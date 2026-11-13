/**
 * Sales Repository - IndexedDB operations for offline sales
 * 
 * Every sale is stored as a complete atomic document (header + items + payment).
 * This ensures no partial sales can exist even if the app crashes mid-write.
 */

import { getDB } from './database';
import type { PendingSale } from '../types/sale';
import type { SyncStatus as SyncStatusType } from '../types/sale';
import { adjustProductStock } from './productRepository';
import { reverseLocalCreditCharge } from './customerRepository';
import { voidSaleFromDailyClosing } from './closingRepository';

/**
 * Save a new sale to IndexedDB
 * This is an atomic write — the entire sale (header + items) is one document
 */
export async function saveSale(sale: PendingSale): Promise<void> {
  const db = await getDB();
  await db.put('pendingSales', sale);
}

/**
 * Get all pending (unsynced) sales
 */
export async function getPendingSales(): Promise<PendingSale[]> {
  const db = await getDB();
  return db.getAllFromIndex('pendingSales', 'by-status', 'PENDING');
}

/**
 * Get all sales (any status)
 */
export async function getAllSales(): Promise<PendingSale[]> {
  const db = await getDB();
  const sales = await db.getAll('pendingSales');
  // Sort by sold_at descending
  return sales.sort((a, b) => new Date(b.sold_at).getTime() - new Date(a.sold_at).getTime());
}

/**
 * Get failed sales
 */
export async function getFailedSales(): Promise<PendingSale[]> {
  const db = await getDB();
  return db.getAllFromIndex('pendingSales', 'by-status', 'FAILED');
}

/**
 * Get a specific sale by UUID
 */
export async function getSaleByUuid(uuid: string): Promise<PendingSale | undefined> {
  const db = await getDB();
  return db.get('pendingSales', uuid);
}

/**
 * Update the sync status of a sale
 */
export async function updateSaleStatus(
  uuid: string, 
  status: SyncStatusType, 
  error?: string
): Promise<void> {
  const db = await getDB();
  const sale = await db.get('pendingSales', uuid);
  if (sale) {
    sale.sync_status = status;
    if (error) sale.sync_error = error;
    if (status === 'SYNCED') sale.synced_at = new Date().toISOString();
    await db.put('pendingSales', sale);
  }
}

/**
 * Mark multiple sales as synced
 */
export async function markSalesSynced(uuids: string[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('pendingSales', 'readwrite');
  
  for (const uuid of uuids) {
    const sale = await tx.store.get(uuid);
    if (sale) {
      sale.sync_status = 'SYNCED';
      sale.synced_at = new Date().toISOString();
      await tx.store.put(sale);
    }
  }
  
  await tx.done;
}

/**
 * Mark multiple sales as failed
 */
export async function markSalesFailed(
  failures: Array<{ uuid: string; error: string }>
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('pendingSales', 'readwrite');
  
  for (const { uuid, error } of failures) {
    const sale = await tx.store.get(uuid);
    if (sale) {
      sale.sync_status = 'FAILED';
      sale.sync_error = error;
      await tx.store.put(sale);
    }
  }
  
  await tx.done;
}

/**
 * Reset failed sales back to pending for retry
 */
export async function resetFailedSales(): Promise<number> {
  const db = await getDB();
  const failed = await db.getAllFromIndex('pendingSales', 'by-status', 'FAILED');
  const tx = db.transaction('pendingSales', 'readwrite');
  
  for (const sale of failed) {
    sale.sync_status = 'PENDING';
    sale.sync_error = undefined;
    await tx.store.put(sale);
  }
  
  await tx.done;
  return failed.length;
}

/**
 * Get counts by sync status
 */
export async function getSyncCounts(): Promise<{
  pending: number;
  synced: number;
  failed: number;
  total: number;
}> {
  const db = await getDB();
  const all = await db.getAll('pendingSales');
  
  const counts = { pending: 0, synced: 0, failed: 0, total: all.length };
  for (const sale of all) {
    if (sale.sync_status === 'PENDING') counts.pending++;
    else if (sale.sync_status === 'SYNCED') counts.synced++;
    else if (sale.sync_status === 'FAILED') counts.failed++;
  }
  
  return counts;
}

/**
 * Delete synced sales older than the given number of days
 * (Cleanup to prevent IndexedDB from growing indefinitely)
 */
export async function cleanupOldSyncedSales(daysToKeep: number = 30): Promise<number> {
  const db = await getDB();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  const cutoffStr = cutoffDate.toISOString();
  
  const all = await db.getAll('pendingSales');
  const tx = db.transaction('pendingSales', 'readwrite');
  let deleted = 0;
  
  for (const sale of all) {
    if (sale.sync_status === 'SYNCED' && sale.sold_at < cutoffStr) {
      await tx.store.delete(sale.uuid);
      deleted++;
    }
  }
  
  await tx.done;
  return deleted;
}

/**
 * Delete a specific sale by UUID (e.g. discard a test or failed sale)
 */
export async function deleteSale(uuid: string): Promise<void> {
  const db = await getDB();
  await db.delete('pendingSales', uuid);
}

/**
 * Delete multiple sales by an array of UUIDs
 */
export async function deleteMultipleSales(uuids: string[]): Promise<number> {
  if (!uuids || uuids.length === 0) return 0;
  const db = await getDB();
  const tx = db.transaction('pendingSales', 'readwrite');
  for (const uuid of uuids) {
    await tx.store.delete(uuid);
  }
  await tx.done;
  return uuids.length;
}

/**
 * Delete all synced sales from IndexedDB to free up local device storage
 */
export async function clearAllSyncedSales(): Promise<number> {
  const db = await getDB();
  const all = await db.getAll('pendingSales');
  const tx = db.transaction('pendingSales', 'readwrite');
  let deleted = 0;
  for (const sale of all) {
    if (sale.sync_status === 'SYNCED') {
      await tx.store.delete(sale.uuid);
      deleted++;
    }
  }
  await tx.done;
  return deleted;
}

/**
 * Delete all failed sales from IndexedDB
 */
export async function clearFailedSales(): Promise<number> {
  const db = await getDB();
  const failed = await db.getAllFromIndex('pendingSales', 'by-status', 'FAILED');
  const tx = db.transaction('pendingSales', 'readwrite');
  for (const sale of failed) {
    await tx.store.delete(sale.uuid);
  }
  await tx.done;
  return failed.length;
}

/**
 * Generate a unique receipt number
 * Format: POS-YYYYMMDD-XXXX (e.g., POS-20261019-0001)
 */
export async function generateReceiptNumber(): Promise<string> {
  const db = await getDB();
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');

  // Get device identifier suffix (e.g. A93D) to guarantee uniqueness across multiple phones
  let devCode = 'D1';
  try {
    const rawDevId = localStorage.getItem('pos_device_id') || '';
    const match = rawDevId.match(/[a-zA-Z0-9]{3,4}$/);
    if (match) devCode = match[0].toUpperCase();
  } catch (_) {}

  const prefix = `POS-${dateStr}-${devCode}-`;
  const legacyPrefix = `POS-${dateStr}-`;
  
  // Get all sales from today to find highest sequence
  const all = await db.getAll('pendingSales');
  let maxSeq = 0;

  for (const sale of all) {
    if (!sale.receipt_number) continue;
    if (sale.receipt_number.startsWith(prefix)) {
      const seqStr = sale.receipt_number.slice(prefix.length);
      const seq = parseInt(seqStr, 10);
      if (seq > maxSeq) maxSeq = seq;
    } else if (sale.receipt_number.startsWith(legacyPrefix)) {
      const parts = sale.receipt_number.split('-');
      const lastPart = parts[parts.length - 1];
      const seq = parseInt(lastPart, 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  }
  
  const nextSeq = (maxSeq + 1).toString().padStart(4, '0');
  return `${prefix}${nextSeq}`;
}

/**
 * Void a sale locally:
 * 1. Restores inventory stock for each sold item (+qty)
 * 2. Reverses customer credit balance and adds ledger entry if Utang
 * 3. Adjusts Daily Closing draft totals (deducts sold qty, updates financial summary)
 * 4. Removes or marks sale as void in IndexedDB
 * 5. Dispatches UI update events
 */
export async function voidLocalSale(sale: PendingSale | any): Promise<void> {
  const db = await getDB();

  // 1. Restore product inventory
  if (sale.items && Array.isArray(sale.items)) {
    for (const item of sale.items) {
      const pId = item.product_id;
      const qty = item.sell_by_weight ? Number(item.weight_kg ?? item.quantity) : Number(item.quantity);
      if (pId && qty > 0) {
        try {
          await adjustProductStock(
            pId,
            qty,
            'STOCK_IN',
            `Void Resibo #${sale.receipt_number}`
          );
        } catch (err) {
          console.warn(`Could not restock product #${pId} on void:`, err);
        }
      }
    }
  }

  // 2. Reverse customer credit charge if it was an Utang sale
  const pMethodName = (sale.payment_method_name || '').toLowerCase();
  const isUtang = pMethodName.includes('utang') || pMethodName.includes('credit');
  if (isUtang && sale.customer_id) {
    try {
      await reverseLocalCreditCharge(sale.customer_id, sale);
    } catch (custErr) {
      console.warn('Could not reverse credit charge for customer:', custErr);
    }
  }

  // 3. Reverse from Daily Closing
  try {
    await voidSaleFromDailyClosing({
      sold_at: sale.sold_at,
      items: (sale.items || []).map((it: any) => ({
        product_id: it.product_id,
        product_name: it.product_name,
        quantity: it.sell_by_weight ? Number(it.weight_kg ?? it.quantity) : Number(it.quantity),
      })),
      total_amount: sale.total_amount,
      cash_tendered: sale.cash_tendered,
      payment_method_name: sale.payment_method_name,
    });
  } catch (closeErr) {
    console.warn('Could not update daily closing on void:', closeErr);
  }

  // 4. Delete the sale from pendingSales store
  if (sale.uuid) {
    try {
      await db.delete('pendingSales', sale.uuid);
    } catch (delErr) {
      console.warn('Could not delete pending sale from IndexedDB:', delErr);
    }
  }

  // 5. Dispatch sync and inventory update events
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('pos_sale_completed'));
    window.dispatchEvent(new CustomEvent('pos_inventory_updated'));
    window.dispatchEvent(new CustomEvent('pos_customers_updated'));
    try {
      const ch = new BroadcastChannel('pos_channel');
      ch.postMessage({ type: 'SALE_COMPLETED' });
      ch.postMessage({ type: 'INVENTORY_UPDATED' });
      ch.close();
    } catch (_) {}
  }
}
