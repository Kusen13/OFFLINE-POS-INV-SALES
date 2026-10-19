/**
 * Sync Page - Manual sync control for offline sales
 */

import { useState, useEffect } from 'react';
import { useSyncStore } from '../../features/sync/syncStore';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { getAllSales, resetFailedSales, cleanupOldSyncedSales } from '../../db/salesRepository';
import { formatCurrency } from '../../utils/currency';
import { formatDateTime, getRelativeTime } from '../../utils/date';
import type { PendingSale } from '../../types/sale';

export function SyncPage() {
  const isOnline = useOnlineStatus();
  const { pendingCount, failedCount, syncedCount, isSyncing: syncing, lastSyncTime, lastError: lastSyncError, performSync, refreshCounts } = useSyncStore();
  const [sales, setSales] = useState<PendingSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState('');

  useEffect(() => {
    loadSales();
  }, [pendingCount, failedCount, syncedCount]);

  async function loadSales() {
    setLoading(true);
    try {
      const all = await getAllSales();
      setSales(all);
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    await performSync();
    await loadSales();
  }

  async function handleRetryFailed() {
    const count = await resetFailedSales();
    setActionMsg(`${count} failed sale(s) reset to pending`);
    await refreshCounts();
    await loadSales();
    setTimeout(() => setActionMsg(''), 3000);
  }

  async function handleCleanup() {
    const count = await cleanupOldSyncedSales(30);
    setActionMsg(`${count} old synced sale(s) cleaned up`);
    await refreshCounts();
    await loadSales();
    setTimeout(() => setActionMsg(''), 3000);
  }

  const totalPendingAmount = sales.filter(s => s.sync_status === 'PENDING').reduce((sum, s) => sum + s.total_amount, 0);

  return (
    <div className="space-y-5 animate-fade-in pb-20 lg:pb-0">

      {/* Connection status */}
      <div className={`rounded-xl p-4 border flex items-center gap-3 ${
        isOnline ? 'bg-success-500/10 border-success-500/30' : 'bg-danger-500/10 border-danger-500/30'
      }`}>
        <div className={`w-3 h-3 rounded-full ${isOnline ? 'bg-success-500 animate-pulse' : 'bg-danger-500'}`} />
        <div>
          <p className={`font-medium text-sm ${isOnline ? 'text-success-500' : 'text-danger-500'}`}>
            {isOnline ? 'Connected to Server' : 'Offline — Sales are saved locally'}
          </p>
          {lastSyncTime && (
            <p className="text-surface-400 text-xs mt-0.5">Last sync: {getRelativeTime(lastSyncTime)}</p>
          )}
        </div>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-warning-500/10 rounded-xl p-4 border border-warning-500/20 text-center">
          <p className="text-3xl font-bold text-warning-500">{pendingCount}</p>
          <p className="text-surface-400 text-xs mt-1">Pending</p>
          {totalPendingAmount > 0 && (
            <p className="text-warning-500 text-xs font-medium mt-0.5">{formatCurrency(totalPendingAmount)}</p>
          )}
        </div>
        <div className="bg-danger-500/10 rounded-xl p-4 border border-danger-500/20 text-center">
          <p className="text-3xl font-bold text-danger-500">{failedCount}</p>
          <p className="text-surface-400 text-xs mt-1">Failed</p>
        </div>
        <div className="bg-success-500/10 rounded-xl p-4 border border-success-500/20 text-center">
          <p className="text-3xl font-bold text-success-500">{syncedCount}</p>
          <p className="text-surface-400 text-xs mt-1">Synced</p>
        </div>
      </div>

      {/* Sync button */}
      <button
        onClick={handleSync}
        disabled={syncing || pendingCount === 0}
        className="w-full py-4 rounded-xl bg-primary-600 text-white text-lg font-bold hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98] shadow-lg shadow-primary-600/20 flex items-center justify-center gap-2"
      >
        {syncing ? (
          <>
            <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Syncing...
          </>
        ) : (
          <>🔄 Sync {pendingCount} Pending Sale{pendingCount !== 1 ? 's' : ''}</>
        )}
      </button>

      {/* Error message */}
      {lastSyncError && (
        <div className="bg-danger-500/10 border border-danger-500/30 rounded-xl p-4">
          <p className="text-danger-500 text-sm">⚠️ {lastSyncError}</p>
        </div>
      )}

      {/* Action message */}
      {actionMsg && (
        <div className="bg-primary-500/10 border border-primary-500/30 rounded-xl p-3 text-primary-400 text-sm text-center">
          {actionMsg}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-3">
        {failedCount > 0 && (
          <button onClick={handleRetryFailed} className="flex-1 px-4 py-2.5 rounded-xl bg-warning-600/20 text-warning-500 text-sm font-medium border border-warning-500/30 hover:bg-warning-600/30 transition-colors">
            🔄 Retry {failedCount} Failed
          </button>
        )}
        {syncedCount > 0 && (
          <button onClick={handleCleanup} className="flex-1 px-4 py-2.5 rounded-xl bg-surface-700 text-surface-300 text-sm font-medium hover:bg-surface-600 transition-colors">
            🗑️ Cleanup Old Synced
          </button>
        )}
      </div>

      {/* Transaction log */}
      <div className="bg-surface-800/50 rounded-xl border border-surface-700/50 overflow-hidden">
        <div className="px-4 py-3 border-b border-surface-700/50">
          <h3 className="text-sm font-semibold text-surface-300">Transaction Log ({sales.length})</h3>
        </div>
        {loading ? (
          <div className="flex justify-center py-8"><div className="w-8 h-8 border-3 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" /></div>
        ) : sales.length === 0 ? (
          <div className="text-center py-8">
            <span className="text-4xl mb-2 block">📋</span>
            <p className="text-surface-400 text-sm">No offline sales recorded yet</p>
          </div>
        ) : (
          <div className="divide-y divide-surface-700/30 max-h-[400px] overflow-y-auto">
            {sales.map(sale => (
              <div key={sale.uuid} className="px-4 py-3 flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  sale.sync_status === 'SYNCED' ? 'bg-success-500' :
                  sale.sync_status === 'FAILED' ? 'bg-danger-500' :
                  'bg-warning-500 animate-pulse'
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-surface-200 text-sm font-mono">{sale.receipt_number}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                      sale.sync_status === 'SYNCED' ? 'bg-success-500/20 text-success-500' :
                      sale.sync_status === 'FAILED' ? 'bg-danger-500/20 text-danger-500' :
                      'bg-warning-500/20 text-warning-500'
                    }`}>{sale.sync_status}</span>
                  </div>
                  <p className="text-surface-500 text-xs mt-0.5">
                    {formatDateTime(sale.sold_at)} • {sale.items.length} items
                    {sale.sync_error && <span className="text-danger-400"> — {sale.sync_error}</span>}
                  </p>
                </div>
                <span className="text-surface-100 font-bold text-sm">{formatCurrency(sale.total_amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
