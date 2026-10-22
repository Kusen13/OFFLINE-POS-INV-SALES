/**
 * seedData.ts
 *
 * Seeds the database with default Suppliers and OrderItems on first run.
 * Runs ONCE — checks if OrderItems already exist before inserting anything.
 *
 * BBQ Items  → BBQ Supplier (Saog)
 * Hotdog     → Meycauayan Public Market
 */

import { getAllOrderItems, createOrderItem } from './orderItemRepository';
import { getDB, STORES } from './database';
import type { Supplier } from '../types/supplier';
import type { OrderItemFormData } from '../types/orderItem';

function uuid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

async function ensureSupplier(name: string, details: Partial<Supplier>): Promise<Supplier> {
  const db = await getDB();
  const existing = await (db as any).getAll(STORES.SUPPLIERS) as Supplier[];
  const normTarget = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const found = existing.find(s => s.name.toLowerCase().replace(/[^a-z0-9]/g, '') === normTarget);
  if (found) {
    if (found.name !== name) {
      found.name = name;
      await (db as any).put(STORES.SUPPLIERS, found);
    }
    return found;
  }

  const now = new Date().toISOString();
  const supplier: Supplier = {
    id: uuid(),
    name,
    contact_person: details.contact_person ?? '',
    phone: details.phone ?? '',
    address: details.address ?? '',
    email: details.email ?? '',
    notes: details.notes ?? '',
    is_active: true,
    created_at: now,
    updated_at: now,
  };
  await (db as any).put(STORES.SUPPLIERS, supplier);
  return supplier;
}

async function syncMasterProducts(bbqSid: string, bbqSname: string, meycSid: string, meycSname: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(STORES.PRODUCTS, 'readwrite');
  const existingProducts: any[] = await tx.store.getAll();

  const standardMenu = [
    { name: 'Pork BBQ', sku: 'BBQ-00001', category_name: 'Inihaw', cost: 15, selling: 20, target: 30, min: 5, unit: 'sticks', supplier_id: bbqSid, supplier_name: bbqSname, item_type: 'product' },
    { name: 'Tenga', sku: 'BBQ-00002', category_name: 'Inihaw', cost: 14, selling: 20, target: 15, min: 3, unit: 'sticks', supplier_id: bbqSid, supplier_name: bbqSname, item_type: 'product' },
    { name: 'Isaw Manok', sku: 'BBQ-00003', category_name: 'Inihaw', cost: 8, selling: 12, target: 30, min: 5, unit: 'sticks', supplier_id: bbqSid, supplier_name: bbqSname, item_type: 'product' },
    { name: 'Dugo', sku: 'BBQ-00004', category_name: 'Inihaw', cost: 8, selling: 12, target: 20, min: 3, unit: 'sticks', supplier_id: bbqSid, supplier_name: bbqSname, item_type: 'product' },
    { name: 'Bulaklak', sku: 'BBQ-00005', category_name: 'Inihaw', cost: 16, selling: 25, target: 15, min: 3, unit: 'sticks', supplier_id: bbqSid, supplier_name: bbqSname, item_type: 'product' },
    { name: 'Atay', sku: 'BBQ-00006', category_name: 'Inihaw', cost: 14, selling: 20, target: 10, min: 2, unit: 'sticks', supplier_id: bbqSid, supplier_name: bbqSname, item_type: 'product' },
    { name: 'Bituka/Tumbong', sku: 'BBQ-00007', category_name: 'Inihaw', cost: 15, selling: 20, target: 15, min: 3, unit: 'sticks', supplier_id: bbqSid, supplier_name: bbqSname, item_type: 'product' },
    { name: 'Paa', sku: 'BBQ-00009', category_name: 'Inihaw', cost: 10, selling: 15, target: 10, min: 2, unit: 'sticks', supplier_id: bbqSid, supplier_name: bbqSname, item_type: 'product' },
    { name: 'Leeg', sku: 'BBQ-00010', category_name: 'Inihaw', cost: 13, selling: 18, target: 10, min: 2, unit: 'sticks', supplier_id: bbqSid, supplier_name: bbqSname, item_type: 'product' },
    { name: 'Hotdog', sku: 'BBQ-00008', category_name: 'Inihaw', cost: 9, selling: 15, target: 20, min: 5, unit: 'pcs', supplier_id: meycSid, supplier_name: meycSname, item_type: 'product' },
    { name: 'Suka', sku: 'SUP-00001', category_name: 'Supplies', cost: 50, selling: 0, target: 1, min: 1, unit: 'bottle', supplier_id: bbqSid, supplier_name: bbqSname, item_type: 'supply' },
  ];

  let nextId = 1;
  if (existingProducts.length > 0) {
    const maxId = Math.max(...existingProducts.map(p => Number(p.id) || 0));
    nextId = maxId > 0 ? maxId + 1 : 1;
  }

  for (const item of standardMenu) {
    const norm = item.name.toLowerCase().trim();
    const found = existingProducts.find(p => {
      const pNorm = (p.name || '').toLowerCase().trim();
      return pNorm === norm || (norm.includes('pork') && pNorm.includes('bbq'));
    });

    if (found) {
      found.supplier_id = item.supplier_id;
      found.supplier_name = item.supplier_name;
      found.target_stock = found.target_stock || item.target;
      found.low_stock_threshold = found.low_stock_threshold || item.min;
      found.unit = found.unit || item.unit;
      if (!found.cost_price || found.cost_price === 0) {
        found.cost_price = item.cost;
      }
      await tx.store.put(found);
    } else {
      const newP = {
        id: nextId++,
        category_id: item.category_name === 'Supplies' ? 3 : 1,
        category_name: item.category_name,
        name: item.name,
        sku: item.sku,
        description: null,
        item_type: (item as any).item_type ?? 'product',
        cost_price: item.cost,
        selling_price: (item as any).item_type === 'supply' ? 0 : item.selling,
        current_stock: 0,
        low_stock_threshold: item.min,
        target_stock: item.target,
        unit: item.unit,
        supplier_id: item.supplier_id,
        supplier_name: item.supplier_name,
        image_path: null,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await tx.store.put(newP);
    }
  }

  await tx.done;
}

export async function seedDefaultData(): Promise<void> {
  try {
    // 1. Ensure suppliers exist with exact user-requested names
    const bbqSupplier = await ensureSupplier('BBQ-SUPPLIER(Saog)', {
      address: 'Saog, Marilao, Bulacan',
      notes: 'Delivery tuwing umaga bago mag-araw',
    });

    const meycSupplier = await ensureSupplier('Meycauayan Public Market', {
      address: 'Meycauayan Public Market, Bulacan',
      notes: 'Binibili ng hiwalay sa palengke (Hotdog)',
    });

    const bbqSid = bbqSupplier.id;
    const bbqSname = bbqSupplier.name;
    const meycSid = meycSupplier.id;
    const meycSname = meycSupplier.name;

    // 2. Sync Master Products in 'products' store
    await syncMasterProducts(bbqSid, bbqSname, meycSid, meycSname);

    const existing = await getAllOrderItems();

    // If items already exist, reconcile suppliers so BBQ+Suka belong to BBQ-SUPPLIER(Saog) and Hotdog belongs to Meycauayan Public Market
    if (existing.length > 0) {
      const db = await getDB();
      for (const it of existing) {
        const norm = it.name.toLowerCase().trim();
        let shouldUpdate = false;
        let targetSid = it.supplier_id;
        let targetSname = it.supplier_name;

        if (norm === 'hotdog') {
          if (targetSname !== meycSname) {
            targetSid = meycSid;
            targetSname = meycSname;
            shouldUpdate = true;
          }
        } else {
          // All BBQ items and Suka
          if (targetSname !== bbqSname) {
            targetSid = bbqSid;
            targetSname = bbqSname;
            shouldUpdate = true;
          }
        }

        if (shouldUpdate) {
          const updated = {
            ...it,
            supplier_id: targetSid,
            supplier_name: targetSname,
            updated_at: new Date().toISOString(),
          };
          await (db as any).put(STORES.ORDER_ITEMS, updated);
        }
      }
      return;
    }

    const items: OrderItemFormData[] = [
      // ── BBQ Supplier (Saog) ──────────────────────────────
      {
        name: 'Pork BBQ',
        supplier_id: bbqSid,
        supplier_name: bbqSname,
        unit: 'sticks',
        cost_price: 15,
        target_qty: 30,
        min_stock: 5,
        notes: 'Pangunahing BBQ stick',
        is_active: true,
      },
      {
        name: 'Tenga',
        supplier_id: bbqSid,
        supplier_name: bbqSname,
        unit: 'sticks',
        cost_price: 14,
        target_qty: 15,
        min_stock: 3,
        notes: '',
        is_active: true,
      },
      {
        name: 'Isaw Manok',
        supplier_id: bbqSid,
        supplier_name: bbqSname,
        unit: 'sticks',
        cost_price: 8,
        target_qty: 30,
        min_stock: 5,
        notes: '',
        is_active: true,
      },
      {
        name: 'Dugo',
        supplier_id: bbqSid,
        supplier_name: bbqSname,
        unit: 'sticks',
        cost_price: 8,
        target_qty: 20,
        min_stock: 3,
        notes: '',
        is_active: true,
      },
      {
        name: 'Bulaklak',
        supplier_id: bbqSid,
        supplier_name: bbqSname,
        unit: 'sticks',
        cost_price: 16,
        target_qty: 15,
        min_stock: 3,
        notes: '',
        is_active: true,
      },
      {
        name: 'Atay',
        supplier_id: bbqSid,
        supplier_name: bbqSname,
        unit: 'sticks',
        cost_price: 14,
        target_qty: 10,
        min_stock: 2,
        notes: '',
        is_active: true,
      },
      {
        name: 'Bituka/Tumbong',
        supplier_id: bbqSid,
        supplier_name: bbqSname,
        unit: 'sticks',
        cost_price: 15,
        target_qty: 15,
        min_stock: 3,
        notes: '',
        is_active: true,
      },
      {
        name: 'Leeg',
        supplier_id: bbqSid,
        supplier_name: bbqSname,
        unit: 'sticks',
        cost_price: 13,
        target_qty: 10,
        min_stock: 2,
        notes: '',
        is_active: true,
      },
      {
        name: 'Paa',
        supplier_id: bbqSid,
        supplier_name: bbqSname,
        unit: 'sticks',
        cost_price: 10,
        target_qty: 10,
        min_stock: 2,
        notes: '',
        is_active: true,
      },
      {
        name: 'Suka',
        supplier_id: bbqSid,
        supplier_name: bbqSname,
        unit: 'bottle',
        cost_price: 50,
        target_qty: 1,
        min_stock: 1,
        notes: 'Sukang maasim — per bottle',
        is_active: true,
      },

      // ── Meycauayan Public Market ─────────────────────────
      {
        name: 'Hotdog',
        supplier_id: meycSid,
        supplier_name: meycSname,
        unit: 'pcs',
        cost_price: 9,
        target_qty: 20,
        min_stock: 5,
        notes: 'Binibili sa palengke — hindi sa BBQ Supplier',
        is_active: true,
      },
    ];

    for (const item of items) {
      await createOrderItem(item);
    }

    console.info(`[Seed] ✅ Seeded ${items.length} OrderItems (BBQ Supplier: ${bbqSupplier.name}, Meycauayan: ${meycSupplier.name})`);
  } catch (err) {
    // Non-critical — just log and continue
    console.warn('[Seed] seedDefaultData failed (non-critical):', err);
  }
}
