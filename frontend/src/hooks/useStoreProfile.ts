import { useState, useEffect, useCallback } from 'react';
import type { AppSettings } from '../types/common';

export interface StoreProfile {
  storeName: string;
  storeSubtitle: string;
  storeLogo: string | null;
  storeAddress: string;
  storeContact: string;
  receiptFooter: string;
  printerWidth: '58mm' | '80mm';
}

export function getStoredProfile(): StoreProfile {
  try {
    const raw = localStorage.getItem('pos_app_settings');
    if (raw) {
      const s: Partial<AppSettings> = JSON.parse(raw);
      return {
        storeName: s.store_name || 'POS & Inventory',
        storeSubtitle: s.store_subtitle || 'Cafeteria & Retail System',
        storeLogo: s.store_logo || null,
        storeAddress: s.store_address || '',
        storeContact: s.store_contact || '',
        receiptFooter: s.receipt_footer || 'Maraming Salamat Po sa Inyong Pagtangkilik!',
        printerWidth: s.printer_width || '58mm',
      };
    }
  } catch (_) {}

  return {
    storeName: 'POS & Inventory',
    storeSubtitle: 'Cafeteria & Retail System',
    storeLogo: null,
    storeAddress: '',
    storeContact: '',
    receiptFooter: 'Maraming Salamat Po sa Inyong Pagtangkilik!',
    printerWidth: '58mm',
  };
}

export function useStoreProfile() {
  const [profile, setProfile] = useState<StoreProfile>(getStoredProfile);

  const refreshProfile = useCallback(() => {
    setProfile(getStoredProfile());
  }, []);

  useEffect(() => {
    const handleUpdate = () => refreshProfile();
    window.addEventListener('storage', handleUpdate);
    window.addEventListener('pos-settings-updated', handleUpdate);
    return () => {
      window.removeEventListener('storage', handleUpdate);
      window.removeEventListener('pos-settings-updated', handleUpdate);
    };
  }, [refreshProfile]);

  return {
    ...profile,
    refreshProfile,
  };
}

export function notifyStoreProfileUpdated() {
  window.dispatchEvent(new Event('pos-settings-updated'));
}

