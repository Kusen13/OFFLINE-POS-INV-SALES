/**
 * Sync Page - Manual sync control for offline sales
 */

import { useState, useEffect, useMemo } from 'react';
import { useSyncStore } from '../../features/sync/syncStore';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { getAllSales, resetFailedSales, cleanupOldSyncedSales } from '../../db/salesRepository';
import { getPendingMutations, type PendingMutation } from '../../db/mutationRepository';
import { formatCurrency } from '../../utils/currency';
import { formatDateTime, getRelativeTime } from '../../utils/date';
import type { PendingSale } from '../../types/sale';

export function SyncPage() {
  const isOnline = useOnlineStatus();
  const { pendingCount, failedCount, syncedCount, isSyncing: syncing, lastSyncTime, lastError: lastSyncError, performSync, refreshCounts } = useSyncStore();
  const [sales, setSales] = useState<PendingSale[]>([]);
  const [mutations, setMutations] = useState<PendingMutation[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState('');

  // Layout, Filter & Pagination States
  const [activeTab, setActiveTab] = useState<'sales' | 'mutations'>('sales');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('table');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'FAILED' | 'SYNCED'>('ALL');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

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

  async function handleCleanup() {
    const count = await cleanupOldSyncedSales(30);
    setActionMsg(`${count} old synced sale(s) cleaned up`);
    await refreshCounts();
    await loadData();
    setTimeout(() => setActionMsg(''), 3000);
  }

  const totalPendingAmount = useMemo(() => {
    return sales.filter(s => s.sync_status === 'PENDING').reduce((sum, s) => sum + (Number(s.total_amount) || 0), 0);
  }, [sales]);

  // Filtered & Paginated Sales
  const filteredSales = useMemo(() => {
    if (statusFilter === 'ALL') return sales;
    return sales.filter(s => s.sync_status === statusFilter);
  }, [sales, statusFilter]);

  const totalPages = Math.ceil(filteredSales.length / pageSize) || 1;
  const paginatedSales = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredSales.slice(start, start + pageSize);
  }, [filteredSales, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, pageSize]);

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-2.5 sm:space-y-3.5 animate-fade-in pb-16 lg:pb-0">
      {/* Header */}
      <div className="flex-shrink-0 hidden lg:block">
        <h1 className="text-xl sm:text-2xl font-bold text-surface-50 tracking-tight">Sync Center</h1>
        <p className="text-surface-400 mt-0.5 text-xs sm:text-sm">
          Pamamahala sa offline data, synchronization, at koneksyon sa laptop server
        </p>
      </div>

      {/* Connection Status Banner (Compact) */}
      <div className={`rounded-xl px-3 py-2 border flex items-center justify-between gap-2 shrink-0 ${
        isOnline ? 'bg-success-500/10 border-success-500/30' : 'bg-danger-500/10 border-danger-500/30'
      }`}>
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${isOnline ? 'bg-success-500 animate-pulse' : 'bg-danger-500'}`} />
          <p className={`font-semibold text-xs sm:text-sm truncate ${isOnline ? 'text-success-400' : 'text-danger-400'}`}>
            {isOnline ? 'Konektado sa Server' : 'Offline — Nakatabi sa device (local storage)'}
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
              <span>Nag-si-sync...</span>
            </>
          ) : (
            <>
              <span>🔄</span>
              <span>Sync All ({pendingCount} Pending)</span>
            </>
          )}
        </button>

        {failedCount > 0 && (
          <button
            onClick={handleRetryFailed}
            className="px-3 py-2 sm:py-2.5 rounded-xl bg-warning-600/20 text-warning-400 text-xs sm:text-sm font-semibold border border-warning-500/30 hover:bg-warning-600/30 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            🔄 Retry Failed ({failedCount})
          </button>
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
        <div className="bg-primary-500/10 border border-primary-500/30 rounded-xl p-2.5 text-primary-300 text-xs text-center font-medium shrink-0">
          {actionMsg}
        </div>
      )}

      {/* Tabs Switcher: Sales Log vs Offline Mutations */}
      <div className="flex rounded-lg bg-surface-900/80 p-0.5 border border-surface-700/60 shrink-0 self-start">
        <button
          onClick={() => setActiveTab('sales')}
          className={`px-3 py-1 rounded text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
            activeTab === 'sales' ? 'bg-primary-600 text-white shadow-xs' : 'text-surface-400 hover:text-surface-200'
          }`}
        >
          🧾 Sales Logs ({sales.length})
        </button>
        <button
          onClick={() => setActiveTab('mutations')}
          className={`px-3 py-1 rounded text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
            activeTab === 'mutations' ? 'bg-primary-600 text-white shadow-xs' : 'text-surface-400 hover:text-surface-200'
          }`}
        >
          ⚙️ Offline Mutations ({mutations.length})
        </button>
      </div>

      {/* Main Container */}
      <div className="flex-1 min-h-0 bg-surface-800/50 rounded-xl border border-surface-700/50 flex flex-col overflow-hidden shadow-sm">
        {activeTab === 'mutations' ? (
          /* Offline Mutations View */
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
                    <span className="text-warning-400 font-medium text-[10px] whitespace-nowrap shrink-0">
                      ⏳ Pending
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Sales Log View */
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
                <div className="flex flex-col items-center gap-2">
                  <div className="w-8 h-8 border-3 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
                  <p className="text-xs text-surface-400">Kinukuha ang talaan ng sync...</p>
                </div>
              </div>
            ) : filteredSales.length === 0 ? (
              <div className="flex-1 min-h-0 flex flex-col items-center justify-center py-12 text-center">
                <span className="text-3xl mb-2 block">📋</span>
                <p className="text-surface-300 font-medium text-xs sm:text-sm">Walang transaksyon sa piniling filter</p>
              </div>
            ) : (
              <>
                {/* Scrollable Container for Table or Cards */}
                <div className="flex-1 min-h-0 overflow-y-auto">
                  {viewMode === 'cards' ? (
                    /* Cards View - 100% Mobile Friendly */
                    <div className="p-2 sm:p-2.5 space-y-1.5">
                      {paginatedSales.map(sale => (
                        <div
                          key={sale.uuid}
                          className="p-2.5 rounded-xl bg-surface-900/40 hover:bg-surface-700/20 border border-surface-800/60 transition-colors"
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
                            <span>{sale.items.length} items</span>
                          </div>

                          {sale.sync_error && (
                            <p className="text-danger-400 text-[10px] mt-1 pt-1 border-t border-surface-800 truncate">
                              Error: {sale.sync_error}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    /* Responsive Table View - Zero Horizontal Overflow */
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
                            Date
                          </th>
                          <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-center whitespace-nowrap hidden md:table-cell">
                            Items
                          </th>
                          <th className="px-2.5 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-right whitespace-nowrap">
                            Total
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-700/30">
                        {paginatedSales.map(sale => (
                          <tr key={sale.uuid} className="hover:bg-surface-700/20 transition-colors">
                            <td className="px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs font-mono font-semibold text-surface-200 whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                  sale.sync_status === 'SYNCED' ? 'bg-success-500' :
                                  sale.sync_status === 'FAILED' ? 'bg-danger-500' :
                                  'bg-warning-500 animate-pulse'
                                }`} />
                                <span>{sale.receipt_number}</span>
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
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Pinned Card Footer: Strictly Single-Line Non-Wrapping Pagination */}
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
        )}
      </div>
    </div>
  );
}
