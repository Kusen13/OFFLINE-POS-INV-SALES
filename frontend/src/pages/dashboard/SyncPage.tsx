/**
 * Sync Page - Enhanced Sync Center & Product Sales Breakdown
 * Standardized Marites POS Clean Layout: 2 Slim Toolbars + Edge-to-Edge Pure Table
 */

import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useSyncStore } from '../../features/sync/syncStore';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { getAllSales, resetFailedSales, deleteSale, deleteMultipleSales, clearFailedSales } from '../../db/salesRepository';
import { getPendingMutations, deleteMutation, clearFailedMutations, clearAllMutations, type PendingMutation } from '../../db/mutationRepository';
import { formatCurrency } from '../../utils/currency';
import { formatDateTime, getRelativeTime, getLocalDateStr } from '../../utils/date';
import type { PendingSale } from '../../types/sale';

interface ProductSummary {
  product_id: number;
  product_name: string;
  unit_price: number;
  total_qty: number;
  total_revenue: number;
  receipt_count: number;
  synced_qty: number;
  pending_qty: number;
  failed_qty: number;
}

function getItemIcon(name?: string): string {
  const n = (name || '').toLowerCase();
  if (n.includes('bigas') || n.includes('rice') || n.includes('palay')) return '🌾';
  if (n.includes('itlog') || n.includes('egg')) return '🥚';
  if (n.includes('tinapay') || n.includes('bread') || n.includes('pandesal')) return '🍞';
  if (n.includes('lata') || n.includes('can') || n.includes('sardines') || n.includes('tuna')) return '🥫';
  if (n.includes('noodle') || n.includes('pancit') || n.includes('mami')) return '🍜';
  if (n.includes('sabon') || n.includes('soap') || n.includes('shampoo')) return '🧼';
  if (n.includes('mantika') || n.includes('oil')) return '🫗';
  if (n.includes('isaw') || n.includes('bbq') || n.includes('barbecue') || n.includes('pork')) return '🍢';
  if (n.includes('dugo') || n.includes('betamax') || n.includes('tenga')) return '🍢';
  if (n.includes('hotdog')) return '🌭';
  if (n.includes('manok') || n.includes('chicken') || n.includes('leeg')) return '🍗';
  if (n.includes('fish') || n.includes('isda') || n.includes('bangus') || n.includes('tilapia')) return '🐟';
  if (n.includes('coke') || n.includes('softdrink') || n.includes('juice') || n.includes('drink')) return '🥤';
  if (n.includes('suka') || n.includes('sauce') || n.includes('seasoning')) return '🍶';
  return '📦';
}

export function SyncPage() {
  const isOnline = useOnlineStatus();
  const {
    pendingCount,
    failedCount,
    syncedCount,
    isSyncing: syncing,
    lastSyncTime,
    lastError: lastSyncError,
    performSync,
    refreshCounts,
  } = useSyncStore();

  const [sales, setSales] = useState<PendingSale[]>([]);
  const [mutations, setMutations] = useState<PendingMutation[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState('');

  // Tabs & Filters
  const [activeTab, setActiveTab] = useState<'products' | 'sales' | 'mutations'>('sales');

  const [customDate, setCustomDate] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'FAILED' | 'SYNCED'>('ALL');
  const [productSearch, setProductSearch] = useState('');
  const [productSort, setProductSort] = useState<'QTY_DESC' | 'REV_DESC' | 'NAME_ASC'>('QTY_DESC');

  // Receipt Modal State
  const [selectedReceipt, setSelectedReceipt] = useState<PendingSale | null>(null);

  // Multi-select for Sales deletion
  const [selectedSaleUuids, setSelectedSaleUuids] = useState<Set<string>>(new Set());

  // Pagination for Sales
  const [page, setPage] = useState(1);
  const pageSize = 25;

  useEffect(() => {
    loadData();
  }, [pendingCount, failedCount, syncedCount]);

  async function loadData() {
    setLoading(true);
    try {
      const [allSales, allMutations] = await Promise.all([
        getAllSales(),
        getPendingMutations(),
      ]);
      setSales(allSales);
      setMutations(allMutations);
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    await performSync();
    await loadData();
  }

  async function handleRetryFailed() {
    const count = await resetFailedSales();
    setActionMsg(`${count} failed sale(s) reset to pending`);
    await refreshCounts();
    await loadData();
    setTimeout(() => setActionMsg(''), 3000);
  }

  async function handleClearFailed() {
    if (!confirm('Sigurado ka bang nais mong burahin ang lahat ng failed transactions?')) return;
    const [salesDeleted, mutsDeleted] = await Promise.all([
      clearFailedSales(),
      clearFailedMutations(),
    ]);
    setActionMsg(`${salesDeleted + mutsDeleted} failed transaction(s) deleted`);
    await refreshCounts();
    await loadData();
    setTimeout(() => setActionMsg(''), 3000);
  }

  async function handleDeleteSale(uuid: string, receiptNumber: string, status?: string) {
    const isSynced = status === 'SYNCED';
    const confirmMsg = isSynced
      ? `Burahin ang transaksyon #${receiptNumber}?\n\nPaalala: Naka-sync na ito sa server; mabubura lamang ito sa local storage ng device na ito.`
      : `Burahin ang hindi pa nai-sync na transaksyon #${receiptNumber}?\n\nBabala: Hindi na ito maipapadala sa server database.`;
    if (!confirm(confirmMsg)) return;

    await deleteSale(uuid);
    setSelectedSaleUuids(prev => {
      const next = new Set(prev);
      next.delete(uuid);
      return next;
    });
    if (selectedReceipt?.uuid === uuid) setSelectedReceipt(null);
    setActionMsg(`Deleted transaction #${receiptNumber}`);
    await refreshCounts();
    await loadData();
    setTimeout(() => setActionMsg(''), 3000);
  }

  async function handleDeleteSelectedSales() {
    if (selectedSaleUuids.size === 0) return;
    const count = selectedSaleUuids.size;
    if (!confirm(`Sigurado ka bang nais mong burahin ang ${count} napiling resibo?`)) return;

    await deleteMultipleSales(Array.from(selectedSaleUuids));
    setSelectedSaleUuids(new Set());
    if (selectedReceipt && selectedSaleUuids.has(selectedReceipt.uuid)) {
      setSelectedReceipt(null);
    }
    setActionMsg(`Matagumpay na nabura ang ${count} resibo`);
    await refreshCounts();
    await loadData();
    setTimeout(() => setActionMsg(''), 3000);
  }

  async function handleDeleteMutation(id: string) {
    if (!confirm('Burahin ang offline mutation na ito?')) return;
    await deleteMutation(id);
    setActionMsg('Nai-delete ang offline mutation');
    await refreshCounts();
    await loadData();
    setTimeout(() => setActionMsg(''), 3000);
  }

  async function handleClearAllMutations() {
    if (!confirm(`Sigurado ka bang nais mong linisin ang lahat ng ${mutations.length} pending offline mutations?`)) return;
    const count = await clearAllMutations();
    setActionMsg(`Nalinis ang ${count} offline mutation(s)`);
    await refreshCounts();
    await loadData();
    setTimeout(() => setActionMsg(''), 3000);
  }

  function toggleSelectSale(uuid: string) {
    setSelectedSaleUuids(prev => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  }

  function toggleSelectAll(uuids: string[]) {
    const allSelected = uuids.length > 0 && uuids.every(id => selectedSaleUuids.has(id));
    setSelectedSaleUuids(prev => {
      const next = new Set(prev);
      if (allSelected) {
        uuids.forEach(id => next.delete(id));
      } else {
        uuids.forEach(id => next.add(id));
      }
      return next;
    });
  }

  // Date-filtered sales
  const dateFilteredSales = useMemo(() => {
    return sales.filter(s => {
      if (!customDate) return true;
      return getLocalDateStr(s.sold_at) === customDate;
    });
  }, [sales, customDate]);

  // Status-filtered sales
  const filteredSales = useMemo(() => {
    if (statusFilter === 'ALL') return dateFilteredSales;
    return dateFilteredSales.filter(s => s.sync_status === statusFilter);
  }, [dateFilteredSales, statusFilter]);

  const totalPages = Math.ceil(filteredSales.length / pageSize) || 1;
  const paginatedSales = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredSales.slice(start, start + pageSize);
  }, [filteredSales, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [customDate, statusFilter]);

  // Product breakdown calculation
  const productBreakdown = useMemo<ProductSummary[]>(() => {
    const map = new Map<string, ProductSummary>();

    for (const sale of dateFilteredSales) {
      if (!sale.items || !Array.isArray(sale.items)) continue;

      for (const it of sale.items) {
        const key = `${it.product_id}_${it.product_name.toLowerCase().trim()}`;
        let entry = map.get(key);
        if (!entry) {
          entry = {
            product_id: it.product_id,
            product_name: it.product_name,
            unit_price: Number(it.unit_price) || 0,
            total_qty: 0,
            total_revenue: 0,
            receipt_count: 0,
            synced_qty: 0,
            pending_qty: 0,
            failed_qty: 0,
          };
          map.set(key, entry);
        }

        const q = Number(it.quantity) || 0;
        const rev = Number(it.line_total) || (q * (Number(it.unit_price) || 0));
        entry.total_qty += q;
        entry.total_revenue += rev;
        entry.receipt_count += 1;

        if (sale.sync_status === 'SYNCED') {
          entry.synced_qty += q;
        } else if (sale.sync_status === 'FAILED') {
          entry.failed_qty += q;
        } else {
          entry.pending_qty += q;
        }
      }
    }

    const arr = Array.from(map.values());
    if (productSort === 'REV_DESC') {
      return arr.sort((a, b) => b.total_revenue - a.total_revenue);
    }
    if (productSort === 'NAME_ASC') {
      return arr.sort((a, b) => a.product_name.localeCompare(b.product_name));
    }
    return arr.sort((a, b) => b.total_qty - a.total_qty);
  }, [dateFilteredSales, productSort]);

  const filteredProductBreakdown = useMemo(() => {
    if (!productSearch.trim()) return productBreakdown;
    const q = productSearch.toLowerCase().trim();
    return productBreakdown.filter(p => p.product_name.toLowerCase().includes(q));
  }, [productBreakdown, productSearch]);

  const totalItemsSold = useMemo(() => {
    return productBreakdown.reduce((sum, p) => sum + p.total_qty, 0);
  }, [productBreakdown]);

  const totalProductRevenue = useMemo(() => {
    return productBreakdown.reduce((sum, p) => sum + p.total_revenue, 0);
  }, [productBreakdown]);

  const totalPendingAmount = useMemo(() => {
    return sales.filter(s => s.sync_status === 'PENDING').reduce((sum, s) => sum + (Number(s.total_amount) || 0), 0);
  }, [sales]);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-surface-950 text-surface-100 font-sans">
      {/* ── TOOLBAR 1: Page Title, Status Chips, Primary Sync Actions ── */}
      <header className="h-12 border-b border-surface-800 bg-surface-900/80 px-3 sm:px-4 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base shrink-0">🔄</span>
          <h1 className="text-xs sm:text-sm font-bold tracking-tight text-surface-100 truncate">
            Sync Center
          </h1>

          {/* Network Health Indicator */}
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
              isOnline
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
            {isOnline ? 'Online' : 'Offline'}
          </span>

          {/* Pending Count Chip */}
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 shrink-0">
            {pendingCount} Pending {totalPendingAmount > 0 && `(${formatCurrency(totalPendingAmount)})`}
          </span>

          {failedCount > 0 && (
            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30 shrink-0">
              {failedCount} Failed
            </span>
          )}

          <span className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-surface-800 text-surface-400 shrink-0">
            {syncedCount} Synced
          </span>

          {lastSyncTime && (
            <span className="hidden lg:inline text-surface-500 text-[10px]">
              (Sync: {getRelativeTime(lastSyncTime)})
            </span>
          )}
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {failedCount > 0 && (
            <>
              <button
                type="button"
                onClick={handleRetryFailed}
                className="h-8 px-2.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs font-semibold hover:bg-amber-500/30 transition-colors cursor-pointer"
              >
                Retry ({failedCount})
              </button>
              <button
                type="button"
                onClick={handleClearFailed}
                className="h-8 px-2.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-semibold hover:bg-rose-500/30 transition-colors cursor-pointer"
              >
                Clear Failed
              </button>
            </>
          )}

          <button
            type="button"
            onClick={handleSync}
            disabled={syncing || pendingCount === 0}
            className="h-8 px-3 rounded-lg bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {syncing ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Syncing...</span>
              </>
            ) : (
              <>
                <span>🔄</span>
                <span>Sync Now ({pendingCount})</span>
              </>
            )}
          </button>

          <a
            href="/connect.html"
            target="_blank"
            rel="noopener noreferrer"
            className="h-8 px-2.5 rounded-lg bg-surface-800 hover:bg-surface-700 text-sky-400 border border-surface-700 text-xs font-medium flex items-center gap-1 transition-colors"
            title="Konekta ng Cellphone & QR Code"
          >
            <span>📱</span>
            <span className="hidden sm:inline">Connect</span>
          </a>
        </div>
      </header>

      {/* ── ALERTS / MESSAGES (Slim banner) ── */}
      {lastSyncError && (
        <div className="px-4 py-1.5 bg-rose-950/70 border-b border-rose-800/80 text-rose-300 text-xs flex items-center justify-between shrink-0">
          <span className="truncate">⚠️ {lastSyncError}</span>
          <button
            type="button"
            onClick={() => useSyncStore.setState({ lastError: null })}
            className="text-rose-400 hover:text-rose-100 text-[11px] font-bold underline ml-2 shrink-0 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {actionMsg && (
        <div className="px-4 py-1.5 bg-primary-950/70 border-b border-primary-800/80 text-primary-300 text-xs text-center font-medium shrink-0 animate-fade-in">
          {actionMsg}
        </div>
      )}

      {/* ── TOOLBAR 2: View Tabs + Contextual Filters & Controls ── */}
      <div className="h-11 border-b border-surface-800/80 bg-surface-900/50 px-3 sm:px-4 flex items-center justify-between gap-2 shrink-0 overflow-x-auto no-scrollbar">
        {/* Left: Tab Switcher */}
        <div className="flex items-center bg-surface-950/80 p-0.5 rounded-lg border border-surface-800 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('sales')}
            className={`h-7 px-3 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'sales'
                ? 'bg-primary-600 text-white shadow-xs'
                : 'text-surface-400 hover:text-surface-200'
            }`}
          >
            <span>🧾</span>
            <span>Resibo Logs</span>
            <span className="text-[10px] opacity-75 font-mono">({filteredSales.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('products')}
            className={`h-7 px-3 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'products'
                ? 'bg-primary-600 text-white shadow-xs'
                : 'text-surface-400 hover:text-surface-200'
            }`}
          >
            <span>📦</span>
            <span>Product Sales</span>
            <span className="text-[10px] opacity-75 font-mono">({productBreakdown.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('mutations')}
            className={`h-7 px-3 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'mutations'
                ? 'bg-primary-600 text-white shadow-xs'
                : 'text-surface-400 hover:text-surface-200'
            }`}
          >
            <span>⚡</span>
            <span>Offline Changes</span>
            <span className="text-[10px] opacity-75 font-mono">({mutations.length})</span>
          </button>
        </div>

        {/* Right: Tab-specific Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {activeTab === 'sales' && (
            <>
              {selectedSaleUuids.size > 0 && (
                <button
                  type="button"
                  onClick={handleDeleteSelectedSales}
                  className="h-7 px-2.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-semibold hover:bg-rose-500/30 transition-colors flex items-center gap-1 cursor-pointer shrink-0"
                >
                  <span>🗑️</span>
                  <span>Delete ({selectedSaleUuids.size})</span>
                </button>
              )}

              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as any)}
                className="h-7 rounded-lg bg-surface-800 border border-surface-700 px-2 text-xs text-surface-200 focus:outline-none focus:border-primary-500 cursor-pointer"
              >
                <option value="ALL">All Status</option>
                <option value="PENDING">🟡 Pending Only</option>
                <option value="SYNCED">🟢 Synced Only</option>
                <option value="FAILED">🔴 Failed Only</option>
              </select>

              {/* Date Picker Filter */}
              <div className="flex items-center gap-1.5 bg-surface-800 border border-surface-700 h-7 px-2 rounded-lg text-xs">
                <span className="text-surface-400">📅</span>
                <input
                  type="date"
                  value={customDate}
                  onChange={e => setCustomDate(e.target.value)}
                  className="bg-transparent text-xs text-surface-200 focus:outline-none cursor-pointer"
                  title="Pumili ng petsa para i-filter"
                />
                {customDate && (
                  <button
                    type="button"
                    onClick={() => setCustomDate('')}
                    className="text-surface-400 hover:text-rose-400 text-xs ml-1 cursor-pointer transition-colors"
                    title="I-clear ang petsa"
                  >
                    ✕
                  </button>
                )}
              </div>
            </>
          )}

          {activeTab === 'products' && (
            <>
              <div className="hidden md:flex items-center gap-2 text-xs font-mono mr-2">
                <span className="text-surface-400">Dami: <strong className="text-primary-400">{totalItemsSold}</strong></span>
                <span className="text-surface-600">•</span>
                <span className="text-surface-400">Benta: <strong className="text-emerald-400">{formatCurrency(totalProductRevenue)}</strong></span>
              </div>

              <div className="relative">
                <input
                  type="text"
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                  placeholder="🔍 Hanapin ang produkto..."
                  className="h-7 w-40 sm:w-52 rounded-lg bg-surface-800 border border-surface-700 px-2.5 text-xs text-surface-100 placeholder:text-surface-500 focus:outline-none focus:border-primary-500"
                />
              </div>

              <select
                value={productSort}
                onChange={e => setProductSort(e.target.value as any)}
                className="h-7 rounded-lg bg-surface-800 border border-surface-700 px-2 text-xs text-surface-200 focus:outline-none focus:border-primary-500 cursor-pointer"
              >
                <option value="QTY_DESC">Pinakamaraming Nabili</option>
                <option value="REV_DESC">Pinakamataas na Benta (₱)</option>
                <option value="NAME_ASC">Pangalan (A-Z)</option>
              </select>
            </>
          )}

          {activeTab === 'mutations' && mutations.length > 0 && (
            <button
              type="button"
              onClick={handleClearAllMutations}
              className="h-7 px-2.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap active:scale-95"
              title="Linisin ang lahat ng pending mutations sa queue"
            >
              <span>🧹</span>
              <span>Linisin ang Lahat ({mutations.length})</span>
            </button>
          )}
        </div>
      </div>

      {/* ── CONTENT AREA: PURE TABLE ── */}
      <main className="flex-1 min-h-0 overflow-auto bg-surface-950">
        {loading ? (
          <div className="h-64 flex flex-col items-center justify-center gap-2 text-surface-500 text-xs">
            <span className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            <span>Ikinakarga ang sync data...</span>
          </div>
        ) : activeTab === 'sales' ? (
          /* ═══════════════════════════════════════════════════════════════════════
             TAB 1: RESIBO LOGS (Table View)
             ═══════════════════════════════════════════════════════════════════════ */
          filteredSales.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-surface-500 text-xs">
              <span className="text-3xl mb-1">🧾</span>
              <p className="font-semibold text-surface-400">Walang resibo sa napiling filter</p>
              <p className="text-[11px] text-surface-600">Mag-punch ng order sa POS para magkaroon ng logs.</p>
            </div>
          ) : (
            <table className="w-full text-xs text-left border-collapse">
              <thead className="sticky top-0 z-10 bg-surface-900 border-b border-surface-800 text-[11px] font-bold text-surface-400 uppercase tracking-wider">
                <tr>
                  <th className="py-2.5 px-3 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={
                        paginatedSales.length > 0 &&
                        paginatedSales.every(s => selectedSaleUuids.has(s.uuid))
                      }
                      onChange={() => toggleSelectAll(paginatedSales.map(s => s.uuid))}
                      className="rounded border-surface-700 text-primary-600 focus:ring-0 cursor-pointer"
                    />
                  </th>
                  <th className="py-2.5 px-3">Petsa at Oras</th>
                  <th className="py-2.5 px-3">Resibo #</th>
                  <th className="py-2.5 px-3">Mga Bilihin (Summary)</th>
                  <th className="py-2.5 px-3 text-right">Kabuuang Halaga</th>
                  <th className="py-2.5 px-3">Bayad</th>
                  <th className="py-2.5 px-3 text-center">Sync Status</th>
                  <th className="py-2.5 px-3 text-right">Aksyon</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-800/60 font-medium text-surface-300">
                {paginatedSales.map(sale => {
                  const isChecked = selectedSaleUuids.has(sale.uuid);
                  const isPending = sale.sync_status === 'PENDING';
                  const isFailed = sale.sync_status === 'FAILED';

                  const itemSummary = (sale.items || [])
                    .map(it => `${it.quantity}× ${it.product_name}`)
                    .join(', ');

                  return (
                    <tr
                      key={sale.uuid}
                      className={`hover:bg-surface-900/50 transition-colors ${isChecked ? 'bg-primary-950/20' : ''}`}
                    >
                      <td className="py-2 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelectSale(sale.uuid)}
                          className="rounded border-surface-700 text-primary-600 focus:ring-0 cursor-pointer"
                        />
                      </td>
                      <td className="py-2 px-3 text-surface-400 whitespace-nowrap">
                        {formatDateTime(sale.sold_at)}
                      </td>
                      <td className="py-2 px-3 font-mono font-bold text-surface-100 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setSelectedReceipt(sale)}
                          className="hover:text-primary-400 hover:underline cursor-pointer"
                        >
                          #{sale.receipt_number}
                        </button>
                      </td>
                      <td className="py-2 px-3 text-surface-300 max-w-xs truncate" title={itemSummary}>
                        {itemSummary || '—'}
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-surface-100 whitespace-nowrap">
                        {formatCurrency(sale.total_amount)}
                      </td>
                      <td className="py-2 px-3 text-surface-400 whitespace-nowrap">
                        {sale.payment_method_name || 'Cash'}
                      </td>
                      <td className="py-2 px-3 text-center whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            isPending
                              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 animate-pulse'
                              : isFailed
                              ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                              : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          }`}
                        >
                          {isPending ? '🟡 PENDING' : isFailed ? '🔴 FAILED' : '🟢 SYNCED'}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setSelectedReceipt(sale)}
                            className="h-7 px-2 rounded bg-surface-800 hover:bg-surface-700 text-surface-300 hover:text-surface-100 text-[11px] transition-colors cursor-pointer"
                            title="Tingnan ang Resibo"
                          >
                            👁️
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSale(sale.uuid, sale.receipt_number, sale.sync_status)}
                            className="h-7 px-2 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-[11px] transition-colors cursor-pointer"
                            title="Burahin ang Resibo"
                          >
                            🗑️
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        ) : activeTab === 'products' ? (
          /* ═══════════════════════════════════════════════════════════════════════
             TAB 2: PRODUCT SALES BREAKDOWN (Table View)
             ═══════════════════════════════════════════════════════════════════════ */
          filteredProductBreakdown.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-surface-500 text-xs">
              <span className="text-3xl mb-1">📦</span>
              <p className="font-semibold text-surface-400">Walang benta ng produkto sa napiling petsa</p>
            </div>
          ) : (
            <table className="w-full text-xs text-left border-collapse">
              <thead className="sticky top-0 z-10 bg-surface-900 border-b border-surface-800 text-[11px] font-bold text-surface-400 uppercase tracking-wider">
                <tr>
                  <th className="py-2.5 px-3">Produkto</th>
                  <th className="py-2.5 px-3 text-right">Presyo (PHP)</th>
                  <th className="py-2.5 px-3 text-right">Dami ng Benta (Qty)</th>
                  <th className="py-2.5 px-3 text-right">Kabuuang Benta</th>
                  <th className="py-2.5 px-3 text-center">Resibo Count</th>
                  <th className="py-2.5 px-3 text-center">Sync Breakdown</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-800/60 font-medium text-surface-300">
                {filteredProductBreakdown.map(prod => (
                  <tr key={prod.product_id} className="hover:bg-surface-900/50 transition-colors">
                    <td className="py-2.5 px-3 flex items-center gap-2">
                      <span className="text-base">{getItemIcon(prod.product_name)}</span>
                      <span className="font-bold text-surface-100">{prod.product_name}</span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-surface-300">
                      {formatCurrency(prod.unit_price)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-primary-400 font-mono text-sm">
                      {prod.total_qty.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-emerald-400 font-mono text-sm">
                      {formatCurrency(prod.total_revenue)}
                    </td>
                    <td className="py-2.5 px-3 text-center font-mono text-surface-400">
                      {prod.receipt_count} orders
                    </td>
                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5 text-[10px]">
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-bold">
                          {prod.synced_qty} Synced
                        </span>
                        {prod.pending_qty > 0 && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 font-bold">
                            {prod.pending_qty} Pending
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : (
          /* ═══════════════════════════════════════════════════════════════════════
             TAB 3: OFFLINE CHANGES (Mutations Table)
             ═══════════════════════════════════════════════════════════════════════ */
          mutations.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-surface-500 text-xs">
              <span className="text-3xl mb-1">⚡</span>
              <p className="font-semibold text-surface-400">Walang naka-queue na offline master changes</p>
              <p className="text-[11px] text-surface-600">Lahat ng bagong produkto, kategorya, at expenses ay naka-sync na.</p>
            </div>
          ) : (
            <table className="w-full text-xs text-left border-collapse">
              <thead className="sticky top-0 z-10 bg-surface-900 border-b border-surface-800 text-[11px] font-bold text-surface-400 uppercase tracking-wider">
                <tr>
                  <th className="py-2.5 px-3">Entity</th>
                  <th className="py-2.5 px-3">Aksyon</th>
                  <th className="py-2.5 px-3">Detalye / Payload</th>
                  <th className="py-2.5 px-3">Petsa Nilikha</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                  <th className="py-2.5 px-3 text-right">Aksyon</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-800/60 font-medium text-surface-300">
                {mutations.map(m => (
                  <tr key={m.id} className="hover:bg-surface-900/50 transition-colors">
                    <td className="py-2.5 px-3 font-bold text-surface-100 uppercase text-[11px]">
                      {m.entity}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-surface-800 text-primary-400 uppercase">
                        {m.action}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-surface-400 max-w-sm truncate">
                      {JSON.stringify(m.payload)}
                    </td>
                    <td className="py-2.5 px-3 text-surface-400 whitespace-nowrap">
                      {formatDateTime(m.created_at)}
                    </td>
                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          m.status === 'PENDING'
                            ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                            : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                        }`}
                      >
                        {m.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleDeleteMutation(m.id)}
                        className="h-7 px-2 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-[11px] transition-colors cursor-pointer"
                        title="Burahin ang offline mutation"
                      >
                        🗑️ Burahin
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </main>

      {/* ── FOOTER PAGINATION BAR (For Resibo tab) ── */}
      {activeTab === 'sales' && filteredSales.length > 0 && (
        <footer className="h-10 border-t border-surface-800 bg-surface-900/80 px-3 sm:px-4 flex items-center justify-between text-xs text-surface-400 shrink-0">
          <div className="flex items-center gap-2">
            <span>
              Ipinapakita: <strong className="text-surface-200">{paginatedSales.length}</strong> sa{' '}
              <strong className="text-surface-200">{filteredSales.length}</strong> resibo
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="h-7 px-2 rounded bg-surface-800 hover:bg-surface-700 text-surface-300 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              ◀
            </button>
            <span className="font-mono text-xs px-2 text-surface-300">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              className="h-7 px-2 rounded bg-surface-800 hover:bg-surface-700 text-surface-300 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              ▶
            </button>
          </div>
        </footer>
      )}

      {/* ── RECEIPT MODAL (Portal) ── */}
      {selectedReceipt && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/70 backdrop-blur-xs animate-fade-in">
          <div className="bg-surface-900 border border-surface-700/80 rounded-2xl max-w-sm w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="p-3.5 bg-surface-800/80 border-b border-surface-700 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-surface-100">
                  Resibo #{selectedReceipt.receipt_number}
                </h3>
                <p className="text-[11px] text-surface-400">
                  {formatDateTime(selectedReceipt.sold_at)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedReceipt(null)}
                className="w-7 h-7 rounded-lg bg-surface-700 hover:bg-surface-600 text-surface-300 hover:text-surface-100 flex items-center justify-center text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Items */}
            <div className="p-4 overflow-y-auto space-y-3 flex-1 text-xs">
              <div className="divide-y divide-surface-800">
                {(selectedReceipt.items || []).map((it, idx) => (
                  <div key={idx} className="py-1.5 flex justify-between items-center">
                    <div>
                      <p className="font-semibold text-surface-100">
                        {it.quantity}× {it.product_name}
                      </p>
                      <p className="text-[10px] text-surface-400">
                        @{formatCurrency(it.unit_price)}
                      </p>
                    </div>
                    <span className="font-mono font-bold text-surface-200">
                      {formatCurrency(it.line_total || it.quantity * it.unit_price)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Totals */}
              <div className="pt-2 border-t border-surface-700 space-y-1">
                <div className="flex justify-between text-surface-400">
                  <span>Subtotal:</span>
                  <span>{formatCurrency(selectedReceipt.subtotal)}</span>
                </div>
                {selectedReceipt.discount_amount > 0 && (
                  <div className="flex justify-between text-rose-400">
                    <span>Discount:</span>
                    <span>-{formatCurrency(selectedReceipt.discount_amount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold text-emerald-400 pt-1 border-t border-surface-800">
                  <span>Kabuuang Halaga:</span>
                  <span>{formatCurrency(selectedReceipt.total_amount)}</span>
                </div>
              </div>

              {/* Payment Details */}
              <div className="pt-2 border-t border-surface-800 text-[11px] text-surface-400 space-y-0.5">
                <div className="flex justify-between">
                  <span>Paraan ng Bayad:</span>
                  <span className="font-semibold text-surface-200">{selectedReceipt.payment_method_name || 'Cash'}</span>
                </div>
                {selectedReceipt.cash_tendered !== null && selectedReceipt.cash_tendered !== undefined && (
                  <div className="flex justify-between">
                    <span>Cash Tendered:</span>
                    <span className="font-mono">{formatCurrency(selectedReceipt.cash_tendered)}</span>
                  </div>
                )}
                {selectedReceipt.change_amount !== null && selectedReceipt.change_amount !== undefined && (
                  <div className="flex justify-between">
                    <span>Sukli:</span>
                    <span className="font-mono text-emerald-400">{formatCurrency(selectedReceipt.change_amount)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="p-3 bg-surface-950 border-t border-surface-800 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => handleDeleteSale(selectedReceipt.uuid, selectedReceipt.receipt_number, selectedReceipt.sync_status)}
                className="h-8 px-3 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-semibold hover:bg-rose-500/30 transition-colors cursor-pointer"
              >
                Burahin
              </button>
              <button
                type="button"
                onClick={() => setSelectedReceipt(null)}
                className="h-8 px-4 rounded-lg bg-surface-800 hover:bg-surface-700 text-surface-200 text-xs font-semibold cursor-pointer ml-auto"
              >
                Isara
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
