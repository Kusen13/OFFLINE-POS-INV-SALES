/**
 * Sync Page - Enhanced Sync Center & Product Sales Breakdown
 * 
 * Features:
 * - Real-time Sync Status & Network Health
 * - "Breakdown per Product" View (Ilang Isaw, BBQ, Isda, atbp. ang nabili)
 * - Date Filters: Ngayong Araw, Kahapon, Custom Date, Lahat
 * - Detailed Sales Logs with Click-to-View Receipt Modal
 * - Offline Mutations Queue Viewer
 * - 1-Click Retry Failed & Purge/Delete Stale Transactions
 */

import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useSyncStore } from '../../features/sync/syncStore';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { getAllSales, resetFailedSales, cleanupOldSyncedSales, deleteSale, clearFailedSales } from '../../db/salesRepository';
import { getPendingMutations, deleteMutation, clearFailedMutations, type PendingMutation } from '../../db/mutationRepository';
import { formatCurrency } from '../../utils/currency';
import { formatDateTime, getRelativeTime, getTodayStr, getLocalDateStr } from '../../utils/date';
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

export function SyncPage() {
  const isOnline = useOnlineStatus();
  const { pendingCount, failedCount, syncedCount, isSyncing: syncing, lastSyncTime, lastError: lastSyncError, performSync, refreshCounts } = useSyncStore();
  const [sales, setSales] = useState<PendingSale[]>([]);
  const [mutations, setMutations] = useState<PendingMutation[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState('');

  // Navigation & Filtering States
  const [activeTab, setActiveTab] = useState<'products' | 'sales' | 'mutations'>('products');
  const [dateFilter, setDateFilter] = useState<'TODAY' | 'YESTERDAY' | 'CUSTOM' | 'ALL'>('TODAY');
  const [customDate, setCustomDate] = useState(() => getTodayStr());
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'FAILED' | 'SYNCED'>('ALL');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('table');
  const [productSearch, setProductSearch] = useState('');
  const [productSort, setProductSort] = useState<'QTY_DESC' | 'REV_DESC' | 'NAME_ASC'>('QTY_DESC');

  // Receipt Modal State
  const [selectedReceipt, setSelectedReceipt] = useState<PendingSale | null>(null);

  // Pagination for Sales
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

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

  async function handleDeleteSale(uuid: string, receiptNumber: string) {
    if (!confirm(`Burahin ang transaksyon ${receiptNumber}?`)) return;
    await deleteSale(uuid);
    if (selectedReceipt?.uuid === uuid) setSelectedReceipt(null);
    setActionMsg(`Nai-delete ang resibo #${receiptNumber}`);
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

  async function handleCleanup() {
    const count = await cleanupOldSyncedSales(30);
    setActionMsg(`${count} old synced sale(s) cleaned up`);
    await refreshCounts();
    await loadData();
    setTimeout(() => setActionMsg(''), 3000);
  }

  // ── Date-Filtered Sales ───────────────────────────────────────────────
  const dateFilteredSales = useMemo(() => {
    const today = getTodayStr();
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const yesterday = getLocalDateStr(d);

    return sales.filter(s => {
      const saleDate = getLocalDateStr(s.sold_at);
      if (dateFilter === 'TODAY') return saleDate === today;
      if (dateFilter === 'YESTERDAY') return saleDate === yesterday;
      if (dateFilter === 'CUSTOM') return saleDate === customDate;
      return true; // ALL
    });
  }, [sales, dateFilter, customDate]);

  // ── Status-Filtered Sales for Sales Log Tab ───────────────────────────
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
  }, [dateFilter, statusFilter, pageSize]);

  // ── Product Breakdown Calculation (Ilang Isaw, BBQ, etc.) ─────────────
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
    <div className="flex-1 min-h-0 flex flex-col space-y-2.5 sm:space-y-3.5 animate-fade-in pb-16 lg:pb-0">
      {/* Header */}
      <div className="flex-shrink-0 hidden lg:flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-surface-50 tracking-tight">Sync Center & Sales Audit</h1>
          <p className="text-surface-400 mt-0.5 text-xs sm:text-sm">
            Pag-monitor sa koneksyon, pag-sync ng mga transaksyon, at kabuuang benta kada produkto
          </p>
        </div>
      </div>

      {/* Connection Status Banner (Compact) */}
      <div className={`rounded-xl px-3 py-2 border flex items-center justify-between gap-2 shrink-0 ${
        isOnline ? 'bg-success-500/10 border-success-500/30' : 'bg-danger-500/10 border-danger-500/30'
      }`}>
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${isOnline ? 'bg-success-500 animate-pulse' : 'bg-danger-500'}`} />
          <p className={`font-semibold text-xs sm:text-sm truncate ${isOnline ? 'text-success-400' : 'text-danger-400'}`}>
            {isOnline ? 'Konektado sa Server (Laptop Database Online)' : 'Offline — Nakatabi sa device (local storage)'}
          </p>
        </div>
        {lastSyncTime && (
          <span className="text-surface-400 text-[10px] sm:text-xs whitespace-nowrap shrink-0">
            Huling sync: {getRelativeTime(lastSyncTime)}
          </span>
        )}
      </div>

      {/* Compact Status KPI Cards */}
      <div className="grid grid-cols-3 gap-2 shrink-0">
        <div className="bg-warning-500/10 rounded-xl p-2 sm:p-2.5 border border-warning-500/25 flex flex-col justify-between">
          <span className="text-[10px] font-bold text-warning-400 uppercase tracking-wider">Pending</span>
          <div className="flex items-baseline justify-between mt-0.5">
            <span className="text-base sm:text-lg font-black text-warning-400">{pendingCount}</span>
            {totalPendingAmount > 0 && (
              <span className="text-[10px] text-warning-400/90 font-medium truncate ml-1">
                {formatCurrency(totalPendingAmount)}
              </span>
            )}
          </div>
        </div>

        <div className="bg-danger-500/10 rounded-xl p-2 sm:p-2.5 border border-danger-500/25 flex flex-col justify-between">
          <span className="text-[10px] font-bold text-danger-400 uppercase tracking-wider">Failed</span>
          <span className="text-base sm:text-lg font-black text-danger-400 mt-0.5">{failedCount}</span>
        </div>

        <div className="bg-success-500/10 rounded-xl p-2 sm:p-2.5 border border-success-500/25 flex flex-col justify-between">
          <span className="text-[10px] font-bold text-success-400 uppercase tracking-wider">Synced</span>
          <span className="text-base sm:text-lg font-black text-success-400 mt-0.5">{syncedCount}</span>
        </div>
      </div>

      {/* Sync Control Action Row */}
      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap shrink-0">
        <button
          onClick={handleSync}
          disabled={syncing || pendingCount === 0}
          className="flex-1 py-2 sm:py-2.5 px-4 rounded-xl bg-primary-600 text-white text-xs sm:text-sm font-bold hover:bg-primary-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-xs shadow-primary-600/20 flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
        >
          {syncing ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>Nag-si-sync sa Laptop...</span>
            </>
          ) : (
            <>
              <span>🔄</span>
              <span>Sync All ({pendingCount} Pending)</span>
            </>
          )}
        </button>

        {failedCount > 0 && (
          <>
            <button
              onClick={handleRetryFailed}
              className="px-3 py-2 sm:py-2.5 rounded-xl bg-warning-600/20 text-warning-400 text-xs sm:text-sm font-semibold border border-warning-500/30 hover:bg-warning-600/30 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              🔄 Retry Failed ({failedCount})
            </button>
            <button
              onClick={handleClearFailed}
              className="px-3 py-2 sm:py-2.5 rounded-xl bg-danger-600/20 text-danger-400 text-xs sm:text-sm font-semibold border border-danger-500/30 hover:bg-danger-600/30 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              🗑️ Burahin ang Failed ({failedCount})
            </button>
          </>
        )}

        {syncedCount > 0 && (
          <button
            onClick={handleCleanup}
            className="px-3 py-2 sm:py-2.5 rounded-xl bg-surface-800 text-surface-300 text-xs sm:text-sm font-medium border border-surface-700/60 hover:bg-surface-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            title="Clean up synced sales older than 30 days"
          >
            🗑️ Cleanup Old
          </button>
        )}
      </div>

      {/* Error & Feedback Messages */}
      {lastSyncError && (
        <div className="bg-danger-500/10 border border-danger-500/30 rounded-xl p-2.5 shrink-0">
          <p className="text-danger-500 text-xs font-medium">⚠️ {lastSyncError}</p>
        </div>
      )}

      {actionMsg && (
        <div className="bg-primary-500/10 border border-primary-500/30 rounded-xl p-2.5 text-primary-300 text-xs text-center font-medium shrink-0 animate-fade-in">
          {actionMsg}
        </div>
      )}

      {/* Top Controls: Tabs & Date Filters */}
      <div className="flex items-center justify-between gap-2 flex-wrap sm:flex-nowrap shrink-0">
        {/* Tabs Switcher: Products Breakdown vs Sales Logs vs Mutations */}
        <div className="flex rounded-lg bg-surface-900/80 p-0.5 border border-surface-700/60 shrink-0 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveTab('products')}
            className={`px-3 py-1 rounded text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'products' ? 'bg-primary-600 text-white shadow-xs' : 'text-surface-400 hover:text-surface-200'
            }`}
          >
            <span>🍢</span>
            <span>Benta Bawat Produkto ({productBreakdown.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('sales')}
            className={`px-3 py-1 rounded text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'sales' ? 'bg-primary-600 text-white shadow-xs' : 'text-surface-400 hover:text-surface-200'
            }`}
          >
            <span>🧾</span>
            <span>Resibo ({dateFilteredSales.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('mutations')}
            className={`px-3 py-1 rounded text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'mutations' ? 'bg-primary-600 text-white shadow-xs' : 'text-surface-400 hover:text-surface-200'
            }`}
          >
            <span>⚙️</span>
            <span>Mutations ({mutations.length})</span>
          </button>
        </div>

        {/* Date Filter Quick Selector */}
        {activeTab !== 'mutations' && (
          <div className="flex items-center gap-1 bg-surface-900/80 p-0.5 rounded-lg border border-surface-700/60 shrink-0 ml-auto flex-wrap">
            <button
              onClick={() => setDateFilter('TODAY')}
              className={`px-2 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                dateFilter === 'TODAY' ? 'bg-primary-600 text-white' : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              ☀️ Ngayon
            </button>
            <button
              onClick={() => setDateFilter('YESTERDAY')}
              className={`px-2 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                dateFilter === 'YESTERDAY' ? 'bg-primary-600 text-white' : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              🌙 Kahapon
            </button>
            <button
              onClick={() => setDateFilter('ALL')}
              className={`px-2 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                dateFilter === 'ALL' ? 'bg-primary-600 text-white' : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              🌐 Lahat
            </button>
            <input
              type="date"
              value={customDate}
              onChange={e => {
                setCustomDate(e.target.value);
                setDateFilter('CUSTOM');
              }}
              className={`bg-surface-800 border border-surface-700 text-[11px] px-1.5 py-0.5 rounded text-surface-200 cursor-pointer ${
                dateFilter === 'CUSTOM' ? 'border-primary-500 ring-1 ring-primary-500/50' : ''
              }`}
              title="Pumili ng Petsa"
            />
          </div>
        )}
      </div>

      {/* Main Container */}
      <div className="flex-1 min-h-0 bg-surface-800/50 rounded-xl border border-surface-700/50 flex flex-col overflow-hidden shadow-sm">
        {activeTab === 'products' ? (
          /* ═══════════════════════════════════════════════════════════════════════
             TAB 1: PRODUCT SALES BREAKDOWN (Ilang Isaw, BBQ, etc. ang nabili)
             ═══════════════════════════════════════════════════════════════════════ */
          <div className="flex-1 min-h-0 flex flex-col">
            {/* Toolbar: Summary Strip + Search + View Switcher */}
            <div className="px-2.5 sm:px-3 py-2 bg-surface-900/70 border-b border-surface-700/50 flex items-center justify-between gap-2 flex-wrap shrink-0">
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="text"
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                  placeholder="🔍 Hanapin ang produkto (e.g. Isaw, BBQ)..."
                  className="px-2.5 py-1 rounded-lg bg-surface-800 border border-surface-700 text-surface-100 text-xs placeholder:text-surface-500 focus:outline-none focus:border-primary-500 w-44 sm:w-64"
                />

                <select
                  value={productSort}
                  onChange={e => setProductSort(e.target.value as any)}
                  className="bg-surface-800 border border-surface-700 rounded-lg px-2 py-1 text-xs text-surface-300 cursor-pointer"
                >
                  <option value="QTY_DESC">Pinakamaraming Nabili</option>
                  <option value="REV_DESC">Pinakamataas na Benta (₱)</option>
                  <option value="NAME_ASC">Pangalan (A-Z)</option>
                </select>
              </div>

              {/* View Switcher: Cards vs Table */}
              <div className="flex items-center gap-1 bg-surface-800/80 p-0.5 rounded-lg border border-surface-700/60 shrink-0 ml-auto">
                <button
                  onClick={() => setViewMode('cards')}
                  className={`px-2 py-0.5 text-xs font-medium rounded transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap ${
                    viewMode === 'cards' ? 'bg-primary-600 text-white shadow-xs' : 'text-surface-400 hover:text-surface-200'
                  }`}
                  title="Cards View"
                >
                  <span>📱</span> <span className="hidden xs:inline">Cards</span>
                </button>
                <button
                  onClick={() => setViewMode('table')}
                  className={`px-2 py-0.5 text-xs font-medium rounded transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap ${
                    viewMode === 'table' ? 'bg-primary-600 text-white shadow-xs' : 'text-surface-400 hover:text-surface-200'
                  }`}
                  title="Table View"
                >
                  <span>📋</span> <span className="hidden xs:inline">Table</span>
                </button>
              </div>
            </div>

            {/* Quick Summary Strip */}
            <div className="px-3 py-1.5 bg-surface-950/60 border-b border-surface-800/60 flex items-center justify-between text-xs text-surface-300 flex-wrap gap-2 shrink-0">
              <div className="flex items-center gap-3">
                <span>
                  📦 Kabuuang Nabili:{' '}
                  <strong className="text-primary-400 font-black">{totalItemsSold.toLocaleString()}</strong> pcs/sticks
                </span>
                <span>•</span>
                <span>
                  💰 Kabuuang Halaga:{' '}
                  <strong className="text-emerald-400 font-black">{formatCurrency(totalProductRevenue)}</strong>
                </span>
              </div>
              {productBreakdown.length > 0 && (
                <span className="text-[11px] text-surface-400">
                  🏆 Top: <strong className="text-surface-100">{productBreakdown[0].product_name}</strong> ({productBreakdown[0].total_qty})
                </span>
              )}
            </div>

            {/* Content List */}
            {loading ? (
              <div className="flex-1 min-h-0 flex items-center justify-center py-16">
                <div className="w-8 h-8 border-3 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
              </div>
            ) : filteredProductBreakdown.length === 0 ? (
              <div className="flex-1 min-h-0 flex flex-col items-center justify-center py-12 text-center">
                <span className="text-3xl mb-2 block">🍢</span>
                <p className="text-surface-300 font-medium text-xs sm:text-sm">Walang benta ng produkto sa napiling petsa</p>
                <p className="text-surface-500 text-[11px] mt-0.5">Pumili ng ibang petsa o mag-checkout muna sa POS</p>
              </div>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto">
                {viewMode === 'cards' ? (
                  /* Cards View */
                  <div className="p-2 sm:p-2.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {filteredProductBreakdown.map((item, idx) => (
                      <div
                        key={`${item.product_id}_${item.product_name}`}
                        className="p-3 rounded-xl bg-surface-900/60 hover:bg-surface-700/20 border border-surface-800/80 transition-all flex flex-col justify-between"
                      >
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-xl shrink-0">{getItemIcon(item.product_name)}</span>
                              <div className="min-w-0">
                                <h3 className="text-xs sm:text-sm font-bold text-surface-100 truncate">
                                  {item.product_name}
                                </h3>
                                <p className="text-[10px] text-surface-400">
                                  {formatCurrency(item.unit_price)} bawat piraso
                                </p>
                              </div>
                            </div>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-surface-800 text-surface-400 shrink-0">
                              #{idx + 1}
                            </span>
                          </div>

                          <div className="mt-3 p-2 rounded-lg bg-surface-950/70 border border-surface-800 flex items-center justify-between">
                            <div>
                              <span className="text-[10px] text-surface-400 block">Dami ng Nabili:</span>
                              <span className="text-base sm:text-lg font-black text-primary-400">
                                {item.total_qty} <span className="text-xs font-semibold text-surface-300">piraso</span>
                              </span>
                            </div>
                            <div className="text-right">
                              <span className="text-[10px] text-surface-400 block">Kabuuang Benta:</span>
                              <span className="text-sm sm:text-base font-bold text-emerald-400">
                                {formatCurrency(item.total_revenue)}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="mt-2.5 pt-2 border-t border-surface-800/80 flex items-center justify-between text-[11px]">
                          <span className="text-surface-400">
                            Nasa <strong>{item.receipt_count}</strong> resibo
                          </span>
                          <div className="flex items-center gap-1.5">
                            {item.synced_qty > 0 && (
                              <span className="px-1.5 py-0.2 rounded bg-success-500/20 text-success-400 text-[10px] font-semibold border border-success-500/30">
                                ✓ {item.synced_qty} Synced
                              </span>
                            )}
                            {item.pending_qty > 0 && (
                              <span className="px-1.5 py-0.2 rounded bg-warning-500/20 text-warning-400 text-[10px] font-semibold border border-warning-500/30">
                                ⏳ {item.pending_qty} Pending
                              </span>
                            )}
                            {item.failed_qty > 0 && (
                              <span className="px-1.5 py-0.2 rounded bg-danger-500/20 text-danger-400 text-[10px] font-semibold border border-danger-500/30">
                                ⚠️ {item.failed_qty} Failed
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  /* Table View */
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-surface-900 border-b border-surface-700/60 z-10 shadow-xs">
                      <tr>
                        <th className="px-2.5 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-center w-10">
                          #
                        </th>
                        <th className="px-2.5 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase whitespace-nowrap">
                          Produkto
                        </th>
                        <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-right whitespace-nowrap hidden sm:table-cell">
                          Presyo
                        </th>
                        <th className="px-2.5 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-center whitespace-nowrap bg-primary-950/20">
                          Dami ng Nabili
                        </th>
                        <th className="px-2.5 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-right whitespace-nowrap">
                          Kabuuang Benta
                        </th>
                        <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-center whitespace-nowrap hidden md:table-cell">
                          Resibo
                        </th>
                        <th className="px-2.5 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-right whitespace-nowrap">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-700/30">
                      {filteredProductBreakdown.map((item, idx) => (
                        <tr key={`${item.product_id}_${item.product_name}`} className="hover:bg-surface-700/20 transition-colors">
                          <td className="px-2.5 sm:px-3 py-2 text-center text-xs font-mono text-surface-400">
                            {idx + 1}
                          </td>
                          <td className="px-2.5 sm:px-3 py-2 text-xs font-semibold text-surface-100 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <span className="text-base">{getItemIcon(item.product_name)}</span>
                              <span>{item.product_name}</span>
                            </div>
                          </td>
                          <td className="px-2 sm:px-3 py-2 text-xs text-surface-300 text-right whitespace-nowrap hidden sm:table-cell">
                            {formatCurrency(item.unit_price)}
                          </td>
                          <td className="px-2.5 sm:px-3 py-2 text-center text-xs font-black text-primary-400 whitespace-nowrap bg-primary-950/20">
                            <span className="text-sm">{item.total_qty}</span>{' '}
                            <span className="text-[10px] font-normal text-surface-400">pcs</span>
                          </td>
                          <td className="px-2.5 sm:px-3 py-2 text-right text-xs font-bold text-emerald-400 whitespace-nowrap">
                            {formatCurrency(item.total_revenue)}
                          </td>
                          <td className="px-2 sm:px-3 py-2 text-center text-xs text-surface-300 whitespace-nowrap hidden md:table-cell">
                            {item.receipt_count}
                          </td>
                          <td className="px-2.5 sm:px-3 py-2 text-right text-xs whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1">
                              {item.synced_qty > 0 && (
                                <span className="px-1.5 py-0.2 rounded bg-success-500/20 text-success-400 text-[10px] font-semibold border border-success-500/30">
                                  ✓ {item.synced_qty} Synced
                                </span>
                              )}
                              {item.pending_qty > 0 && (
                                <span className="px-1.5 py-0.2 rounded bg-warning-500/20 text-warning-400 text-[10px] font-semibold border border-warning-500/30">
                                  ⏳ {item.pending_qty}
                                </span>
                              )}
                              {item.failed_qty > 0 && (
                                <span className="px-1.5 py-0.2 rounded bg-danger-500/20 text-danger-400 text-[10px] font-semibold border border-danger-500/30">
                                  ⚠️ {item.failed_qty}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        ) : activeTab === 'sales' ? (
          /* ═══════════════════════════════════════════════════════════════════════
             TAB 2: SALES LOGS (Mga Resibo na may Click-to-View Modal)
             ═══════════════════════════════════════════════════════════════════════ */
          <div className="flex-1 min-h-0 flex flex-col">
            {/* Header with Status Filters and View Switcher */}
            <div className="px-2.5 sm:px-3 py-1.5 sm:py-2 bg-surface-900/70 border-b border-surface-700/50 flex items-center justify-between gap-1.5 sm:gap-2 flex-nowrap shrink-0 overflow-x-auto no-scrollbar">
              {/* Status Filter Buttons */}
              <div className="flex items-center gap-1 shrink-0 flex-nowrap">
                {(['ALL', 'PENDING', 'FAILED', 'SYNCED'] as const).map(status => (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(status)}
                    className={`px-2 py-0.5 rounded text-[10px] sm:text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      statusFilter === status
                        ? status === 'PENDING'
                          ? 'bg-warning-500/20 text-warning-400 border border-warning-500/40'
                          : status === 'FAILED'
                          ? 'bg-danger-500/20 text-danger-400 border border-danger-500/40'
                          : status === 'SYNCED'
                          ? 'bg-success-500/20 text-success-400 border border-success-500/40'
                          : 'bg-primary-600 text-white'
                        : 'bg-surface-800 text-surface-400 hover:text-surface-200 border border-surface-700/60'
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>

              {/* View Switcher: [ 📱 Cards | 📋 Table ] */}
              <div className="flex items-center gap-1 bg-surface-800/80 p-0.5 rounded-lg border border-surface-700/60 shrink-0">
                <button
                  onClick={() => setViewMode('cards')}
                  className={`px-2 py-0.5 text-xs font-medium rounded transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap ${
                    viewMode === 'cards'
                      ? 'bg-primary-600 text-white shadow-xs'
                      : 'text-surface-400 hover:text-surface-200'
                  }`}
                  title="Cards View"
                >
                  <span>📱</span> <span className="hidden xs:inline">Cards</span>
                </button>
                <button
                  onClick={() => setViewMode('table')}
                  className={`px-2 py-0.5 text-xs font-medium rounded transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap ${
                    viewMode === 'table'
                      ? 'bg-primary-600 text-white shadow-xs'
                      : 'text-surface-400 hover:text-surface-200'
                  }`}
                  title="Table View"
                >
                  <span>📋</span> <span className="hidden xs:inline">Table</span>
                </button>
              </div>
            </div>

            {loading ? (
              <div className="flex-1 min-h-0 flex items-center justify-center py-16">
                <div className="w-8 h-8 border-3 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
              </div>
            ) : filteredSales.length === 0 ? (
              <div className="flex-1 min-h-0 flex flex-col items-center justify-center py-12 text-center">
                <span className="text-3xl mb-2 block">📋</span>
                <p className="text-surface-300 font-medium text-xs sm:text-sm">Walang resibo sa piniling filter o petsa</p>
              </div>
            ) : (
              <>
                {/* Scrollable Container for Table or Cards */}
                <div className="flex-1 min-h-0 overflow-y-auto">
                  {viewMode === 'cards' ? (
                    /* Cards View */
                    <div className="p-2 sm:p-2.5 space-y-1.5">
                      {paginatedSales.map(sale => (
                        <div
                          key={sale.uuid}
                          onClick={() => setSelectedReceipt(sale)}
                          className="p-2.5 rounded-xl bg-surface-900/40 hover:bg-surface-700/20 border border-surface-800/60 transition-colors cursor-pointer"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <div className={`w-2 h-2 rounded-full shrink-0 ${
                                sale.sync_status === 'SYNCED' ? 'bg-success-500' :
                                sale.sync_status === 'FAILED' ? 'bg-danger-500' :
                                'bg-warning-500 animate-pulse'
                              }`} />
                              <span className="text-surface-200 text-xs font-mono font-bold truncate">
                                {sale.receipt_number}
                              </span>
                              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-medium ${
                                sale.sync_status === 'SYNCED' ? 'bg-success-500/20 text-success-400' :
                                sale.sync_status === 'FAILED' ? 'bg-danger-500/20 text-danger-400' :
                                'bg-warning-500/20 text-warning-400'
                              }`}>
                                {sale.sync_status}
                              </span>
                            </div>

                            <span className="text-surface-100 font-bold text-xs sm:text-sm whitespace-nowrap">
                              {formatCurrency(sale.total_amount)}
                            </span>
                          </div>

                          <div className="flex items-center justify-between mt-1 text-[11px] text-surface-400">
                            <span>{formatDateTime(sale.sold_at)}</span>
                            <div className="flex items-center gap-2">
                              <span>{sale.items.length} items</span>
                              {sale.sync_status !== 'SYNCED' && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteSale(sale.uuid, sale.receipt_number);
                                  }}
                                  className="px-2 py-0.5 rounded bg-danger-500/20 text-danger-400 hover:bg-danger-500/30 text-[10px] font-semibold border border-danger-500/30 cursor-pointer"
                                  title="Burahin ang transaksyon"
                                >
                                  🗑️ Burahin
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Quick Preview of First 2 Items */}
                          {sale.items && sale.items.length > 0 && (
                            <div className="mt-1.5 pt-1.5 border-t border-surface-800 text-[10px] text-surface-400 flex items-center justify-between truncate">
                              <span className="truncate">
                                {sale.items.slice(0, 2).map(i => `${i.quantity}x ${i.product_name}`).join(', ')}
                                {sale.items.length > 2 && ` +${sale.items.length - 2} pa`}
                              </span>
                              <span className="text-primary-400 ml-1 shrink-0">Tingnan Resibo →</span>
                            </div>
                          )}

                          {sale.sync_error && (
                            <p className="text-danger-400 text-[10px] mt-1 pt-1 border-t border-surface-800 truncate">
                              Error: {sale.sync_error}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    /* Table View */
                    <table className="w-full text-left border-collapse">
                      <thead className="sticky top-0 bg-surface-900 border-b border-surface-700/60 z-10 shadow-xs">
                        <tr>
                          <th className="px-2.5 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase whitespace-nowrap">
                            Receipt
                          </th>
                          <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase whitespace-nowrap">
                            Status
                          </th>
                          <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase whitespace-nowrap hidden sm:table-cell">
                            Date & Oras
                          </th>
                          <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-center whitespace-nowrap hidden md:table-cell">
                            Items
                          </th>
                          <th className="px-2.5 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-right whitespace-nowrap">
                            Total
                          </th>
                          <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-center whitespace-nowrap">
                            Aksyon
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-700/30">
                        {paginatedSales.map(sale => (
                          <tr
                            key={sale.uuid}
                            onClick={() => setSelectedReceipt(sale)}
                            className="hover:bg-surface-700/20 transition-colors cursor-pointer"
                          >
                            <td className="px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs font-mono font-semibold text-surface-200 whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                  sale.sync_status === 'SYNCED' ? 'bg-success-500' :
                                  sale.sync_status === 'FAILED' ? 'bg-danger-500' :
                                  'bg-warning-500 animate-pulse'
                                }`} />
                                <span className="hover:text-primary-400 underline decoration-dotted">{sale.receipt_number}</span>
                              </div>
                            </td>
                            <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-xs whitespace-nowrap">
                              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-medium ${
                                sale.sync_status === 'SYNCED' ? 'bg-success-500/20 text-success-400' :
                                sale.sync_status === 'FAILED' ? 'bg-danger-500/20 text-danger-400' :
                                'bg-warning-500/20 text-warning-400'
                              }`}>
                                {sale.sync_status}
                              </span>
                            </td>
                            <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-xs text-surface-300 whitespace-nowrap hidden sm:table-cell">
                              {formatDateTime(sale.sold_at)}
                            </td>
                            <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-center text-xs text-surface-300 whitespace-nowrap hidden md:table-cell">
                              {sale.items.length}
                            </td>
                            <td className="px-2.5 sm:px-3 py-1.5 sm:py-2 text-right text-xs font-bold text-surface-100 whitespace-nowrap">
                              {formatCurrency(sale.total_amount)}
                            </td>
                            <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-center text-xs whitespace-nowrap">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedReceipt(sale);
                                  }}
                                  className="px-2 py-0.5 rounded bg-surface-700/60 text-surface-200 hover:bg-surface-700 text-[10px] font-semibold border border-surface-600 cursor-pointer"
                                  title="Tingnan ang resibo"
                                >
                                  👁️ Tingnan
                                </button>
                                {sale.sync_status !== 'SYNCED' && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteSale(sale.uuid, sale.receipt_number);
                                    }}
                                    className="px-2 py-0.5 rounded bg-danger-500/20 text-danger-400 hover:bg-danger-500/30 text-[10px] font-semibold border border-danger-500/30 cursor-pointer"
                                    title="Burahin ang transaksyon"
                                  >
                                    🗑️
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Pinned Card Footer: Pagination */}
                <div className="flex-shrink-0 px-2.5 sm:px-3 py-1.5 sm:py-2 bg-surface-900/90 border-t border-surface-700/60 flex items-center justify-between flex-nowrap text-xs gap-2 shrink-0">
                  <span className="text-[10px] sm:text-xs text-surface-400 font-medium whitespace-nowrap shrink-0">
                    {filteredSales.length === 0
                      ? '0 of 0'
                      : `${(page - 1) * pageSize + 1}-${Math.min(
                          page * pageSize,
                          filteredSales.length
                        )} of ${filteredSales.length}`}
                  </span>

                  <div className="flex items-center gap-1 sm:gap-1.5 whitespace-nowrap shrink-0">
                    <select
                      value={pageSize}
                      onChange={e => setPageSize(Number(e.target.value))}
                      className="bg-surface-800 border border-surface-700/60 rounded px-1 py-0.5 text-[10px] sm:text-[11px] text-surface-300 cursor-pointer"
                    >
                      <option value={10}>10/page</option>
                      <option value={15}>15/page</option>
                      <option value={25}>25/page</option>
                      <option value={50}>50/page</option>
                    </select>
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="px-1.5 sm:px-2 py-0.5 rounded bg-surface-800 hover:bg-surface-700 disabled:opacity-40 disabled:cursor-not-allowed text-[10px] sm:text-[11px] border border-surface-700/60 text-surface-200 cursor-pointer whitespace-nowrap"
                    >
                      ← Prev
                    </button>
                    <span className="text-[10px] sm:text-[11px] text-surface-400 font-medium px-0.5">
                      {page}/{totalPages}
                    </span>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                      className="px-1.5 sm:px-2 py-0.5 rounded bg-surface-800 hover:bg-surface-700 disabled:opacity-40 disabled:cursor-not-allowed text-[10px] sm:text-[11px] border border-surface-700/60 text-surface-200 cursor-pointer whitespace-nowrap"
                    >
                      Next →
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          /* ═══════════════════════════════════════════════════════════════════════
             TAB 3: OFFLINE MUTATIONS
             ═══════════════════════════════════════════════════════════════════════ */
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="px-3 py-2 bg-surface-900/70 border-b border-surface-700/50 flex items-center justify-between">
              <h3 className="text-xs sm:text-sm font-semibold text-warning-400">
                Pending Offline Changes ({mutations.length})
              </h3>
              <span className="text-[10px] text-surface-400">Expenses • Products • Categories</span>
            </div>

            {mutations.length === 0 ? (
              <div className="text-center py-12">
                <span className="text-3xl mb-2 block">✨</span>
                <p className="text-surface-300 font-medium text-xs sm:text-sm">Walang pending offline mutations</p>
                <p className="text-surface-500 text-[11px] mt-0.5">Lahat ng data changes ay updated sa database</p>
              </div>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-surface-700/30">
                {mutations.map(m => (
                  <div key={m.id} className="px-3 py-2.5 flex items-center justify-between text-xs hover:bg-surface-700/20 transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="capitalize px-1.5 py-0.2 rounded bg-surface-700 text-surface-200 font-semibold text-[10px]">
                        {m.entity}
                      </span>
                      <span className="text-primary-400 uppercase font-mono text-[10px] font-bold">
                        {m.action}
                      </span>
                      <span className="text-surface-300 truncate max-w-[200px] sm:max-w-md">
                        {m.payload?.name || m.payload?.description || `ID: ${m.entityId}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`font-medium text-[10px] whitespace-nowrap ${
                        m.status === 'FAILED' ? 'text-danger-400' : 'text-warning-400'
                      }`}>
                        {m.status === 'FAILED' ? '❌ Failed' : '⏳ Pending'}
                      </span>
                      <button
                        onClick={() => handleDeleteMutation(m.id)}
                        className="px-2 py-0.5 rounded bg-danger-500/20 text-danger-400 hover:bg-danger-500/30 text-[10px] font-semibold border border-danger-500/30 cursor-pointer"
                        title="Burahin ang mutation"
                      >
                        🗑️ Burahin
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── PORTALED RECEIPT DETAIL MODAL ──────────────────────────────────── */}
      {selectedReceipt && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/75 backdrop-blur-xs animate-fade-in"
          onClick={() => setSelectedReceipt(null)}
        >
          <div
            className="w-full max-w-md bg-surface-900 border border-surface-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-scale-up"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-3.5 bg-surface-800/80 border-b border-surface-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">🧾</span>
                <div>
                  <h3 className="font-bold text-surface-100 text-sm font-mono">{selectedReceipt.receipt_number}</h3>
                  <p className="text-[10px] text-surface-400">{formatDateTime(selectedReceipt.sold_at)}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                  selectedReceipt.sync_status === 'SYNCED' ? 'bg-success-500/20 text-success-400 border border-success-500/30' :
                  selectedReceipt.sync_status === 'FAILED' ? 'bg-danger-500/20 text-danger-400 border border-danger-500/30' :
                  'bg-warning-500/20 text-warning-400 border border-warning-500/30'
                }`}>
                  {selectedReceipt.sync_status}
                </span>
                <button
                  onClick={() => setSelectedReceipt(null)}
                  className="p-1 rounded-lg text-surface-400 hover:text-surface-100 hover:bg-surface-700 text-sm cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal Content / Line Items */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 divide-y divide-surface-800 text-xs">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] font-bold text-surface-400 uppercase tracking-wider pb-1">
                  <span>Paninda / Produkto</span>
                  <span>Halaga</span>
                </div>
                {selectedReceipt.items?.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between py-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span>{getItemIcon(item.product_name)}</span>
                      <div className="min-w-0">
                        <p className="text-surface-100 font-semibold truncate">{item.product_name}</p>
                        <p className="text-[10px] text-surface-400">
                          {item.quantity} x {formatCurrency(item.unit_price)}
                        </p>
                      </div>
                    </div>
                    <span className="font-bold text-surface-200">
                      {formatCurrency(item.line_total || (item.quantity * item.unit_price))}
                    </span>
                  </div>
                ))}
              </div>

              {/* Totals & Payment Info */}
              <div className="pt-3 space-y-1.5">
                <div className="flex justify-between text-surface-400">
                  <span>Subtotal:</span>
                  <span>{formatCurrency(selectedReceipt.subtotal)}</span>
                </div>
                {selectedReceipt.discount_amount > 0 && (
                  <div className="flex justify-between text-danger-400">
                    <span>Discount:</span>
                    <span>-{formatCurrency(selectedReceipt.discount_amount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-black text-emerald-400 pt-1 border-t border-surface-800">
                  <span>Kabuuang Halaga:</span>
                  <span>{formatCurrency(selectedReceipt.total_amount)}</span>
                </div>
              </div>

              {/* Payment Details */}
              <div className="pt-3 space-y-1 text-[11px] text-surface-400">
                <div className="flex justify-between">
                  <span>Paraan ng Bayad:</span>
                  <span className="font-semibold text-surface-200">{selectedReceipt.payment_method_name || 'Cash'}</span>
                </div>
                {selectedReceipt.cash_tendered !== null && selectedReceipt.cash_tendered !== undefined && (
                  <div className="flex justify-between">
                    <span>Binayad (Cash):</span>
                    <span className="font-mono">{formatCurrency(selectedReceipt.cash_tendered)}</span>
                  </div>
                )}
                {selectedReceipt.change_amount !== null && selectedReceipt.change_amount !== undefined && (
                  <div className="flex justify-between">
                    <span>Sukli:</span>
                    <span className="font-mono text-emerald-400">{formatCurrency(selectedReceipt.change_amount)}</span>
                  </div>
                )}
                {selectedReceipt.payment_reference && (
                  <div className="flex justify-between">
                    <span>Reference / GCash Ref:</span>
                    <span className="font-mono font-bold text-primary-400">{selectedReceipt.payment_reference}</span>
                  </div>
                )}
                <div className="flex justify-between text-[10px] text-surface-500 pt-1">
                  <span>Device Pinagmulan:</span>
                  <span className="font-mono">{selectedReceipt.source_device || 'unknown'}</span>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-3 bg-surface-950/80 border-t border-surface-800 flex items-center justify-between">
              {selectedReceipt.sync_status !== 'SYNCED' ? (
                <button
                  onClick={() => handleDeleteSale(selectedReceipt.uuid, selectedReceipt.receipt_number)}
                  className="px-3 py-1.5 rounded-lg bg-danger-500/20 text-danger-400 hover:bg-danger-500/30 text-xs font-semibold border border-danger-500/30 cursor-pointer"
                >
                  🗑️ Burahin ang Resibo
                </button>
              ) : (
                <span className="text-[10px] text-success-400">✓ Naka-save na sa Laptop Server</span>
              )}
              <button
                onClick={() => setSelectedReceipt(null)}
                className="px-4 py-1.5 rounded-lg bg-surface-800 hover:bg-surface-700 text-surface-200 text-xs font-semibold cursor-pointer ml-auto"
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

function getItemIcon(name?: string): string {
  const n = (name || '').toLowerCase();
  if (n.includes('isaw')) return '🍢';
  if (n.includes('bbq') || n.includes('barbecue') || n.includes('pork')) return '🍢';
  if (n.includes('dugo') || n.includes('betamax')) return '🍢';
  if (n.includes('tenga') || n.includes('ear')) return '🍢';
  if (n.includes('hotdog')) return '🌭';
  if (n.includes('bulaklak') || n.includes('chicharon')) return '🍢';
  if (n.includes('leeg') || n.includes('neck') || n.includes('manok') || n.includes('chicken')) return '🍗';
  if (n.includes('fish') || n.includes('isda') || n.includes('bangus') || n.includes('tilapia') || n.includes('galunggong')) return '🐟';
  if (n.includes('coke') || n.includes('softdrink') || n.includes('juice') || n.includes('drink')) return '🥤';
  if (n.includes('suka') || n.includes('sauce') || n.includes('seasoning')) return '🍶';
  return '📦';
}
