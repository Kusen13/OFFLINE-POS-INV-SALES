/**
 * Product Repository - IndexedDB operations for cached products
 */

import { getDB } from './database';
import type { Product, Category } from '../types/product';
import type { PaymentMethod } from '../types/sale';
import { updateProduct } from '../api/endpoints';
import { addPendingMutation } from './mutationRepository';

/**
 * Replace all cached products with fresh data from server
 */
export async function replaceAllProducts(products: Product[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('products', 'readwrite');
  const allCurrent = await tx.store.getAll();
  const currentMap = new Map<number, Product>();
  for (const p of allCurrent) {
    currentMap.set(p.id, p);
  }
  const pendingOffline = allCurrent.filter(p => p.id < 0 || (p as any).is_pending);

  await tx.store.clear();
  for (const product of products) {
    const existing = currentMap.get(product.id);
    const merged: Product = {
      ...existing,
      ...product,
      item_type: product.item_type ?? existing?.item_type ?? 'product',
      initial_stock: product.initial_stock ?? existing?.initial_stock ?? product.current_stock ?? 0,
      initial_stock_date: product.initial_stock_date ?? existing?.initial_stock_date ?? '2026-10-19',
      supplier_name: product.supplier_name || existing?.supplier_name,
      supplier_id: product.supplier_id || existing?.supplier_id,
      target_stock: product.target_stock ?? existing?.target_stock ?? 20,
      unit: product.unit || existing?.unit || 'sticks',
      reseller_price: product.reseller_price ?? existing?.reseller_price,
    };
    await tx.store.put(merged);
  }
  for (const pending of pendingOffline) {
    await tx.store.put(pending);
  }
  await tx.done;
}

/**
 * Save or update a single product locally in IndexedDB
 */
export async function saveLocalProduct(product: Product & { is_pending?: boolean }): Promise<void> {
  const db = await getDB();
  await db.put('products', product);
}

/**
 * Delete a product locally in IndexedDB
 */
export async function deleteLocalProduct(id: number): Promise<void> {
  const db = await getDB();
  await db.delete('products', id);
}

/**
 * Batch stock-in (re-order receiving) updating current stock and optionally cost price
 */
export async function batchStockIn(
  items: { productId: number; quantity: number; unitCost?: number }[],
  reason = 'Tanggap na Delivery mula sa Re-Order'
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('products', 'readwrite');
  for (const item of items) {
    const product = await tx.store.get(item.productId);
    if (product) {
      const stockBefore = product.current_stock || 0;
      const stockAfter = stockBefore + item.quantity;
      product.current_stock = stockAfter;
      if (item.unitCost !== undefined && item.unitCost > 0) {
        product.cost_price = item.unitCost;
      }
      product.updated_at = new Date().toISOString();
      await tx.store.put(product);

      recordStockMovement({
        productId: product.id,
        productName: product.name,
        type: 'STOCK_IN',
        quantityChange: item.quantity,
        stockBefore,
        stockAfter,
        reason,
      });
    }
  }
  await tx.done;
}

/**
 * Update products incrementally (upsert)
 */
export async function upsertProducts(products: Product[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('products', 'readwrite');
  for (const product of products) {
    const existing = await tx.store.get(product.id);
    const merged: Product = {
      ...existing,
      ...product,
      item_type: product.item_type ?? existing?.item_type ?? 'product',
      initial_stock: product.initial_stock ?? existing?.initial_stock ?? product.current_stock ?? 0,
      initial_stock_date: product.initial_stock_date ?? existing?.initial_stock_date ?? '2026-10-19',
      supplier_name: product.supplier_name || existing?.supplier_name,
      supplier_id: product.supplier_id || existing?.supplier_id,
      target_stock: product.target_stock ?? existing?.target_stock ?? 20,
      unit: product.unit || existing?.unit || 'sticks',
      reseller_price: product.reseller_price ?? existing?.reseller_price,
    };
    await tx.store.put(merged);
  }
  await tx.done;
}

/**
 * Get all cached products from IndexedDB
 */
export async function getAllProducts(): Promise<Product[]> {
  const db = await getDB();
  return db.getAll('products');
}

/**
 * Get active products only, aligned with current Daily Closing
 */
export async function getActiveProducts(): Promise<Product[]> {
  const all = await getAllProducts();
  return all.filter(p => p.is_active);
}

/**
 * Get products by category
 */
export async function getProductsByCategory(categoryId: number): Promise<Product[]> {
  const db = await getDB();
  return db.getAllFromIndex('products', 'by-category', categoryId);
}

/**
 * Get a product by ID
 */
export async function getProductById(id: number): Promise<Product | undefined> {
  const db = await getDB();
  return db.get('products', id);
}

/**
 * Search products by name or SKU
 */
export async function searchProducts(query: string): Promise<Product[]> {
  const db = await getDB();
  const all = await db.getAll('products');
  const lower = query.toLowerCase();
  return all.filter(p => 
    p.is_active && 
    (p.name.toLowerCase().includes(lower) || p.sku.toLowerCase().includes(lower))
  );
}

/**
 * Get product count
 */
export async function getProductCount(): Promise<number> {
  const db = await getDB();
  return db.count('products');
}

// ============================================================
// Categories
// ============================================================

/**
 * Replace all cached categories
 */
export async function replaceAllCategories(categories: Category[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('categories', 'readwrite');
  const allCurrent = await tx.store.getAll();
  const pendingOffline = allCurrent.filter(c => c.id < 0 || (c as any).is_pending);

  await tx.store.clear();
  for (const category of categories) {
    await tx.store.put(category);
  }
  for (const pending of pendingOffline) {
    await tx.store.put(pending);
  }
  await tx.done;
}

/**
 * Save or update a single category locally in IndexedDB
 */
export async function saveLocalCategory(category: Category & { is_pending?: boolean }): Promise<void> {
  const db = await getDB();
  await db.put('categories', category);
}

/**
 * Delete a category locally in IndexedDB
 */
export async function deleteLocalCategory(id: number): Promise<void> {
  const db = await getDB();
  await db.delete('categories', id);
}

/**
 * Get all cached categories
 */
export async function getAllCategories(): Promise<(Category & { is_pending?: boolean })[]> {
  const db = await getDB();
  const categories = await db.getAll('categories');
  return categories.sort((a, b) => a.sort_order - b.sort_order);
}

// ============================================================
// Payment Methods
// ============================================================

/**
 * Replace all cached payment methods
 */
export async function replaceAllPaymentMethods(methods: PaymentMethod[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('paymentMethods', 'readwrite');
  await tx.store.clear();
  for (const method of methods) {
    await tx.store.put(method);
  }
  await tx.done;
}

/**
 * Get all cached payment methods
 */
export async function getAllPaymentMethods(): Promise<PaymentMethod[]> {
  const db = await getDB();
  const methods = await db.getAll('paymentMethods');
  return methods.filter(m => m.is_active).sort((a, b) => a.sort_order - b.sort_order);
}

// ============================================================
// Sync Metadata
// ============================================================

/**
 * Save a sync metadata value
 */
export async function setSyncMeta(key: string, value: string): Promise<void> {
  const db = await getDB();
  await db.put('syncMeta', { key, value });
}

/**
 * Get a sync metadata value
 */
export async function getSyncMeta(key: string): Promise<string | undefined> {
  const db = await getDB();
  const meta = await db.get('syncMeta', key);
  return meta?.value;
}

/**
 * Get the last product sync timestamp
 */
export async function getLastProductSync(): Promise<string | null> {
  const meta = await getSyncMeta('lastProductSync');
  return meta ?? null;
}

/**
 * Set the last product sync timestamp
 */
export async function setLastProductSync(timestamp: string): Promise<void> {
  await setSyncMeta('lastProductSync', timestamp);
}

// ============================================================
// Stock Movements & Audit Trail
// ============================================================

export interface StockMovementRecord {
  id: string;
  productId: number;
  productName: string;
  type: 'STOCK_IN' | 'WASTE' | 'ADJUSTMENT' | 'SALE';
  quantityChange: number;
  stockBefore: number;
  stockAfter: number;
  reason: string;
  timestamp: string;
}

const STOCK_LOGS_KEY = 'pos_stock_movement_logs';

export function getStockMovementLogs(limit = 50): StockMovementRecord[] {
  try {
    const raw = localStorage.getItem(STOCK_LOGS_KEY);
    if (!raw) return [];
    const list: StockMovementRecord[] = JSON.parse(raw);
    return list.slice(0, limit);
  } catch {
    return [];
  }
}

export function recordStockMovement(entry: Omit<StockMovementRecord, 'id' | 'timestamp'>): void {
  try {
    const current = getStockMovementLogs(100);
    const newRecord: StockMovementRecord = {
      ...entry,
      id: `mov-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
    };
    const updated = [newRecord, ...current].slice(0, 100);
    localStorage.setItem(STOCK_LOGS_KEY, JSON.stringify(updated));
  } catch (e) {
    console.warn('Failed to record stock movement log:', e);
  }
}

/**
 * Adjust stock by delta (+ or -) and log the movement
 */
export async function adjustProductStock(
  productId: number,
  delta: number,
  type: 'STOCK_IN' | 'WASTE' | 'ADJUSTMENT' | 'SALE' = 'ADJUSTMENT',
  reason = ''
): Promise<Product | undefined> {
  const db = await getDB();
  const product = await db.get('products', productId);
  if (!product) return undefined;

  const stockBefore = product.current_stock || 0;
  const stockAfter = Math.max(0, stockBefore + delta);
  product.current_stock = stockAfter;
  product.updated_at = new Date().toISOString();
  await db.put('products', product);

  recordStockMovement({
    productId: product.id,
    productName: product.name,
    type,
    quantityChange: stockAfter - stockBefore,
    stockBefore,
    stockAfter,
    reason: reason || (delta > 0 ? 'Mabilisang Dagdag' : 'Mabilisang Bawas'),
  });

  return product;
}

/**
 * Set exact physical stock count, log audit, AND push to server
 * so all other devices (phone, tablet) see the update immediately.
 */
export async function setProductStock(
  productId: number,
  exactStock: number,
  reason = 'Physical count audit'
): Promise<Product | undefined> {
  const db = await getDB();
  const product = await db.get('products', productId);
  if (!product) return undefined;

  const stockBefore = product.current_stock || 0;
  const stockAfter = Math.max(0, exactStock);
  product.current_stock = stockAfter;
  product.updated_at = new Date().toISOString();
  await db.put('products', product);

  recordStockMovement({
    productId: product.id,
    productName: product.name,
    type: 'ADJUSTMENT',
    quantityChange: stockAfter - stockBefore,
    stockBefore,
    stockAfter,
    reason,
  });

  // Push to server so other devices (phone) pick it up on next sync/poll
  try {
    if (typeof navigator === 'undefined' || navigator.onLine) {
      await updateProduct(productId, { current_stock: stockAfter } as any);
    } else {
      throw new Error('Offline');
    }
  } catch {
    // Queue for next sync if server unreachable
    try {
      await addPendingMutation({
        entity: 'product',
        action: 'update',
        payload: { ...product },
      });
    } catch { /* ignore */ }
  }

  return product;
}
