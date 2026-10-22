/**
 * MobileDrawer - Reusable slide-out navigation menu for mobile devices
 */

import { NavLink, useLocation } from 'react-router-dom';
import { SyncStatusBar } from '../SyncStatusBar';
import { NAV_ITEMS } from './navItems';

export interface MobileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MobileDrawer({ isOpen, onClose }: MobileDrawerProps) {
  const location = useLocation();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside className="fixed inset-y-0 left-0 w-72 max-w-[85vw] bg-surface-900 border-r border-surface-700/60 shadow-2xl flex flex-col z-50 animate-slide-right">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-700/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-primary-600/30">
              P
            </div>
            <div>
              <h2 className="text-sm font-bold text-surface-50">POS & Inventory</h2>
              <p className="text-xs text-surface-400">Cafeteria System</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-surface-400 hover:text-surface-100 hover:bg-surface-800 transition-colors"
            aria-label="Close menu"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                onClick={onClose}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 ${
                  isActive
                    ? 'bg-primary-600/20 text-primary-400 border border-primary-500/30 shadow-sm font-semibold'
                    : 'text-surface-300 hover:bg-surface-800/80 hover:text-surface-100'
                }`}
              >
                <span className="text-xl shrink-0">{item.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{item.label}</p>
                  <p className="text-[11px] text-surface-500 truncate">{item.desc}</p>
                </div>
                {isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-primary-400 shrink-0" />
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-surface-700/50 bg-surface-950/40 space-y-2 safe-area-bottom">
          <SyncStatusBar compact />
          <div className="text-center">
            <span className="text-[10px] text-surface-500 font-mono">Offline-First POS v1.0</span>
          </div>
        </div>
      </aside>
    </div>
  );
}
