/**
 * Customer & Suki Utang Repository
 * Provides offline-first IndexedDB operations with server sync for customers and credit ledger
 */

import { getDB, STORES } from './database';
import type { Customer, CustomerLedgerEntry } from '../types/customer';
import type { PendingSale } from '../types/sale';
import { generateUUID } from '../utils/uuid';
import { nowISO } from '../utils/date';
import { api } from '../api/client';

/**
 * Get all active customers from IndexedDB
 */
export async function getAllCustomers(): Promise<Customer[]> {
  const db = await getDB();
  const tx = db.transaction(STORES.CUSTOMERS, 'readonly');
  const store = tx.objectStore(STORES.CUSTOMERS);
  const list = await store.getAll();
  return list.filter(c => c.is_active);
}

/**
 * Get single customer with their local ledger entries
 */
export async function getCustomerWithLedger(id: number): Promise<{ customer: Customer; ledger: CustomerLedgerEntry[] } | null> {
  const db = await getDB();
  const customer = await db.get(STORES.CUSTOMERS, id);
  if (!customer) return null;

  // Try fetching ledger from server if online
  try {
    const res = await api.get<{ success: boolean; data: { customer: Customer } }>(`/customers/${id}`);
    if (res.data?.customer?.ledger) {
      return { customer: res.data.customer, ledger: res.data.customer.ledger };
    }
  } catch (_) {
    // Offline fallback to local IndexedDB
  }

  const tx = db.transaction(STORES.CUSTOMER_LEDGER, 'readonly');
  const store = tx.objectStore(STORES.CUSTOMER_LEDGER);
  const index = store.index('by-customer-id');
  const allEntries = await index.getAll(id);
  allEntries.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return { customer, ledger: allEntries };
}

/**
 * Save or create a customer
 */
export async function saveCustomer(data: {
  id?: number;
  name: string;
  phone?: string;
  address?: string;
  credit_limit?: number;
  initial_balance?: number;
  notes?: string;
}): Promise<Customer> {
  const db = await getDB();
  const now = nowISO();

  // Try direct server write first if online
  if (navigator.onLine) {
    try {
      if (data.id) {
        await api.put(`/customers/${data.id}`, data);
      } else {
        const res = await api.post<{ success: boolean; data: any }>('/customers', data);
        if (res.data?.id) {
          data.id = res.data.id;
        }
      }
    } catch (e) {
      console.warn('Server customer save skipped/failed, saving locally:', e);
    }
  }

  const id = data.id || Date.now();
  const existing = await db.get(STORES.CUSTOMERS, id);

  const customer: Customer = {
    id,
    uuid: existing?.uuid || generateUUID(),
    name: data.name,
    phone: data.phone || null,
    address: data.address || null,
    credit_limit: data.credit_limit ?? (existing?.credit_limit || 0),
    current_balance: existing
      ? existing.current_balance
      : (data.initial_balance || 0),
    notes: data.notes || null,
    is_active: true,
    created_at: existing?.created_at || now,
    updated_at: now,
  };

  await db.put(STORES.CUSTOMERS, customer);

  // If initial balance was set on new customer, create local ledger charge
  if (!existing && (data.initial_balance || 0) > 0) {
    const ledgerEntry: CustomerLedgerEntry = {
      id: Date.now(),
      uuid: generateUUID(),
      customer_id: id,
      transaction_type: 'CHARGE',
      amount: data.initial_balance || 0,
      balance_after: data.initial_balance || 0,
      reference_type: 'INITIAL_BALANCE',
      reference_id: `INIT-${String(id).slice(-4)}`,
      payment_method: 'Credit',
      notes: 'Panimulang balanse ng utang',
      created_at: now,
    };
    await db.put(STORES.CUSTOMER_LEDGER, ledgerEntry);
  }

  // Notify UI
  window.dispatchEvent(new CustomEvent('pos_customers_updated'));
  return customer;
}

/**
 * Record a debt payment (Magbayad ng Utang)
 */
export async function recordCustomerPayment(
  customerId: number,
  amount: number,
  paymentMethod: string = 'Cash',
  notes: string = 'Bayad sa utang'
): Promise<{ success: boolean; paymentReceipt?: string; newBalance: number }> {
  const db = await getDB();
  const now = nowISO();
  let paymentReceipt = 'PAY-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

  let newBalance = 0;

  // Try server call first
  if (navigator.onLine) {
    try {
      const res = await api.post<{ success: boolean; data: any }>(`/customers/${customerId}/payment`, {
        amount,
        payment_method: paymentMethod,
        notes,
      });
      if (res.data?.payment?.remaining_balance !== undefined) {
        newBalance = res.data.payment.remaining_balance;
        paymentReceipt = res.data.payment.receipt_number;
      }
    } catch (e) {
      console.warn('Server payment call failed, recording offline in IndexedDB:', e);
    }
  }

  // Update local IndexedDB
  const customer = await db.get(STORES.CUSTOMERS, customerId);
  if (customer) {
    const prevBal = customer.current_balance;
    newBalance = Math.max(0, prevBal - amount);
    customer.current_balance = newBalance;
    customer.updated_at = now;
    await db.put(STORES.CUSTOMERS, customer);

    const ledgerEntry: CustomerLedgerEntry = {
      id: Date.now(),
      uuid: generateUUID(),
      customer_id: customerId,
      transaction_type: 'PAYMENT',
      amount,
      balance_after: newBalance,
      reference_type: 'DEBT_PAYMENT',
      reference_id: paymentReceipt,
      payment_method: paymentMethod,
      notes,
      created_at: now,
    };
    await db.put(STORES.CUSTOMER_LEDGER, ledgerEntry);
  }

  window.dispatchEvent(new CustomEvent('pos_customers_updated'));
  return { success: true, paymentReceipt, newBalance };
}

/**
 * Record a sale on Utang (Credit Charge) locally in IndexedDB
 */
export async function recordLocalCreditCharge(
  customerId: number, 
  sale: PendingSale, 
  customAmount?: number
): Promise<void> {
  const db = await getDB();
  const customer = await db.get(STORES.CUSTOMERS, customerId);
  if (!customer) return;

  const chargeAmount = customAmount !== undefined ? customAmount : sale.total_amount;
  if (chargeAmount <= 0) return;

  const newBalance = customer.current_balance + chargeAmount;
  customer.current_balance = newBalance;
  customer.updated_at = sale.sold_at;
  await db.put(STORES.CUSTOMERS, customer);

  const cashDown = sale.cash_tendered && sale.cash_tendered > 0 ? sale.cash_tendered : 0;
  const isSplit = cashDown > 0;
  const defaultNote = isSplit 
    ? `Benta sa POS - Split Payment (DP: ₱${cashDown.toFixed(2)}, Utang: ₱${chargeAmount.toFixed(2)})`
    : 'Benta sa POS - Utang';

  const ledgerEntry: CustomerLedgerEntry = {
    id: Date.now(),
    uuid: generateUUID(),
    customer_id: customerId,
    transaction_type: 'CHARGE',
    amount: chargeAmount,
    balance_after: newBalance,
    reference_type: 'SALE',
    reference_id: sale.receipt_number,
    payment_method: 'Utang / Credit',
    notes: sale.notes || defaultNote,
    created_at: sale.sold_at,
  };
  await db.put(STORES.CUSTOMER_LEDGER, ledgerEntry);

  window.dispatchEvent(new CustomEvent('pos_customers_updated'));
}

/**
 * Reverse a credit charge locally when a sale is voided/cancelled
 */
export async function reverseLocalCreditCharge(
  customerId: number,
  sale: { receipt_number: string; total_amount: number; cash_tendered?: number | null; notes?: string | null },
  customAmount?: number
): Promise<void> {
  const db = await getDB();
  const customer = await db.get(STORES.CUSTOMERS, customerId);
  if (!customer) return;

  const cashDown = sale.cash_tendered && sale.cash_tendered > 0 ? sale.cash_tendered : 0;
  const reversalAmount = customAmount !== undefined ? customAmount : Math.max(0, sale.total_amount - cashDown);
  if (reversalAmount <= 0) return;

  const newBalance = Math.max(0, customer.current_balance - reversalAmount);
  customer.current_balance = newBalance;
  customer.updated_at = new Date().toISOString();
  await db.put(STORES.CUSTOMERS, customer);

  const ledgerEntry: CustomerLedgerEntry = {
    id: Date.now(),
    uuid: generateUUID(),
    customer_id: customerId,
    transaction_type: 'PAYMENT',
    amount: reversalAmount,
    balance_after: newBalance,
    reference_type: 'VOID',
    reference_id: sale.receipt_number,
    payment_method: 'Void / Cancel',
    notes: `Kanselado / Void ang Resibo #${sale.receipt_number}`,
    created_at: new Date().toISOString(),
  };
  await db.put(STORES.CUSTOMER_LEDGER, ledgerEntry);

  window.dispatchEvent(new CustomEvent('pos_customers_updated'));
}

/**
 * Replace all customers in IndexedDB (used during sync)
 */
export async function replaceAllCustomers(customers: Customer[]): Promise<void> {
  if (!customers || customers.length === 0) return;
  const db = await getDB();
  const tx = db.transaction(STORES.CUSTOMERS, 'readwrite');
  const store = tx.objectStore(STORES.CUSTOMERS);
  await store.clear();
  for (const c of customers) {
    await store.put(c);
  }
  await tx.done;
  window.dispatchEvent(new CustomEvent('pos_customers_updated'));
}

/**
 * Get total debt payments collected on a specific date (YYYY-MM-DD)
 * Sums all 'PAYMENT' transactions recorded on that day across all suki customers
 */
export async function getDebtPaymentsTotalForDate(dateStr: string): Promise<number> {
  let serverTotal: number | null = null;
  // Try server first if online
  if (navigator.onLine) {
    try {
      const res = await api.get<{ success: boolean; data: { collected_for_date: number } }>(`/customers?date=${dateStr}`);
      if (res.data?.collected_for_date !== undefined) {
        serverTotal = Number(res.data.collected_for_date) || 0;
      }
    } catch (_) {}
  }

  // Calculate from local IndexedDB
  try {
    const db = await getDB();
    const tx = db.transaction(STORES.CUSTOMER_LEDGER, 'readonly');
    const store = tx.objectStore(STORES.CUSTOMER_LEDGER);
    const allEntries = await store.getAll();
    const localTotal = allEntries
      .filter(e => e.transaction_type === 'PAYMENT' && e.created_at && e.created_at.startsWith(dateStr))
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    return serverTotal !== null ? Math.max(serverTotal, localTotal) : localTotal;
  } catch (err) {
    console.warn('Could not calculate debt payments for date:', err);
    return serverTotal || 0;
  }
}

