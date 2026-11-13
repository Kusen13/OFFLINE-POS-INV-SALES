/**
 * Security & Role-Based Access Control (RBAC) Store
 * Manages Owner Mode vs Cashier Mode, 4-digit PIN verification,
 * Blind Count closing, and Cashier accountability.
 */

import { create } from 'zustand';

export type UserRole = 'owner' | 'cashier';

export function getStoredManagerPin(): string {
  try {
    const s = JSON.parse(localStorage.getItem('pos_app_settings') || '{}');
    return s.manager_pin || '1234';
  } catch {
    return '1234';
  }
}

interface AuthState {
  role: UserRole;
  isOwner: boolean;
  blindCountEnabled: boolean;
  hideCostFromCashier: boolean;
  activeCashierName: string;

  // Actions
  lockToCashier: () => void;
  unlockToOwner: (pin: string) => boolean;
  verifyPin: (pin: string) => boolean;
  setBlindCount: (enabled: boolean) => void;
  setHideCost: (enabled: boolean) => void;
  setActiveCashier: (name: string) => void;
}

export const useAuthStore = create<AuthState>((set) => {
  // Read initial role from localStorage, defaulting to 'owner' so setup is never blocked
  const initialRole: UserRole = (localStorage.getItem('pos_current_role') as UserRole) || 'owner';
  const initialBlindCount = localStorage.getItem('pos_blind_count_enabled') === 'true';
  const initialHideCost = localStorage.getItem('pos_hide_cost_from_cashier') !== 'false';
  const initialCashier = localStorage.getItem('pos_active_cashier_name') || 'Cashier';

  return {
    role: initialRole,
    isOwner: initialRole === 'owner',
    blindCountEnabled: initialBlindCount,
    hideCostFromCashier: initialHideCost,
    activeCashierName: initialCashier,

    lockToCashier: () => {
      localStorage.setItem('pos_current_role', 'cashier');
      set({ role: 'cashier', isOwner: false });
    },

    unlockToOwner: (pin: string) => {
      const storedPin = getStoredManagerPin();
      if (pin.trim() === storedPin.trim()) {
        localStorage.setItem('pos_current_role', 'owner');
        set({ role: 'owner', isOwner: true });
        return true;
      }
      return false;
    },

    verifyPin: (pin: string) => {
      const storedPin = getStoredManagerPin();
      return pin.trim() === storedPin.trim();
    },

    setBlindCount: (enabled: boolean) => {
      localStorage.setItem('pos_blind_count_enabled', String(enabled));
      set({ blindCountEnabled: enabled });
    },

    setHideCost: (enabled: boolean) => {
      localStorage.setItem('pos_hide_cost_from_cashier', String(enabled));
      set({ hideCostFromCashier: enabled });
    },

    setActiveCashier: (name: string) => {
      localStorage.setItem('pos_active_cashier_name', name);
      set({ activeCashierName: name });
    },
  };
});
