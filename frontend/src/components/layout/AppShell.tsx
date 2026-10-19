/**
 * AppShell - Main layout wrapper for dashboard pages
 * Provides sidebar navigation on desktop, bottom nav on mobile
 */

import { Outlet, NavLink, useLocation } from 'react-router-dom';
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

// Bottom nav shows fewer items on mobile
const mobileNavItems = [
  { path: '/dashboard', label: 'Home', icon: '📊' },
  { path: '/pos', label: 'POS', icon: '🛒' },
  { path: '/products', label: 'Products', icon: '📦' },
  { path: '/sales', label: 'Sales', icon: '💰' },
  { path: '/sync', label: 'Sync', icon: '🔄' },
];

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="flex h-dvh overflow-hidden bg-surface-950">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar - hidden on mobile, always visible on desktop */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-64 bg-surface-900 border-r border-surface-700/50
          transform transition-transform duration-200 ease-out
          lg:static lg:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Logo / Brand */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-surface-700/50">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center text-white font-bold text-lg shadow-lg">
            P
          </div>
          <div>
            <h1 className="text-base font-bold text-surface-50">POS System</h1>
            <p className="text-xs text-surface-400">Inventory & Sales</p>
          </div>
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
        <div className="px-3 pb-4">
          <SyncStatusBar compact />
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile menu button header - hidden on desktop */}
        <header className="flex items-center px-4 py-2.5 bg-surface-900 border-b border-surface-700/50 lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-1 rounded-xl text-surface-300 hover:bg-surface-800 hover:text-surface-100"
            aria-label="Open menu"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 bg-surface-900/95 border-t border-surface-700/50 safe-area-bottom lg:hidden backdrop-blur-lg">
        <div className="flex items-center justify-around px-2 py-1">
          {mobileNavItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={`flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors
                  ${isActive ? 'text-primary-400' : 'text-surface-400 hover:text-surface-200'}`}
              >
                <span className="text-xl">{item.icon}</span>
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
