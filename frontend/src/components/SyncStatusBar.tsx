/**
 * SyncStatusBar - Shows sync status, pending counts, and quick sync button
 */

import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useSyncStore } from '../features/sync/syncStore';

interface SyncStatusBarProps {
  compact?: boolean;
}

export function SyncStatusBar({ compact = false }: SyncStatusBarProps) {
  const isOnline = useOnlineStatus();
  const { 
    pendingCount, failedCount, 
    isSyncing, syncProgress,
    performSync,
  } = useSyncStore();

  const getStatusColor = () => {
    if (!isOnline) return 'bg-danger-500/20 text-danger-500 border-danger-500/30';
    if (failedCount > 0) return 'bg-warning-500/20 text-warning-500 border-warning-500/30';
    if (pendingCount > 0) return 'bg-warning-500/20 text-warning-500 border-warning-500/30';
    return 'bg-success-500/20 text-success-500 border-success-500/30';
  };

  const getStatusText = () => {
    if (!isOnline) return 'Offline';
    if (isSyncing) return syncProgress || 'Syncing...';
    if (failedCount > 0) return `${failedCount} Failed`;
    if (pendingCount > 0) return `${pendingCount} Pending`;
    return 'Synced';
  };

  const getStatusDot = () => {
    if (!isOnline) return 'bg-danger-500';
    if (failedCount > 0 || pendingCount > 0) return 'bg-warning-500 animate-pulse';
    return 'bg-success-500';
  };

  if (compact) {
    return (
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium ${getStatusColor()}`}>
        <span className={`w-2 h-2 rounded-full ${getStatusDot()}`} />
        <span className="truncate">{getStatusText()}</span>
        {pendingCount > 0 && !isSyncing && (
          <button
            onClick={performSync}
            className="ml-auto px-2 py-0.5 rounded bg-primary-600 text-white text-xs hover:bg-primary-500 transition-colors"
            disabled={isSyncing}
          >
            Sync
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${getStatusColor()}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${getStatusDot()}`} />
        <span>{getStatusText()}</span>
      </div>
      {pendingCount > 0 && !isSyncing && (
        <button
          onClick={performSync}
          className="px-3 py-1 rounded-full bg-primary-600 text-white text-xs font-medium hover:bg-primary-500 transition-colors animate-pulse-glow"
          disabled={isSyncing}
        >
          Sync Now
        </button>
      )}
    </div>
  );
}
