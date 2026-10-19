/**
 * POS Page - Main ordering interface (placeholder for Milestone 3-4)
 */

import { Link } from 'react-router-dom';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useSyncStore } from '../../features/sync/syncStore';

export function POSPage() {
  const isOnline = useOnlineStatus();
  const { pendingCount, failedCount, isSyncing, performSync } = useSyncStore();

  return (
    <div className="min-h-dvh bg-surface-950 flex flex-col">
      {/* Top status bar */}
      <header className="flex items-center justify-between px-4 py-3 bg-surface-900 border-b border-surface-700/50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center text-white font-bold text-sm">
            P
          </div>
          <h1 className="text-lg font-bold text-surface-50">Point of Sale</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
            isOnline 
              ? 'bg-success-500/20 text-success-500 border-success-500/30' 
              : 'bg-danger-500/20 text-danger-500 border-danger-500/30'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-success-500' : 'bg-danger-500'}`} />
            {isOnline ? 'Online' : 'Offline'}
          </div>
          <Link 
            to="/dashboard" 
            className="p-2 rounded-lg text-surface-400 hover:bg-surface-800 hover:text-surface-200"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </Link>
        </div>
      </header>

      {/* Main content - placeholder */}
      <main className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-primary-500/20 to-primary-700/20 border border-primary-500/30 flex items-center justify-center mb-6 animate-pulse-glow">
          <span className="text-5xl">🛒</span>
        </div>
        <h2 className="text-2xl font-bold text-surface-100 mb-2">POS Coming Soon</h2>
        <p className="text-surface-400 max-w-md mb-8">
          The mobile ordering interface will be built in Milestone 3-4.
          Product browsing, cart, checkout, and receipt generation will be available here.
        </p>

        {/* Status cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 w-full max-w-sm">
          <div className="bg-surface-800/50 rounded-xl p-4 border border-surface-700/50">
            <p className="text-2xl font-bold text-warning-500">{pendingCount}</p>
            <p className="text-xs text-surface-400 mt-1">Pending</p>
          </div>
          <div className="bg-surface-800/50 rounded-xl p-4 border border-surface-700/50">
            <p className="text-2xl font-bold text-danger-500">{failedCount}</p>
            <p className="text-xs text-surface-400 mt-1">Failed</p>
          </div>
          <div className="col-span-2 sm:col-span-1 bg-surface-800/50 rounded-xl p-4 border border-surface-700/50">
            <button
              onClick={performSync}
              disabled={isSyncing || pendingCount === 0}
              className="w-full px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSyncing ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
