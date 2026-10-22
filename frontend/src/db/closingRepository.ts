import { getDB, STORES } from './database';
import type { DailyClosing } from '../types/closing';
import type { PendingSale } from '../types/sale';
import { fetchDailyClosingByDate, saveDailyClosingApi, deleteDailyClosingApi } from '../api/endpoints';
import { addPendingMutation } from './mutationRepository';

// Historical seed data from oct_2026.csv (Locked official bases for Oct 19 & 20, active base for Oct 21)
export const HISTORICAL_CLOSINGS: Record<string, DailyClosing> = {
  '2026-10-19': {
    id: 'closing-2026-10-19',
    date: '2026-10-19',
    status: 'FINALIZED',
    total_prepared: 157,
    total_sold: 90,
    total_unsold: 66,
    total_spoilage: 1,
    total_spoilage_loss: 25,
    total_revenue: 1695,
    total_cogs: 1001,
    total_gross_profit: 694,
    opening_cash: 0,
    cash_sales: 1695,
    cash_expenses: 282,
    bills_allocation: 0,
    expected_cash_on_hand: 1413,
    actual_cash_on_hand: 1695,
    cash_discrepancy: 282,
    created_at: '2026-10-19T22:00:00.000Z',
    finalized_at: '2026-10-19T22:00:00.000Z',
    items: [
      { product_id: 31, product_name: 'Pork BBQ', sku: 'BBQ-00003', unit_cost: 15, selling_price: 25, prev_stock: 5, received_qty: 26, prepared_qty: 31, sold_qty: 12, unsold_qty: 19, spoilage_qty: 0, discrepancy: 0, spoilage_loss: 0, actual_revenue: 300, cogs: 180, gross_profit: 120 },
      { product_id: 32, product_name: 'Isaw Manok', sku: 'BBQ-00004', unit_cost: 8, selling_price: 15, prev_stock: 0, received_qty: 30, prepared_qty: 30, sold_qty: 25, unsold_qty: 5, spoilage_qty: 0, discrepancy: 0, spoilage_loss: 0, actual_revenue: 375, cogs: 200, gross_profit: 175 },
      { product_id: 33, product_name: 'Dugo', sku: 'BBQ-00005', unit_cost: 8, selling_price: 15, prev_stock: 0, received_qty: 10, prepared_qty: 10, sold_qty: 10, unsold_qty: 0, spoilage_qty: 0, discrepancy: 0, spoilage_loss: 0, actual_revenue: 150, cogs: 80, gross_profit: 70 },
      { product_id: 35, product_name: 'Bituka/Tumbong', sku: 'BBQ-00007', unit_cost: 15, selling_price: 20, prev_stock: 0, received_qty: 15, prepared_qty: 15, sold_qty: 15, unsold_qty: 0, spoilage_qty: 0, discrepancy: 0, spoilage_loss: 0, actual_revenue: 300, cogs: 225, gross_profit: 75 },
      { product_id: 36, product_name: 'Paa', sku: 'BBQ-00008', unit_cost: 10, selling_price: 20, prev_stock: 0, received_qty: 10, prepared_qty: 10, sold_qty: 5, unsold_qty: 5, spoilage_qty: 0, discrepancy: 0, spoilage_loss: 0, actual_revenue: 100, cogs: 50, gross_profit: 50 },
      { product_id: 37, product_name: 'Tenga', sku: 'BBQ-00009', unit_cost: 14, selling_price: 20, prev_stock: 0, received_qty: 15, prepared_qty: 15, sold_qty: 9, unsold_qty: 6, spoilage_qty: 0, discrepancy: 0, spoilage_loss: 0, actual_revenue: 180, cogs: 126, gross_profit: 54 },
      { product_id: 38, product_name: 'Hotdog', sku: 'BBQ-00010', unit_cost: 9, selling_price: 20, prev_stock: 3, received_qty: 17, prepared_qty: 20, sold_qty: 12, unsold_qty: 8, spoilage_qty: 0, discrepancy: 0, spoilage_loss: 0, actual_revenue: 240, cogs: 108, gross_profit: 132 },
      { product_id: 39, product_name: 'Bulaklak', sku: 'BBQ-00011', unit_cost: 16, selling_price: 25, prev_stock: 0, received_qty: 15, prepared_qty: 15, sold_qty: 2, unsold_qty: 12, spoilage_qty: 1, discrepancy: 0, spoilage_loss: 25, actual_revenue: 50, cogs: 32, gross_profit: 18 },
      { product_id: 40, product_name: 'Leeg', sku: 'BBQ-00012', unit_cost: 13, selling_price: 20, prev_stock: 0, received_qty: 10, prepared_qty: 10, sold_qty: 0, unsold_qty: 10, spoilage_qty: 0, discrepancy: 0, spoilage_loss: 0, actual_revenue: 0, cogs: 0, gross_profit: 0 },
      { product_id: 42, product_name: 'Atay', sku: 'BBQ-00014', unit_cost: 14, selling_price: 20, prev_stock: 0, received_qty: 0, prepared_qty: 0, sold_qty: 0, unsold_qty: 0, spoilage_qty: 0, discrepancy: 0, spoilage_loss: 0, actual_revenue: 0, cogs: 0, gross_profit: 0 },
      { product_id: 43, product_name: 'Suka', sku: 'BBQ-00015', unit_cost: 50, selling_price: 0, prev_stock: 0, received_qty: 0, prepared_qty: 1, sold_qty: 0, unsold_qty: 1, spoilage_qty: 0, discrepancy: 0, spoilage_loss: 0, actual_revenue: 0, cogs: 0, gross_profit: 0 },
    ],
  },
  '2026-10-20': {
    id: 'closing-2026-10-20',
    date: '2026-10-20',
    status: 'FINALIZED',
    total_prepared: 145,
    total_sold: 81,
    total_unsold: 64,
    total_spoilage: 0,
    total_spoilage_loss: 0,
    total_revenue: 1530,
    total_cogs: 930,
    total_gross_profit: 600,
    opening_cash: 1695,
    cash_sales: 1530,
    cash_expenses: 345,
    bills_allocation: 0,
    expected_cash_on_hand: 2880,
    actual_cash_on_hand: 2880,
    cash_discrepancy: 0,
    created_at: '2026-10-20T22:00:00.000Z',
    finalized_at: '2026-10-20T22:00:00.000Z',
    items: [
      { product_id: 31, product_name: 'Pork BBQ', sku: 'BBQ-00003', unit_cost: 15, selling_price: 25, prev_stock: 19, received_qty: 0, prepared_qty: 19, sold_qty: 12, unsold_qty: 7, spoilage_qty: 0, discrepancy: 0, spoilage_loss: 0, actual_revenue: 300, cogs: 180, gross_profit: 120 },
      { product_id: 32, product_name: 'Isaw Manok', sku: 'BBQ-00004', unit_cost: 8, selling_price: 15, prev_stock: 5, received_qty: 25, prepared_qty: 30, sold_qty: 24, unsold_qty: 6, spoilage_qty: 0, discrepancy: 0, spoilage_loss: 0, actual_revenue: 360, cogs: 192, gross_profit: 168 },
      { product_id: 33, product_name: 'Dugo', sku: 'BBQ-00005', unit_cost: 8, selling_price: 15, prev_stock: 0, received_qty: 10, prepared_qty: 10, sold_qty: 7, unsold_qty: 3, spoilage_qty: 0, discrepancy: 0, spoilage_loss: 0, actual_revenue: 105, cogs: 56, gross_profit: 49 },
      { product_id: 35, product_name: 'Bituka/Tumbong', sku: 'BBQ-00007', unit_cost: 15, selling_price: 20, prev_stock: 0, received_qty: 15, prepared_qty: 15, sold_qty: 14, unsold_qty: 1, spoilage_qty: 0, discrepancy: 0, spoilage_loss: 0, actual_revenue: 280, cogs: 210, gross_profit: 70 },
      { product_id: 36, product_name: 'Paa', sku: 'BBQ-00008', unit_cost: 10, selling_price: 20, prev_stock: 5, received_qty: 5, prepared_qty: 10, sold_qty: 0, unsold_qty: 10, spoilage_qty: 0, discrepancy: 0, spoilage_loss: 0, actual_revenue: 0, cogs: 0, gross_profit: 0 },
      { product_id: 37, product_name: 'Tenga', sku: 'BBQ-00009', unit_cost: 14, selling_price: 20, prev_stock: 6, received_qty: 9, prepared_qty: 15, sold_qty: 9, unsold_qty: 6, spoilage_qty: 0, discrepancy: 0, spoilage_loss: 0, actual_revenue: 180, cogs: 126, gross_profit: 54 },
      { product_id: 38, product_name: 'Hotdog', sku: 'BBQ-00010', unit_cost: 9, selling_price: 20, prev_stock: 8, received_qty: 12, prepared_qty: 20, sold_qty: 8, unsold_qty: 12, spoilage_qty: 0, discrepancy: 0, spoilage_loss: 0, actual_revenue: 160, cogs: 72, gross_profit: 88 },
      { product_id: 39, product_name: 'Bulaklak', sku: 'BBQ-00011', unit_cost: 16, selling_price: 25, prev_stock: 12, received_qty: 3, prepared_qty: 15, sold_qty: 1, unsold_qty: 14, spoilage_qty: 0, discrepancy: 0, spoilage_loss: 0, actual_revenue: 25, cogs: 16, gross_profit: 9 },
      { product_id: 40, product_name: 'Leeg', sku: 'BBQ-00012', unit_cost: 13, selling_price: 20, prev_stock: 10, received_qty: 0, prepared_qty: 10, sold_qty: 6, unsold_qty: 4, spoilage_qty: 0, discrepancy: 0, spoilage_loss: 0, actual_revenue: 120, cogs: 78, gross_profit: 42 },
      { product_id: 42, product_name: 'Atay', sku: 'BBQ-00014', unit_cost: 14, selling_price: 20, prev_stock: 0, received_qty: 0, prepared_qty: 0, sold_qty: 0, unsold_qty: 0, spoilage_qty: 0, discrepancy: 0, spoilage_loss: 0, actual_revenue: 0, cogs: 0, gross_profit: 0 },
      { product_id: 43, product_name: 'Suka', sku: 'BBQ-00015', unit_cost: 50, selling_price: 0, prev_stock: 1, received_qty: 0, prepared_qty: 1, sold_qty: 0, unsold_qty: 1, spoilage_qty: 0, discrepancy: 0, spoilage_loss: 0, actual_revenue: 0, cogs: 0, gross_profit: 0 },
    ],
  },
  '2026-10-21': {
    id: 'closing-2026-10-21',
    date: '2026-10-21',
    status: 'DRAFT',
    total_prepared: 64,
    total_sold: 0,
    total_unsold: 64,
    total_spoilage: 0,
    total_spoilage_loss: 0,
    total_revenue: 0,
    total_cogs: 0,
    total_gross_profit: 0,
    opening_cash: 2880,
    cash_sales: 0,
    cash_expenses: 0,
    bills_allocation: 0,
    expected_cash_on_hand: 2880,
    actual_cash_on_hand: 2880,
    cash_discrepancy: 0,
    created_at: '2026-10-21T06:00:00.000Z',
    items: [
      { product_id: 31, product_name: 'Pork BBQ', sku: 'BBQ-00003', unit_cost: 15, selling_price: 25, prev_stock: 7, received_qty: 0, prepared_qty: 7, sold_qty: 0, unsold_qty: 7, spoilage_qty: 0, discrepancy: 0, spoilage_loss: 0, actual_revenue: 0, cogs: 0, gross_profit: 0 },
      { product_id: 32, product_name: 'Isaw Manok', sku: 'BBQ-00004', unit_cost: 8, selling_price: 15, prev_stock: 6, received_qty: 0, prepared_qty: 6, sold_qty: 0, unsold_qty: 6, spoilage_qty: 0, discrepancy: 0, spoilage_loss: 0, actual_revenue: 0, cogs: 0, gross_profit: 0 },
      { product_id: 33, product_name: 'Dugo', sku: 'BBQ-00005', unit_cost: 8, selling_price: 15, prev_stock: 3, received_qty: 0, prepared_qty: 3, sold_qty: 0, unsold_qty: 3, spoilage_qty: 0, discrepancy: 0, spoilage_loss: 0, actual_revenue: 0, cogs: 0, gross_profit: 0 },
      { product_id: 35, product_name: 'Bituka/Tumbong', sku: 'BBQ-00007', unit_cost: 15, selling_price: 20, prev_stock: 1, received_qty: 0, prepared_qty: 1, sold_qty: 0, unsold_qty: 1, spoilage_qty: 0, discrepancy: 0, spoilage_loss: 0, actual_revenue: 0, cogs: 0, gross_profit: 0 },
      { product_id: 36, product_name: 'Paa', sku: 'BBQ-00008', unit_cost: 10, selling_price: 20, prev_stock: 10, received_qty: 0, prepared_qty: 10, sold_qty: 0, unsold_qty: 10, spoilage_qty: 0, discrepancy: 0, spoilage_loss: 0, actual_revenue: 0, cogs: 0, gross_profit: 0 },
      { product_id: 37, product_name: 'Tenga', sku: 'BBQ-00009', unit_cost: 14, selling_price: 20, prev_stock: 6, received_qty: 0, prepared_qty: 6, sold_qty: 0, unsold_qty: 6, spoilage_qty: 0, discrepancy: 0, spoilage_loss: 0, actual_revenue: 0, cogs: 0, gross_profit: 0 },
      { product_id: 38, product_name: 'Hotdog', sku: 'BBQ-00010', unit_cost: 9, selling_price: 20, prev_stock: 12, received_qty: 0, prepared_qty: 12, sold_qty: 0, unsold_qty: 12, spoilage_qty: 0, discrepancy: 0, spoilage_loss: 0, actual_revenue: 0, cogs: 0, gross_profit: 0 },
      { product_id: 39, product_name: 'Bulaklak', sku: 'BBQ-00011', unit_cost: 16, selling_price: 25, prev_stock: 14, received_qty: 0, prepared_qty: 14, sold_qty: 0, unsold_qty: 14, spoilage_qty: 0, discrepancy: 0, spoilage_loss: 0, actual_revenue: 0, cogs: 0, gross_profit: 0 },
      { product_id: 40, product_name: 'Leeg', sku: 'BBQ-00012', unit_cost: 13, selling_price: 20, prev_stock: 4, received_qty: 0, prepared_qty: 4, sold_qty: 0, unsold_qty: 4, spoilage_qty: 0, discrepancy: 0, spoilage_loss: 0, actual_revenue: 0, cogs: 0, gross_profit: 0 },
      { product_id: 42, product_name: 'Atay', sku: 'BBQ-00014', unit_cost: 14, selling_price: 20, prev_stock: 0, received_qty: 0, prepared_qty: 0, sold_qty: 0, unsold_qty: 0, spoilage_qty: 0, discrepancy: 0, spoilage_loss: 0, actual_revenue: 0, cogs: 0, gross_profit: 0 },
      { product_id: 43, product_name: 'Suka', sku: 'BBQ-00015', unit_cost: 50, selling_price: 0, prev_stock: 1, received_qty: 0, prepared_qty: 1, sold_qty: 0, unsold_qty: 1, spoilage_qty: 0, discrepancy: 0, spoilage_loss: 0, actual_revenue: 0, cogs: 0, gross_profit: 0 },
    ],
  },
};

/**
 * Synchronize all products in IndexedDB with a Daily Closing's items.
 * Uses both product_id and normalized product_name so all products match 100%.
 */
export async function syncCurrentStocksWithClosing(closing: DailyClosing): Promise<void> {
  if (!closing || !closing.items || closing.items.length === 0) return;
  const db = await getDB();
  const prodTx = db.transaction(STORES.PRODUCTS, 'readwrite');
  const allProds = await prodTx.store.getAll();
  let changed = false;

  for (const item of closing.items) {
    const normName = (item.product_name || '').toLowerCase().trim();
    // Available stock is unsold_qty (or prepared_qty - sold_qty - spoilage_qty)
    const expectedStock = Math.max(0, item.unsold_qty ?? (item.prepared_qty - (item.sold_qty || 0) - (item.spoilage_qty || 0)));

    const target = allProds.find(
      p => p.id === item.product_id || p.name.toLowerCase().trim() === normName
    );

    if (target && target.current_stock !== expectedStock) {
      target.current_stock = expectedStock;
      target.updated_at = new Date().toISOString();
      await prodTx.store.put(target);
      changed = true;
    }
  }

  await prodTx.done;

  if (changed && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('pos_inventory_updated'));
    try {
      const ch = new BroadcastChannel('pos_channel');
      ch.postMessage({ type: 'INVENTORY_UPDATED' });
      ch.close();
    } catch (_) {}
  }
}

export async function saveDailyClosing(closing: DailyClosing): Promise<void> {
  const db = await getDB();
  // 1. Save to local IndexedDB immediately
  await db.put(STORES.DAILY_CLOSINGS, closing);

  // 2. Synchronize current_stock with unsold_qty for the items in this closing
  await syncCurrentStocksWithClosing(closing);

  // 3. Sync to server in background if connected, else queue offline mutation
  try {
    await saveDailyClosingApi(closing);
  } catch (err) {
    try {
      await addPendingMutation({
        entity: 'daily_closing',
        action: 'update',
        payload: closing,
      });
    } catch (mutErr) {
      console.warn('Failed to queue daily closing mutation:', mutErr);
    }
  }
}

export async function getDailyClosingByDate(date: string): Promise<DailyClosing | undefined> {
  // Historical seed dates (Oct 19 & Oct 20) are permanently locked official bases
  if (date === '2026-10-19' || date === '2026-10-20') {
    return HISTORICAL_CLOSINGS[date];
  }

  const db = await getDB();

  // If online, check server first for latest closing (especially for today Oct 21)
  try {
    const res = await fetchDailyClosingByDate(date);
    if (res.success && res.data) {
      const serverClosing = res.data;
      const writeTx = db.transaction(STORES.DAILY_CLOSINGS, 'readwrite');
      await writeTx.store.put(serverClosing);
      return serverClosing;
    }
  } catch (err) {
    // Network offline or 404
  }

  // Fallback to local IndexedDB
  const tx = db.transaction(STORES.DAILY_CLOSINGS, 'readonly');
  const index = tx.store.index('by-date');
  const local = await index.get(date);

  if (local) {
    // Runtime safeguard: auto-correct prepared_qty if it drifted (e.g. from stale curStock)
    let corrected = false;
    const fixedItems = local.items?.map(it => {
      const correctPrep = (it.prev_stock ?? 0) + (it.received_qty ?? 0);
      if (it.prepared_qty !== correctPrep && local.status !== 'FINALIZED') {
        const correctUnsold = Math.max(0, correctPrep - (it.sold_qty ?? 0) - (it.spoilage_qty ?? 0));
        corrected = true;
        return { ...it, prepared_qty: correctPrep, unsold_qty: correctUnsold };
      }
      return it;
    }) ?? local.items;

    if (corrected && fixedItems) {
      const fixedClosing: DailyClosing = {
        ...local,
        items: fixedItems,
        total_prepared: fixedItems.reduce((s, i) => s + i.prepared_qty, 0),
        total_unsold:   fixedItems.reduce((s, i) => s + i.unsold_qty, 0),
        total_sold:     fixedItems.reduce((s, i) => s + (i.sold_qty ?? 0), 0),
      };
      const writeTx2 = db.transaction(STORES.DAILY_CLOSINGS, 'readwrite');
      await writeTx2.store.put(fixedClosing);
      await writeTx2.done;
      return fixedClosing;
    }

    return local;
  }

  // Fallback to seed for date if present (e.g. 2026-10-21 initial prepared basis)
  if (HISTORICAL_CLOSINGS[date]) {
    const seed = HISTORICAL_CLOSINGS[date];
    try {
      const writeTx = db.transaction(STORES.DAILY_CLOSINGS, 'readwrite');
      await writeTx.store.put(seed);
    } catch {}
    return seed;
  }

  return undefined;
}

export async function getAllDailyClosings(): Promise<DailyClosing[]> {
  const db = await getDB();
  const all = await db.getAll(STORES.DAILY_CLOSINGS);
  const map = new Map<string, DailyClosing>();

  // Add historical seeds
  for (const date of Object.keys(HISTORICAL_CLOSINGS)) {
    map.set(date, HISTORICAL_CLOSINGS[date]);
  }

  // Override with saved database records (except historical locked dates)
  for (const c of all) {
    if (c.date === '2026-10-19' || c.date === '2026-10-20') continue;
    map.set(c.date, c);
  }

  return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
}

export async function deleteDailyClosing(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORES.DAILY_CLOSINGS, id);

  try {
    await deleteDailyClosingApi(id);
  } catch (err) {
    console.warn('Could not delete closing on server:', err);
  }
}

/**
 * Automatically credit a POS sale to the matching date's Daily Closing draft.
 * Increments sold_qty, recalculates unsold_qty (prepared - sold - spoilage),
 * updates financial totals, and saves.
 */
export async function creditSaleToDailyClosing(sale: PendingSale): Promise<void> {
  const saleDate = sale.sold_at ? sale.sold_at.split('T')[0] : new Date().toISOString().split('T')[0];
  if (saleDate === '2026-10-19' || saleDate === '2026-10-20') return; // Do not touch locked historical dates

  const db = await getDB();
  const tx = db.transaction(STORES.DAILY_CLOSINGS, 'readonly');
  const index = tx.store.index('by-date');
  const closing = await index.get(saleDate);

  if (!closing || closing.status === 'FINALIZED') return;

  const items = [...closing.items];
  let changed = false;

  for (const sItem of sale.items) {
    const pId = sItem.product_id;
    const normName = (sItem.product_name || '').toLowerCase().trim();
    const target = items.find(
      it => it.product_id === pId || it.product_name.toLowerCase().trim() === normName
    );

    if (target) {
      target.sold_qty = (target.sold_qty || 0) + sItem.quantity;
      target.unsold_qty = Math.max(0, target.prepared_qty - target.sold_qty - target.spoilage_qty);
      target.actual_revenue = target.sold_qty * target.selling_price;
      target.cogs = target.sold_qty * target.unit_cost;
      target.gross_profit = target.actual_revenue - target.cogs;
      target.discrepancy = (target.sold_qty + target.unsold_qty + target.spoilage_qty) - target.prepared_qty;
      changed = true;
    }
  }

  if (changed) {
    const totalRev = items.reduce((s, i) => s + i.actual_revenue, 0);
    const updatedClosing: DailyClosing = {
      ...closing,
      items,
      total_prepared: items.reduce((s, i) => s + i.prepared_qty, 0),
      total_sold: items.reduce((s, i) => s + i.sold_qty, 0),
      total_unsold: items.reduce((s, i) => s + i.unsold_qty, 0),
      total_spoilage: items.reduce((s, i) => s + i.spoilage_qty, 0),
      total_revenue: totalRev,
      total_cogs: items.reduce((s, i) => s + i.cogs, 0),
      total_gross_profit: items.reduce((s, i) => s + i.gross_profit, 0),
      total_spoilage_loss: items.reduce((s, i) => s + i.spoilage_loss, 0),
      cash_sales: totalRev,
      expected_cash_on_hand: (closing.opening_cash || 0) + totalRev - (closing.cash_expenses || 0) - (closing.bills_allocation || 0),
      actual_cash_on_hand: (closing.actual_cash_on_hand !== undefined && closing.actual_cash_on_hand !== closing.expected_cash_on_hand)
        ? closing.actual_cash_on_hand
        : ((closing.opening_cash || 0) + totalRev - (closing.cash_expenses || 0) - (closing.bills_allocation || 0)),
    };
    await saveDailyClosing(updatedClosing);
  }
}
