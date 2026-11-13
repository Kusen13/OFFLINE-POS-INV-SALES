/**
 * Sales History Page - Transaction records with filters, details, Returns/Refunds
 * UPDATED: Partial returns + Manager PIN protection for Void
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { fetchSales, fetchSaleDetail, voidSale as apiVoidSale } from '../../api/endpoints';
import { getAllSales, getPendingSales, getSaleByUuid, voidLocalSale, saveSale, generateReceiptNumber } from '../../db/salesRepository';
import { adjustProductStock } from '../../db/productRepository';
import { formatCurrency } from '../../utils/currency';
import { formatDateTime, getTodayStr, nowISO, SYSTEM_START_DATE } from '../../utils/date';
import { exportToCSV, formatSalesForCSV } from '../../utils/csv';
import { generateUUID } from '../../utils/uuid';
import type { Sale } from '../../types/sale';
import type { BusinessType, Category, Product } from '../../types/product';
import { BUSINESS_DEPARTMENTS, getCategoryIcon } from '../../types/product';
import { getAllCategories, getAllProducts } from '../../db/productRepository';

export type DisplaySale = Sale & {
  is_pending_sync?: boolean;
};

interface ReturnLineItem {
  saleItemIdx: number;
  product_id: number;
  product_name: string;
  unit_price: number;
  originalQty: number;
  returnQty: number;
  line_total: number;
  sell_by_weight: boolean;
  weight_unit?: string;
}

// ─── Manager PIN Modal ─────────────────────────────────────────────────────────
interface PinModalProps {
  action?: string;
  onSuccess: () => void;
  onCancel: () => void;
}
function ManagerPinModal({ action = 'i-void ang sale', onSuccess, onCancel }: PinModalProps) {
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const MANAGER_PIN = (() => {
    try { return JSON.parse(localStorage.getItem('pos_app_settings') || '{}').manager_pin || '1234'; }
    catch { return '1234'; }
  })();
  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin === MANAGER_PIN) { onSuccess(); }
    else { setPinError('Mali ang PIN. Subukan ulit.'); setPin(''); }
  };
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-surface-800 border border-surface-700 rounded-2xl p-6 w-full max-w-xs shadow-2xl">
        <div className="text-center mb-5">
          <span className="text-3xl block mb-2">🔐</span>
          <h3 className="text-base font-bold text-surface-100">Manager PIN</h3>
          <p className="text-surface-400 text-xs mt-1">Kailangan ng PIN para {action}</p>
        </div>
        <form onSubmit={handlePinSubmit} className="space-y-3">
          <input type="password" inputMode="numeric" maxLength={8} value={pin}
            onChange={e => { setPin(e.target.value); setPinError(''); }}
            placeholder="Ilagay ang PIN" autoFocus
            className="w-full text-center text-2xl font-mono py-3 px-4 rounded-xl bg-surface-900 border-2 border-surface-600 focus:border-primary-500 text-surface-100 tracking-[0.5em] focus:outline-none"
          />
          {pinError && <p className="text-xs text-rose-400 text-center">{pinError}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={onCancel}
              className="flex-1 py-2.5 rounded-xl bg-surface-700 text-surface-300 text-sm font-bold hover:bg-surface-600 transition-colors cursor-pointer">
              Kanselahin
            </button>
            <button type="submit" disabled={!pin}
              className="flex-1 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white text-sm font-bold transition-colors cursor-pointer">
              OK
            </button>
          </div>
        </form>
        <p className="text-center text-[10px] text-surface-500 mt-3">Default PIN: 1234 · I-bago sa Settings</p>
      </div>
    </div>,
    document.body
  );
}

// ─── Return Modal ──────────────────────────────────────────────────────────────
interface ReturnModalProps {
  sale: DisplaySale;
  storeSettings: Record<string, string>;
  onClose: () => void;
  onReturnComplete: (msg: string) => void;
}
function ReturnModal({ sale, onClose, onReturnComplete }: ReturnModalProps) {
  const items = sale.items ?? [];
  const [returnLines, setReturnLines] = useState<ReturnLineItem[]>(
    items.map((it, idx) => ({
      saleItemIdx: idx,
      product_id: it.product_id,
      product_name: it.product_name,
      unit_price: it.unit_price,
      originalQty: it.sell_by_weight ? Number(it.weight_kg ?? it.quantity) : it.quantity,
      returnQty: 0,
      line_total: 0,
      sell_by_weight: !!it.sell_by_weight,
      weight_unit: it.weight_unit || (it.sell_by_weight ? 'kg' : 'pcs'),
    }))
  );
  const [refundMethod, setRefundMethod] = useState<'cash' | 'store_credit'>('cash');
  const [returnReason, setReturnReason] = useState('');
  const [processing, setProcessing] = useState(false);
  const [done, setDone] = useState(false);
  const [doneReceipt, setDoneReceipt] = useState<{ number: string; total: number } | null>(null);

  const updateQty = (idx: number, qty: number) => {
    setReturnLines(prev => prev.map((ri, i) => {
      if (i !== idx) return ri;
      const clamped = Math.max(0, Math.min(qty, ri.originalQty));
      return { ...ri, returnQty: clamped, line_total: parseFloat((clamped * ri.unit_price).toFixed(2)) };
    }));
  };
  const toReturn = returnLines.filter(r => r.returnQty > 0);
  const totalRefund = toReturn.reduce((s, r) => s + r.line_total, 0);

  const handleSubmit = async () => {
    if (!toReturn.length || processing) return;
    setProcessing(true);
    try {
      const receiptNum = await generateReceiptNumber();
      for (const ri of toReturn) {
        if (ri.product_id > 0 && ri.product_id !== 999) {
          await adjustProductStock(ri.product_id, ri.returnQty, 'STOCK_IN',
            `Return mula sa #${sale.receipt_number}: ${returnReason || 'Customer return'}`);
        }
      }
      const returnSaleUuid = generateUUID();
      await saveSale({
        uuid: returnSaleUuid,
        receipt_number: `RTN-${receiptNum}`,
        items: toReturn.map(ri => ({
          product_id: ri.product_id, product_name: ri.product_name, product_sku: '',
          unit_price: ri.unit_price, unit_cost: 0,
          quantity: -ri.returnQty, line_total: -ri.line_total,
          sell_by_weight: ri.sell_by_weight,
          weight_kg: ri.sell_by_weight ? ri.returnQty : undefined,
          weight_unit: ri.weight_unit, image_path: undefined,
        })),
        subtotal: -totalRefund, discount_amount: 0, tax_amount: 0,
        total_amount: -totalRefund, cash_tendered: null, change_amount: null,
        payment_method_id: sale.payment_method_id, payment_method_name: sale.payment_method_name ?? 'Cash',
        payment_reference: `Return: ${sale.receipt_number}`,
        source_device: localStorage.getItem('pos_device_id') ?? 'unknown',
        notes: `Return mula sa ${sale.receipt_number}. Dahilan: ${returnReason || 'Hindi tinukoy'}. Refund: ${refundMethod === 'cash' ? 'Cash' : 'Store Credit'}.`,
        sold_at: nowISO(), sync_status: 'PENDING', created_at: nowISO(),
      });
      setDoneReceipt({ number: `RTN-${receiptNum}`, total: totalRefund });
      setDone(true);
      onReturnComplete(`✅ Return naitala! ${toReturn.length} item(s), Refund: ${formatCurrency(totalRefund)} via ${refundMethod === 'cash' ? 'Cash' : 'Store Credit'}. Stock naibalik.`);
    } catch (err) {
      alert('Error sa pag-return: ' + (err instanceof Error ? err.message : 'Unknown'));
    } finally {
      setProcessing(false);
    }
  };

  if (done && doneReceipt) {
    return createPortal(
      <div className="fixed inset-0 z-[55] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
        <div className="bg-surface-800 border border-surface-700 rounded-2xl p-5 w-full max-w-sm shadow-2xl text-center">
          <span className="text-4xl block mb-3">✅</span>
          <h3 className="text-base font-bold text-emerald-400">Return Naitala!</h3>
          <p className="text-surface-400 text-xs mt-1">Receipt: <strong className="font-mono text-surface-200">{doneReceipt.number}</strong></p>
          <p className="text-2xl font-black text-amber-400 my-3">{formatCurrency(doneReceipt.total)}</p>
          <p className="text-xs text-surface-400">Refund via {refundMethod === 'cash' ? '💵 Cash' : '🎫 Store Credit'}</p>
          <div className="flex gap-2 mt-4">
            <button type="button" onClick={() => window.print()}
              className="flex-1 py-2.5 rounded-xl bg-surface-700 hover:bg-surface-600 text-surface-200 text-xs font-bold cursor-pointer">🖨️ I-Print</button>
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold cursor-pointer">Tapos Na ✓</button>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-3 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-surface-800 border border-surface-700 rounded-2xl w-full max-w-md shadow-2xl flex flex-col max-h-[92dvh]">
        {/* Header */}
        <div className="px-4 py-3 bg-surface-900 border-b border-surface-700/60 rounded-t-2xl flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-sm font-bold text-surface-100">↩️ Return / Refund</h3>
            <p className="text-[11px] text-surface-400">Resibo #{sale.receipt_number}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-700 text-surface-400 cursor-pointer">✕</button>
        </div>

        {/* Item list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <p className="text-xs text-surface-400">Piliin ang mga ibabalik na items at dami:</p>
          {returnLines.map((ri, idx) => (
            <div key={idx} className={`p-3 rounded-xl border transition-all ${ri.returnQty > 0 ? 'bg-amber-500/5 border-amber-500/30' : 'bg-surface-900 border-surface-700/50'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-surface-100 truncate">{ri.product_name}</p>
                  <p className="text-[10px] text-surface-400 mt-0.5">
                    {formatCurrency(ri.unit_price)}/{ri.sell_by_weight ? ri.weight_unit : 'pc'} · Original: <strong>{ri.originalQty}</strong>
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" onClick={() => updateQty(idx, ri.returnQty - (ri.sell_by_weight ? 0.1 : 1))}
                    disabled={ri.returnQty <= 0}
                    className="w-7 h-7 rounded-lg bg-surface-700 hover:bg-surface-600 disabled:opacity-30 text-surface-200 font-bold flex items-center justify-center cursor-pointer">−</button>
                  <input type="number" min="0" max={ri.originalQty} step={ri.sell_by_weight ? 0.1 : 1}
                    value={ri.returnQty || ''} placeholder="0"
                    onChange={e => updateQty(idx, parseFloat(e.target.value) || 0)}
                    onFocus={e => e.target.select()}
                    className="w-14 h-7 text-center rounded-lg bg-surface-800 border border-surface-600 text-surface-100 text-xs font-bold focus:border-amber-500 focus:outline-none"
                  />
                  <button type="button" onClick={() => updateQty(idx, ri.returnQty + (ri.sell_by_weight ? 0.1 : 1))}
                    disabled={ri.returnQty >= ri.originalQty}
                    className="w-7 h-7 rounded-lg bg-surface-700 hover:bg-surface-600 disabled:opacity-30 text-surface-200 font-bold flex items-center justify-center cursor-pointer">+</button>
                </div>
              </div>
              {ri.returnQty > 0 && (
                <div className="mt-1 flex items-center justify-between">
                  <button type="button" onClick={() => updateQty(idx, ri.originalQty)}
                    className="text-[10px] text-primary-400 hover:text-primary-300 cursor-pointer">I-return lahat →</button>
                  <span className="text-[11px] text-amber-300 font-bold">−{formatCurrency(ri.line_total)}</span>
                </div>
              )}
            </div>
          ))}

          {/* Reason */}
          <div>
            <label className="block text-xs font-semibold text-surface-300 mb-1">Dahilan ng Return</label>
            <input type="text" value={returnReason} onChange={e => setReturnReason(e.target.value)}
              placeholder="e.g. Sira, Mali ang order, Expired..."
              className="w-full px-3 py-2 rounded-xl bg-surface-900 border border-surface-700 text-surface-100 text-xs focus:border-amber-500 focus:outline-none"
            />
          </div>

          {/* Refund method */}
          <div>
            <label className="block text-xs font-semibold text-surface-300 mb-1">Paraan ng Refund</label>
            <div className="flex gap-2">
              {(['cash', 'store_credit'] as const).map(m => (
                <button key={m} type="button" onClick={() => setRefundMethod(m)}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${refundMethod === m ? 'bg-amber-600 border-amber-500 text-white' : 'bg-surface-900 border-surface-700 text-surface-400 hover:bg-surface-800'}`}>
                  {m === 'cash' ? '💵 Cash Refund' : '🎫 Store Credit'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-surface-700/60 bg-surface-900 rounded-b-2xl shrink-0">
          <div className="flex justify-between items-center mb-3">
            <p className="text-xs text-surface-400">{toReturn.length > 0 ? `${toReturn.length} item(s) na ibabalik` : 'Walang napiling item'}</p>
            <div className="text-right">
              <p className="text-[10px] text-surface-400">Kabuuang Refund</p>
              <p className="text-lg font-black text-amber-400">{formatCurrency(totalRefund)}</p>
            </div>
          </div>
          <button type="button" onClick={handleSubmit} disabled={!toReturn.length || processing}
            className="w-full py-3 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm transition-all cursor-pointer flex items-center justify-center gap-2">
            <span>{processing ? '⏳' : '↩️'}</span>
            <span>{processing ? 'Nipo-proseso...' : `I-Return at I-Refund ${formatCurrency(totalRefund)}`}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function SalesHistoryPage() {

  const [sales, setSales] = useState<DisplaySale[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, per_page: 15, total_pages: 0 });
  const [filters, setFilters] = useState(() => {
    const today = getTodayStr();
    return { page: 1, per_page: 15, date_from: today, date_to: today };
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDept, setSelectedDept] = useState<BusinessType>('barbeque');
  const [categoryFilter, setCategoryFilter] = useState<number | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSale, setSelectedSale] = useState<DisplaySale | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [voidToast, setVoidToast] = useState<string | null>(null);
  // New: PIN protection + Return flow
  const [showPinModal, setShowPinModal] = useState(false);
  const [pendingVoidSale, setPendingVoidSale] = useState<DisplaySale | null>(null);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [storeSettings] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('pos_app_settings') || '{}');
    } catch {
      return {};
    }
  });

  const loadSales = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Try fetching from server
      const res = await fetchSales({
        page: filters.page,
        per_page: filters.per_page,
        date_from: filters.date_from || undefined,
        date_to: filters.date_to || undefined,
      });

      // 2. Also check local pending (unsynced) sales from IndexedDB
      const localPending = await getPendingSales();
      setPendingCount(localPending.length);

      let combined: DisplaySale[] = res.data;

      if (localPending && localPending.length > 0) {
        const filteredPending: DisplaySale[] = localPending
          .filter(ps => {
            const saleDate = ps.sold_at?.slice(0, 10);
            if (filters.date_from && saleDate < filters.date_from) return false;
            if (filters.date_to && saleDate > filters.date_to) return false;
            return true;
          })
          .map((ps, idx) => ({
            id: -1 * (idx + 1),
            uuid: ps.uuid,
            receipt_number: ps.receipt_number,
            subtotal: ps.subtotal,
            discount_amount: ps.discount_amount,
            tax_amount: ps.tax_amount,
            total_amount: ps.total_amount,
            cash_tendered: ps.cash_tendered,
            change_amount: ps.change_amount,
            payment_method_id: ps.payment_method_id,
            payment_method_name: ps.payment_method_name,
            payment_reference: ps.payment_reference,
            source_device: ps.source_device,
            notes: ps.notes,
            sold_at: ps.sold_at,
            synced_at: null,
            created_at: ps.created_at,
            item_count: ps.items?.length || 0,
            items: ps.items?.map((it, i) => ({
              id: i,
              sale_id: -1 * (idx + 1),
              product_id: it.product_id,
              product_name: it.product_name,
              product_sku: it.product_sku,
              unit_price: it.unit_price,
              unit_cost: it.unit_cost,
              quantity: it.quantity,
              line_total: it.line_total,
              image_path: it.image_path,
              sell_by_weight: it.sell_by_weight,
              weight_kg: it.weight_kg,
              weight_unit: it.weight_unit,
            })),
            is_pending_sync: true,
          }));

        const existingUuids = new Set(res.data.map(s => s.uuid));
        const toPrepend = filteredPending.filter(ps => !existingUuids.has(ps.uuid));
        combined = [...toPrepend, ...res.data];
      }

      setIsOfflineMode(false);
      setSales(combined);
      setPagination({
        ...res.pagination,
        total: res.pagination.total + (localPending?.length || 0),
      });
    } catch {
      // 3. Server failed / offline fallback -> Load from local IndexedDB
      try {
        const localAll = await getAllSales();
        const pending = localAll.filter(s => s.sync_status === 'PENDING');
        setPendingCount(pending.length);

        let filtered = localAll;
        if (filters.date_from) {
          filtered = filtered.filter(s => (s.sold_at || '').slice(0, 10) >= filters.date_from);
        }
        if (filters.date_to) {
          filtered = filtered.filter(s => (s.sold_at || '').slice(0, 10) <= filters.date_to);
        }

        const mapped: DisplaySale[] = filtered.map((ps, idx) => ({
          id: -1 * (idx + 1),
          uuid: ps.uuid,
          receipt_number: ps.receipt_number,
          subtotal: ps.subtotal,
          discount_amount: ps.discount_amount,
          tax_amount: ps.tax_amount,
          total_amount: ps.total_amount,
          cash_tendered: ps.cash_tendered,
          change_amount: ps.change_amount,
          payment_method_id: ps.payment_method_id,
          payment_method_name: ps.payment_method_name,
          payment_reference: ps.payment_reference,
          source_device: ps.source_device,
          notes: ps.notes,
          sold_at: ps.sold_at,
          synced_at: ps.synced_at || null,
          created_at: ps.created_at,
          item_count: ps.items?.length || 0,
          items: ps.items?.map((it, i) => ({
            id: i,
            sale_id: -1 * (idx + 1),
            product_id: it.product_id,
            product_name: it.product_name,
            product_sku: it.product_sku,
            unit_price: it.unit_price,
            unit_cost: it.unit_cost,
            quantity: it.quantity,
            line_total: it.line_total,
            image_path: it.image_path,
            sell_by_weight: it.sell_by_weight,
            weight_kg: it.weight_kg,
            weight_unit: it.weight_unit,
          })),
          is_pending_sync: ps.sync_status === 'PENDING',
        }));

        const totalCount = mapped.length;
        const start = (filters.page - 1) * filters.per_page;
        const pageItems = mapped.slice(start, start + filters.per_page);

        setIsOfflineMode(true);
        setSales(pageItems);
        setPagination({
          total: totalCount,
          page: filters.page,
          per_page: filters.per_page,
          total_pages: Math.max(1, Math.ceil(totalCount / filters.per_page)),
        });
      } catch (localErr) {
        setError(localErr instanceof Error ? localErr.message : 'Failed to load sales');
      }
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadSales();
    Promise.all([getAllCategories(), getAllProducts()]).then(([cats, prods]) => {
      setCategories(cats);
      setProducts(prods);
    });
  }, [loadSales]);

  async function viewSaleDetail(sale: DisplaySale) {
    if (sale.items && sale.items.length > 0) {
      setSelectedSale(sale);
      return;
    }
    try {
      const res = await fetchSaleDetail(sale.id);
      setSelectedSale(res.data);
    } catch {
      const local = await getSaleByUuid(sale.uuid);
      if (local && local.items) {
        setSelectedSale({
          ...sale,
          items: local.items.map((it, i) => ({
            id: i,
            sale_id: sale.id,
            product_id: it.product_id,
            product_name: it.product_name,
            product_sku: it.product_sku,
            unit_price: it.unit_price,
            unit_cost: it.unit_cost,
            quantity: it.quantity,
            line_total: it.line_total,
            image_path: it.image_path,
            sell_by_weight: it.sell_by_weight,
            weight_kg: it.weight_kg,
            weight_unit: it.weight_unit,
          })),
        });
      } else {
        setSelectedSale(sale);
      }
    }
  }

  // Map product ID to department and category for instant lookup
  const prodInfoMap = useMemo(() => {
    const map = new Map<number, { category_id: number; business_type: BusinessType }>();
    for (const p of products) {
      const cat = categories.find(c => c.id === p.category_id);
      const bType = p.business_type || cat?.business_type || (p.name.toLowerCase().includes('bigas') || p.name.toLowerCase().includes('rice') ? 'rice' : (p.name.toLowerCase().includes('gulay') || p.name.toLowerCase().includes('veg') ? 'vegetables' : (p.name.toLowerCase().includes('bbq') || p.name.toLowerCase().includes('inihaw') || p.name.toLowerCase().includes('barbeque') ? 'barbeque' : 'groceries')));
      map.set(p.id, {
        category_id: p.category_id,
        business_type: bType as BusinessType,
      });
    }
    return map;
  }, [products, categories]);

  // Categories filtered by active Business Department
  const displayCategories = useMemo(() => {
    let list = categories;
    list = list.filter(c => (c.business_type || 'groceries') === selectedDept);
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [categories, selectedDept]);

  // Reset category filter if not in active department
  useEffect(() => {
    if (categoryFilter !== null && displayCategories.length > 0 && !displayCategories.some(c => c.id === categoryFilter)) {
      setCategoryFilter(null);
    }
  }, [displayCategories, categoryFilter]);

  // Filter sales based on Department, Category, and search query
  const displayedSales = useMemo(() => {
    let result = sales;

    // 1. Business Department Filter
    result = result.filter(s => {
      if (!s.items || s.items.length === 0) return false;
      return s.items.some(it => {
        const info = prodInfoMap.get(it.product_id);
        return (info?.business_type || 'groceries') === selectedDept;
      });
    });

    // 2. Category Filter
    if (categoryFilter !== null) {
      result = result.filter(s => {
        if (!s.items || s.items.length === 0) return true;
        return s.items.some(it => {
          const info = prodInfoMap.get(it.product_id);
          return info?.category_id === categoryFilter;
        });
      });
    }

    // 3. Search Query Filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(s =>
        s.receipt_number.toLowerCase().includes(q) ||
        (s.payment_method_name && s.payment_method_name.toLowerCase().includes(q)) ||
        (s.items && s.items.some(it => it.product_name.toLowerCase().includes(q)))
      );
    }

    return result;
  }, [sales, selectedDept, categoryFilter, prodInfoMap, searchQuery]);

  // Summary Metrics
  const totalSalesAmount = useMemo(() => displayedSales.reduce((sum, s) => sum + (Number(s.total_amount) || 0), 0), [displayedSales]);
  const todayStr = getTodayStr();
  const todaySales = useMemo(() => displayedSales.filter(s => s.sold_at?.startsWith(todayStr)), [displayedSales, todayStr]);
  const todayTotal = useMemo(() => todaySales.reduce((sum, s) => sum + (Number(s.total_amount) || 0), 0), [todaySales]);
  const avgTicket = useMemo(() => (displayedSales.length > 0 ? totalSalesAmount / displayedSales.length : 0), [displayedSales, totalSalesAmount]);

  const handleVoidSale = async (sale: DisplaySale) => {
    setVoiding(true);
    try {
      // 1. Always execute local rollback in IndexedDB
      await voidLocalSale(sale);

      // 2. If online and sale has server ID (id > 0), call server API
      if (sale.id && sale.id > 0) {
        try {
          await apiVoidSale(sale.id);
        } catch (serverErr) {
          console.warn('Server void attempt had warning/failure:', serverErr);
        }
      }

      setVoidToast(`✓ Matagumpay na na-VOID ang Resibo #${sale.receipt_number}. Naibalik ang stocks.`);
      setTimeout(() => setVoidToast(null), 4000);
      setSelectedSale(null);
      await loadSales();
    } catch (err) {
      console.error('Failed to void sale:', err);
      alert('Nagka-problema sa pag-void ng resibo.');
    } finally {
      setVoiding(false);
    }
  };

  // PIN-protected void: shows PIN modal first
  const requestVoid = (sale: DisplaySale) => {
    setPendingVoidSale(sale);
    setShowPinModal(true);
  };

  // Helper: detect return/refund receipts
  const isReturnSale = (sale: DisplaySale) =>
    sale.receipt_number?.startsWith('RTN-') || (sale.total_amount ?? 0) < 0;


  return (
    <div className="flex-1 min-h-0 flex flex-col animate-fade-in relative">
      {/* Toast Notification */}
      {voidToast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-2 text-xs font-bold animate-bounce-in ${voidToast.startsWith('✅') ? 'bg-emerald-600' : 'bg-rose-600'} text-white`}>
          <span>{voidToast.startsWith('✅') ? '✅' : '🚫'}</span>
          <span>{voidToast}</span>
        </div>
      )}

      {/* Manager PIN Modal — shown before void */}
      {showPinModal && pendingVoidSale && (
        <ManagerPinModal
          action={`i-void ang Resibo #${pendingVoidSale.receipt_number}`}
          onSuccess={() => {
            setShowPinModal(false);
            const sale = pendingVoidSale!;
            setPendingVoidSale(null);
            handleVoidSale(sale);
          }}
          onCancel={() => { setShowPinModal(false); setPendingVoidSale(null); }}
        />
      )}

      {/* Return/Refund Modal */}
      {showReturnModal && selectedSale && (
        <ReturnModal
          sale={selectedSale}
          storeSettings={storeSettings}
          onClose={() => setShowReturnModal(false)}
          onReturnComplete={(msg) => {
            setVoidToast(msg);
            setTimeout(() => setVoidToast(null), 5000);
            setShowReturnModal(false);
            setSelectedSale(null);
            loadSales();
          }}
        />
      )}

      {/* ── ROW 1: Title + Date Filters + Presets + Export + ⋯ ── */}
      <div className="flex-shrink-0 flex items-center gap-1.5 px-0 py-0 flex-nowrap overflow-x-auto no-scrollbar">
        <span className="text-sm font-bold text-surface-100 whitespace-nowrap shrink-0 mr-1">🧾 Sales</span>

        {/* From Date */}
        <div className="flex items-center gap-1 bg-surface-900 px-2 py-1 rounded-lg border border-surface-700/60 shrink-0">
          <span className="text-[10px] text-surface-400 font-bold">From:</span>
          <input
            type="date"
            value={filters.date_from}
            min={SYSTEM_START_DATE}
            onChange={e => {
              const val = e.target.value;
              setFilters(f => ({
                ...f, page: 1, date_from: val,
                date_to: f.date_to && f.date_to >= val ? f.date_to : val,
              }));
            }}
            className="bg-transparent text-[11px] text-surface-100 font-bold focus:outline-none cursor-pointer w-[112px]"
          />
        </div>

        {/* To Date */}
        <div className="flex items-center gap-1 bg-surface-900 px-2 py-1 rounded-lg border border-surface-700/60 shrink-0">
          <span className="text-[10px] text-surface-400 font-bold">To:</span>
          <input
            type="date"
            value={filters.date_to}
            min={SYSTEM_START_DATE}
            onChange={e => setFilters(f => ({ ...f, page: 1, date_to: e.target.value }))}
            className="bg-transparent text-[11px] text-surface-100 font-bold focus:outline-none cursor-pointer w-[112px]"
          />
        </div>

        {/* Today / All presets */}
        <button
          type="button"
          onClick={() => { const t = getTodayStr(); setFilters(f => ({ ...f, page: 1, date_from: t, date_to: t })); }}
          className={`h-7 px-2 rounded-lg text-[11px] font-bold transition-all cursor-pointer shrink-0 border ${
            filters.date_from === getTodayStr() && filters.date_to === getTodayStr()
              ? 'bg-primary-600 border-primary-500 text-white'
              : 'bg-surface-800 border-surface-700/60 text-surface-300 hover:bg-surface-700'
          }`}
        >⚡ Today</button>
        {(filters.date_from || filters.date_to) && (
          <button
            type="button"
            onClick={() => setFilters(f => ({ ...f, page: 1, date_from: '', date_to: '' }))}
            className="h-7 px-2 rounded-lg bg-surface-800 border border-surface-700/60 text-surface-400 hover:text-white text-[11px] font-bold cursor-pointer shrink-0"
          >✕ All</button>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Export CSV */}
        {displayedSales.length > 0 && (
          <button
            onClick={() => exportToCSV(formatSalesForCSV(displayedSales), `sales_${getTodayStr()}`)}
            className="h-7 px-2 rounded-lg bg-surface-800 border border-surface-700/60 text-surface-200 text-[11px] font-semibold hover:bg-surface-700 transition-colors flex items-center gap-1 shrink-0 cursor-pointer"
            title="Export to CSV"
          >
            <span>📥</span><span className="hidden sm:inline">CSV</span>
          </button>
        )}

        {/* Status badges */}
        {isOfflineMode && (
          <span className="h-7 px-2 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/30 text-[10px] font-bold flex items-center shrink-0">⚡ Offline</span>
        )}
        {pendingCount > 0 && (
          <span className="h-7 px-2 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/40 text-[10px] font-bold flex items-center shrink-0 animate-pulse">🟡 {pendingCount} Pending</span>
        )}
      </div>

      {/* ── 4 BUSINESS DEPARTMENTS SELECTOR RIBBON ── */}
      <div className="flex-shrink-0 flex items-center gap-1.5 py-1 flex-nowrap overflow-x-auto no-scrollbar">
        {BUSINESS_DEPARTMENTS.map(dept => {
          const count = sales.filter(s => {
            if (!s.items || s.items.length === 0) return true;
            return s.items.some(it => {
              const info = prodInfoMap.get(it.product_id);
              return (info?.business_type || 'groceries') === dept.id;
            });
          }).length;
          const isSelected = selectedDept === dept.id;
          return (
            <button
              key={dept.id}
              type="button"
              onClick={() => { setSelectedDept(dept.id); setCategoryFilter(null); }}
              className={`h-7 px-3 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer border ${
                isSelected
                  ? `${dept.activeColor} shadow-md`
                  : 'bg-surface-800/80 text-surface-300 border-surface-700/60 hover:bg-surface-700/70 hover:text-white'
              }`}
            >
              <span>{dept.icon}</span>
              <span>{dept.label}</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${isSelected ? 'bg-black/25 text-white' : 'bg-surface-700 text-surface-400'}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── ROW 2: Search + KPI Ribbon ── */}
      <div className="flex-shrink-0 flex items-center gap-1.5 flex-nowrap overflow-x-auto no-scrollbar">
        {/* Search */}
        <div className="relative flex-1 min-w-[130px] max-w-xs">
          <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Receipt, item..."
            className="w-full h-7 pl-7 pr-6 text-[11px] rounded-lg bg-surface-900 border border-surface-700/60 text-surface-100 placeholder-surface-500 focus:outline-none focus:border-primary-500"
          />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery('')} className="absolute inset-y-0 right-0 pr-2 flex items-center text-surface-400 hover:text-surface-200 text-xs cursor-pointer">✕</button>
          )}
        </div>

        {/* Category Dropdown Filter */}
        <select
          value={categoryFilter ?? ''}
          onChange={e => {
            const val = e.target.value;
            setCategoryFilter(val ? Number(val) : null);
          }}
          className="h-7 px-2 rounded-lg bg-surface-900 border border-surface-700/60 text-surface-200 text-[11px] font-semibold focus:outline-none focus:border-primary-500 cursor-pointer shrink-0 max-w-[140px] sm:max-w-[180px] truncate"
        >
          {displayCategories.length > 1 && <option value="">🏷️ Lahat ng {BUSINESS_DEPARTMENTS.find(d => d.id === selectedDept)?.label || ''} Kategorya</option>}
          {displayCategories.map(cat => (
            <option key={cat.id} value={cat.id}>
              {getCategoryIcon(cat.name)} {cat.name}
            </option>
          ))}
        </select>

        {/* KPI Ribbon */}
        <div className="flex items-center gap-1 shrink-0">
          <span className="h-7 px-2 rounded-lg bg-surface-800/70 border border-surface-700/40 flex items-center gap-1 text-[10px] font-bold shrink-0">
            <span className="text-surface-400">Total</span>
            <span className="text-primary-400">{formatCurrency(totalSalesAmount)}</span>
            <span className="text-surface-500 hidden sm:inline">({pagination.total})</span>
          </span>
          <span className="h-7 px-2 rounded-lg bg-surface-800/70 border border-surface-700/40 flex items-center gap-1 text-[10px] font-bold shrink-0">
            <span className="text-surface-400">Today</span>
            <span className="text-emerald-400">{formatCurrency(todayTotal)}</span>
          </span>
          <span className="h-7 px-2 rounded-lg bg-surface-800/70 border border-surface-700/40 flex items-center gap-1 text-[10px] font-bold shrink-0 hidden sm:flex">
            <span className="text-surface-400">Avg</span>
            <span className="text-amber-300">{formatCurrency(avgTicket)}</span>
          </span>
        </div>
      </div>


      {error && (
        <div className="flex-shrink-0 bg-danger-500/10 border border-danger-500/30 rounded-lg px-3 py-1.5">
          <p className="text-danger-500 text-xs">⚠️ {error}</p>
        </div>
      )}

      {/* Main Table — flex-1 fills all remaining space */}
      <div className="flex-1 min-h-0 bg-surface-800/50 rounded-xl border border-surface-700/50 flex flex-col overflow-hidden shadow-sm">

        {loading ? (
          <div className="flex-1 min-h-0 flex items-center justify-center py-16">
            <div className="flex flex-col items-center gap-2">
              <div className="w-8 h-8 border-3 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
              <p className="text-xs text-surface-400">Kinukuha ang talaan ng mga benta...</p>
            </div>
          </div>
        ) : displayedSales.length === 0 ? (
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center py-12 text-center">
            <span className="text-3xl mb-2 block">💰</span>
            <p className="text-surface-300 font-medium text-xs sm:text-sm">
              {searchQuery ? 'Walang transaksyon na tumutugma sa filter' : 'Walang transaksyon na nahanap'}
            </p>
            <p className="text-surface-500 text-[11px] sm:text-xs mt-0.5">
              {searchQuery ? 'Subukan ang ibang salita o receipt number' : 'Lilitaw dito ang mga benta kapag nag-checkout sa POS'}
            </p>
          </div>
        ) : (
          <>
            {/* Scrollable Table Container */}
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
              <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-surface-900 border-b border-surface-700/60 z-10 shadow-xs">
                    <tr>
                      <th className="px-2.5 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase whitespace-nowrap">
                        Receipt
                      </th>
                      <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase whitespace-nowrap">
                        Date & Time
                      </th>
                      <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-center whitespace-nowrap hidden sm:table-cell">
                        Items
                      </th>
                      <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase whitespace-nowrap hidden md:table-cell">
                        Payment
                      </th>
                      <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-emerald-500/80 uppercase whitespace-nowrap hidden lg:table-cell">
                        👤 Cashier
                      </th>
                      <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-center whitespace-nowrap">
                        Status
                      </th>
                      <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-right whitespace-nowrap">
                        Total
                      </th>
                      <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-right whitespace-nowrap">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-700/30">
                    {displayedSales.map(sale => (
                      <tr key={sale.uuid || sale.id} className="hover:bg-surface-700/20 transition-colors">
                        <td className="px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs font-mono font-semibold text-surface-200 whitespace-nowrap">
                          {sale.receipt_number}
                        </td>
                        <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-xs text-surface-300 whitespace-nowrap">
                          {formatDateTime(sale.sold_at)}
                        </td>
                        <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-center text-xs text-surface-300 whitespace-nowrap hidden sm:table-cell">
                          {sale.item_count ?? '-'}
                        </td>
                        <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-xs text-surface-300 whitespace-nowrap hidden md:table-cell">
                          <span className="px-2 py-0.5 rounded-full bg-surface-700/60 text-surface-300 text-[10px] border border-surface-600/40">
                            {sale.payment_method_name ?? 'Cash'}
                          </span>
                        </td>
                        <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-xs text-emerald-300 whitespace-nowrap hidden lg:table-cell">
                          {(sale as any).cashier_name ? (
                            <span className="flex items-center gap-1">
                              <span>👤</span>
                              <span className="font-semibold">{(sale as any).cashier_name}</span>
                            </span>
                          ) : (
                            <span className="text-surface-600">—</span>
                          )}
                        </td>
                        <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-center whitespace-nowrap">
                          {sale.is_pending_sync ? (
                            <span className="px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-semibold">
                              🟡 Pending
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-semibold">
                              🟢 Synced
                            </span>
                          )}
                        </td>
                        <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-right text-xs font-bold text-primary-400 whitespace-nowrap">
                          {formatCurrency(sale.total_amount)}
                        </td>
                        <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-right whitespace-nowrap">
                          <button
                            onClick={() => viewSaleDetail(sale)}
                            className="px-2 py-0.5 rounded-lg text-primary-400 text-xs font-medium hover:bg-primary-500/10 border border-transparent hover:border-primary-500/30 transition-colors cursor-pointer"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
              </table>
            </div>

            {/* Pinned Card Footer: Strictly Single-Line Non-Wrapping Pagination */}
            <div className="flex-shrink-0 px-2.5 sm:px-3 py-1.5 sm:py-2 bg-surface-900/90 border-t border-surface-700/60 flex items-center justify-between flex-nowrap text-xs gap-2 shrink-0">
              <span className="text-[10px] sm:text-xs text-surface-400 font-medium whitespace-nowrap shrink-0">
                {pagination.total === 0
                  ? '0 of 0'
                  : `${(pagination.page - 1) * filters.per_page + 1}-${Math.min(
                      pagination.page * filters.per_page,
                      pagination.total
                    )} of ${pagination.total}`}
              </span>

              <div className="flex items-center gap-1 sm:gap-1.5 whitespace-nowrap shrink-0">
                <select
                  value={filters.per_page}
                  onChange={e => setFilters(f => ({ ...f, page: 1, per_page: Number(e.target.value) }))}
                  className="bg-surface-800 border border-surface-700/60 rounded px-1 py-0.5 text-[10px] sm:text-[11px] text-surface-300 cursor-pointer"
                >
                  <option value={10}>10/page</option>
                  <option value={15}>15/page</option>
                  <option value={25}>25/page</option>
                  <option value={50}>50/page</option>
                </select>
                <button
                  onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}
                  disabled={pagination.page <= 1}
                  className="px-1.5 sm:px-2 py-0.5 rounded bg-surface-800 hover:bg-surface-700 disabled:opacity-40 disabled:cursor-not-allowed text-[10px] sm:text-[11px] border border-surface-700/60 text-surface-200 cursor-pointer whitespace-nowrap"
                >
                  ← Prev
                </button>
                <span className="text-[10px] sm:text-[11px] text-surface-400 font-medium px-0.5">
                  {pagination.page}/{pagination.total_pages || 1}
                </span>
                <button
                  onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}
                  disabled={pagination.page >= pagination.total_pages}
                  className="px-1.5 sm:px-2 py-0.5 rounded bg-surface-800 hover:bg-surface-700 disabled:opacity-40 disabled:cursor-not-allowed text-[10px] sm:text-[11px] border border-surface-700/60 text-surface-200 cursor-pointer whitespace-nowrap"
                >
                  Next →
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Sale detail modal */}
      {selectedSale && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-surface-800 rounded-2xl p-4 sm:p-6 max-w-md w-full border border-surface-700 shadow-2xl animate-fade-in max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-surface-100">Sale Details</h3>
              <button onClick={() => setSelectedSale(null)} className="p-1 rounded-lg text-surface-400 hover:text-surface-200 hover:bg-surface-700 cursor-pointer">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-surface-400">Receipt:</span>
                <span className="text-surface-200 font-mono">{selectedSale.receipt_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-surface-400">Date:</span>
                <span className="text-surface-200">{formatDateTime(selectedSale.sold_at)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-surface-400">Payment:</span>
                <span className="text-surface-200">{selectedSale.payment_method_name ?? 'Cash'}</span>
              </div>
              {selectedSale.source_device && (
                <div className="flex justify-between">
                  <span className="text-surface-400">Device:</span>
                  <span className="text-surface-200">{selectedSale.source_device}</span>
                </div>
              )}
              {selectedSale.cashier_name && (
                <div className="flex justify-between">
                  <span className="text-surface-400">Cashier:</span>
                  <span className="text-emerald-300 font-semibold">👤 {selectedSale.cashier_name}</span>
                </div>
              )}
              {selectedSale.customer_name && (
                <div className="flex justify-between">
                  <span className="text-surface-400">Customer:</span>
                  <span className="text-amber-300 font-semibold">🧑 {selectedSale.customer_name}</span>
                </div>
              )}

              {/* Line items */}
              {selectedSale.items && selectedSale.items.length > 0 && (
                <div className="mt-4 pt-4 border-t border-surface-700/50">
                  <p className="text-xs font-semibold text-surface-400 uppercase mb-2">Items</p>
                  <div className="space-y-2">
                    {selectedSale.items.map((item, i) => {
                      const isWeight = item.sell_by_weight || (item.weight_kg && item.weight_kg > 0);
                      const qtyDisplay = isWeight
                        ? `${Number(item.weight_kg ?? item.quantity).toFixed(2)}${item.weight_unit || 'kg'}`
                        : `${item.quantity}×`;
                      return (
                        <div key={i} className="flex justify-between items-start gap-2">
                          <div className="min-w-0">
                            <span className="text-surface-200 text-xs">
                              <span className={`font-bold mr-1 ${isWeight ? 'text-sky-400' : 'text-surface-300'}`}>
                                {qtyDisplay}
                              </span>
                              {item.product_name}
                            </span>
                            {isWeight && (
                              <p className="text-[10px] text-surface-500">
                                {formatCurrency(item.unit_price)}/{item.weight_unit || 'kg'} × {Number(item.weight_kg ?? item.quantity).toFixed(2)}{item.weight_unit || 'kg'}
                              </p>
                            )}
                          </div>
                          <span className="text-surface-100 font-medium text-xs shrink-0">{formatCurrency(item.line_total)}</span>
                        </div>
                      );
                    })}

                  </div>
                </div>
              )}

              {/* Totals */}
              <div className="mt-4 pt-4 border-t border-surface-700/50 space-y-1">
                <div className="flex justify-between">
                  <span className="text-surface-400">Subtotal:</span>
                  <span className="text-surface-200">{formatCurrency(selectedSale.subtotal)}</span>
                </div>
                {selectedSale.discount_amount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-surface-400">Discount:</span>
                    <span className="text-success-500">-{formatCurrency(selectedSale.discount_amount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-bold">
                  <span className="text-surface-200">Total:</span>
                  <span className="text-primary-400">{formatCurrency(selectedSale.total_amount)}</span>
                </div>
                {selectedSale.cash_tendered && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-surface-400">Cash:</span>
                      <span className="text-surface-200">{formatCurrency(selectedSale.cash_tendered)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-surface-400">Change:</span>
                      <span className="text-surface-200">{formatCurrency(selectedSale.change_amount ?? 0)}</span>
                    </div>
                  </>
                )}
              </div>

              {/* Thermal Receipt Container for Printing */}
              <div
                id="thermal-receipt"
                className={`hidden font-mono text-black ${
                  storeSettings.printer_width === '80mm' ? 'thermal-80mm' : 'thermal-58mm'
                }`}
              >
                <div className="text-center pb-2 border-b border-dashed border-black">
                  <p className="font-bold uppercase text-xs">
                    {storeSettings.store_name || 'AKING TINDAHAN'}
                  </p>
                  {storeSettings.store_address && (
                    <p className="text-[10px] mt-0.5">{storeSettings.store_address}</p>
                  )}
                  {storeSettings.store_contact && (
                    <p className="text-[10px]">{storeSettings.store_contact}</p>
                  )}
                  <p className="text-[10px] font-bold mt-1">*** REPRINT / DUPLICATE COPY ***</p>
                  <p className="text-[10px]">{formatDateTime(selectedSale.sold_at)}</p>
                </div>

                <div className="pt-1 text-xs space-y-0.5">
                  <div className="flex justify-between">
                    <span>Resibo #:</span>
                    <span className="font-bold">{selectedSale.receipt_number}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Paraan:</span>
                    <span>{selectedSale.payment_method_name ?? 'Cash'}</span>
                  </div>
                </div>

                {selectedSale.items && selectedSale.items.length > 0 && (
                  <div className="border-t border-dashed border-black my-1 pt-1 space-y-1">
                    {selectedSale.items.map((it, idx) => {
                      const isWeight = it.sell_by_weight || (it.weight_kg && it.weight_kg > 0);
                      const qtyStr = isWeight
                        ? `${Number(it.weight_kg ?? it.quantity).toFixed(2)}${it.weight_unit || 'kg'}`
                        : `${it.quantity}×`;
                      return (
                        <div key={idx} className="flex justify-between text-xs">
                          <span className="truncate max-w-[170px]">{qtyStr} {it.product_name}</span>
                          <span className="font-bold">{formatCurrency(it.line_total)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="border-t border-dashed border-black pt-1 space-y-0.5">
                  <div className="flex justify-between text-xs">
                    <span>Subtotal:</span>
                    <span>{formatCurrency(selectedSale.subtotal)}</span>
                  </div>
                  {selectedSale.discount_amount > 0 && (
                    <div className="flex justify-between text-xs">
                      <span>Discount:</span>
                      <span>-{formatCurrency(selectedSale.discount_amount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-bold pt-0.5 border-t border-dashed border-black">
                    <span>KABUUAN:</span>
                    <span>{formatCurrency(selectedSale.total_amount)}</span>
                  </div>
                  {selectedSale.cash_tendered && (
                    <>
                      <div className="flex justify-between text-xs pt-1">
                        <span>Cash:</span>
                        <span>{formatCurrency(selectedSale.cash_tendered)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span>Sukli:</span>
                        <span>{formatCurrency(selectedSale.change_amount ?? 0)}</span>
                      </div>
                    </>
                  )}
                </div>

                <div className="text-center text-[10px] pt-2 mt-2 border-t border-dashed border-black">
                  {storeSettings.receipt_footer || 'Maraming salamat po sa pagtangkilik!'}
                </div>
              </div>

              {/* Action Buttons: Reprint, Return & Void */}
              <div className="pt-4 border-t border-surface-700/60 mt-4 space-y-2 no-print">
                {/* Reprint */}
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="w-full py-2.5 rounded-xl bg-surface-700 hover:bg-surface-600 text-surface-100 border border-surface-600 text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                >
                  <span>🖨️</span>
                  <span>I-print Muli ang Resibo ({storeSettings.printer_width || '58mm'})</span>
                </button>

                {/* Return / Refund — only for non-return sales with items */}
                {!isReturnSale(selectedSale) && (selectedSale.items?.length ?? 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowReturnModal(true)}
                    className="w-full py-2.5 rounded-xl bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                  >
                    <span>↩️</span>
                    <span>Return / Refund Items (Ibang Item lang)</span>
                  </button>
                )}

                {/* Void — full cancel, PIN-protected */}
                {!isReturnSale(selectedSale) && (
                  <button
                    type="button"
                    onClick={() => requestVoid(selectedSale)}
                    disabled={voiding}
                    className="w-full py-2.5 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-xs font-bold transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-sm"
                  >
                    <span>🚫</span>
                    <span>{voiding ? 'Kina-kansela ang Resibo...' : 'I-Void Buong Sale (Cancel) 🔐'}</span>
                  </button>
                )}
              </div>

            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
