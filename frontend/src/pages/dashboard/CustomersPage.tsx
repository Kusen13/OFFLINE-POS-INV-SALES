/**
 * Customers & Suki Utang Page (Talaan ng Utang)
 * 
 * Features:
 * - Summary metric cards (Total Receivables, Active Debtors, Collected Today)
 * - Customer list with filter (All, May Utang Lamang, Bayad Na)
 * - Search by name, phone, or address
 * - Partial or Full Debt Payment modal with automatic receipt generation
 * - Transaction Ledger modal showing full history of charges and payments
 * - Add/Edit Suki modal
 * - Offline-capable via IndexedDB with automatic server sync
 */

import { useState, useEffect, useMemo } from 'react';
import { formatCurrency } from '../../utils/currency';
import { getAllCustomers, getCustomerWithLedger, saveCustomer, recordCustomerPayment } from '../../db/customerRepository';
import { api } from '../../api/client';
import type { Customer, CustomerLedgerEntry } from '../../types/customer';

export function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'debtors' | 'settled'>('all');

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [payingCustomer, setPayingCustomer] = useState<Customer | null>(null);
  const [ledgerCustomer, setLedgerCustomer] = useState<{ customer: Customer; ledger: CustomerLedgerEntry[] } | null>(null);
  const [lastPaymentReceipt, setLastPaymentReceipt] = useState<any | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    address: '',
    credit_limit: '',
    initial_balance: '',
    notes: '',
  });

  // Payment form state
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'GCash'>('Cash');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3500);
  };

  useEffect(() => {
    loadCustomers();
    const handleUpdate = () => loadCustomers();
    window.addEventListener('pos_customers_updated', handleUpdate);
    return () => window.removeEventListener('pos_customers_updated', handleUpdate);
  }, []);

  async function loadCustomers() {
    try {
      setLoading(true);
      // Try fetching from server first if online
      if (navigator.onLine) {
        try {
          const res = await api.get<{ success: boolean; data: { customers: Customer[] } }>('/customers');
          if (res.data?.customers) {
            setCustomers(res.data.customers);
            setLoading(false);
            return;
          }
        } catch (_) {}
      }
      // Local fallback
      const local = await getAllCustomers();
      setCustomers(local);
    } finally {
      setLoading(false);
    }
  }

  // Derived summaries
  const totalReceivables = useMemo(() => {
    return customers.reduce((sum, c) => sum + (c.current_balance > 0 ? c.current_balance : 0), 0);
  }, [customers]);

  const debtorCount = useMemo(() => {
    return customers.filter(c => c.current_balance > 0).length;
  }, [customers]);

  const settledCount = useMemo(() => {
    return customers.filter(c => c.current_balance <= 0).length;
  }, [customers]);

  // Filtered customer list
  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      const matchesSearch =
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.phone && c.phone.toLowerCase().includes(search.toLowerCase())) ||
        (c.address && c.address.toLowerCase().includes(search.toLowerCase()));

      if (!matchesSearch) return false;
      if (filter === 'debtors') return c.current_balance > 0;
      if (filter === 'settled') return c.current_balance <= 0;
      return true;
    });
  }, [customers, search, filter]);

  // Open Add/Edit Modal
  function handleOpenAddEdit(c?: Customer) {
    if (c) {
      setEditingCustomer(c);
      setFormData({
        name: c.name,
        phone: c.phone || '',
        address: c.address || '',
        credit_limit: c.credit_limit ? String(c.credit_limit) : '',
        initial_balance: '',
        notes: c.notes || '',
      });
    } else {
      setEditingCustomer(null);
      setFormData({
        name: '',
        phone: '',
        address: '',
        credit_limit: '2000',
        initial_balance: '',
        notes: '',
      });
    }
    setShowAddModal(true);
  }

  // Save Suki
  async function handleSaveCustomer(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.name.trim()) return;

    try {
      setIsSubmitting(true);
      await saveCustomer({
        id: editingCustomer?.id,
        name: formData.name.trim(),
        phone: formData.phone.trim() || undefined,
        address: formData.address.trim() || undefined,
        credit_limit: parseFloat(formData.credit_limit) || 0,
        initial_balance: parseFloat(formData.initial_balance) || 0,
        notes: formData.notes.trim() || undefined,
      });

      setShowAddModal(false);
      showToast(editingCustomer ? '✓ Na-update ang impormasyon ng suki' : '✓ Matagumpay na nairehistro ang bagong suki');
      loadCustomers();
    } catch (err: any) {
      alert('Error: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  // Open Pay Modal
  function handleOpenPay(c: Customer) {
    setPayingCustomer(c);
    setPaymentAmount(String(c.current_balance > 0 ? c.current_balance : ''));
    setPaymentMethod('Cash');
    setPaymentNotes('');
  }

  // Submit Payment
  async function handleSubmitPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payingCustomer) return;
    const amt = parseFloat(paymentAmount);
    if (!amt || amt <= 0) {
      alert('Maglagay ng tamang halaga ng ibabayad');
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await recordCustomerPayment(payingCustomer.id, amt, paymentMethod, paymentNotes || 'Bayad sa utang');
      
      setLastPaymentReceipt({
        receiptNumber: res.paymentReceipt,
        customerName: payingCustomer.name,
        amountPaid: amt,
        previousBalance: payingCustomer.current_balance,
        remainingBalance: res.newBalance,
        method: paymentMethod,
        date: new Date().toLocaleString('en-PH'),
      });

      setPayingCustomer(null);
      showToast(`✓ Naitala ang bayad na ₱${amt.toFixed(2)} para kay ${payingCustomer.name}!`);
      loadCustomers();
    } catch (err: any) {
      alert('Error sa pagbayad: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  // Open Ledger Modal
  async function handleOpenLedger(c: Customer) {
    const data = await getCustomerWithLedger(c.id);
    if (data) {
      setLedgerCustomer(data);
    }
  }

  // 1-Click Reminder for SMS / Messenger
  function handleCopyReminder(c: Customer) {
    const formattedBalance = formatCurrency(c.current_balance);
    const text = `Magandang araw po ${c.name}!\n\nMagalang po naming pinapaalala ang inyong natitirang balanse sa tindahan na ${formattedBalance}.\n\nMaraming salamat po sa inyong patuloy na pagtangkilik! 🙏`;
    navigator.clipboard.writeText(text).then(() => {
      showToast(`✓ Na-kopya ang paalala para kay ${c.name}! Pwedeng i-paste sa SMS o Messenger.`);
    }).catch(() => {
      alert(text);
    });
  }

  // 1-Click Detailed Statement for SMS / Messenger
  function handleCopyDetailedStatement(c: Customer, ledger: CustomerLedgerEntry[]) {
    const formattedBalance = formatCurrency(c.current_balance);
    const dateStr = new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
    
    let text = `📋 TALAAN NG UTANG AT BAYAD\n`;
    text += `Suki: ${c.name}\n`;
    text += `Petsa: ${dateStr}\n`;
    text += `Kasalukuyang Balanse: ${formattedBalance}\n`;
    if (c.credit_limit > 0) {
      text += `Credit Limit: ${formatCurrency(c.credit_limit)}\n`;
    }
    text += `\nMga Huling Transaksyon:\n`;

    const recent = ledger.slice(0, 5);
    if (recent.length === 0) {
      text += `(Walang naitalang detalye)\n`;
    } else {
      recent.forEach(e => {
        const typeStr = e.transaction_type === 'CHARGE' ? '🔴 Utang' : '🟢 Bayad';
        const dStr = new Date(e.created_at).toLocaleDateString('en-PH', { month: 'numeric', day: 'numeric' });
        text += `• ${dStr} - ${typeStr}: ${formatCurrency(e.amount)} (${e.notes || e.reference_id})\n`;
      });
    }

    text += `\nMaraming salamat po sa inyong patuloy na pagtangkilik! 🙏`;

    navigator.clipboard.writeText(text).then(() => {
      showToast(`✓ Na-kopya ang buong statement para kay ${c.name}! Pwedeng i-paste sa Messenger o SMS.`);
    }).catch(() => {
      alert(text);
    });
  }

  // 1-Click Payment Receipt Copy for Messenger / SMS
  function handleCopyPaymentReceipt() {
    if (!lastPaymentReceipt) return;
    let storeName = 'AKING TINDAHAN';
    try {
      const cfg = JSON.parse(localStorage.getItem('pos_app_settings') || '{}');
      if (cfg.store_name) storeName = cfg.store_name;
    } catch {}

    let text = `🧾 OFFICIAL PAYMENT RECEIPT\n`;
    text += `Tindahan: ${storeName}\n`;
    text += `Petsa: ${lastPaymentReceipt.date}\n`;
    text += `Resibo #: ${lastPaymentReceipt.receiptNumber}\n`;
    text += `Suki: ${lastPaymentReceipt.customerName}\n`;
    text += `--------------------------------\n`;
    text += `Halagang Ibinayad: ${formatCurrency(lastPaymentReceipt.amountPaid)} (${lastPaymentReceipt.method})\n`;
    if (lastPaymentReceipt.previousBalance != null) {
      text += `Dating Utang: ${formatCurrency(lastPaymentReceipt.previousBalance)}\n`;
    }
    text += `Natitirang Balanse: ${formatCurrency(lastPaymentReceipt.remainingBalance)}\n`;
    text += `--------------------------------\n`;
    text += `Thank you for your payment! 🙏`;

    navigator.clipboard.writeText(text).then(() => {
      showToast(`✓ Payment receipt copied to clipboard!`);
    }).catch(() => {
      alert(text);
    });
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-1.5 sm:space-y-2 animate-fade-in pb-16 lg:pb-0">
      {/* Toast Notification */}
      {notification && (
        <div className="fixed top-4 right-4 z-50 bg-emerald-600 text-white font-semibold px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-2 animate-bounce text-xs sm:text-sm">
          <span>{notification}</span>
        </div>
      )}

      {/* ── ROW 1: Title + Filter Pills + Refresh + New Customer ── */}
      <div className="flex-shrink-0 flex items-center justify-between gap-1.5 flex-nowrap overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-sm font-bold text-surface-100 whitespace-nowrap shrink-0 flex items-center gap-1">
            <span>📒</span> Credit & Receivables
          </span>

          {/* Filter Pills */}
          <div className="flex items-center bg-surface-900 border border-surface-700/60 rounded-lg p-0.5 shrink-0">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer whitespace-nowrap ${
                filter === 'all' ? 'bg-primary-600 text-white shadow-xs' : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              All ({customers.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('debtors')}
              className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer whitespace-nowrap ${
                filter === 'debtors' ? 'bg-rose-600 text-white shadow-xs' : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              With Debt ({debtorCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter('settled')}
              className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer whitespace-nowrap ${
                filter === 'settled' ? 'bg-emerald-600 text-white shadow-xs' : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              Settled ({settledCount})
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => loadCustomers()}
            className="h-7 px-2 rounded-lg bg-surface-800 hover:bg-surface-700 text-surface-300 border border-surface-700/60 text-[11px] font-semibold transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 shadow-xs cursor-pointer"
            title="Refresh"
          >
            <span>🔄</span> <span className="hidden sm:inline">Refresh</span>
          </button>
          <button
            type="button"
            onClick={() => handleOpenAddEdit()}
            className="h-7 px-3 rounded-lg bg-primary-600 hover:bg-primary-500 text-white text-[11px] font-semibold transition-colors shadow-xs flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>+ New Customer</span>
          </button>
        </div>
      </div>

      {/* ── ROW 2: Search + KPI Ribbon ── */}
      <div className="flex-shrink-0 flex items-center gap-1.5 flex-nowrap overflow-x-auto no-scrollbar">
        <div className="relative flex-1 min-w-[130px] max-w-xs">
          <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search customer (Name, Mobile, Address)..."
            className="w-full h-7 pl-7 pr-3 text-[11px] rounded-lg bg-surface-900 border border-surface-700/60 text-surface-100 placeholder-surface-500 focus:outline-none focus:border-primary-500"
          />
        </div>
        <span className="h-7 px-2 rounded-lg bg-surface-800/70 border border-surface-700/40 flex items-center gap-1 text-[10px] font-bold shrink-0">
          <span className="text-surface-400">Total Receivables</span>
          <span className="text-rose-400">{formatCurrency(totalReceivables)}</span>
        </span>
        <span className="h-7 px-2 rounded-lg bg-surface-800/70 border border-surface-700/40 flex items-center gap-1 text-[10px] font-bold shrink-0">
          <span className="text-surface-400">Debtors</span>
          <span className="text-amber-400">{debtorCount}</span>
        </span>
        <span className="h-7 px-2 rounded-lg bg-surface-800/70 border border-surface-700/40 flex items-center gap-1 text-[10px] font-bold shrink-0 hidden sm:flex">
          <span className="text-surface-400">Settled</span>
          <span className="text-emerald-400">{settledCount}</span>
        </span>
      </div>

      {/* Main Table Container */}
      <div className="flex-1 min-h-0 bg-surface-800/50 rounded-xl border border-surface-700/50 flex flex-col overflow-hidden shadow-sm">
        {loading ? (
          <div className="flex-1 min-h-0 flex items-center justify-center py-16">
            <div className="flex flex-col items-center gap-2">
              <div className="w-8 h-8 border-3 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
              <p className="text-xs text-surface-400">Kinukuha ang talaan ng mga customer...</p>
            </div>
          </div>
        ) : filteredCustomers.length === 0 ? (
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center py-12 text-center">
            <span className="text-3xl mb-2 block">📒</span>
            <p className="text-surface-300 font-medium text-xs sm:text-sm">Walang nahanap na customer</p>
            <p className="text-surface-500 text-[11px] mt-0.5">Subukan ang ibang keyword o i-reset ang filter</p>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[720px] whitespace-nowrap">
              <thead className="sticky top-0 bg-surface-900 border-b border-surface-700/60 z-10 shadow-xs">
                <tr className="text-[11px] font-bold text-surface-400 uppercase tracking-wider">
                  <th className="py-2 px-3">Customer Name</th>
                  <th className="py-2 px-3">Contact & Address</th>
                  <th className="py-2 px-3 text-right">Balance</th>
                  <th className="py-2 px-3 text-right">Credit Limit</th>
                  <th className="py-2 px-3">Notes</th>
                  <th className="py-2 px-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-800/60 text-sm">
                  {filteredCustomers.map(c => {
                    const hasDebt = c.current_balance > 0;
                    const percentUsed = c.credit_limit > 0 ? (c.current_balance / c.credit_limit) * 100 : 0;
                    const isOverLimit = c.credit_limit > 0 && c.current_balance > c.credit_limit;

                    return (
                      <tr key={c.id} className="hover:bg-surface-800/30 transition-colors">
                        {/* Name */}
                        <td className="py-3.5 px-4 font-bold text-surface-100">
                          <div className="flex items-center gap-2.5">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-xs ${
                              hasDebt ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            }`}>
                              {c.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <span className="font-bold text-surface-100">{c.name}</span>
                              {isOverLimit && (
                                <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 font-semibold">
                                  Over Limit!
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Phone & Address */}
                        <td className="py-3.5 px-4 text-xs text-surface-300">
                          <div>{c.phone || <span className="text-surface-500">—</span>}</div>
                          <div className="text-surface-400 text-[11px] truncate max-w-xs">{c.address || ''}</div>
                        </td>

                        {/* Balance */}
                        <td className="py-2.5 px-3 text-right font-mono">
                          <span className={`font-black text-sm sm:text-base ${hasDebt ? 'text-rose-400' : 'text-emerald-400'}`}>
                            {formatCurrency(c.current_balance)}
                          </span>
                        </td>

                        {/* Credit Limit */}
                        <td className="py-3.5 px-4 text-right font-mono text-xs text-surface-400">
                          <div>{c.credit_limit > 0 ? formatCurrency(c.credit_limit) : 'No limit'}</div>
                          {c.credit_limit > 0 && (
                            <div className="w-20 ml-auto bg-surface-700 h-1.5 rounded-full overflow-hidden mt-1">
                              <div
                                className={`h-full ${percentUsed > 90 ? 'bg-rose-500' : percentUsed > 60 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                style={{ width: `${Math.min(100, percentUsed)}%` }}
                              />
                            </div>
                          )}
                        </td>

                        {/* Notes */}
                        <td className="py-3.5 px-4 text-xs text-surface-400 max-w-[150px] truncate">
                          {c.notes || <span className="text-surface-600">—</span>}
                        </td>

                        {/* Actions */}
                        <td className="py-3.5 px-4">
                          <div className="flex items-center justify-center gap-1.5 flex-wrap">
                            {hasDebt && (
                              <>
                                <button
                                  onClick={() => handleOpenPay(c)}
                                  className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md shadow-emerald-600/20 transition-all flex items-center gap-1 cursor-pointer active:scale-95"
                                  title="Record Debt Payment"
                                >
                                  <span>💵</span> Pay
                                </button>
                                <button
                                  onClick={() => handleCopyReminder(c)}
                                  className="px-2.5 py-1.5 rounded-lg bg-surface-800 hover:bg-surface-700 text-amber-300 border border-amber-500/30 text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer active:scale-95"
                                  title="Copy Reminder message for SMS / Messenger"
                                >
                                  <span>📲</span> Reminder
                                </button>
                              </>
                            )}
                            <button
                              onClick={() => handleOpenLedger(c)}
                              className="px-2.5 py-1.5 rounded-lg bg-surface-800 hover:bg-surface-700 text-sky-400 border border-surface-700 text-xs font-semibold transition-colors flex items-center gap-1 cursor-pointer active:scale-95"
                              title="Customer Ledger Statement"
                            >
                              <span>📜</span> Ledger
                            </button>
                            <button
                              onClick={() => handleOpenAddEdit(c)}
                              className="p-1.5 rounded-lg text-surface-400 hover:text-surface-200 hover:bg-surface-800 transition-colors cursor-pointer"
                              title="Edit Customer"
                            >
                              ✏️
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
        )}
      </div>

      {/* ── MODAL: MAGBAYAD NG UTANG ────────────────────────────────────── */}
      {payingCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md bg-surface-900 border border-surface-700 rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 bg-emerald-950/70 border-b border-emerald-500/30 flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Debt Collection</span>
                <h3 className="text-lg font-bold text-surface-50 mt-0.5">Record Payment: {payingCustomer.name}</h3>
              </div>
              <button onClick={() => setPayingCustomer(null)} className="p-1 rounded-lg text-surface-400 hover:text-surface-200 cursor-pointer">
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitPayment} className="p-5 space-y-4">
              {/* Current Debt Card */}
              <div className="p-3.5 rounded-xl bg-surface-800/80 border border-surface-700/80 flex items-center justify-between">
                <div>
                  <span className="text-xs text-surface-400 block font-medium">Outstanding Balance:</span>
                  <div className="text-2xl font-black text-rose-400 font-mono mt-0.5">
                    {formatCurrency(payingCustomer.current_balance)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPaymentAmount(String(payingCustomer.current_balance))}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 text-xs font-bold hover:bg-emerald-600/30 transition-colors cursor-pointer"
                >
                  Pay Full Balance
                </button>
              </div>

              {/* Payment Amount Input */}
              <div>
                <label className="block text-xs font-bold text-surface-300 uppercase mb-1.5">
                  Payment Amount (₱)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={paymentAmount}
                  onChange={e => setPaymentAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full text-2xl font-bold font-mono text-center py-3 px-4 rounded-xl bg-surface-800 border-2 border-surface-600 focus:border-emerald-500 text-surface-50 focus:outline-none"
                  autoFocus
                />
              </div>

              {/* Quick Preset Buttons */}
              <div className="grid grid-cols-4 gap-1.5">
                {[50, 100, 200, 500].map(amt => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setPaymentAmount(String(amt))}
                    className="py-2 rounded-lg bg-surface-800 hover:bg-surface-700 text-surface-200 border border-surface-700 text-xs font-bold transition-colors cursor-pointer"
                  >
                    ₱{amt}
                  </button>
                ))}
              </div>

              {/* Payment Method */}
              <div>
                <label className="block text-xs font-bold text-surface-300 uppercase mb-1.5">
                  Payment Method
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('Cash')}
                    className={`py-2.5 rounded-xl font-bold text-sm border transition-all cursor-pointer ${
                      paymentMethod === 'Cash'
                        ? 'bg-emerald-600 text-white border-emerald-500 shadow-md shadow-emerald-600/30'
                        : 'bg-surface-800 text-surface-300 border-surface-700 hover:bg-surface-700'
                    }`}
                  >
                    💵 Cash
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('GCash')}
                    className={`py-2.5 rounded-xl font-bold text-sm border transition-all cursor-pointer ${
                      paymentMethod === 'GCash'
                        ? 'bg-sky-600 text-white border-sky-500 shadow-md shadow-sky-600/30'
                        : 'bg-surface-800 text-surface-300 border-surface-700 hover:bg-surface-700'
                    }`}
                  >
                    📱 GCash
                  </button>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-bold text-surface-300 uppercase mb-1.5">
                  Notes / Remarks (Optional)
                </label>
                <input
                  type="text"
                  value={paymentNotes}
                  onChange={e => setPaymentNotes(e.target.value)}
                  placeholder="e.g. Partial payment kinsenas..."
                  className="w-full px-3 py-2 rounded-xl bg-surface-800 border border-surface-700 text-surface-100 text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Remaining Balance Preview */}
              {parseFloat(paymentAmount) > 0 && (
                <div className="p-3 rounded-xl bg-surface-800/50 border border-surface-700/60 text-center">
                  <span className="text-xs text-surface-400 font-medium">Remaining Balance After Payment:</span>
                  <div className="text-lg font-black text-surface-100 font-mono mt-0.5">
                    {formatCurrency(Math.max(0, payingCustomer.current_balance - parseFloat(paymentAmount)))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPayingCustomer(null)}
                  className="flex-1 py-3 rounded-xl bg-surface-800 text-surface-300 font-semibold hover:bg-surface-700 transition-colors text-sm cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !parseFloat(paymentAmount)}
                  className="flex-[2] py-3 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-500 disabled:opacity-40 transition-all text-sm shadow-lg shadow-emerald-600/30 cursor-pointer"
                >
                  {isSubmitting ? 'Recording...' : '✓ Confirm Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: RESIBO NG BAYAD ────────────────────────────────────────── */}
      {lastPaymentReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-sm bg-surface-900 border border-surface-700 rounded-2xl shadow-2xl p-6 text-center space-y-4">
            <div className="w-12 h-12 mx-auto rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-2xl font-bold no-print">
              ✓
            </div>
            
            {/* Printable Thermal Receipt Container */}
            <div id="thermal-receipt" className="p-3 rounded-xl bg-surface-800/80 border border-surface-700 space-y-2 text-left text-xs font-mono">
              <div className="text-center pb-2 border-b border-dashed border-surface-700">
                <p className="font-bold text-surface-100 uppercase text-xs">
                  {(() => {
                    try {
                      const cfg = JSON.parse(localStorage.getItem('pos_app_settings') || '{}');
                      return cfg.store_name || 'AKING TINDAHAN';
                    } catch {
                      return 'AKING TINDAHAN';
                    }
                  })()}
                </p>
                <p className="text-[11px] text-surface-300 font-sans mt-0.5 font-bold">RESIBO NG BAYAD SA UTANG</p>
                <p className="text-[10px] text-surface-400 mt-0.5">{lastPaymentReceipt.receiptNumber}</p>
                <p className="text-[10px] text-surface-400">{lastPaymentReceipt.date}</p>
              </div>

              <div className="space-y-1.5 pt-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-surface-400">Customer:</span>
                  <span className="font-bold text-surface-100">{lastPaymentReceipt.customerName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-surface-400">Amount Paid:</span>
                  <span className="font-bold text-emerald-400 text-sm">{formatCurrency(lastPaymentReceipt.amountPaid)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-surface-400">Method:</span>
                  <span className="text-surface-200">{lastPaymentReceipt.method}</span>
                </div>
                <div className="flex justify-between border-t border-dashed border-surface-700 pt-2">
                  <span className="text-surface-400">Remaining Balance:</span>
                  <span className="font-black text-rose-300 text-sm">{formatCurrency(lastPaymentReceipt.remainingBalance)}</span>
                </div>
              </div>

              <div className="text-center text-[10px] text-surface-400 pt-3 border-t border-dashed border-surface-700">
                Thank you for your business!
              </div>
            </div>

            <div className="flex flex-col gap-2 no-print">
              <button
                onClick={handleCopyPaymentReceipt}
                className="w-full py-2.5 rounded-xl bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 font-semibold text-xs border border-sky-500/30 flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                title="Kopyahin ang resibo para ma-send kay suki sa Messenger o text"
              >
                <span>📲</span>
                <span>Copy for Messenger / SMS</span>
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => window.print()}
                  className="flex-1 py-2.5 rounded-xl bg-surface-800 text-surface-200 font-semibold hover:bg-surface-700 text-xs border border-surface-700 cursor-pointer"
                >
                  🖨️ Print
                </button>
                <button
                  onClick={() => setLastPaymentReceipt(null)}
                  className="flex-1 py-2.5 rounded-xl bg-primary-600 text-white font-bold hover:bg-primary-500 text-xs shadow-md cursor-pointer"
                >
                  Tapos Na
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: KASAYSAYAN NG UTANG AT BAYAD (LEDGER) ───────────────────── */}
      {ledgerCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-2xl bg-surface-900 border border-surface-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-5 py-4 bg-surface-800/80 border-b border-surface-700 flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-sky-400 uppercase tracking-wider">Ledger Statement</span>
                <h3 className="text-lg font-bold text-surface-50 mt-0.5">{ledgerCustomer.customer.name}</h3>
                <p className="text-xs text-surface-400">
                  Current Balance: <span className="font-bold text-rose-400 font-mono">{formatCurrency(ledgerCustomer.customer.current_balance)}</span>
                </p>
              </div>
              <button onClick={() => setLedgerCustomer(null)} className="p-1 rounded-lg text-surface-400 hover:text-surface-200 cursor-pointer">
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {ledgerCustomer.ledger.length === 0 ? (
                <div className="text-center py-12 text-surface-400">
                  <span className="text-3xl">📜</span>
                  <p className="mt-2 text-sm font-medium">No recorded transactions for this customer.</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {ledgerCustomer.ledger.map((entry, idx) => {
                    const isCharge = entry.transaction_type === 'CHARGE';
                    return (
                      <div
                        key={entry.uuid || idx}
                        className={`p-3.5 rounded-xl border flex items-center justify-between transition-colors ${
                          isCharge
                            ? 'bg-rose-950/20 border-rose-500/30'
                            : 'bg-emerald-950/20 border-emerald-500/30'
                        }`}
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-md ${
                              isCharge ? 'bg-rose-500/30 text-rose-300' : 'bg-emerald-500/30 text-emerald-300'
                            }`}>
                              {isCharge ? '🔴 CHARGE' : '🟢 PAYMENT'}
                            </span>
                            <span className="text-xs text-surface-400 font-mono">{entry.reference_id}</span>
                          </div>
                          <p className="text-xs text-surface-300 font-medium">{entry.notes || 'No remarks'}</p>
                          <p className="text-[11px] text-surface-500">{new Date(entry.created_at).toLocaleString('en-PH')}</p>
                        </div>

                        <div className="text-right font-mono">
                          <span className={`text-base font-black ${isCharge ? 'text-rose-400' : 'text-emerald-400'}`}>
                            {isCharge ? '+' : '-'}{formatCurrency(entry.amount)}
                          </span>
                          <div className="text-[11px] text-surface-400 font-sans">
                            Balance: <span className="font-mono text-surface-200">{formatCurrency(entry.balance_after)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="p-4 bg-surface-800/60 border-t border-surface-700 flex items-center justify-between gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => handleCopyDetailedStatement(ledgerCustomer.customer, ledgerCustomer.ledger)}
                className="px-3.5 py-2 rounded-xl bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                title="Copy statement to paste in Messenger or SMS"
              >
                <span>📋</span>
                <span>Copy Statement (Messenger / SMS)</span>
              </button>
              <button
                onClick={() => setLedgerCustomer(null)}
                className="px-5 py-2 rounded-xl bg-surface-700 text-surface-200 font-semibold hover:bg-surface-600 text-sm transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: BAGONG SUKI O I-EDIT ────────────────────────────────────── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md bg-surface-900 border border-surface-700 rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 bg-surface-800/80 border-b border-surface-700 flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-primary-400 uppercase tracking-wider">Customer Management</span>
                <h3 className="text-lg font-bold text-surface-50 mt-0.5">
                  {editingCustomer ? 'Edit Customer Details' : '+ Register New Customer'}
                </h3>
              </div>
              <button onClick={() => setShowAddModal(false)} className="p-1 rounded-lg text-surface-400 hover:text-surface-200 cursor-pointer">
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveCustomer} className="p-5 space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-surface-300 uppercase mb-1">
                  Customer Name *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Aling Nena, Kuya Jun"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface-800 border border-surface-700 text-surface-100 text-sm focus:outline-none focus:border-primary-500"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-surface-300 uppercase mb-1">
                    Mobile Number
                  </label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={e => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="09xx-xxx-xxxx"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-surface-800 border border-surface-700 text-surface-100 text-sm focus:outline-none focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-surface-300 uppercase mb-1">
                    Credit Limit (₱)
                  </label>
                  <input
                    type="number"
                    step="50"
                    min="0"
                    value={formData.credit_limit}
                    onChange={e => setFormData({ ...formData, credit_limit: e.target.value })}
                    placeholder="2000"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-surface-800 border border-surface-700 text-surface-100 text-sm font-mono focus:outline-none focus:border-primary-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-surface-300 uppercase mb-1">
                  Address / Area
                </label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={e => setFormData({ ...formData, address: e.target.value })}
                  placeholder="e.g. Kanto St., Purok 2"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-surface-800 border border-surface-700 text-surface-100 text-sm focus:outline-none focus:border-primary-500"
                />
              </div>

              {!editingCustomer && (
                <div>
                  <label className="block text-xs font-bold text-amber-400 uppercase mb-1">
                    Starting Balance (Notebook Carry-over)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.initial_balance}
                    onChange={e => setFormData({ ...formData, initial_balance: e.target.value })}
                    placeholder="0.00"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-surface-800 border border-surface-700 text-surface-100 text-sm font-mono focus:outline-none focus:border-amber-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-surface-300 uppercase mb-1">
                  Notes / Remarks (Optional)
                </label>
                <textarea
                  rows={2}
                  value={formData.notes}
                  onChange={e => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="e.g. Suki sa bigas, nagbabayad tuwing kinsenas..."
                  className="w-full px-3.5 py-2 rounded-xl bg-surface-800 border border-surface-700 text-surface-100 text-sm focus:outline-none focus:border-primary-500 resize-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 py-3 rounded-xl bg-surface-800 text-surface-300 font-semibold hover:bg-surface-700 text-sm cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-[2] py-3 rounded-xl bg-primary-600 text-white font-bold hover:bg-primary-500 text-sm shadow-lg shadow-primary-600/30 cursor-pointer"
                >
                  {isSubmitting ? 'Saving...' : '✓ Save Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
