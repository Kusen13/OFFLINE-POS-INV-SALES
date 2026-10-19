/**
 * Sync Page - Sync history, status, and controls
 */

import { useSyncStore } from '../../features/sync/syncStore';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

export function SyncPage() {
  const isOnline = useOnlineStatus();
  const {
    pendingCount, syncedCount, failedCount,
    isSyncing, serverReachable, syncProgress, lastError,
    performSync, retryFailed, checkServer, lastSyncTime,
  } = useSyncStore();

  return (
    <div className="space-y-6 animate-fade-in pb-20 lg:pb-0">
      <div>
        <h1 className="text-2xl font-bold text-surface-50">Synchronization</h1>
        <p className="text-surface-400 mt-1">Manage data sync between devices and server</p>
      </div>

      {/* Status overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-warning-500/10 rounded-xl p-5 border border-warning-500/20">
          <p className="text-3xl font-bold text-warning-500">{pendingCount}</p>
          <p className="text-sm text-surface-300 mt-1">Pending Sales</p>
        </div>
        <div className="bg-success-500/10 rounded-xl p-5 border border-success-500/20">
          <p className="text-3xl font-bold text-success-500">{syncedCount}</p>
          <p className="text-sm text-surface-300 mt-1">Synced Sales</p>
        </div>
        <div className="bg-danger-500/10 rounded-xl p-5 border border-danger-500/20">
          <p className="text-3xl font-bold text-danger-500">{failedCount}</p>
          <p className="text-sm text-surface-300 mt-1">Failed Sales</p>
        </div>
      </div>

      {/* Connection status */}
      <div className="bg-surface-800/50 rounded-xl p-5 border border-surface-700/50 space-y-4">
        <h3 className="text-lg font-semibold text-surface-100">Connection Status</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex items-center gap-3">
            <span className={`w-3 h-3 rounded-full ${isOnline ? 'bg-success-500' : 'bg-danger-500'}`} />
            <span className="text-surface-200">Network: {isOnline ? 'Connected' : 'Disconnected'}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className={`w-3 h-3 rounded-full ${serverReachable ? 'bg-success-500' : 'bg-surface-500'}`} />
            <span className="text-surface-200">Server: {serverReachable ? 'Reachable' : 'Unknown'}</span>
          </div>
        </div>
        {lastSyncTime && (
          <p className="text-xs text-surface-400">Last sync: {new Date(lastSyncTime).toLocaleString()}</p>
        )}
      </div>

      {/* Error display */}
      {lastError && (
        <div className="bg-danger-500/10 border border-danger-500/30 rounded-xl p-4">
          <p className="text-danger-500 text-sm font-medium">⚠️ {lastError}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={performSync}
          disabled={isSyncing}
          className="px-6 py-3 rounded-xl bg-primary-600 text-white font-medium hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {isSyncing ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              {syncProgress || 'Syncing...'}
            </>
          ) : (
            <>🔄 Sync Now</>
          )}
        </button>

        <button
          onClick={checkServer}
          className="px-6 py-3 rounded-xl bg-surface-700 text-surface-200 font-medium hover:bg-surface-600 transition-colors"
        >
          🔍 Check Server
        </button>

        {failedCount > 0 && (
          <button
            onClick={retryFailed}
            disabled={isSyncing}
            className="px-6 py-3 rounded-xl bg-warning-600 text-white font-medium hover:bg-warning-500 disabled:opacity-50 transition-colors"
          >
            🔁 Retry Failed ({failedCount})
          </button>
        )}
      </div>

      {/* Sync log placeholder */}
      <div className="bg-surface-800/50 rounded-xl p-6 border border-surface-700/50">
        <h3 className="text-lg font-semibold text-surface-100 mb-4">Sync History</h3>
        <p className="text-surface-400 text-sm">Detailed sync logs will be shown here in Milestone 5.</p>
      </div>
    </div>
  );
}
