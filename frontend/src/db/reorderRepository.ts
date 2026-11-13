/**
 * Re-order Sheet Repository
 * 
 * Manages daily BBQ orders, target stock par levels, and calculates
 * replenishment needs based on yesterday's unsold closing inventory.
 */

import { initDB, STORES } from './database';
import { getAllProducts } from './productRepository';
import { getActiveOrderItems } from './orderItemRepository';
import { getDailyClosingByDate, HISTORICAL_CLOSINGS } from './closingRepository';
import { api } from '../api/client';
import { addPendingMutation } from './mutationRepository';
import type { ReorderSheet, ReorderItem } from '../types/reorder';

// Default target par stock per product name (from business operational guidelines)
export const DEFAULT_TARGET_STOCKS: Record<string, number> = {
  'pork bbq': 30,
  'laman': 30,
  'tenga': 15,
  'isaw manok': 30,
  'isaw': 30,
  'dugo': 20,
  'bulaklak': 15,
  'bituka/tumbong': 15,
  'bituka': 15,
  'leeg': 10,
  'paa': 10,
  'atay': 10,
  'hotdog': 20,
  'suka': 1,
};

// Reseller / supplier unit prices
export const DEFAULT_RESELLER_PRICES: Record<string, number> = {
  'pork bbq': 15,
  'laman': 15,
  'tenga': 14,
  'isaw manok': 8,
  'isaw': 8,
  'dugo': 8,
  'bulaklak': 16,
  'atay': 14,
  'bituka/tumbong': 15,
  'bituka': 15,
  'leeg': 13,
  'paa': 10,
  'hotdog': 9,
  'suka': 50,
};

// Historical seed data from scripts/re_order.csv (starting Oct 19, 2026)
// prev_stock aligns 100% with Daily Closing's starting stock (PREV) for each date
export const HISTORICAL_REORDERS: Record<string, Partial<ReorderSheet>> = {
  '2026-10-19': {
    order_date: '2026-10-19',
    based_on_date: '2026-10-19',
    total_cost: 1188,
    items: [
      { product_id: 1, product_name: 'Pork BBQ', sku: 'BBQ-001', target_stock: 31, sold_qty: 12, unsold_qty: 19, prev_stock: 5, suggested_qty: 26, order_qty: 26, reseller_price: 15, total_cost: 390, unit: 'sticks' },
      { product_id: 2, product_name: 'Tenga', sku: 'BBQ-002', target_stock: 15, sold_qty: 9, unsold_qty: 6, prev_stock: 0, suggested_qty: 15, order_qty: 15, reseller_price: 14, total_cost: 210, unit: 'sticks' },
      { product_id: 3, product_name: 'Isaw Manok', sku: 'BBQ-003', target_stock: 30, sold_qty: 25, unsold_qty: 5, prev_stock: 0, suggested_qty: 30, order_qty: 30, reseller_price: 8, total_cost: 240, unit: 'sticks' },
      { product_id: 4, product_name: 'Dugo', sku: 'BBQ-004', target_stock: 20, sold_qty: 10, unsold_qty: 0, prev_stock: 0, suggested_qty: 20, order_qty: 10, reseller_price: 8, total_cost: 80, unit: 'sticks' },
      { product_id: 5, product_name: 'Bulaklak', sku: 'BBQ-005', target_stock: 15, sold_qty: 2, unsold_qty: 12, prev_stock: 0, suggested_qty: 15, order_qty: 15, reseller_price: 16, total_cost: 240, unit: 'sticks' },
      { product_id: 6, product_name: 'Atay', sku: 'BBQ-006', target_stock: 0, sold_qty: 0, unsold_qty: 0, prev_stock: 0, suggested_qty: 0, order_qty: 0, reseller_price: 14, total_cost: 0, unit: 'sticks' },
      { product_id: 7, product_name: 'Bituka/Tumbong', sku: 'BBQ-007', target_stock: 15, sold_qty: 15, unsold_qty: 0, prev_stock: 0, suggested_qty: 15, order_qty: 15, reseller_price: 15, total_cost: 225, unit: 'sticks' },
      { product_id: 10, product_name: 'Paa', sku: 'BBQ-010', target_stock: 10, sold_qty: 5, unsold_qty: 5, prev_stock: 0, suggested_qty: 10, order_qty: 10, reseller_price: 10, total_cost: 100, unit: 'sticks' },
      { product_id: 8, product_name: 'Hotdog', sku: 'BBQ-008', target_stock: 20, sold_qty: 12, unsold_qty: 8, prev_stock: 3, suggested_qty: 17, order_qty: 17, reseller_price: 9, total_cost: 153, unit: 'sticks' },
      { product_id: 11, product_name: 'Leeg', sku: 'BBQ-011', target_stock: 0, sold_qty: 0, unsold_qty: 10, prev_stock: 0, suggested_qty: 0, order_qty: 0, reseller_price: 13, total_cost: 0, unit: 'sticks' },
      { product_id: 9, product_name: 'Suka', sku: 'SUP-001', target_stock: 1, sold_qty: 0, unsold_qty: 1, prev_stock: 0, suggested_qty: 0, order_qty: 0, reseller_price: 50, total_cost: 0, unit: 'bottle' },
    ],
  },
  '2026-10-20': {
    order_date: '2026-10-20',
    based_on_date: '2026-10-19',
    total_cost: 937,
    items: [
      { product_id: 1, product_name: 'Pork BBQ', sku: 'BBQ-001', target_stock: 30, sold_qty: 12, unsold_qty: 7, prev_stock: 19, suggested_qty: 11, order_qty: 0, reseller_price: 15, total_cost: 0, unit: 'sticks' },
      { product_id: 2, product_name: 'Tenga', sku: 'BBQ-002', target_stock: 15, sold_qty: 9, unsold_qty: 6, prev_stock: 6, suggested_qty: 9, order_qty: 9, reseller_price: 14, total_cost: 126, unit: 'sticks' },
      { product_id: 3, product_name: 'Isaw Manok', sku: 'BBQ-003', target_stock: 30, sold_qty: 25, unsold_qty: 6, prev_stock: 5, suggested_qty: 25, order_qty: 25, reseller_price: 8, total_cost: 200, unit: 'sticks' },
      { product_id: 4, product_name: 'Dugo', sku: 'BBQ-004', target_stock: 20, sold_qty: 10, unsold_qty: 3, prev_stock: 0, suggested_qty: 20, order_qty: 10, reseller_price: 8, total_cost: 80, unit: 'sticks' },
      { product_id: 5, product_name: 'Bulaklak', sku: 'BBQ-005', target_stock: 15, sold_qty: 2, unsold_qty: 14, prev_stock: 12, suggested_qty: 3, order_qty: 3, reseller_price: 16, total_cost: 48, unit: 'sticks' },
      { product_id: 6, product_name: 'Atay', sku: 'BBQ-006', target_stock: 0, sold_qty: 0, unsold_qty: 0, prev_stock: 0, suggested_qty: 0, order_qty: 0, reseller_price: 14, total_cost: 0, unit: 'sticks' },
      { product_id: 7, product_name: 'Bituka/Tumbong', sku: 'BBQ-007', target_stock: 15, sold_qty: 15, unsold_qty: 1, prev_stock: 0, suggested_qty: 15, order_qty: 15, reseller_price: 15, total_cost: 225, unit: 'sticks' },
      { product_id: 11, product_name: 'Leeg', sku: 'BBQ-011', target_stock: 0, sold_qty: 0, unsold_qty: 4, prev_stock: 10, suggested_qty: 0, order_qty: 0, reseller_price: 13, total_cost: 0, unit: 'sticks' },
      { product_id: 10, product_name: 'Paa', sku: 'BBQ-010', target_stock: 10, sold_qty: 5, unsold_qty: 10, prev_stock: 5, suggested_qty: 5, order_qty: 5, reseller_price: 10, total_cost: 50, unit: 'sticks' },
      { product_id: 8, product_name: 'Hotdog', sku: 'BBQ-008', target_stock: 20, sold_qty: 12, unsold_qty: 12, prev_stock: 8, suggested_qty: 12, order_qty: 12, reseller_price: 9, total_cost: 108, unit: 'sticks' },
      { product_id: 9, product_name: 'Suka', sku: 'SUP-001', target_stock: 1, sold_qty: 0, unsold_qty: 1, prev_stock: 1, suggested_qty: 0, order_qty: 0, reseller_price: 50, total_cost: 0, unit: 'bottle' },
    ],
  },
};

/**
 * Get saved par target stocks from localStorage
 */
export function getSavedTargetStocks(): Record<string, number> {
  try {
    const raw = localStorage.getItem('pos_target_stocks');
    if (raw) return { ...DEFAULT_TARGET_STOCKS, ...JSON.parse(raw) };
  } catch (e) {
    console.warn('Failed to parse target stocks:', e);
  }
  return { ...DEFAULT_TARGET_STOCKS };
}

/**
 * Save user custom target stocks
 */
export function saveTargetStocks(targets: Record<string, number>): void {
  try {
    localStorage.setItem('pos_target_stocks', JSON.stringify(targets));
  } catch (e) {
    console.warn('Failed to save target stocks:', e);
  }
}

/**
 * Normalizes all items in a sheet so every item has a clean supplier_name
 * (Hotdog -> Meycauayan Public Market, BBQ/Suka -> BBQ-SUPPLIER(Saog))
 */
export function normalizeSheetItems(sheet: ReorderSheet): ReorderSheet {
  const items = (sheet.items || []).map(it => {
    const norm = it.product_name.toLowerCase().trim();
    const isHotdog = norm === 'hotdog';

    // Infer business_type
    let bType = it.business_type;
    if (!bType) {
      const cat = (it.category_name || '').toLowerCase();
      if (cat.includes('bigas') || cat.includes('rice')) bType = 'rice';
      else if (cat.includes('gulay') || cat.includes('veg')) bType = 'vegetables';
      else if (cat.includes('bbq') || cat.includes('inihaw') || cat.includes('barbeque')) bType = 'barbeque';
      else bType = 'groceries';
    }

    let supplierName = it.supplier_name;
    if (!supplierName || supplierName.trim().length === 0) {
      if (bType === 'rice') {
        supplierName = 'Intercity Bocaue Rice Trading';
      } else if (bType === 'vegetables') {
        supplierName = 'Balintawak / Meycauayan Bagsakan';
      } else if (bType === 'barbeque') {
        supplierName = isHotdog ? 'Meycauayan Public Market' : 'BBQ-SUPPLIER(Saog)';
      } else {
        supplierName = 'Puregold Wholesale Meycauayan';
      }
    } else if (supplierName.toLowerCase().includes('saog') || supplierName.toLowerCase().includes('bbq')) {
      supplierName = 'BBQ-SUPPLIER(Saog)';
    }

    return {
      ...it,
      item_type: it.item_type || 'product',
      business_type: bType,
      category_id: it.category_id ?? 1,
      category_name: it.category_name || 'General',
      unit: it.unit || (it.sell_by_weight ? 'kg' : (norm === 'suka' ? 'bottle' : 'sticks')),
      sell_by_weight: it.sell_by_weight ?? false,
      supplier_name: supplierName,
      prev_stock: it.prev_stock ?? it.unsold_qty ?? 0,
    };
  });

  return {
    ...sheet,
    items,
    total_quantity: items.reduce((s, it) => s + (Number(it.order_qty) || 0), 0),
    total_cost: items.reduce((s, it) => s + (Number(it.total_cost) || 0), 0),
  };
}

/**
 * Get a specific Reorder Sheet by order date
 */
export async function getReorderSheetByDate(date: string): Promise<ReorderSheet | null> {
  // 1. If online, check MySQL server API first so changes made on any device sync instantly
  try {
    if (typeof navigator === 'undefined' || navigator.onLine) {
      const res = await api.get<any>(`/reorders?date=${date}`);
      if (res && res.data) {
        const normalized = normalizeSheetItems(res.data);
        try {
          const db = await initDB();
          if (db.objectStoreNames.contains(STORES.REORDERS)) {
            await db.put(STORES.REORDERS, normalized);
          }
        } catch {}
        return normalized;
      }
    }
  } catch (err) {
    // Server 404 or network offline, proceed to local IndexedDB
  }

  // 2. Try IndexedDB
  try {
    const db = await initDB();
    if (db.objectStoreNames.contains(STORES.REORDERS)) {
      const existing = await db.getFromIndex(STORES.REORDERS, 'by-date', date);
      if (existing) return normalizeSheetItems(existing as ReorderSheet);
    }
  } catch (err) {
    console.warn('IndexedDB reorders lookup failed, checking localStorage/seed:', err);
  }

  // 2. Try localStorage fallback
  try {
    const local = localStorage.getItem(`pos_reorder_${date}`);
    if (local) return normalizeSheetItems(JSON.parse(local));
  } catch {}

  // 3. Try historical seed data
  if (HISTORICAL_REORDERS[date]) {
    const h = HISTORICAL_REORDERS[date];
    const rawItems = ((h.items || []) as ReorderItem[]).map(it => {
      const isHotdog = it.product_name.toLowerCase().trim() === 'hotdog';
      return {
        ...it,
        prev_stock: it.prev_stock ?? it.unsold_qty ?? 0,
        supplier_name: it.supplier_name || (isHotdog ? 'Meycauayan Public Market' : 'BBQ-SUPPLIER(Saog)'),
      };
    });
    const totalQty = rawItems.reduce((sum, it) => sum + (Number(it.order_qty) || 0), 0);
    const totalCost = rawItems.reduce((sum, it) => sum + (Number(it.total_cost) || 0), 0);
    const sheet: ReorderSheet = {
      id: `reorder-${date}`,
      order_date: date,
      based_on_date: h.based_on_date || getPreviousDate(date),
      status: 'ORDERED',
      supplier_name: 'BBQ-SUPPLIER(Saog)',
      items: rawItems,
      total_quantity: totalQty,
      total_cost: totalCost,
      created_at: `${date}T08:00:00.000Z`,
      updated_at: `${date}T08:00:00.000Z`,
    };
    return sheet;
  }

  return null;
}

/**
 * Calculate previous date (YYYY-MM-DD)
 */
export function getPreviousDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  // Use local date parts to avoid UTC offset shifting the date (e.g. PH = UTC+8)
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Retrieves the official starting / PREV stocks (yesterday's unsold) for any date.
 * This guarantees 100% synchronization between Daily Closing (PREV) and BBQ Re-order (Prev. Stocks).
 */
export async function getPrevStocksMap(date: string): Promise<Record<string, number>> {
  const prevMap: Record<string, number> = {};

  if (date <= '2026-10-19') {
    // Oct 19, 2026 (Go-live date): starting stocks from official Oct 19 closing base
    const oct19 = HISTORICAL_CLOSINGS['2026-10-19'];
    if (oct19 && oct19.items) {
      for (const it of oct19.items) {
        prevMap[it.product_name.toLowerCase().trim()] = it.prev_stock ?? 0;
      }
    }
    return prevMap;
  }

  // Any date after Oct 19: fetch yesterday's daily closing to get unsold sticks
  const prevDateStr = getPreviousDate(date);
  try {
    const prevClosing = await getDailyClosingByDate(prevDateStr);
    if (prevClosing && prevClosing.items) {
      for (const it of prevClosing.items) {
        prevMap[it.product_name.toLowerCase().trim()] = it.unsold_qty ?? 0;
      }
      return prevMap;
    }
  } catch (err) {
    console.warn(`Could not load daily closing for ${prevDateStr}:`, err);
  }

  // Fallback if yesterday's closing not found: check products
  try {
    const products = await getAllProducts();
    for (const p of products) {
      if (p.id === 999 || p.item_type === 'service' || p.item_type === 'supply') continue;
      const norm = p.name.toLowerCase().trim();
      prevMap[norm] = p.current_stock ?? p.initial_stock ?? 0;
    }
  } catch {}

  return prevMap;
}

/**
 * Generate a smart suggested re-order sheet for a given order date
 * Formula: Order Qty = Math.max(0, Target Stock - Prev Stocks from Yesterday)
 */
export async function generateSuggestedReorder(
  rawOrderDate: string,
  customBasedOnDate?: string,
  ignoreExisting: boolean = false
): Promise<ReorderSheet> {
  const orderDate = rawOrderDate < '2026-10-19' ? '2026-10-19' : rawOrderDate;
  const basedOnDate = customBasedOnDate || (orderDate <= '2026-10-19' ? '2026-10-19' : getPreviousDate(orderDate));

  // 1. Check if we already have an existing reorder sheet for this date
  if (!ignoreExisting) {
    const existing = await getReorderSheetByDate(orderDate);
    if (existing) {
      // Clean out any custom / open item anchor that might have slipped into drafts
      if (existing.items) {
        existing.items = existing.items.filter(
          it => it.product_id !== 999 && !it.product_name.toLowerCase().includes('custom / open')
        );
      }

      const allProds = await getAllProducts();
      const prodMap = new Map(allProds.map(p => [p.id, p]));
      const prodByName = new Map(allProds.map(p => [p.name.toLowerCase().trim(), p]));

      // Helper: get the effective lock status for a specific dept, checking dept_status first
      const getDeptLockStatus = (dept: string): string => {
        if (existing.dept_status && existing.dept_status[dept]) {
          return existing.dept_status[dept];
        }
        return existing.status || 'DRAFT';
      };

      // Helper: infer which dept an item belongs to from its business_type or category_name
      const inferDept = (it: ReorderItem): string => {
        if ((it as any).business_type) return (it as any).business_type;
        const cat = ((it as any).category_name || '').toLowerCase();
        if (cat.includes('bigas') || cat.includes('rice')) return 'rice';
        if (cat.includes('gulay') || cat.includes('veg')) return 'vegetables';
        if (cat.includes('bbq') || cat.includes('inihaw') || cat.includes('barbeque') ||
            cat.includes('pork') || cat.includes('chicken')) return 'barbeque';
        return 'groceries';
      };

      // If ANY dept is still DRAFT, fetch prevMap for those depts
      const hasAnyDraft = !existing.items.every(it => {
        const dept = inferDept(it);
        const st = getDeptLockStatus(dept);
        return st === 'RECEIVED' || st === 'LOCKED' || st === 'ORDERED';
      });
      const prevMap = hasAnyDraft ? await getPrevStocksMap(orderDate) : {};

      existing.items = existing.items.map(it => {
        const norm = it.product_name.toLowerCase().trim();
        const p = prodMap.get(it.product_id) || prodByName.get(norm);
        const dept = inferDept(it);
        const deptStatus = getDeptLockStatus(dept);
        const isLocked = deptStatus === 'RECEIVED' || deptStatus === 'LOCKED' || deptStatus === 'ORDERED';

        // For LOCKED departments: preserve all saved values — do NOT recalculate
        if (isLocked) {
          return {
            ...it,
            category_id: it.category_id ?? p?.category_id ?? 1,
            category_name: it.category_name ?? p?.category_name ?? 'Inihaw / BBQ',
            item_type: it.item_type ?? p?.item_type ?? 'product',
            business_type: it.business_type ?? (p as any)?.business_type,
            unit: it.unit ?? p?.unit ?? (it.sell_by_weight ? 'kg' : (norm === 'suka' ? 'bottle' : 'sticks')),
            sell_by_weight: it.sell_by_weight ?? p?.sell_by_weight ?? false,
            current_stock: p?.current_stock ?? it.current_stock ?? 0,
            min_stock_level: p?.low_stock_threshold ?? it.min_stock_level ?? 6,
            // Keep prev_stock, order_qty, etc. exactly as locked
          };
        }

        // For DRAFT departments: dynamically refresh prev_stock from yesterday's closing
        const accuratePrev = prevMap[norm] !== undefined ? prevMap[norm] : (it.prev_stock ?? 0);
        let suggested = 0;
        const isWeight = it.sell_by_weight ?? p?.sell_by_weight ?? false;
        if (isWeight) {
          suggested = Math.max(0, Number(((it.target_stock || 0) - (p?.current_stock ?? accuratePrev)).toFixed(2)));
        } else if (p?.low_stock_threshold && (p.current_stock ?? 0) > p.low_stock_threshold) {
          suggested = 0;
        } else {
          suggested = Math.max(0, (it.target_stock || 0) - accuratePrev);
        }
        return {
          ...it,
          category_id: it.category_id ?? p?.category_id ?? 1,
          category_name: it.category_name ?? p?.category_name ?? 'Inihaw / BBQ',
          item_type: it.item_type ?? p?.item_type ?? 'product',
          business_type: it.business_type ?? (p as any)?.business_type,
          unit: it.unit ?? p?.unit ?? (isWeight ? 'kg' : (norm === 'suka' ? 'bottle' : 'sticks')),
          sell_by_weight: isWeight,
          current_stock: p?.current_stock ?? it.current_stock ?? 0,
          min_stock_level: p?.low_stock_threshold ?? it.min_stock_level ?? 6,
          prev_stock: accuratePrev,
          unsold_qty: accuratePrev,
          suggested_qty: suggested,
        };
      });

      const userOrderItems = await getActiveOrderItems();
      if (userOrderItems.length > 0) {
        const existingNames = new Set(existing.items.map(it => it.product_name.toLowerCase().trim()));
        const missing: ReorderItem[] = [];
        for (const oi of userOrderItems) {
          if (!existingNames.has(oi.name.toLowerCase().trim())) {
            const normName = oi.name.toLowerCase().trim();
            const targetStock = oi.target_qty || 20;
            const isHotdog = normName === 'hotdog';
            const supName = oi.supplier_name || (isHotdog ? 'Meycauayan Public Market' : 'BBQ-SUPPLIER(Saog)');
            missing.push({
              product_id: -(existing.items.length + missing.length + 1),
              product_name: oi.name,
              sku: `OI-${oi.id.slice(0, 6).toUpperCase()}`,
              category_id: 1,
              category_name: 'Supplies',
              target_stock: targetStock,
              sold_qty: 0,
              unsold_qty: 0,
              prev_stock: 0,
              supplier_id: oi.supplier_id,
              supplier_name: supName,
              suggested_qty: targetStock,
              order_qty: 0,
              reseller_price: oi.cost_price > 0 ? oi.cost_price : (DEFAULT_RESELLER_PRICES[normName] ?? 15),
              total_cost: 0,
              unit: oi.unit || (normName === 'suka' ? 'bottle' : 'sticks'),
              notes: oi.notes,
            });
          }
        }
        if (missing.length > 0) {
          existing.items = [...existing.items, ...missing];
          existing.total_quantity = existing.items.reduce((s, it) => s + (Number(it.order_qty) || 0), 0);
          existing.total_cost = existing.items.reduce((s, it) => s + (Number(it.total_cost) || 0), 0);
        }
      }

      return normalizeSheetItems(existing);
    }
  }

  // 2. Fetch the official PREV stocks (identical to Daily Closing's starting stock)
  const prevMap = await getPrevStocksMap(orderDate);

  // 3. Build items from Master Products list (Centralized Source of Truth)
  const allProducts = await getAllProducts();
  const savedTargets = getSavedTargetStocks();
  const reorderItems: ReorderItem[] = [];

  const activeProducts = allProducts.filter(
    p => p.is_active && p.id !== 999 && p.item_type !== 'service'
  );

  if (activeProducts.length > 0) {
    for (const p of activeProducts) {
      const normName = p.name.toLowerCase().trim();
      const isWeight = p.sell_by_weight ?? (p.unit === 'kg' || normName.includes('gulay') || normName.includes('bigas'));
      const isRetail = !isWeight && (p.category_id !== 1 && !(p.category_name || '').toLowerCase().includes('inihaw') && !(p.category_name || '').toLowerCase().includes('bbq'));

      const defaultTarget = isWeight ? 5 : (isRetail ? (p.target_stock || 24) : 20);
      const targetStock = p.target_stock ?? savedTargets[normName] ?? defaultTarget;
      const prevStock = prevMap[normName] ?? (p.current_stock ?? 0);

      let suggestedQty = 0;
      if (isWeight) {
        suggestedQty = Math.max(0, Number((targetStock - (p.current_stock ?? prevStock)).toFixed(2)));
      } else if (isRetail) {
        const threshold = p.low_stock_threshold || 6;
        suggestedQty = (p.current_stock ?? 0) <= threshold ? Math.max(0, targetStock - (p.current_stock ?? 0)) : 0;
      } else {
        // Inihaw / BBQ
        suggestedQty = Math.max(0, targetStock - prevStock);
      }

      const resellerPrice = p.cost_price && p.cost_price > 0 ? Number(p.cost_price) : (DEFAULT_RESELLER_PRICES[normName] ?? 15);
      const isHotdog = normName === 'hotdog';
      const supplierName = p.supplier_name || (isHotdog ? 'Meycauayan Public Market' : 'BBQ-SUPPLIER(Saog)');

      reorderItems.push({
        product_id: p.id,
        product_name: p.name,
        sku: p.sku,
        item_type: p.item_type || 'product',
        business_type: p.business_type || 'groceries',
        category_id: p.category_id ?? 1,
        category_name: p.category_name || 'Inihaw / BBQ',
        target_stock: targetStock,
        sold_qty: 0,
        unsold_qty: prevStock,
        prev_stock: prevStock,
        current_stock: p.current_stock ?? 0,
        min_stock_level: p.low_stock_threshold ?? 6,
        sell_by_weight: isWeight,
        supplier_id: p.supplier_id ?? '',
        supplier_name: supplierName,
        suggested_qty: suggestedQty,
        order_qty: 0,
        reseller_price: resellerPrice,
        total_cost: 0,
        unit: p.unit || (isWeight ? 'kg' : (normName === 'suka' ? 'bottle' : 'sticks')),
      });
    }
  } else {
    // Fallback path: build from orderItems
    const userOrderItems = await getActiveOrderItems();
    for (const oi of userOrderItems) {
      const normName = oi.name.toLowerCase().trim();
      const targetStock = savedTargets[normName] ?? oi.target_qty;
      const prevStock = prevMap[normName] ?? 0;
      const suggestedQty = Math.max(0, targetStock - prevStock);

      reorderItems.push({
        product_id: -(reorderItems.length + 1),
        product_name: oi.name,
        sku: `OI-${oi.id.slice(0, 6).toUpperCase()}`,
        category_id: 1,
        category_name: oi.supplier_name || 'Supplier',
        target_stock: targetStock,
        sold_qty: 0,
        unsold_qty: prevStock,
        prev_stock: prevStock,
        supplier_id: oi.supplier_id,
        supplier_name: oi.supplier_name,
        suggested_qty: suggestedQty,
        order_qty: 0,
        reseller_price: oi.cost_price > 0 ? oi.cost_price : (DEFAULT_RESELLER_PRICES[normName] ?? 15),
        total_cost: 0,
        unit: oi.unit || 'sticks',
        notes: oi.notes,
      });
    }
  }

  const totalQty = reorderItems.reduce((sum, it) => sum + (Number(it.order_qty) || 0), 0);
  const totalCost = reorderItems.reduce((sum, it) => sum + (Number(it.total_cost) || 0), 0);

  const now = new Date().toISOString();
  return normalizeSheetItems({
    id: `reorder-${orderDate}`,
    order_date: orderDate,
    based_on_date: basedOnDate,
    status: 'DRAFT',
    supplier_name: 'BBQ-SUPPLIER(Saog)',
    items: reorderItems,
    total_quantity: totalQty,
    total_cost: totalCost,
    created_at: now,
    updated_at: now,
  });
}


/**
 * Save a reorder sheet to IndexedDB, localStorage, and attempt API sync
 */
export async function saveReorderSheet(sheet: ReorderSheet): Promise<void> {
  const updatedSheet = {
    ...sheet,
    updated_at: new Date().toISOString(),
    total_quantity: sheet.items.reduce((sum, it) => sum + (Number(it.order_qty) || 0), 0),
    total_cost: sheet.items.reduce((sum, it) => sum + (Number(it.total_cost) || 0), 0),
  };

  // 1. IndexedDB
  try {
    const db = await initDB();
    if (db.objectStoreNames.contains(STORES.REORDERS)) {
      await db.put(STORES.REORDERS, updatedSheet);
    }
  } catch (err) {
    console.warn('Failed to save reorder to IndexedDB:', err);
  }

  // 2. LocalStorage backup
  try {
    localStorage.setItem(`pos_reorder_${sheet.order_date}`, JSON.stringify(updatedSheet));
  } catch (err) {
    console.warn('Failed to save reorder to localStorage:', err);
  }

  // 3. Auto-save target stocks for future calculations
  const currentTargets = getSavedTargetStocks();
  for (const it of sheet.items) {
    if (it.target_stock !== undefined) {
      currentTargets[it.product_name.toLowerCase().trim()] = Number(it.target_stock) || 0;
    }
  }
  saveTargetStocks(currentTargets);

  // 4. Try API sync if server is reachable, otherwise queue mutation
  try {
    if (typeof navigator === 'undefined' || navigator.onLine) {
      await api.post('/reorders', updatedSheet);
    } else {
      throw new Error('Offline');
    }
  } catch {
    try {
      await addPendingMutation({
        entity: 'reorder',
        action: 'update',
        payload: updatedSheet,
      });
    } catch (mutErr) {
      console.warn('Failed to queue reorder mutation:', mutErr);
    }
  }
}

/**
 * Delete a reorder sheet
 */
export async function deleteReorderSheet(orderDate: string): Promise<void> {
  try {
    const db = await initDB();
    if (db.objectStoreNames.contains(STORES.REORDERS)) {
      await db.delete(STORES.REORDERS, `reorder-${orderDate}`);
    }
  } catch {}

  try {
    localStorage.removeItem(`pos_reorder_${orderDate}`);
  } catch {}

  try {
    if (typeof navigator === 'undefined' || navigator.onLine) {
      await api.delete(`/reorders/${orderDate}`);
    }
  } catch {}
}

/**
 * Get all saved reorder sheets
 */
export async function getAllReorderSheets(): Promise<ReorderSheet[]> {
  const map = new Map<string, ReorderSheet>();

  // 1. Seed historical
  for (const date of Object.keys(HISTORICAL_REORDERS)) {
    const h = HISTORICAL_REORDERS[date];
    const totalQty = (h.items || []).reduce((sum, it) => sum + (Number(it.order_qty) || 0), 0);
    const totalCost = (h.items || []).reduce((sum, it) => sum + (Number(it.total_cost) || 0), 0);
    map.set(date, {
      id: `reorder-${date}`,
      order_date: date,
      based_on_date: h.based_on_date || getPreviousDate(date),
      status: 'ORDERED',
      supplier_name: 'BBQ Supplier',
      items: (h.items || []) as ReorderItem[],
      total_quantity: totalQty,
      total_cost: totalCost,
      created_at: `${date}T08:00:00.000Z`,
      updated_at: `${date}T08:00:00.000Z`,
    });
  }

  // 2. Read IndexedDB
  try {
    const db = await initDB();
    if (db.objectStoreNames.contains(STORES.REORDERS)) {
      const records = (await db.getAll(STORES.REORDERS)) as ReorderSheet[];
      for (const r of records) {
        map.set(r.order_date, r);
      }
    }
  } catch (err) {
    console.warn('Could not read reorders from IndexedDB:', err);
  }

  return Array.from(map.values()).sort((a, b) => b.order_date.localeCompare(a.order_date));
}
