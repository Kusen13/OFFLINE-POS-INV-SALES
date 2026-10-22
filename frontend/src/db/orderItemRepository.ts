/**
 * OrderItem Repository
 *
 * Offline-first CRUD for orderable items stored in IndexedDB.
 * These are items you ORDER from suppliers — separate from Products (POS items).
 */

import { getDB, STORES } from './database';
import type { OrderItem, OrderItemFormData } from '../types/orderItem';

function uuid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export async function getAllOrderItems(): Promise<OrderItem[]> {
  const db = await getDB();
  const all = await (db as any).getAll(STORES.ORDER_ITEMS) as OrderItem[];
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getActiveOrderItems(): Promise<OrderItem[]> {
  const all = await getAllOrderItems();
  return all.filter(i => i.is_active);
}

export async function getOrderItemsBySupplier(supplierId: string): Promise<OrderItem[]> {
  const db = await getDB();
  try {
    const items = await (db as any).getAllFromIndex(STORES.ORDER_ITEMS, 'by-supplier', supplierId) as OrderItem[];
    return items.filter(i => i.is_active);
  } catch {
    const all = await getAllOrderItems();
    return all.filter(i => i.supplier_id === supplierId && i.is_active);
  }
}

export async function getOrderItemById(id: string): Promise<OrderItem | undefined> {
  const db = await getDB();
  return (db as any).get(STORES.ORDER_ITEMS, id) as Promise<OrderItem | undefined>;
}

export async function createOrderItem(data: OrderItemFormData): Promise<OrderItem> {
  const db = await getDB();
  const now = new Date().toISOString();
  const item: OrderItem = {
    ...data,
    id: uuid(),
    created_at: now,
    updated_at: now,
  };
  await (db as any).put(STORES.ORDER_ITEMS, item);
  return item;
}

export async function updateOrderItem(id: string, data: Partial<OrderItemFormData>): Promise<OrderItem> {
  const db = await getDB();
  const existing = await (db as any).get(STORES.ORDER_ITEMS, id) as OrderItem | undefined;
  if (!existing) throw new Error(`OrderItem ${id} not found`);
  const updated: OrderItem = {
    ...existing,
    ...data,
    id,
    updated_at: new Date().toISOString(),
  };
  await (db as any).put(STORES.ORDER_ITEMS, updated);
  return updated;
}

export async function deleteOrderItem(id: string): Promise<void> {
  const db = await getDB();
  await (db as any).delete(STORES.ORDER_ITEMS, id);
}
