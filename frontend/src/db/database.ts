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
import type { Expense } from '../types/inventory';
import type { DailyClosing } from '../types/closing';
import type { ReorderSheet } from '../types/reorder';
import type { Supplier } from '../types/supplier';
import type { OrderItem } from '../types/orderItem';

export interface PendingMutation {
  id: string; // uuid
  entity: 'expense' | 'product' | 'category' | 'daily_closing' | 'reorder' | 'stock_adjustment';
  action: 'create' | 'update' | 'delete';
  payload: any;
  entityId?: number;
  tempId?: number;
  status: 'PENDING' | 'SYNCED' | 'FAILED';
  errorMessage?: string;
  created_at: string;
}

// Database name and version
const DB_NAME = 'pos_offline_db';
const DB_VERSION = 10;

// Store names
export const STORES = {
  PRODUCTS: 'products',
  CATEGORIES: 'categories',
  PENDING_SALES: 'pendingSales',
  PAYMENT_METHODS: 'paymentMethods',
  SYNC_META: 'syncMeta',
  EXPENSES: 'expenses',
  PENDING_MUTATIONS: 'pendingMutations',
  DAILY_CLOSINGS: 'dailyClosings',
  REORDERS: 'reorders',
  SUPPLIERS: 'suppliers',
  ORDER_ITEMS: 'orderItems',
} as const;

export interface SyncMeta {
  key: string;
  value: string;
}

export type PosDB = IDBPDatabase<{
  products: {
    key: number;
    value: Product & { is_pending?: boolean };
    indexes: {
      'by-category': number;
      'by-sku': string;
      'by-updated': string;
    };
  };
  categories: {
    key: number;
    value: Category & { is_pending?: boolean };
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
  expenses: {
    key: number;
    value: Expense & { is_pending?: boolean };
    indexes: {
      'by-date': string;
      'by-category': string;
    };
  };
  pendingMutations: {
    key: string;
    value: PendingMutation;
    indexes: {
      'by-entity': string;
      'by-status': string;
    };
  };
  dailyClosings: {
    key: string;
    value: DailyClosing;
    indexes: {
      'by-date': string;
    };
  };
  reorders: {
    key: string;
    value: ReorderSheet;
    indexes: {
      'by-date': string;
    };
  };
  suppliers: {
    key: string;
    value: Supplier;
    indexes: {
      'by-name': string;
      'by-active': number;
    };
  };
  orderItems: {
    key: string;
    value: OrderItem;
    indexes: {
      'by-supplier': string;
      'by-name': string;
      'by-active': number;
    };
  };
}>;

let dbInstance: PosDB | null = null;

export const initDB = getDB;

/**
 * Initialize and return the database connection.
 * Creates stores and indexes on first run or version upgrade.
 */
export async function getDB(): Promise<PosDB> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<PosDB>(DB_NAME, DB_VERSION, {
    async upgrade(db, oldVersion, _newVersion, tx) {
      // ── v1–v6: create stores if they don't exist ──────────────────────────
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

      // Expenses store
      if (!db.objectStoreNames.contains('expenses')) {
        const expStore = db.createObjectStore('expenses', { keyPath: 'id' });
        expStore.createIndex('by-date', 'expense_date');
        expStore.createIndex('by-category', 'category');
      }

      // Pending mutations store
      if (!db.objectStoreNames.contains('pendingMutations')) {
        const mutStore = db.createObjectStore('pendingMutations', { keyPath: 'id' });
        mutStore.createIndex('by-entity', 'entity');
        mutStore.createIndex('by-status', 'status');
      }

      // Daily Closings store
      if (!db.objectStoreNames.contains('dailyClosings')) {
        const closingStore = db.createObjectStore('dailyClosings', { keyPath: 'id' });
        closingStore.createIndex('by-date', 'date', { unique: true });
      }

      // Reorders store
      if (!db.objectStoreNames.contains('reorders')) {
        const reordersStore = db.createObjectStore('reorders', { keyPath: 'id' });
        reordersStore.createIndex('by-date', 'order_date', { unique: true });
      }

      // Suppliers store
      if (!db.objectStoreNames.contains('suppliers')) {
        const supplierStore = (db as any).createObjectStore('suppliers', { keyPath: 'id' });
        supplierStore.createIndex('by-name', 'name');
        supplierStore.createIndex('by-active', 'is_active');
      }

      // Order Items store (items ordered from suppliers — separate from Products)
      if (!db.objectStoreNames.contains('orderItems')) {
        const orderItemStore = (db as any).createObjectStore('orderItems', { keyPath: 'id' });
        orderItemStore.createIndex('by-supplier', 'supplier_id');
        orderItemStore.createIndex('by-name', 'name');
        orderItemStore.createIndex('by-active', 'is_active');
      }

      // ── v7 migration: fix Oct 21 closing if it has wrong Pork BBQ prepared_qty ──
      if (oldVersion < 7 && db.objectStoreNames.contains('dailyClosings')) {
        try {
          const closingStore = tx.objectStore('dailyClosings');
          const oct21 = await closingStore.get('closing-2026-10-21') as any;
          if (oct21 && oct21.items) {
            let fixed = false;
            oct21.items = oct21.items.map((it: any) => {
              // Correct formula: prepared = prev_stock + received_qty (never use curStock)
              const correctPrep = (it.prev_stock ?? 0) + (it.received_qty ?? 0);
              if (it.prepared_qty !== correctPrep) {
                const correctUnsold = Math.max(0, correctPrep - (it.sold_qty ?? 0) - (it.spoilage_qty ?? 0));
                fixed = true;
                return { ...it, prepared_qty: correctPrep, unsold_qty: correctUnsold };
              }
              return it;
            });
            if (fixed) {
              // Recompute totals
              oct21.total_prepared = oct21.items.reduce((s: number, i: any) => s + i.prepared_qty, 0);
              oct21.total_unsold   = oct21.items.reduce((s: number, i: any) => s + i.unsold_qty, 0);
              oct21.total_sold     = oct21.items.reduce((s: number, i: any) => s + (i.sold_qty ?? 0), 0);
              await closingStore.put(oct21);
              console.log('[DB v7] Fixed Oct 21 closing — total_prepared now:', oct21.total_prepared);
            }
          }
        } catch (e) {
          console.warn('[DB v7] Could not fix Oct 21 closing:', e);
        }
      }

      // ── v8 migration: Reset stale auto-populated draft reorders & closings ──
      if (oldVersion < 8) {
        try {
          if (db.objectStoreNames.contains('reorders')) {
            const reorderStore = tx.objectStore('reorders');
            const allReorders = await reorderStore.getAll();
            for (const r of allReorders) {
              if (r.status === 'DRAFT' && r.order_date >= '2026-10-21') {
                r.items = (r.items || []).map((it: any) => ({
                  ...it,
                  order_qty: 0,
                  total_cost: 0,
                }));
                r.total_quantity = 0;
                r.total_cost = 0;
                await reorderStore.put(r);
                console.log('[DB v8] Sanitized draft reorder for', r.order_date, 'to 0');
              }
            }
          }

          if (db.objectStoreNames.contains('dailyClosings')) {
            const closingStore = tx.objectStore('dailyClosings');
            const allClosings = await closingStore.getAll();
            for (const c of allClosings) {
              if (c.status !== 'FINALIZED' && c.date >= '2026-10-21') {
                c.items = (c.items || []).map((it: any) => {
                  const receivedQty = 0;
                  const prep = (it.prev_stock ?? 0) + receivedQty;
                  const unsold = Math.max(0, prep - (it.sold_qty ?? 0) - (it.spoilage_qty ?? 0));
                  return {
                    ...it,
                    received_qty: 0,
                    prepared_qty: prep,
                    unsold_qty: unsold,
                    discrepancy: ((it.sold_qty ?? 0) + unsold + (it.spoilage_qty ?? 0)) - prep,
                  };
                });
                c.total_prepared = c.items.reduce((s: number, i: any) => s + (i.prepared_qty || 0), 0);
                c.total_unsold = c.items.reduce((s: number, i: any) => s + (i.unsold_qty || 0), 0);
                c.total_discrepancy = c.items.reduce((s: number, i: any) => s + (i.discrepancy || 0), 0);
                await closingStore.put(c);
                console.log('[DB v8] Reset draft closing for', c.date, 'to 0 received');
              }
            }
          }
        } catch (e) {
          console.warn('[DB v8] Migration error:', e);
        }
      }

      // ── v9 migration: Synchronize reorders prev_stock with daily closings ──
      if (oldVersion < 9) {
        try {
          if (db.objectStoreNames.contains('reorders')) {
            const reorderStore = tx.objectStore('reorders');
            const allReorders = await reorderStore.getAll();
            const oct19Unsold: Record<string, number> = {
              'pork bbq': 19, 'isaw manok': 5, 'dugo': 0, 'bituka/tumbong': 0,
              'paa': 5, 'tenga': 6, 'hotdog': 8, 'bulaklak': 12, 'leeg': 10, 'atay': 0, 'suka': 1
            };
            const oct20Unsold: Record<string, number> = {
              'pork bbq': 7, 'isaw manok': 6, 'dugo': 3, 'bituka/tumbong': 1,
              'paa': 10, 'tenga': 6, 'hotdog': 12, 'bulaklak': 14, 'leeg': 4, 'atay': 0, 'suka': 1
            };
            const oct21Unsold: Record<string, number> = {
              'pork bbq': 2, 'isaw manok': 0, 'dugo': 0, 'bituka/tumbong': 0,
              'paa': 0, 'tenga': 3, 'hotdog': 9, 'bulaklak': 8, 'leeg': 4, 'atay': 0, 'suka': 1
            };

            for (const r of allReorders) {
              const prevMap = r.order_date === '2026-10-20' ? oct19Unsold : (r.order_date === '2026-10-21' ? oct20Unsold : (r.order_date === '2026-10-22' ? oct21Unsold : null));
              if (prevMap && r.status === 'DRAFT') {
                r.items = (r.items || []).map((it: any) => {
                  const norm = (it.product_name || '').toLowerCase().trim();
                  const prev = prevMap[norm] ?? it.prev_stock ?? 0;
                  const suggested = Math.max(0, (it.target_stock || 0) - prev);
                  return { ...it, prev_stock: prev, unsold_qty: prev, suggested_qty: suggested };
                });
                await reorderStore.put(r);
                console.log('[DB v9] Aligned prev_stock for reorder', r.order_date);
              }
            }
          }
        } catch (e) {
          console.warn('[DB v9] Migration error:', e);
        }
      }

      // ── v10 migration: Force full product re-sync to fix stale prices in PWA ──
      // Clears lastProductSync timestamp so App.tsx triggers a full product
      // re-download from the server on next startup, correcting any wrong cached prices.
      if (oldVersion < 10) {
        try {
          if (db.objectStoreNames.contains('syncMeta')) {
            const syncMetaStore = tx.objectStore('syncMeta');
            await syncMetaStore.delete('lastProductSync');
            console.log('[DB v10] Cleared lastProductSync — full product re-fetch will occur on next startup.');
          }
        } catch (e) {
          console.warn('[DB v10] Migration error:', e);
        }
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
