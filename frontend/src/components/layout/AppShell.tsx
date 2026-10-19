/**
 * AppShell - Main layout wrapper for dashboard pages
 * Provides sidebar navigation on desktop/laptop and slide-out drawer on smaller screens
 */

import { Outlet, NavLink } from 'react-router-dom';
import { useState } from 'react';
import { SyncStatusBar } from '../SyncStatusBar';

const navItems = [
  { path: '/dashboard', label: 'Dashboard', icon: '📊' },
  { path: '/pos', label: 'POS', icon: '🛒' },
  { path: '/products', label: 'Products', icon: '📦' },
  { path: '/categories', label: 'Categories', icon: '🏷️' },
  { path: '/inventory', label: 'Inventory', icon: '📋' },
  { path: '/sales', label: 'Sales', icon: '💰' },
  { path: '/expenses', label: 'Expenses', icon: '💸' },
  { path: '/sync', label: 'Sync', icon: '🔄' },
  { path: '/settings', label: 'Settings', icon: '⚙️' },
];

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-dvh overflow-hidden bg-surface-950">
      {/* Mobile / Narrow screen sidebar overlay backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar - slide-out drawer on narrow screens, static on desktop */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-64 bg-surface-900 border-r border-surface-700/50 flex flex-col
          transform transition-transform duration-200 ease-out shadow-2xl lg:shadow-none
          lg:static lg:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Logo / Brand + Close button on mobile */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-700/50 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center text-white font-bold text-lg shadow-lg">
              P
            </div>
            <div>
              <h1 className="text-base font-bold text-surface-50">POS System</h1>
              <p className="text-xs text-surface-400">Inventory & Sales</p>
            </div>
          </div>

          {/* Close button for drawer mode */}
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

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150
                ${isActive
                  ? 'bg-primary-600/20 text-primary-400 shadow-sm'
                  : 'text-surface-300 hover:bg-surface-800 hover:text-surface-100'
                }`
              }
            >
              <span className="text-lg">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Sync status in sidebar */}
        <div className="px-3 pb-4 flex-shrink-0">
          <SyncStatusBar compact />
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Menu button header - visible when sidebar is collapsed/narrow */}
        <header className="flex items-center gap-3 px-4 py-2.5 bg-surface-900 border-b border-surface-700/50 lg:hidden flex-shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSidebarOpen(prev => !prev);
            }}
            className="p-2 -ml-1 rounded-xl text-surface-300 hover:bg-surface-800 hover:text-surface-100 active:scale-95 transition-all cursor-pointer"
            aria-label="Toggle navigation menu"
          >
            <svg className="w-6 h-6 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-sm font-bold text-surface-100">POS System</span>
        </header>

        {/* Page content */}
        <main className="flex-1 min-h-0 overflow-y-auto p-4 lg:p-6 flex flex-col">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
