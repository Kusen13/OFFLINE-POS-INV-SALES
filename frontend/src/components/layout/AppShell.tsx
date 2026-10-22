/**
 * AppShell - Main layout wrapper for both desktop and mobile
 * Unified, professional navigation with descriptions, badges, and status bar
 */

import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useState, useEffect, useMemo } from 'react';
import { SyncStatusBar } from '../SyncStatusBar';
import { NAV_ITEMS } from './navItems';

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

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
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-primary-600/30 shrink-0">
              P
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-surface-50 truncate">POS & Inventory</h2>
              <p className="text-xs text-surface-400 truncate">Cafeteria System</p>
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

        {/* Navigation list */}
        <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-150 ${
                  isActive
                    ? 'bg-primary-600/20 text-primary-400 border border-primary-500/30 shadow-sm font-semibold'
                    : 'text-surface-300 hover:bg-surface-800/80 hover:text-surface-100 border border-transparent'
                }`}
              >
                <span className="text-xl shrink-0">{item.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate leading-snug">{item.label}</p>
                  <p className="text-[11px] text-surface-500 truncate leading-tight">{item.desc}</p>
                </div>
                {isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-primary-400 shrink-0" />
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-surface-700/50 bg-surface-950/40 space-y-2 flex-shrink-0 safe-area-bottom">
          <SyncStatusBar compact />
          <div className="text-center">
            <span className="text-[10px] text-surface-500 font-mono">Offline-First POS v1.0</span>
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
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm shrink-0">{currentItem.icon}</span>
                  <span className="text-sm font-extrabold text-surface-100 truncate tracking-tight">{currentItem.label}</span>
                </div>
                <p className="text-[10px] text-surface-400 truncate leading-tight mt-0.5">
                  {currentItem.desc}
                </p>
              </div>
            </div>
          </header>
        )}

        {/* Page content */}
        <main className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col ${location.pathname === '/pos' ? 'p-0' : 'p-2 sm:p-4 lg:p-6'}`}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
