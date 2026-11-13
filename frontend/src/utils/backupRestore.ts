/**
 * 1-Click Backup & Restore Utility
 * Lumilikha ng kumpletong kopya ng lahat ng IndexedDB data (products, sales,
 * customers, debt, expenses, closings, bills, at settings) at nagbibigay ng
 * ligtas na pag-restore sa kahit anong laptop o browser.
 */

import { getDB, STORES } from '../db/database';
import { getTodayStr } from './date';

export interface SystemBackupPackage {
  app: 'OFFLINE_POS_INV_SALES';
  version: string;
  backupDate: string;
  storeName: string;
  data: {
    products: any[];
    categories: any[];
    pendingSales: any[];
    expenses: any[];
    dailyClosings: any[];
    reorders: any[];
    suppliers: any[];
    customers: any[];
    customerLedger: any[];
    localStorageSettings: Record<string, any>;
  };
}

export async function createFullSystemBackup(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(Object.values(STORES), 'readonly');

  const products = await tx.objectStore(STORES.PRODUCTS).getAll();
  const categories = await tx.objectStore(STORES.CATEGORIES).getAll();
  const pendingSales = await tx.objectStore(STORES.PENDING_SALES).getAll();
  const expenses = await tx.objectStore(STORES.EXPENSES).getAll();
  const dailyClosings = await tx.objectStore(STORES.DAILY_CLOSINGS).getAll();
  const reorders = await tx.objectStore(STORES.REORDERS).getAll();
  const suppliers = await tx.objectStore(STORES.SUPPLIERS).getAll();
  const customers = await tx.objectStore(STORES.CUSTOMERS).getAll();
  const customerLedger = await tx.objectStore(STORES.CUSTOMER_LEDGER).getAll();
  await tx.done;

  // Gather all pos_* localStorage settings
  const localSettings: Record<string, any> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith('pos_') || key === 'pos_app_settings')) {
      localSettings[key] = localStorage.getItem(key);
    }
  }

  let storeName = 'Aking_Tindahan';
  try {
    const s = JSON.parse(localStorage.getItem('pos_app_settings') || '{}');
    if (s.store_name) {
      storeName = s.store_name.replace(/[^a-zA-Z0-9_-]/g, '_');
    }
  } catch {}

  const pkg: SystemBackupPackage = {
    app: 'OFFLINE_POS_INV_SALES',
    version: '1.2.0',
    backupDate: new Date().toISOString(),
    storeName,
    data: {
      products,
      categories,
      pendingSales,
      expenses,
      dailyClosings,
      reorders,
      suppliers,
      customers,
      customerLedger,
      localStorageSettings: localSettings,
    },
  };

  const jsonStr = JSON.stringify(pkg, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const now = new Date();
  const timeStamp = `${getTodayStr()}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  link.href = url;
  link.download = `POS_BACKUP_${storeName}_${timeStamp}.posbackup`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function restoreFullSystemBackup(file: File): Promise<{
  success: boolean;
  message: string;
  storeName: string;
  counts: Record<string, number>;
}> {
  const text = await file.text();
  let pkg: SystemBackupPackage;
  try {
    pkg = JSON.parse(text);
  } catch {
    throw new Error('Hindi mabasa ang file. Siguraduhing wastong .posbackup o .json file ito.');
  }

  if (pkg.app !== 'OFFLINE_POS_INV_SALES' || !pkg.data) {
    throw new Error('Hindi tugma ang backup file para sa POS system na ito.');
  }

  const db = await getDB();
  const data = pkg.data;

  // Perform transactional overwrite
  const tx = db.transaction(Object.values(STORES), 'readwrite');

  if (Array.isArray(data.products)) {
    await tx.objectStore(STORES.PRODUCTS).clear();
    for (const item of data.products) await tx.objectStore(STORES.PRODUCTS).put(item);
  }

  if (Array.isArray(data.categories)) {
    await tx.objectStore(STORES.CATEGORIES).clear();
    for (const item of data.categories) await tx.objectStore(STORES.CATEGORIES).put(item);
  }

  if (Array.isArray(data.pendingSales)) {
    await tx.objectStore(STORES.PENDING_SALES).clear();
    for (const item of data.pendingSales) await tx.objectStore(STORES.PENDING_SALES).put(item);
  }

  if (Array.isArray(data.expenses)) {
    await tx.objectStore(STORES.EXPENSES).clear();
    for (const item of data.expenses) await tx.objectStore(STORES.EXPENSES).put(item);
  }

  if (Array.isArray(data.dailyClosings)) {
    await tx.objectStore(STORES.DAILY_CLOSINGS).clear();
    for (const item of data.dailyClosings) await tx.objectStore(STORES.DAILY_CLOSINGS).put(item);
  }

  if (Array.isArray(data.reorders)) {
    await tx.objectStore(STORES.REORDERS).clear();
    for (const item of data.reorders) await tx.objectStore(STORES.REORDERS).put(item);
  }

  if (Array.isArray(data.suppliers)) {
    await tx.objectStore(STORES.SUPPLIERS).clear();
    for (const item of data.suppliers) await tx.objectStore(STORES.SUPPLIERS).put(item);
  }

  if (Array.isArray(data.customers)) {
    await tx.objectStore(STORES.CUSTOMERS).clear();
    for (const item of data.customers) await tx.objectStore(STORES.CUSTOMERS).put(item);
  }

  if (Array.isArray(data.customerLedger)) {
    await tx.objectStore(STORES.CUSTOMER_LEDGER).clear();
    for (const item of data.customerLedger) await tx.objectStore(STORES.CUSTOMER_LEDGER).put(item);
  }

  await tx.done;

  // Restore localStorageSettings
  if (data.localStorageSettings && typeof data.localStorageSettings === 'object') {
    for (const [k, v] of Object.entries(data.localStorageSettings)) {
      if (typeof v === 'string') {
        localStorage.setItem(k, v);
      }
    }
  }

  return {
    success: true,
    storeName: pkg.storeName || 'Tindahan',
    message: `Matagumpay na naibalik ang backup ng tindahan (${pkg.storeName || 'Tindahan'})!`,
    counts: {
      products: data.products?.length || 0,
      sales: data.pendingSales?.length || 0,
      customers: data.customers?.length || 0,
      expenses: data.expenses?.length || 0,
      closings: data.dailyClosings?.length || 0,
    },
  };
}

