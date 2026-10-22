/**
 * Supplier Repository
 *
 * Offline-first CRUD for suppliers stored in IndexedDB.
 * Suppliers are separate from Products — they represent the
 * external vendors/resellers from whom we purchase raw items.
 */

import { getDB, STORES } from './database';
import { api } from '../api/client';
import type { Supplier, SupplierFormData } from '../types/supplier';

function uuid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export async function getAllSuppliers(): Promise<Supplier[]> {
  const db = await getDB();
  const local = (await (db as any).getAll(STORES.SUPPLIERS)) as Supplier[];

  // Background sync from MySQL if online
  try {
    if (typeof navigator === 'undefined' || navigator.onLine) {
      const res = await api.get<{ success: boolean; data: Supplier[] }>('/suppliers');
      if (res.data && Array.isArray(res.data) && res.data.length > 0) {
        for (const s of res.data) {
          await (db as any).put(STORES.SUPPLIERS, s);
        }
        return res.data.sort((a, b) => a.name.localeCompare(b.name));
      }
    }
  } catch {}

  return local.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getSupplierById(id: string): Promise<Supplier | undefined> {
  const db = await getDB();
  return (db as any).get(STORES.SUPPLIERS, id) as Promise<Supplier | undefined>;
}

export async function createSupplier(data: SupplierFormData): Promise<Supplier> {
  const db = await getDB();
  const now = new Date().toISOString();
  const supplier: Supplier = {
    ...data,
    id: uuid(),
    created_at: now,
    updated_at: now,
  };
  await (db as any).put(STORES.SUPPLIERS, supplier);

  try {
    if (typeof navigator === 'undefined' || navigator.onLine) {
      await api.post('/suppliers', supplier);
    }
  } catch {}

  return supplier;
}

export async function updateSupplier(id: string, data: Partial<SupplierFormData>): Promise<Supplier> {
  const db = await getDB();
  const existing = (await (db as any).get(STORES.SUPPLIERS, id)) as Supplier | undefined;
  if (!existing) throw new Error(`Supplier ${id} not found`);
  const updated: Supplier = {
    ...existing,
    ...data,
    id,
    updated_at: new Date().toISOString(),
  };
  await (db as any).put(STORES.SUPPLIERS, updated);

  try {
    if (typeof navigator === 'undefined' || navigator.onLine) {
      await api.put(`/suppliers/${id}`, updated);
    }
  } catch {}

  return updated;
}

export async function deleteSupplier(id: string): Promise<void> {
  const db = await getDB();
  await (db as any).delete(STORES.SUPPLIERS, id);

  try {
    if (typeof navigator === 'undefined' || navigator.onLine) {
      await api.delete(`/suppliers/${id}`);
    }
  } catch {}
}
