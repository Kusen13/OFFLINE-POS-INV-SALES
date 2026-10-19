/**
 * IndexedDB Database Initialization
 * 
 * Uses the `idb` library for a Promise-based API.
 * This is the offline data layer — all sales are stored here
 * before being synced to the server.
 */

import { openDB, type IDBPDatabase } from 'idb';
import type { Product, Category } from '../types/product';
import type { PendingSale, PaymentMethod } from '../types/sale';

// Database name and version
const DB_NAME = 'pos_offline_db';
const DB_VERSION = 1;

// Store names
export const STORES = {
  PRODUCTS: 'products',
  CATEGORIES: 'categories',
  PENDING_SALES: 'pendingSales',
  PAYMENT_METHODS: 'paymentMethods',
  SYNC_META: 'syncMeta',
} as const;

export interface SyncMeta {
  key: string;
  value: string;
}

export type PosDB = IDBPDatabase<{
  products: {
    key: number;
    value: Product;
    indexes: {
      'by-category': number;
      'by-sku': string;
      'by-updated': string;
    };
  };
  categories: {
    key: number;
    value: Category;
    indexes: {
      'by-name': string;
    };
  };
  pendingSales: {
    key: string;
    value: PendingSale;
    indexes: {
      'by-status': string;
      'by-sold-at': string;
      'by-receipt': string;
    };
  };
  paymentMethods: {
    key: number;
    value: PaymentMethod;
  };
  syncMeta: {
    key: string;
    value: SyncMeta;
  };
}>;

let dbInstance: PosDB | null = null;

/**
 * Initialize and return the database connection.
 * Creates stores and indexes on first run or version upgrade.
 */
export async function getDB(): Promise<PosDB> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<PosDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Products store
      if (!db.objectStoreNames.contains('products')) {
        const productStore = db.createObjectStore('products', { keyPath: 'id' });
        productStore.createIndex('by-category', 'category_id');
        productStore.createIndex('by-sku', 'sku', { unique: true });
        productStore.createIndex('by-updated', 'updated_at');
      }

      // Categories store
      if (!db.objectStoreNames.contains('categories')) {
        const categoryStore = db.createObjectStore('categories', { keyPath: 'id' });
        categoryStore.createIndex('by-name', 'name', { unique: true });
      }

      // Pending sales store
      if (!db.objectStoreNames.contains('pendingSales')) {
        const salesStore = db.createObjectStore('pendingSales', { keyPath: 'uuid' });
        salesStore.createIndex('by-status', 'sync_status');
        salesStore.createIndex('by-sold-at', 'sold_at');
        salesStore.createIndex('by-receipt', 'receipt_number', { unique: true });
      }

      // Payment methods store
      if (!db.objectStoreNames.contains('paymentMethods')) {
        db.createObjectStore('paymentMethods', { keyPath: 'id' });
      }

      // Sync metadata store
      if (!db.objectStoreNames.contains('syncMeta')) {
        db.createObjectStore('syncMeta', { keyPath: 'key' });
      }
    },
    blocked() {
      console.warn('Database upgrade blocked — close other tabs');
    },
    blocking() {
      // Close our connection so other tabs can upgrade
      dbInstance?.close();
      dbInstance = null;
    },
  }) as unknown as PosDB;

  return dbInstance;
}

/**
 * Request persistent storage so the browser doesn't evict our data
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (navigator.storage && navigator.storage.persist) {
    const granted = await navigator.storage.persist();
    console.log(`Persistent storage ${granted ? 'granted' : 'denied'}`);
    return granted;
  }
  return false;
}

/**
 * Check storage usage
 */
export async function getStorageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (navigator.storage && navigator.storage.estimate) {
    const estimate = await navigator.storage.estimate();
    return {
      usage: estimate.usage ?? 0,
      quota: estimate.quota ?? 0,
    };
  }
  return null;
}
