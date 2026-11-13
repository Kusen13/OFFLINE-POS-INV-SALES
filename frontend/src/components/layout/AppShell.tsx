/**
 * AppShell - Main layout wrapper for both desktop and mobile
 * Unified, professional navigation with descriptions, badges, and status bar
 */

import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useState, useEffect, useMemo } from 'react';
import { SyncStatusBar } from '../SyncStatusBar';
import { NAV_ITEMS, NAV_GROUPS } from './navItems';
import { useAuthStore } from '../../features/security/authStore';
import { useStoreProfile } from '../../hooks/useStoreProfile';

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const { storeName, storeSubtitle, storeLogo } = useStoreProfile();

  // Role-Based Security Store
  const { isOwner, lockToCashier, unlockToOwner } = useAuthStore();
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');

  const handleUnlockSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (unlockToOwner(pinInput)) {
      setIsPinModalOpen(false);
      setPinInput('');
      setPinError('');
    } else {
      setPinError('Incorrect PIN. Please try again.');
      setPinInput('');
    }
  };

  // Listen for custom toggle from POS mobile header or other pages
  useEffect(() => {
    const handleToggle = () => setSidebarOpen(prev => !prev);
    const handleClose = () => setSidebarOpen(false);
    window.addEventListener('toggle_pos_sidebar', handleToggle);
    window.addEventListener('close_pos_sidebar', handleClose);
    return () => {
      window.removeEventListener('toggle_pos_sidebar', handleToggle);
      window.removeEventListener('close_pos_sidebar', handleClose);
    };
  }, []);

  // Close sidebar on route change
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const currentItem = useMemo(() => {
    return NAV_ITEMS.find(item => item.path === location.pathname) || {
      path: location.pathname,
      label: 'POS & Inventory',
      icon: '⚡',
      desc: 'Point of Sale & Cafeteria System',
    };
  }, [location.pathname]);

  // Active route's group
  const activeGroup = useMemo(() => {
    const item = NAV_ITEMS.find(it => it.path === location.pathname);
    return item?.group || 'SALES';
  }, [location.pathname]);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    return {
      SALES: true,
      OPERATIONS: true,
      CATALOG: false,
      FINANCE: false,
      SYSTEM: false,
    };
  });

  // Ensure active group is expanded when navigating
  useEffect(() => {
    if (activeGroup) {
      setOpenGroups(prev => ({
        ...prev,
        [activeGroup]: true,
      }));
    }
  }, [activeGroup]);

  const toggleGroup = (key: string) => {
    setOpenGroups(prev => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-surface-950">
      {/* Mobile / Narrow screen sidebar overlay backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden transition-opacity duration-200"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar - slide-out drawer on mobile/tablet, permanent on desktop (lg:) */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-surface-900 border-r border-surface-700/60 flex flex-col
          transform transition-transform duration-200 ease-out shadow-2xl lg:shadow-none
          lg:static lg:translate-x-0 lg:w-72 lg:shrink-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Header / Brand */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-700/50 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {storeLogo ? (
              <img
                src={storeLogo}
                alt={storeName}
                className="w-9 h-9 rounded-xl object-cover border border-surface-700/80 shrink-0 shadow-xs"
              />
            ) : (
              <div className="w-9 h-9 rounded-xl bg-primary-600 border border-primary-500/40 flex items-center justify-center text-white font-black text-base shadow-xs shrink-0">
                {storeName ? storeName.charAt(0).toUpperCase() : 'P'}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold text-surface-50 truncate leading-snug">{storeName}</h2>
              <p className="text-[11px] text-surface-400 truncate leading-none mt-0.5">{storeSubtitle}</p>
            </div>
          </div>

          {/* Close button for drawer mode on mobile */}
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="p-1.5 rounded-lg text-surface-400 hover:text-surface-100 hover:bg-surface-800 lg:hidden cursor-pointer transition-colors"
            aria-label="Close sidebar"
          >
            <svg className="w-5 h-5 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Navigation Drawer Accordion List */}
        <nav className="flex-1 px-3 py-2 space-y-1.5 overflow-y-auto">
          {NAV_GROUPS.map((group) => {
            const groupItems = NAV_ITEMS.filter(
              (item) => item.group === group.key && !item.hideFromSidebar && (isOwner || !item.ownerOnly)
            );
            if (groupItems.length === 0) return null;

            const isOpen = openGroups[group.key] ?? false;
            const hasActiveRoute = groupItems.some(it => it.path === location.pathname);

            return (
              <div key={group.key} className="rounded-xl border border-surface-800/80 bg-surface-950/30 overflow-hidden">
                {/* Group Drawer Trigger */}
                <button
                  type="button"
                  onClick={() => toggleGroup(group.key)}
                  className={`w-full flex items-center justify-between px-3 py-2 text-xs font-bold transition-all cursor-pointer select-none ${
                    hasActiveRoute
                      ? 'text-primary-300 bg-surface-800/60'
                      : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800/30'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm shrink-0">{group.icon}</span>
                    <span className="tracking-wide uppercase text-[11px] font-bold truncate">{group.label}</span>
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-surface-800 text-surface-400 font-mono shrink-0">
                      {groupItems.length}
                    </span>
                  </div>
                  <svg
                    className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-90 text-primary-400' : 'text-surface-500'}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                {/* Drawer Items */}
                {isOpen && (
                  <div className="p-1.5 space-y-1 border-t border-surface-800/50 bg-surface-900/50">
                    {groupItems.map((item) => {
                      const isActive = location.pathname === item.path;
                      return (
                        <NavLink
                          key={item.path}
                          to={item.path}
                          onClick={() => setSidebarOpen(false)}
                          className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-150 ${
                            isActive
                              ? 'bg-primary-600/25 text-primary-300 border border-primary-500/40 shadow-xs'
                              : 'text-surface-300 hover:bg-surface-800/80 hover:text-surface-100 border border-transparent'
                          }`}
                        >
                          <span className="text-base shrink-0">{item.icon}</span>
                          <span className="truncate flex-1 text-left">{item.label}</span>
                          {isActive && (
                            <span className="w-1.5 h-1.5 rounded-full bg-primary-400 shrink-0" />
                          )}
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Footer / User Profile & System Status */}
        <div className="p-3 border-t border-surface-800 bg-surface-950/60 space-y-2 flex-shrink-0 safe-area-bottom">
          {/* Pinned User Role Card */}
          {isOwner ? (
            <div className="flex items-center justify-between p-2 rounded-xl bg-surface-800/80 border border-surface-700/60">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-6 h-6 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center justify-center text-xs shrink-0">
                  👑
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-surface-100 truncate leading-none">Administrator</p>
                  <p className="text-[10px] text-surface-400 truncate mt-0.5">Full Access Granted</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Lock system to Cashier Mode? (Cost prices and financial reports will be restricted)')) {
                    lockToCashier();
                  }
                }}
                className="px-2 py-1 rounded-lg bg-surface-700 hover:bg-surface-600 text-surface-300 hover:text-white text-[10px] font-bold border border-surface-600 transition-colors cursor-pointer shrink-0"
                title="Lock to Cashier Mode"
              >
                🔒 Lock
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between p-2 rounded-xl bg-surface-800/80 border border-surface-700/60">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-6 h-6 rounded-md bg-sky-500/15 text-sky-300 border border-sky-500/30 flex items-center justify-center text-xs shrink-0">
                  👤
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-surface-100 truncate leading-none">Cashier Mode</p>
                  <p className="text-[10px] text-surface-400 truncate mt-0.5">Cost Restricted</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPinError('');
                  setPinInput('');
                  setIsPinModalOpen(true);
                }}
                className="px-2 py-1 rounded-lg bg-primary-600 hover:bg-primary-500 text-white text-[10px] font-bold border border-primary-500 transition-colors cursor-pointer shrink-0 shadow-xs"
                title="Unlock with Manager PIN"
              >
                🔑 Unlock
              </button>
            </div>
          )}

          <SyncStatusBar compact />
          <div className="flex items-center justify-between text-[10px] text-surface-500 font-mono">
            <span>Offline POS v1.2</span>
            <button
              type="button"
              onClick={async () => {
                if ('serviceWorker' in navigator) {
                  try {
                    const regs = await navigator.serviceWorker.getRegistrations();
                    for (const reg of regs) await reg.unregister();
                  } catch (_) {}
                }
                if ('caches' in window) {
                  try {
                    const keys = await caches.keys();
                    for (const key of keys) await caches.delete(key);
                  } catch (_) {}
                }
                window.location.reload();
              }}
              className="text-primary-400 hover:text-primary-300 underline cursor-pointer font-sans text-[11px] font-semibold"
              title="Reload the latest version of the application"
            >
              🔄 Check for Updates
            </button>
          </div>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Dynamic Mobile Header (only shown on mobile when NOT on POS page) */}
        {location.pathname !== '/pos' && (
          <header className="flex items-center justify-between px-3 py-2 bg-surface-900 border-b border-surface-700/60 lg:hidden flex-shrink-0 shadow-xs">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSidebarOpen(prev => !prev);
                }}
                className="p-1.5 -ml-1 rounded-xl text-surface-300 hover:bg-surface-800 hover:text-surface-100 active:scale-95 transition-all cursor-pointer shrink-0"
                aria-label="Toggle navigation menu"
              >
                <svg className="w-5 h-5 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <div className="min-w-0 flex-1 flex items-center gap-1.5">
                <span className="text-sm shrink-0">{currentItem.icon}</span>
                <span className="text-sm font-extrabold text-surface-100 truncate tracking-tight">{currentItem.label}</span>
              </div>
            </div>

            {/* Mobile Role Switcher Pill */}
            <button
              type="button"
              onClick={() => {
                if (isOwner) {
                  if (window.confirm('Lock system to Cashier Mode?')) lockToCashier();
                } else {
                  setPinError('');
                  setPinInput('');
                  setIsPinModalOpen(true);
                }
              }}
              className="px-2 py-1 rounded-lg text-[10px] font-bold border transition-all cursor-pointer shrink-0 bg-surface-800 text-surface-200 border-surface-700 hover:bg-surface-750"
            >
              {isOwner ? '👑 Admin' : '👤 Cashier'}
            </button>
          </header>
        )}

        {/* Page content */}
        <main className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col ${location.pathname === '/pos' ? 'p-0' : 'p-2 sm:p-3 lg:p-4'}`}>
          {!isOwner && currentItem.ownerOnly ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center animate-fade-in my-auto">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-3xl mb-4 shadow-lg shadow-amber-500/10">
                🔒
              </div>
              <h2 className="text-lg font-black text-surface-100">Restricted Access (Cashier Mode)</h2>
              <p className="text-xs text-surface-400 max-w-sm mt-1.5 mb-5">
                The page <strong>{currentItem.label}</strong> is restricted to Administrators to safeguard store margins and financial reports.
              </p>
              <button
                type="button"
                onClick={() => {
                  setPinError('');
                  setPinInput('');
                  setIsPinModalOpen(true);
                }}
                className="px-5 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs sm:text-sm font-bold shadow-md transition-all cursor-pointer flex items-center gap-2 active:scale-95"
              >
                <span>🔑</span>
                <span>Enter Manager PIN</span>
              </button>
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>

      {/* 4-Digit Owner / Manager PIN Unlock Modal */}
      {isPinModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-surface-900 border border-surface-700 rounded-2xl max-w-xs w-full p-5 shadow-2xl space-y-4 animate-scale-up text-center">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center justify-center text-2xl mx-auto shadow-md">
              👑
            </div>
            <div>
              <h3 className="text-base font-black text-surface-100">Unlock Administrator Access</h3>
              <p className="text-[11px] text-surface-400 mt-0.5">
                Enter 4-digit Manager PIN (Default: 1234)
              </p>
            </div>

            <form onSubmit={handleUnlockSubmit} className="space-y-3">
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                autoFocus
                value={pinInput}
                onChange={e => setPinInput(e.target.value)}
                placeholder="● ● ● ●"
                className="w-full py-2.5 px-3 rounded-xl bg-surface-950 border border-surface-700 text-surface-100 font-mono text-center text-2xl tracking-[0.4em] focus:border-amber-400 focus:outline-none"
              />

              {pinError && (
                <p className="text-xs text-rose-400 font-bold">⚠️ {pinError}</p>
              )}

              {/* Quick Numpad for Touchscreens */}
              <div className="grid grid-cols-3 gap-1.5 pt-1">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map(k => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      if (k === 'C') setPinInput('');
                      else if (k === '⌫') setPinInput(p => p.slice(0, -1));
                      else setPinInput(p => (p.length < 8 ? p + k : p));
                    }}
                    className="h-10 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-200 font-bold text-sm transition-colors cursor-pointer active:scale-95 border border-surface-700/60"
                  >
                    {k}
                  </button>
                ))}
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsPinModalOpen(false);
                    setPinInput('');
                    setPinError('');
                  }}
                  className="flex-1 py-2 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-300 text-xs font-bold cursor-pointer border border-surface-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!pinInput}
                  className="flex-1 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-xs font-bold transition-all shadow-md cursor-pointer active:scale-95"
                >
                  Unlock
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
