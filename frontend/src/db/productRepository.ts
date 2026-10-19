/**
 * Product Repository - IndexedDB operations for cached products
 */

import { getDB } from './database';
import type { Product, Category } from '../types/product';
import type { PaymentMethod } from '../types/sale';

/**
 * Replace all cached products with fresh data from server
 */
export async function replaceAllProducts(products: Product[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('products', 'readwrite');
  const allCurrent = await tx.store.getAll();
  const pendingOffline = allCurrent.filter(p => p.id < 0 || (p as any).is_pending);

  await tx.store.clear();
  for (const product of products) {
    await tx.store.put(product);
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
 * Update products incrementally (upsert)
 */
export async function upsertProducts(products: Product[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('products', 'readwrite');
  for (const product of products) {
    await tx.store.put(product);
  }
  await tx.done;
}

/**
 * Get all cached products
 */
export async function getAllProducts(): Promise<Product[]> {
  const db = await getDB();
  return db.getAll('products');
}

/**
 * Get active products only
 */
export async function getActiveProducts(): Promise<Product[]> {
  const db = await getDB();
  const all = await db.getAll('products');
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
