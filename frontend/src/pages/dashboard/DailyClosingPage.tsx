import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { formatCurrency } from '../../utils/currency';
import { getTodayStr, getLocalDateStr, formatDate, formatDateTime, SYSTEM_START_DATE } from '../../utils/date';
import { getAllProducts, setProductStock, replaceAllProducts } from '../../db/productRepository';
import { getDailyClosingByDate, saveDailyClosing, deleteDailyClosing } from '../../db/closingRepository';
import { getAllSales } from '../../db/salesRepository';
import { getAllExpenses, saveLocalExpense, deleteLocalExpense } from '../../db/expenseRepository';
import { getDailyBillsTotalForDate } from '../../db/billsRepository';
import { getReorderSheetByDate } from '../../db/reorderRepository';
import { fetchSales, fetchProducts, createExpense, updateExpense, deleteExpense } from '../../api/endpoints';
import { addPendingMutation, removeMutationByTempId } from '../../db/mutationRepository';
import { getDebtPaymentsTotalForDate } from '../../db/customerRepository';
import type { DailyClosing, DailyClosingItem } from '../../types/closing';
import type { Expense } from '../../types/inventory';
import { getCategoryIcon, type BusinessType, type BusinessDepartment } from '../../types/product';
import { getAllBusinessDepartments } from '../../utils/businessStorage';
import { useSyncStore } from '../../features/sync/syncStore';
import { useAuthStore } from '../../features/security/authStore';
import { type RicePackagingFilter, RICE_PACKAGING_OPTIONS, matchRicePackaging } from '../../utils/ricePackaging';

function safeQty(val: number | string | undefined | null, isWeight = false): string {
  const n = parseFloat(String(val ?? 0)) || 0;
  if (isWeight) {
    return n.toFixed(3);
  }
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function DailyClosingPage() {
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = getTodayStr();
    return today < SYSTEM_START_DATE ? SYSTEM_START_DATE : today;
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [closing, setClosing] = useState<DailyClosing | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [priceEditId, setPriceEditId] = useState<number | null>(null);
  const [priceEditVal, setPriceEditVal] = useState('');
  const [isCashDrawerOpen, setIsCashDrawerOpen] = useState(false);
  const [showOpeningCashPrompt, setShowOpeningCashPrompt] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const isDirtyRef = useRef(false);
  isDirtyRef.current = isDirty;
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<number | null>(null);
  const [ricePackagingFilter, setRicePackagingFilter] = useState<RicePackagingFilter>('all');
  const [departments, setDepartments] = useState<BusinessDepartment[]>(() => getAllBusinessDepartments());
  const [selectedDept, setSelectedDept] = useState<BusinessType>('barbeque');

  useEffect(() => {
    const handleDeptUpdated = () => setDepartments(getAllBusinessDepartments());
    window.addEventListener('pos_departments_updated', handleDeptUpdated);
    return () => window.removeEventListener('pos_departments_updated', handleDeptUpdated);
  }, []);
  const { syncProducts, syncSales } = useSyncStore();

  const [storeSettings] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('pos_app_settings') || '{}');
    } catch {
      return {};
    }
  });

  const [isDenominationModalOpen, setIsDenominationModalOpen] = useState(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);

  // Drawer OPEX / Petty Cash states inside Daily Closing
  const [dayExpenseList, setDayExpenseList] = useState<(Expense & { is_pending?: boolean })[]>([]);
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [isExpenseDrawerExpanded, setIsExpenseDrawerExpanded] = useState(false);
  const [expenseForm, setExpenseForm] = useState({
    category: 'Supplies',
    description: '',
    amount: '',
    isDrawer: true,
  });
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [savingExpense, setSavingExpense] = useState(false);

  // Auth & Blind Count State
  const { isOwner, blindCountEnabled, hideCostFromCashier } = useAuthStore();
  const [hasRevealedBlindCount, setHasRevealedBlindCount] = useState(false);
  const isBlindActive = !isOwner && blindCountEnabled && !hasRevealedBlindCount;

  const [denominations, setDenominations] = useState({
    d1000: 0,
    d500: 0,
    d200: 0,
    d100: 0,
    d50: 0,
    d20: 0,
    c20: 0,
    c10: 0,
    c5: 0,
    c1: 0,
    looseCoins: 0,
  });

  // Sync denominations when closing is loaded or changed
  useEffect(() => {
    if (closing?.cash_denominations) {
      const cd = closing.cash_denominations as any;
      setDenominations({
        d1000: cd.d1000 ?? 0,
        d500: cd.d500 ?? 0,
        d200: cd.d200 ?? 0,
        d100: cd.d100 ?? 0,
        d50: cd.d50 ?? 0,
        d20: cd.d20 ?? 0,
        c20: cd.c20 ?? 0,
        c10: cd.c10 ?? 0,
        c5: cd.c5 ?? 0,
        c1: cd.c1 ?? 0,
        looseCoins: cd.looseCoins ?? cd.coins ?? 0,
      });
    }
  }, [closing?.cash_denominations]);

  const denomTotal = useMemo(() => {
    return (
      ((Number(denominations.d1000) || 0) * 1000) +
      ((Number(denominations.d500) || 0) * 500) +
      ((Number(denominations.d200) || 0) * 200) +
      ((Number(denominations.d100) || 0) * 100) +
      ((Number(denominations.d50) || 0) * 50) +
      ((Number(denominations.d20) || 0) * 20) +
      ((Number(denominations.c20) || 0) * 20) +
      ((Number(denominations.c10) || 0) * 10) +
      ((Number(denominations.c5) || 0) * 5) +
      ((Number(denominations.c1) || 0) * 1) +
      (Number(denominations.looseCoins) || 0)
    );
  }, [denominations]);

  const handleApplyDenominations = () => {
    if (!closing) return;
    const cleanTotal = denomTotal;
    setIsDirty(true);
    setClosing(prev => {
      if (!prev) return prev;
      const expected = prev.expected_cash_on_hand ?? 0;
      const discrepancy = cleanTotal - expected;
      return {
        ...prev,
        actual_cash_on_hand: cleanTotal,
        cash_discrepancy: discrepancy,
        cash_denominations: {
          d1000: Number(denominations.d1000) || 0,
          d500: Number(denominations.d500) || 0,
          d200: Number(denominations.d200) || 0,
          d100: Number(denominations.d100) || 0,
          d50: Number(denominations.d50) || 0,
          d20: Number(denominations.d20) || 0,
          c20: Number(denominations.c20) || 0,
          c10: Number(denominations.c10) || 0,
          c5: Number(denominations.c5) || 0,
          c1: Number(denominations.c1) || 0,
          looseCoins: Number(denominations.looseCoins) || 0,
          coins: ((Number(denominations.c20) || 0) * 20) +
                 ((Number(denominations.c10) || 0) * 10) +
                 ((Number(denominations.c5) || 0) * 5) +
                 ((Number(denominations.c1) || 0) * 1) +
                 (Number(denominations.looseCoins) || 0),
        } as any,
      };
    });
    setHasRevealedBlindCount(true);
    setIsDenominationModalOpen(false);
    setSuccessMsg(`✓ Matagumpay na nailapat ang bilang sa kaha: ${formatCurrency(cleanTotal)}`);
    setTimeout(() => setSuccessMsg(null), 3500);
  };

  const handleResetDenominations = () => {
    setDenominations({
      d1000: 0,
      d500: 0,
      d200: 0,
      d100: 0,
      d50: 0,
      d20: 0,
      c20: 0,
      c10: 0,
      c5: 0,
      c1: 0,
      looseCoins: 0,
    });
  };


  const nextDateStr = useMemo(() => {
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    return getLocalDateStr(d);
  }, [selectedDate]);

  // Unique categories from current closing items (filtered by selectedDept)
  const closingCategories = useMemo(() => {
    if (!closing || !closing.items) return [];
    const seen = new Map<number, { id: number; name: string; count: number }>();
    for (const it of closing.items) {
      const itDept = (it as any).business_type || 'groceries';
      if (itDept !== selectedDept) continue;
      const catId = (it as any).category_id ?? 1;
      const catName = (it as any).category_name || 'General';
      if (seen.has(catId)) {
        seen.get(catId)!.count++;
      } else {
        seen.set(catId, { id: catId, name: catName, count: 1 });
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [closing, selectedDept]);

  const activeCategory = useMemo(() => {
    if (categoryFilter === null) return null;
    return closingCategories.find(c => c.id === categoryFilter) || null;
  }, [closingCategories, categoryFilter]);

  const activeCatName = (activeCategory?.name ?? '').toLowerCase();
  const isPreparedFoodCategory = 
    selectedDept === 'barbeque' ||
    activeCatName.includes('inihaw') || 
    activeCatName.includes('bbq') || 
    activeCatName.includes('barbeque') ||
    activeCatName.includes('ulam') ||
    activeCatName.includes('luto') ||
    activeCatName.includes('cooked') ||
    activeCatName.includes('tinapay') ||
    activeCatName.includes('bakery') ||
    activeCatName.includes('bread');
  const isBbqCategory = isPreparedFoodCategory;

  // Items filtered strictly by Department, direct category selection, and Bigasan packaging filter
  const filteredItems = useMemo(() => {
    if (!closing || !closing.items) return [];
    return closing.items.filter(it => {
      const itDept = (it as any).business_type || 'groceries';
      if (itDept !== selectedDept) return false;
      if (categoryFilter !== null && categoryFilter !== undefined) {
        const catId = (it as any).category_id ?? 1;
        if (catId !== categoryFilter) return false;
      }
      if (selectedDept === 'rice' && ricePackagingFilter !== 'all') {
        if (!matchRicePackaging(it.product_name, it.unit, it.sell_by_weight, ricePackagingFilter)) {
          return false;
        }
      }
      return true;
    });
  }, [closing, selectedDept, categoryFilter, ricePackagingFilter]);

  const isWeightCategory = !isBbqCategory && (
    selectedDept === 'vegetables' ||
    selectedDept === 'rice' ||
    activeCatName.includes('gulay') ||
    activeCatName.includes('vegetable') ||
    activeCatName.includes('bigas') ||
    activeCatName.includes('rice') ||
    filteredItems.some(it => it.sell_by_weight)
  );

  const paginatedItems = useMemo(() => {
    if (pageSize >= 999) return filteredItems;
    const start = (currentPage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, currentPage, pageSize]);

  const totalPages = useMemo(() => {
    if (pageSize >= 999) return 1;
    return Math.ceil(filteredItems.length / pageSize) || 1;
  }, [filteredItems, pageSize]);

  // Load or initialize daily closing for selected date
  const loadClosingData = useCallback(async (date: string, forceRecalculate = false) => {
    setLoading(true);
    setSuccessMsg(null);
    setErrorMsg(null);
    setIsDirty(false);
    try {
      // 1. Check if we already have a saved closing (Draft or Finalized) for this date
      const existing = await getDailyClosingByDate(date);
      // If the closing has been officially FINALIZED, it is locked and should not change
      if (!forceRecalculate && existing && existing.status === 'FINALIZED') {
        let prods: any[] = [];
        try {
          prods = await getAllProducts();
        } catch (_) {}
        const prodById = new Map<number, any>(prods.map(p => [p.id, p]));
        const prodByName = new Map<string, any>(prods.map(p => [(p.name || '').toLowerCase().trim(), p]));

        const enrichedItems = (existing.items || []).map(it => {
          const p = prodById.get(it.product_id) || prodByName.get((it.product_name || '').toLowerCase().trim());
          return {
            ...it,
            category_id: it.category_id ?? p?.category_id ?? 1,
            category_name: it.category_name ?? (p as any)?.category_name ?? 'General',
            business_type: (it as any).business_type ?? (p as any)?.business_type ?? 'groceries',
            unit: it.unit ?? p?.unit ?? 'pcs',
            sell_by_weight: it.sell_by_weight ?? p?.sell_by_weight ?? false,
          };
        });

        const lockedClosing: DailyClosing = {
          ...existing,
          items: enrichedItems,
        };

        setClosing(lockedClosing);
        setLastSavedTime(
          (existing as any).updated_at
            ? new Date((existing as any).updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : null
        );
        setLoading(false);
        return;
      }

      // Map existing draft item inputs so user edits (prepared_qty, spoilage_qty, manual sold) are preserved
      // Map existing draft item inputs so user edits (prepared_qty, spoilage_qty, manual sold) are preserved
      const existingItemMap = new Map<number, DailyClosingItem>();
      const existingItemByName = new Map<string, DailyClosingItem>();
      if (existing && existing.items) {
        for (const it of existing.items) {
          if (it.product_id === 999 || (it.product_name && it.product_name.toLowerCase().includes('custom / open'))) {
            continue;
          }
          existingItemMap.set(it.product_id, it);
          if (it.product_name) {
            existingItemByName.set(it.product_name.toLowerCase().trim(), it);
          }
        }
      }

      // 2. Otherwise initialize from current products and sales
      let products = await getAllProducts();
      if (!products || products.length === 0) {
        try {
          const apiRes = await fetchProducts({ per_page: 500 });
          if (apiRes.data && apiRes.data.length > 0) {
            await replaceAllProducts(apiRes.data);
            products = apiRes.data;
          }
        } catch (_) {}
      }

      // Filter out non-inventory products (Custom / Open item anchor, services, supplies)
      products = products.filter(p => p.id !== 999 && p.item_type !== 'service' && p.item_type !== 'supply' && p.is_active !== false);
      
      // Fetch sales for this date to determine sold_qty per product, cash sales, and credit sales
      const salesQtyMap: Record<number, number> = {};
      const seenUuids = new Set<string>();
      let totalCreditSales = 0;
      let totalActualCashSales = 0;

      const isCreditSale = (sale: any) => {
        const pId = Number(sale.payment_method_id);
        const pName = (sale.payment_method_name || '').toLowerCase();
        return pId === 3 || pName.includes('utang') || pName.includes('credit');
      };

      // A. Fetch from server API
      try {
        const salesRes = await fetchSales({ date_from: date, date_to: date, per_page: 500, with_items: true });
        for (const sale of salesRes.data) {
          if (sale.uuid) seenUuids.add(sale.uuid);
          const saleAmt = Number(sale.total_amount) || 0;
          if (isCreditSale(sale)) {
            totalCreditSales += saleAmt;
          } else {
            totalActualCashSales += saleAmt;
          }
          if (sale.items && Array.isArray(sale.items)) {
            for (const item of sale.items) {
              salesQtyMap[item.product_id] = (salesQtyMap[item.product_id] || 0) + item.quantity;
            }
          }
        }
      } catch (serverErr) {
        console.warn('Could not fetch server sales:', serverErr);
      }

      // B. Also fetch from local IndexedDB (pending / offline sales)
      try {
        const localSales = await getAllSales();
        for (const sale of localSales) {
          const saleDate = sale.sold_at ? getLocalDateStr(sale.sold_at) : '';
          if (saleDate === date && (!sale.uuid || !seenUuids.has(sale.uuid))) {
            if (sale.uuid) seenUuids.add(sale.uuid);
            const saleAmt = Number(sale.total_amount) || 0;
            if (isCreditSale(sale)) {
              totalCreditSales += saleAmt;
            } else {
              totalActualCashSales += saleAmt;
            }
            if (sale.items && Array.isArray(sale.items)) {
              for (const item of sale.items) {
                salesQtyMap[item.product_id] = (salesQtyMap[item.product_id] || 0) + item.quantity;
              }
            }
          }
        }
      } catch (localErr) {
        console.warn('Could not fetch local sales:', localErr);
      }

      // Fetch yesterday's closing to pull leftover unsold as today's starting stock (prev_stock)
      const prevDateObj = new Date(date + 'T00:00:00');
      prevDateObj.setDate(prevDateObj.getDate() - 1);
      const prevDateStr = getLocalDateStr(prevDateObj);
      const prevClosing = await getDailyClosingByDate(prevDateStr);

      // Fetch Re-order Sheet for this date to automatically pull ordered replenishment (received_qty)
      const reorderMap: Record<string, number> = {};
      const reorderSheetMap: Record<string, any> = {};
      let isReorderLocked = false;
      try {
        const reorderSheet = await getReorderSheetByDate(date);
        if (reorderSheet) {
          // Check per-department lock status first; fall back to global status for backward-compat
          const deptStatus = reorderSheet.dept_status?.[selectedDept];
          const effectiveStatus = deptStatus ?? reorderSheet.status;
          isReorderLocked = effectiveStatus === 'ORDERED' || effectiveStatus === 'LOCKED' || effectiveStatus === 'RECEIVED';

          if (reorderSheet.items) {
            for (const it of reorderSheet.items) {
              // Only include items that belong to the currently-selected department
              const itDept: string = (it as any).business_type || (() => {
                const cat = ((it as any).category_name || '').toLowerCase();
                if (cat.includes('bigas') || cat.includes('rice')) return 'rice';
                if (cat.includes('gulay') || cat.includes('veg')) return 'vegetables';
                if (cat.includes('bbq') || cat.includes('inihaw') || cat.includes('barbeque') || cat.includes('pork') || cat.includes('chicken')) return 'barbeque';
                return 'groceries';
              })();
              if (itDept !== selectedDept) continue;
              const key = it.product_name.toLowerCase().trim();
              reorderMap[key] = (reorderMap[key] || 0) + (Number(it.order_qty) || 0);
              reorderSheetMap[key] = it;
            }
          }
        }
      } catch (reorderErr) {
        console.warn('Could not load reorder sheet for date:', reorderErr);
      }

      // Total POS sales recorded for today across all products
      const totalPosSoldToday = Object.values(salesQtyMap).reduce((a, b) => a + b, 0);

      // Live Sold Qty:
      // For October 19, 2026 (initial spreadsheet setup date before POS system was active),
      // preserve manual draft sold counts or fallback to reorder sheet.
      // For all other active dates, POS sales are the live source of truth.
      const isHistoricalSeedDate = date === '2026-10-19' || date === '2026-10-20';

      const items: DailyClosingItem[] = products.map(p => {
        const unitCost = Number(p.cost_price) || 0;
        const sellingPrice = Number(p.selling_price) || 0;
        const curStock = p.current_stock || 0;
        const posSold = salesQtyMap[p.id] || 0;
        const normName = p.name.toLowerCase().trim();
        const draft = existingItemMap.get(p.id) || existingItemByName.get(normName);
        const reorderIt = reorderSheetMap[normName];

        const defaultSold = (!isHistoricalSeedDate || totalPosSoldToday > 0)
          ? posSold
          : (draft?.sold_qty ?? reorderIt?.sold_qty ?? 0);
        const soldQty = draft?.sold_qty !== undefined ? draft.sold_qty : defaultSold;
        const spoilageQty = draft?.spoilage_qty ?? 0;

        // Pull yesterday's leftover unsold count if available
        // For system go-live date (Oct 19, 2026), there is no previous closing: starting stock is strictly the product's Initial Stock
        const prevItem = date === SYSTEM_START_DATE ? null : prevClosing?.items.find(
          it => it.product_id === p.id || it.product_name.toLowerCase().trim() === p.name.toLowerCase().trim()
        );
        const prevStock = prevItem ? prevItem.unsold_qty : ((p.initial_stock !== undefined && p.initial_stock !== null) ? p.initial_stock : curStock);

        // Received stock (inorder mula sa Re-order Sheet para sa araw na ito):
        const reorderedQty = reorderMap[normName] ?? 0;
        // Kapag naka-lock ang Re-order sheet, ito ang nagiging opisyal na batayan ng Ordered items (received_qty)
        // Kung walang naka-lock na reorder at hindi pa FINALIZED, default ay STRICTLY 0!
        const receivedQty = isReorderLocked
          ? reorderedQty
          : (existing && existing.status === 'FINALIZED' ? (draft?.received_qty ?? 0) : 0);

        // Prepared stock: preserve draft if user set it, else default to prevStock + receivedQty
        // For historical seed date (Oct 19), default to Re-order target_stock (Prep) if available
        // NOTE: Do NOT use curStock here — it creates a circular dependency where stale stock
        // values inflate the prepared count. The correct basis is always: prev unsold + ordered.
        const defaultPrepared = (isHistoricalSeedDate && reorderIt?.target_stock)
          ? reorderIt.target_stock
          : (prevStock + receivedQty);
        const preparedQty = draft?.prepared_qty !== undefined
          ? (isReorderLocked && draft.received_qty !== receivedQty
              ? Math.max(draft.prepared_qty, prevStock + receivedQty)
              : draft.prepared_qty)
          : defaultPrepared;

        // Unsold automatically computes: Prepared - Sold - Spoilage (or respects manual override)
        const unsoldQty = draft?.unsold_qty !== undefined
          ? draft.unsold_qty
          : Math.max(0, preparedQty - soldQty - spoilageQty);

        // Discrepancy: Accounted for (Sold + Unsold + Spoilage) vs Prepared
        const discrepancy = draft?.discrepancy ?? ((soldQty + unsoldQty + spoilageQty) - preparedQty);
        // Spoilage loss is based on Selling Price
        const spoilageLoss = spoilageQty * sellingPrice;
        const actualRevenue = soldQty * sellingPrice;
        const cogs = soldQty * unitCost;
        const grossProfit = actualRevenue - cogs;

        return {
          product_id: p.id,
          product_name: p.name,
          sku: p.sku,
          unit_cost: unitCost,
          selling_price: sellingPrice,
          prev_stock: prevStock,
          received_qty: receivedQty,
          prepared_qty: preparedQty,
          sold_qty: soldQty,
          unsold_qty: unsoldQty,
          spoilage_qty: spoilageQty,
          discrepancy,
          spoilage_loss: spoilageLoss,
          actual_revenue: actualRevenue,
          cogs,
          gross_profit: grossProfit,
          // Category/unit meta for category-aware rendering
          category_id:    (p as any).category_id   ?? 1,
          category_name:  (p as any).category_name || 'General',
          business_type:  (p as any).business_type || 'groceries',
          sell_by_weight: (p as any).sell_by_weight ?? false,
          unit:           (p as any).unit           ?? 'pcs',
        } as DailyClosingItem;

      });

      // C. Calculate Cash Drawer & On-Hand Reconciliation
      // 1. Opening Cash (Yesterday's ending cash or manual opening count)
      const openingCash = existing?.opening_cash ?? prevClosing?.actual_cash_on_hand ?? prevClosing?.expected_cash_on_hand ?? 0;

      // 2. Cash Expenses (OPEX) paid today
      let dayExpenses = 0;
      try {
        const allExp = await getAllExpenses();
        const currentExpList = allExp.filter(e => e.expense_date === date);
        setDayExpenseList(currentExpList);
        dayExpenses = currentExpList.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
      } catch (expErr) {
        console.warn('Could not fetch daily expenses:', expErr);
        setDayExpenseList([]);
      }

      // 3. Sinking Bills allocation today
      let dayBills = 0;
      try {
        dayBills = await getDailyBillsTotalForDate(date);
      } catch (billsErr) {
        console.warn('Could not fetch daily bills allocation:', billsErr);
      }
      // 4. Nakolektang Bayad sa Utang mula sa mga Suki ngayong araw (Debt Collections)
      let dayDebtCollections = 0;
      try {
        dayDebtCollections = await getDebtPaymentsTotalForDate(date);
      } catch (debtErr) {
        console.warn('Could not fetch debt payments for date:', debtErr);
      }

      const totalRev = items.reduce((s, i) => s + i.actual_revenue, 0);

      // Distinguish Cash Sales vs Credit (Pina-utang) Sales:
      const creditSales = existing && existing.status === 'FINALIZED'
        ? (existing.credit_sales ?? totalCreditSales)
        : totalCreditSales;

      const cashSales = existing && existing.status === 'FINALIZED'
        ? (existing.cash_sales ?? Math.max(0, totalRev - creditSales))
        : Math.max(0, totalRev - creditSales);

      const debtCollections = existing && existing.status === 'FINALIZED'
        ? (existing.debt_collections ?? dayDebtCollections)
        : dayDebtCollections;

      // Inaasahang Cash sa Kaha = Opening Cash + Cash Benta + Nakolektang Bayad sa Utang - Gastos - Bills
      const expectedCashOnHand = openingCash + cashSales + debtCollections - dayExpenses - dayBills;
      const actualCashOnHand = (existing && existing.status === 'FINALIZED')
        ? (existing.actual_cash_on_hand ?? expectedCashOnHand)
        : (existing?.actual_cash_on_hand !== undefined && existing.actual_cash_on_hand !== existing.expected_cash_on_hand
            ? existing.actual_cash_on_hand
            : expectedCashOnHand);
      const cashDiscrepancy = actualCashOnHand - expectedCashOnHand;

      const newClosing: DailyClosing = {
        id: `closing-${date}`,
        date,
        status: 'DRAFT',
        items,
        total_prepared: items.reduce((s, i) => s + i.prepared_qty, 0),
        total_sold: items.reduce((s, i) => s + i.sold_qty, 0),
        total_unsold: items.reduce((s, i) => s + i.unsold_qty, 0),
        total_spoilage: items.reduce((s, i) => s + i.spoilage_qty, 0),
        total_revenue: totalRev,
        total_cogs: items.reduce((s, i) => s + i.cogs, 0),
        total_gross_profit: items.reduce((s, i) => s + i.gross_profit, 0),
        total_spoilage_loss: items.reduce((s, i) => s + i.spoilage_loss, 0),
        // Cash Drawer Fields (with accurate Utang & Collections separation)
        opening_cash: openingCash,
        cash_sales: cashSales,
        credit_sales: creditSales,
        debt_collections: debtCollections,
        cash_expenses: dayExpenses,
        bills_allocation: dayBills,
        expected_cash_on_hand: expectedCashOnHand,
        actual_cash_on_hand: actualCashOnHand,
        cash_discrepancy: cashDiscrepancy,
        cash_denominations: existing?.cash_denominations,
        created_at: new Date().toISOString(),
      };

      setClosing(newClosing);

      // FIX #1: Auto-prompt opening cash if today's date AND opening_cash is 0 AND it's a new day (no sales yet)
      const isToday = date === getTodayStr();
      const isFirstTimeToday = !existing || existing.status === 'DRAFT';
      const hasZeroOpening = (openingCash === 0 && prevClosing === undefined);
      if (isToday && isFirstTimeToday && hasZeroOpening && newClosing.total_sold === 0) {
        setShowOpeningCashPrompt(true);
        setIsCashDrawerOpen(true); // Auto-open the cash drawer section
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load closing data');
    } finally {
      setLoading(false);
    }
  }, [selectedDept]);

  useEffect(() => {
    loadClosingData(selectedDate);
  }, [selectedDate, selectedDept, loadClosingData]);

  // Real-time synchronization: listen for POS transactions, Sync events, window focus, and cross-tab broadcasts
  useEffect(() => {
    let debounceTimer: any = null;
    const handlePosUpdate = () => {
      // Do not interrupt user while editing or typing numbers
      if (isDirtyRef.current) return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (!isDirtyRef.current) {
          loadClosingData(selectedDate);
        }
      }, 600);
    };

    // 1. Same-window custom events
    window.addEventListener('pos_sale_completed', handlePosUpdate);
    window.addEventListener('pos_sync_completed', handlePosUpdate);
    window.addEventListener('pos_reorder_saved', handlePosUpdate);
    window.addEventListener('pos_inventory_updated', handlePosUpdate);

    // 2. Cross-tab BroadcastChannel
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel('pos_channel');
      channel.onmessage = (event) => {
        if (
          event.data?.type === 'SALE_COMPLETED' ||
          event.data?.type === 'SYNC_COMPLETED' ||
          event.data?.type === 'REORDER_SAVED' ||
          event.data?.type === 'INVENTORY_UPDATED'
        ) {
          handlePosUpdate();
        }
      };
    } catch (_) {}

    return () => {
      clearTimeout(debounceTimer);
      window.removeEventListener('pos_sale_completed', handlePosUpdate);
      window.removeEventListener('pos_sync_completed', handlePosUpdate);
      window.removeEventListener('pos_reorder_saved', handlePosUpdate);
      window.removeEventListener('pos_inventory_updated', handlePosUpdate);
      if (channel) {
        channel.close();
      }
    };
  }, [selectedDate, loadClosingData]);

  // Debounced auto-save for drafts (saves 1.5s after user stops typing)
  useEffect(() => {
    if (
      !isDirty ||
      !closing ||
      closing.status === 'FINALIZED' ||
      closing.date === '2026-10-19' ||
      closing.date === '2026-10-20'
    ) return;

    const timer = setTimeout(async () => {
      try {
        await saveDailyClosing({ ...closing, status: 'DRAFT' });
        setIsDirty(false);
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setLastSavedTime(timeStr);
      } catch (err) {
        console.warn('Auto-save error:', err);
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, [closing, isDirty]);

  // Handle cash drawer updates (e.g. physical count or opening cash adjustment)
  const handleUpdateCashField = (field: 'opening_cash' | 'actual_cash_on_hand', val: number) => {
    if (!closing) return;
    const cleanVal = Math.max(0, val);
    setIsDirty(true);

    setClosing(prev => {
      if (!prev) return prev;
      const opening = field === 'opening_cash' ? cleanVal : (prev.opening_cash || 0);
      const actual = field === 'actual_cash_on_hand' ? cleanVal : (prev.actual_cash_on_hand ?? 0);
      const sales = prev.cash_sales ?? prev.total_revenue;
      const debtCol = prev.debt_collections || 0;
      const exp = prev.cash_expenses || 0;
      const bills = prev.bills_allocation || 0;

      const expected = opening + sales + debtCol - exp - bills;
      const discrepancy = actual - expected;

      return {
        ...prev,
        opening_cash: opening,
        expected_cash_on_hand: expected,
        actual_cash_on_hand: actual,
        cash_discrepancy: discrepancy,
      };
    });
  };

  const handleOpenNewExpense = () => {
    setEditingExpense(null);
    setExpenseForm({
      category: 'Supplies',
      description: '',
      amount: '',
      isDrawer: true,
    });
    setIsExpenseModalOpen(true);
  };

  const handleOpenEditExpense = (exp: Expense) => {
    setEditingExpense(exp);
    setExpenseForm({
      category: exp.category,
      description: exp.description.replace('[Petty Cash]', '').trim(),
      amount: String(exp.amount),
      isDrawer: exp.description.includes('[Petty Cash]') || !exp.description.includes('[Bulsa]'),
    });
    setIsExpenseModalOpen(true);
  };

  const handleSaveDrawerExpense = async () => {
    const amt = parseFloat(expenseForm.amount);
    if (isNaN(amt) || amt <= 0) {
      alert('Mangyaring maglagay ng wastong halaga para sa gastos.');
      return;
    }
    if (!expenseForm.description.trim()) {
      alert('Mangyaring ilagay ang detalye o deskripsyon ng gastos.');
      return;
    }

    setSavingExpense(true);
    try {
      const cleanDesc = expenseForm.description.replace('[Petty Cash]', '').replace('[Bulsa]', '').trim();
      const finalDesc = expenseForm.isDrawer ? `[Petty Cash] ${cleanDesc}` : cleanDesc;
      const expenseData = {
        category: expenseForm.category || 'Supplies',
        description: finalDesc,
        amount: amt,
        expense_date: selectedDate,
      };

      if (editingExpense) {
        if (editingExpense.id > 0) {
          try {
            await updateExpense(editingExpense.id, expenseData);
            await saveLocalExpense({ ...editingExpense, ...expenseData });
          } catch {
            await saveLocalExpense({ ...editingExpense, ...expenseData, is_pending: true });
            await addPendingMutation({
              entity: 'expense',
              action: 'update',
              payload: expenseData,
              entityId: editingExpense.id,
            });
          }
        } else {
          await saveLocalExpense({ ...editingExpense, ...expenseData, is_pending: true });
        }
      } else {
        try {
          const res = await createExpense(expenseData);
          if (res.data) {
            await saveLocalExpense(res.data);
          }
        } catch {
          const tempId = -Date.now();
          const newExp: Expense & { is_pending?: boolean } = {
            id: tempId,
            category: expenseData.category,
            description: expenseData.description,
            amount: expenseData.amount,
            expense_date: expenseData.expense_date,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            is_pending: true,
          };
          await saveLocalExpense(newExp);
          await addPendingMutation({
            entity: 'expense',
            action: 'create',
            payload: expenseData,
            tempId,
          });
        }
      }

      // Re-read expenses and update daily closing state
      const allExp = await getAllExpenses();
      const currentList = allExp.filter(e => e.expense_date === selectedDate);
      setDayExpenseList(currentList);
      const newExpensesTotal = currentList.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

      setClosing(prev => {
        if (!prev) return prev;
        const opening = prev.opening_cash || 0;
        const actual = prev.actual_cash_on_hand ?? 0;
        const sales = prev.cash_sales ?? prev.total_revenue;
        const debtCol = prev.debt_collections || 0;
        const bills = prev.bills_allocation || 0;
        const expected = opening + sales + debtCol - newExpensesTotal - bills;
        const discrepancy = actual - expected;
        return {
          ...prev,
          cash_expenses: newExpensesTotal,
          expected_cash_on_hand: expected,
          cash_discrepancy: discrepancy,
        };
      });

      setIsDirty(true);
      useSyncStore.getState().refreshCounts();
      setIsExpenseModalOpen(false);
      setEditingExpense(null);
      setExpenseForm({ category: 'Supplies', description: '', amount: '', isDrawer: true });
    } catch (err) {
      console.error('Save expense error:', err);
      alert('May problema sa pag-save ng gastos: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSavingExpense(false);
    }
  };

  const handleDeleteDrawerExpense = async (exp: Expense) => {
    const descDisplay = exp.description.replace('[Petty Cash]', '').trim();
    if (!window.confirm(`Sigurado ka bang nais mong tanggalin ang gastos na "${descDisplay}" (${formatCurrency(exp.amount)})?`)) {
      return;
    }

    try {
      if (exp.id > 0) {
        try {
          await deleteExpense(exp.id);
          await deleteLocalExpense(exp.id);
        } catch {
          await deleteLocalExpense(exp.id);
          await addPendingMutation({
            entity: 'expense',
            action: 'delete',
            payload: {},
            entityId: exp.id,
          });
        }
      } else {
        await deleteLocalExpense(exp.id);
        await removeMutationByTempId(exp.id);
      }

      const allExp = await getAllExpenses();
      const currentList = allExp.filter(e => e.expense_date === selectedDate);
      setDayExpenseList(currentList);
      const newExpensesTotal = currentList.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

      setClosing(prev => {
        if (!prev) return prev;
        const opening = prev.opening_cash || 0;
        const actual = prev.actual_cash_on_hand ?? 0;
        const sales = prev.cash_sales ?? prev.total_revenue;
        const debtCol = prev.debt_collections || 0;
        const bills = prev.bills_allocation || 0;
        const expected = opening + sales + debtCol - newExpensesTotal - bills;
        const discrepancy = actual - expected;
        return {
          ...prev,
          cash_expenses: newExpensesTotal,
          expected_cash_on_hand: expected,
          cash_discrepancy: discrepancy,
        };
      });

      setIsDirty(true);
      useSyncStore.getState().refreshCounts();
    } catch (err) {
      console.error('Delete expense error:', err);
      alert('Hindi ma-delete ang gastos: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  // Editable fields: Prev. Stocks, Prepared, Sold, Unsold/Natitira, Spoilage/Bawas
  const handleUpdateItem = (
    productId: number,
    field: 'received_qty' | 'prev_stock' | 'prepared_qty' | 'sold_qty' | 'unsold_qty' | 'spoilage_qty',
    rawVal: string | number
  ) => {
    if (!closing) return;
    // Use parseFloat for by-weight items, parseInt for piece-based items
    const item = closing.items.find(i => i.product_id === productId);
    const isWeight = item?.sell_by_weight ?? false;
    const val = typeof rawVal === 'number'
      ? rawVal
      : rawVal === ''
      ? 0
      : (isWeight ? parseFloat(rawVal) : parseInt(rawVal)) || 0;
    const cleanVal = Math.max(0, val);
    setIsDirty(true);

    setClosing(prev => {
      if (!prev) return prev;
      const updatedItems = prev.items.map(item => {
        if (item.product_id !== productId) return item;
        const updated = { ...item };

        if (field === 'received_qty') {
          updated.received_qty = cleanVal;
          updated.prepared_qty = updated.received_qty + updated.prev_stock;
          updated.unsold_qty = Math.max(0, updated.prepared_qty - updated.sold_qty - updated.spoilage_qty);
        } else if (field === 'prev_stock') {
          updated.prev_stock = cleanVal;
          updated.prepared_qty = updated.received_qty + updated.prev_stock;
          updated.unsold_qty = Math.max(0, updated.prepared_qty - updated.sold_qty - updated.spoilage_qty);
        } else if (field === 'prepared_qty') {
          updated.prepared_qty = cleanVal;
          updated.unsold_qty = Math.max(0, updated.prepared_qty - updated.sold_qty - updated.spoilage_qty);
        } else if (field === 'sold_qty') {
          updated.sold_qty = cleanVal;
          updated.actual_revenue = updated.sold_qty * updated.selling_price;
          updated.cogs = updated.sold_qty * updated.unit_cost;
          updated.gross_profit = updated.actual_revenue - updated.cogs;
          updated.unsold_qty = Math.max(0, updated.prepared_qty - updated.sold_qty - updated.spoilage_qty);
        } else if (field === 'spoilage_qty') {
          updated.spoilage_qty = cleanVal;
          updated.spoilage_loss = updated.spoilage_qty * updated.selling_price;
          updated.unsold_qty = Math.max(0, updated.prepared_qty - updated.sold_qty - updated.spoilage_qty);
        } else if (field === 'unsold_qty') {
          updated.unsold_qty = cleanVal;
        }

        const accountedFor = updated.sold_qty + updated.unsold_qty + updated.spoilage_qty;
        updated.discrepancy = accountedFor - updated.prepared_qty;

        return updated;
      });

      return {
        ...prev,
        items: updatedItems,
        total_prepared: updatedItems.reduce((s, i) => s + i.prepared_qty, 0),
        total_sold: updatedItems.reduce((s, i) => s + i.sold_qty, 0),
        total_unsold: updatedItems.reduce((s, i) => s + i.unsold_qty, 0),
        total_spoilage: updatedItems.reduce((s, i) => s + i.spoilage_qty, 0),
        total_revenue: updatedItems.reduce((s, i) => s + i.actual_revenue, 0),
        total_cogs: updatedItems.reduce((s, i) => s + i.cogs, 0),
        total_gross_profit: updatedItems.reduce((s, i) => s + i.gross_profit, 0),
        total_spoilage_loss: updatedItems.reduce((s, i) => s + i.spoilage_loss, 0),
      };
    });
  };

  // Inline price edit (for vegetables/bigas where price changes daily)
  const handleUpdateItemPrice = (productId: number, newPrice: number) => {
    if (!closing || newPrice <= 0) return;
    setIsDirty(true);
    setClosing(prev => {
      if (!prev) return prev;
      const updatedItems = prev.items.map(item => {
        if (item.product_id !== productId) return item;
        const updated = { ...item, selling_price: newPrice };
        updated.actual_revenue = updated.sold_qty * newPrice;
        updated.gross_profit   = updated.actual_revenue - updated.cogs;
        updated.spoilage_loss  = updated.spoilage_qty * newPrice;
        return updated;
      });
      return {
        ...prev,
        items: updatedItems,
        total_revenue:      updatedItems.reduce((s, i) => s + i.actual_revenue, 0),
        total_gross_profit: updatedItems.reduce((s, i) => s + i.gross_profit, 0),
        total_spoilage_loss:updatedItems.reduce((s, i) => s + i.spoilage_loss, 0),
      };
    });
    setPriceEditId(null);
  };

  // Explicitly save current draft to local IndexedDB and server
  const handleSaveDraft = async () => {
    if (!closing) return;
    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const draft: DailyClosing = {
        ...closing,
        status: 'DRAFT',
      };
      await saveDailyClosing(draft);
      setClosing(draft);
      setIsDirty(false);
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setLastSavedTime(timeStr);
      setSuccessMsg(`💾 Saved draft closing for ${selectedDate}! Local database updated.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save draft');
    } finally {
      setSaving(false);
    }
  };

  // Finalize closing & carry over unsold stock to current stock
  const handleFinalize = async () => {
    if (!closing) return;
    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const finalized: DailyClosing = {
        ...closing,
        status: 'FINALIZED',
        finalized_at: new Date().toISOString(),
      };

      // 1. Save closing record to IndexedDB & Server
      await saveDailyClosing(finalized);

      // 2. Set current stock for all products to unsold_qty (physical carry-over count) with audit trail log
      for (const item of closing.items) {
        try {
          await setProductStock(
            item.product_id,
            item.unsold_qty,
            `Daily Closing (${selectedDate}) Unsold Count Carryover`
          );
        } catch (stockErr) {
          console.warn(`Could not set stock for product ${item.product_name}:`, stockErr);
        }
      }

      setClosing(finalized);
      setIsDirty(false);
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setLastSavedTime(timeStr);
      setSuccessMsg(`✓ Shift finalized for ${selectedDate}! Leftover stock carried over to current inventory.`);

      // FIX #4: Auto-sync products + sales so all devices (phone) get updated stock immediately
      setTimeout(async () => {
        try {
          await syncProducts();
          await syncSales();
        } catch (syncErr) {
          console.warn('Post-finalize sync failed (will retry on next manual sync):', syncErr);
        }
      }, 800);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to finalize day closing');
    } finally {
      setSaving(false);
    }
  };

  // Re-open shift so user can edit or recalculate
  const handleReopen = async () => {
    if (!closing) return;
    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await deleteDailyClosing(closing.id);
      await loadClosingData(selectedDate, true);
      setSuccessMsg('🔓 Shift re-opened. You can now adjust unsold or spoilage counts and finalize again.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to re-open shift');
    } finally {
      setSaving(false);
    }
  };

  // Recalculate live sales
  const handleRecalculate = async () => {
    await loadClosingData(selectedDate, true);
    setSuccessMsg('🔄 Recalculated live sales for ' + selectedDate);
  };

  // 1-Click Copy Summary for Messenger / SMS
  const handleCopyDailySummary = () => {
    if (!closing) return;
    const dateFormatted = new Date(closing.date + 'T00:00:00').toLocaleDateString('tl-PH', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const diffText = (closing.cash_discrepancy ?? 0) === 0
      ? '✓ TUGMA / BALANSE (₱0.00)'
      : (closing.cash_discrepancy ?? 0) > 0
      ? `+₱${(closing.cash_discrepancy ?? 0).toFixed(2)} (SOBRA SA KAHA)`
      : `-₱${Math.abs(closing.cash_discrepancy ?? 0).toFixed(2)} (KULANG SA KAHA)`;

    let denomText = '';
    const cd = closing.cash_denominations as any;
    if (cd && (cd.d1000 || cd.d500 || cd.d200 || cd.d100 || cd.d50 || cd.d20 || cd.coins || cd.looseCoins)) {
      const lines: string[] = [];
      if (cd.d1000) lines.push(`  ₱1,000 × ${cd.d1000} = ₱${(cd.d1000 * 1000).toLocaleString('en-PH')}`);
      if (cd.d500)  lines.push(`  ₱500 × ${cd.d500} = ₱${(cd.d500 * 500).toLocaleString('en-PH')}`);
      if (cd.d200)  lines.push(`  ₱200 × ${cd.d200} = ₱${(cd.d200 * 200).toLocaleString('en-PH')}`);
      if (cd.d100)  lines.push(`  ₱100 × ${cd.d100} = ₱${(cd.d100 * 100).toLocaleString('en-PH')}`);
      if (cd.d50)   lines.push(`  ₱50 × ${cd.d50} = ₱${(cd.d50 * 50).toLocaleString('en-PH')}`);
      if (cd.d20)   lines.push(`  ₱20 × ${cd.d20} = ₱${(cd.d20 * 20).toLocaleString('en-PH')}`);
      const coinsTot = (cd.coins || 0) || (((cd.c20 || 0) * 20) + ((cd.c10 || 0) * 10) + ((cd.c5 || 0) * 5) + ((cd.c1 || 0) * 1) + (cd.looseCoins || 0));
      if (coinsTot > 0) lines.push(`  🪙 Barya: ₱${coinsTot.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`);
      if (lines.length > 0) {
        denomText = `\n----------------------------------------\n💵 BILANGAN NG KAHA (DENOMINATIONS):\n${lines.join('\n')}`;
      }
    }

    const profitSection = (!hideCostFromCashier || isOwner) ? `🥘 Puhunan (COGS): ₱${(closing.total_cogs || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
💵 Gross Profit: ₱${(closing.total_gross_profit || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
🗑️ Spoilage / Tapon: ₱${(closing.total_spoilage_loss || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })} (${closing.total_spoilage || 0} pcs)
⭐ Net Shift Income: ₱${netEstimatedProfit.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : `📦 Kabuuang Benta: ₱${(closing.total_revenue || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

    const text = `📊 BUOD NG BENTA (DAILY CLOSING)
Tindahan: ${storeSettings.store_name || 'AKING TINDAHAN'}
Petsa: ${dateFormatted}
----------------------------------------
💰 Gross Sales: ₱${(closing.total_revenue || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
📦 Nabentang Dami: ${closing.total_sold || 0} piraso / kilo
${profitSection}
----------------------------------------
💵 KAHA & CASH BREAKDOWN:
🪙 Panimulang Pondo: ₱${(closing.opening_cash || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
💸 Bawas Gastos sa Kaha: -₱${(closing.cash_expenses || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
= Net Starting Pondo: ₱${((closing.opening_cash || 0) - (closing.cash_expenses || 0)).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
💵 Benta sa Cash: ₱${((closing.cash_sales ?? closing.total_revenue) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
📒 Benta sa Utang (Credit): ₱${(closing.credit_sales || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
🤝 Nakolektang Bayad sa Utang: +₱${(closing.debt_collections || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
🎯 Bills / Hulog: -₱${(closing.bills_allocation || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
💰 Inaasahang Cash sa Kaha: ₱${(closing.expected_cash_on_hand || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
🪙 Aktwal na Bilang ng Cash: ₱${(closing.actual_cash_on_hand || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
⚖️ Status ng Kaha: ${diffText}${denomText}
----------------------------------------
✅ Katayuan: ${closing.status === 'FINALIZED' ? 'SARADO NA AT NA-REMIT NA' : 'DRAFT / BUKAS PA ANG SHIFT'}`;

    navigator.clipboard.writeText(text).then(() => {
      setSuccessMsg('✓ Na-kopya na ang Buod ng Benta para sa Messenger / SMS!');
      setTimeout(() => setSuccessMsg(null), 4000);
    }).catch(() => {
      alert('Hindi makopya sa clipboard. Paki-check ang clipboard permissions.');
    });
  };

  const netEstimatedProfit = useMemo(() => {
    if (!closing) return 0;
    return closing.total_gross_profit - closing.total_spoilage_loss;
  }, [closing]);

  const filteredMetrics = useMemo(() => {
    if (!closing) return { sales: 0, profit: 0 };
    if (categoryFilter === null) {
      return {
        sales: closing.total_revenue,
        profit: netEstimatedProfit,
      };
    }
    const sales = filteredItems.reduce((s, it) => s + it.actual_revenue, 0);
    const gross = filteredItems.reduce((s, it) => s + it.gross_profit, 0);
    const spoil = filteredItems.reduce((s, it) => s + it.spoilage_loss, 0);
    return {
      sales,
      profit: gross - spoil,
    };
  }, [closing, selectedDept, categoryFilter, filteredItems, netEstimatedProfit]);

  // FIX #5: Compute custom/open item revenue from local sales for the selected date
  const [customItemsRevenue, setCustomItemsRevenue] = useState(0);
  useEffect(() => {
    if (!closing) return;
    import('../../db/salesRepository').then(({ getAllSales }) => {
      getAllSales().then(sales => {
        const dayCustom = sales
          .filter(s => {
            const sDate = s.sold_at ? s.sold_at.slice(0, 10) : '';
            return sDate === closing.date;
          })
          .reduce((sum, s) => {
            const customItems = (s.items || []).filter(
              (it: any) => it.product_id === 999 || it.product_id < 0 || it.product_sku === 'CUSTOM'
            );
            return sum + customItems.reduce((s2: number, it: any) => s2 + ((it.unit_price || it.selling_price || 0) * (it.quantity || 1)), 0);
          }, 0);
        setCustomItemsRevenue(dayCustom);
      }).catch(() => {});
    }).catch(() => {});
  }, [closing?.date]);

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-1.5 sm:space-y-2 animate-fade-in">
      {/* Row 1: Header, Date, Status, and Action Buttons (No cut-offs on mobile) */}
      <div className="flex-shrink-0 flex items-center justify-between gap-1.5">
        {/* Left: Date & Status */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center gap-1 bg-surface-900 border border-surface-700/80 rounded-lg px-2 py-0.5 shadow-xs">
            <span className="text-[11px] text-surface-400">📅</span>
            <input
              type="date"
              value={selectedDate}
              min={SYSTEM_START_DATE}
              onChange={e => {
                const val = e.target.value;
                setSelectedDate(val < SYSTEM_START_DATE ? SYSTEM_START_DATE : val);
                setCurrentPage(1);
              }}
              className="text-xs bg-transparent text-surface-100 font-semibold cursor-pointer focus:outline-none w-26 sm:w-30"
            />
          </div>

          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap shadow-xs ${
            closing?.status === 'FINALIZED'
              ? 'bg-success-500/20 text-success-400 border-success-500/30'
              : 'bg-warning-500/20 text-warning-400 border-warning-500/30'
          }`}>
            {closing?.status === 'FINALIZED' ? '✓ Closed' : 'Draft'}
          </span>

          {isDirty ? (
            <span className="text-[10px] text-amber-400 font-bold animate-pulse hidden sm:inline">
              💾
            </span>
          ) : lastSavedTime ? (
            <span className="text-[10px] text-surface-500 hidden sm:inline" title="Last saved">
              ✓ {lastSavedTime}
            </span>
          ) : null}
        </div>

        {/* Right: Consolidated Action Buttons (Save, Finalize + Overflow menu) */}
        <div className="flex items-center gap-1 shrink-0 py-0.5 relative">
          {/* Quick Copy Summary Button */}
          <button
            type="button"
            onClick={handleCopyDailySummary}
            className="px-2 py-1 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 text-xs font-bold whitespace-nowrap shrink-0 shadow-xs transition-all cursor-pointer flex items-center gap-1 active:scale-95"
            title="Kopyahin ang Buod ng Benta para kay Boss (Messenger / SMS)"
          >
            <span>📲</span>
            <span className="hidden xs:inline">Buod kay Boss</span>
          </button>

          {closing?.status === 'FINALIZED' ? (
            <button
              type="button"
              onClick={handleReopen}
              disabled={saving}
              className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold whitespace-nowrap shrink-0 shadow-xs transition-all cursor-pointer flex items-center gap-1 active:scale-95"
              title="Unlock to edit counts"
            >
              <span>🔓</span>
              <span>{saving ? 'Opening...' : 'Re-open'}</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={saving || loading}
                className="px-2.5 py-1 rounded-lg bg-primary-600/20 hover:bg-primary-600/30 text-primary-300 border border-primary-500/40 text-xs font-bold whitespace-nowrap shrink-0 shadow-xs transition-all cursor-pointer flex items-center gap-1 active:scale-95"
                title="Save draft"
              >
                <span>💾</span>
                <span>{saving ? '...' : 'Save'}</span>
              </button>

              <button
                type="button"
                onClick={handleFinalize}
                disabled={saving || loading}
                className="px-2.5 py-1 rounded-lg bg-success-600 hover:bg-success-500 disabled:opacity-50 text-white text-xs font-bold whitespace-nowrap shrink-0 shadow-xs transition-all cursor-pointer flex items-center gap-1 active:scale-95"
                title="Finalize shift and carry over remaining stock"
              >
                <span>🔒</span>
                <span>{saving ? '...' : 'Finalize'}</span>
              </button>
            </>
          )}

          {/* More Actions Dropdown Menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsMoreMenuOpen(prev => !prev)}
              className="p-1 px-1.5 rounded-lg bg-surface-800 hover:bg-surface-700 text-surface-200 border border-surface-700 text-xs font-bold cursor-pointer transition-all active:scale-95 flex items-center"
              title="More Actions"
            >
              <span>⋯</span>
            </button>

            {isMoreMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setIsMoreMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-1 z-40 bg-surface-850 border border-surface-700/80 rounded-xl shadow-xl py-1 min-w-[155px] animate-fade-in text-xs">
                  <Link
                    to={`/reorder?date=${nextDateStr}`}
                    onClick={() => setIsMoreMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-surface-200 hover:bg-surface-700/60 font-semibold"
                  >
                    <span>📝</span>
                    <span>Re-order Sheet</span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => { setIsPrintModalOpen(true); setIsMoreMenuOpen(false); }}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 text-surface-200 hover:bg-surface-700/60 font-semibold cursor-pointer"
                  >
                    <span>🖨️</span>
                    <span>Print Z-Reading</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { handleCopyDailySummary(); setIsMoreMenuOpen(false); }}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 text-surface-200 hover:bg-surface-700/60 font-semibold cursor-pointer"
                  >
                    <span>📋</span>
                    <span>Copy Summary</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { handleRecalculate(); setIsMoreMenuOpen(false); }}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 text-surface-200 hover:bg-surface-700/60 font-semibold cursor-pointer border-t border-surface-700/40"
                  >
                    <span>🔄</span>
                    <span>Recalculate Sales</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {successMsg && (
        <div className="p-2 sm:p-2.5 rounded-xl bg-success-500/10 border border-success-500/30 text-success-400 text-xs flex items-center justify-between">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="text-success-400 hover:text-success-200 ml-2 cursor-pointer">✕</button>
        </div>
      )}

      {errorMsg && (
        <div className="p-2 sm:p-2.5 rounded-xl bg-danger-500/10 border border-danger-500/30 text-danger-400 text-xs flex items-center justify-between">
          <span>⚠️ {errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-danger-400 hover:text-danger-200 ml-2 cursor-pointer">✕</button>
        </div>
      )}

      {/* FIX #1: Opening Cash Prompt Banner — shows when no opening cash is set for today */}
      {showOpeningCashPrompt && closing && closing.status !== 'FINALIZED' && (closing.opening_cash ?? 0) === 0 && (
        <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-300 text-xs animate-fade-in">
          <span className="text-lg shrink-0">💰</span>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-amber-200">Mag-set ng Opening Cash para ngayon!</p>
            <p className="text-amber-400/80 text-[11px] mt-0.5">
              Ang "Opening Cash" ay ang pera sa kaha bago magsimula ang benta ngayon (hal. ₱500 na float). I-type ang halaga sa ibaba sa loob ng Cash Drawer section.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setShowOpeningCashPrompt(false); setIsCashDrawerOpen(true); }}
            className="shrink-0 px-2.5 py-1 rounded-lg bg-amber-500 text-surface-950 font-bold text-[11px] cursor-pointer hover:bg-amber-400 transition-colors active:scale-95 whitespace-nowrap"
          >
            I-set Ngayon ▸
          </button>
          <button
            type="button"
            onClick={() => setShowOpeningCashPrompt(false)}
            className="shrink-0 text-amber-500/60 hover:text-amber-300 cursor-pointer"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* Row 2: 4-Department Ribbon, Category Dropdown + Financial Summary Ribbon */}
      {closing && (
        <div className="flex-shrink-0 space-y-1">
          {/* Business Department Filter Ribbon */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-0.5">
            {departments.map(dept => {
              const isSelected = selectedDept === dept.id;
              return (
                <button
                  key={dept.id}
                  type="button"
                  onClick={() => {
                    setSelectedDept(dept.id);
                    setCategoryFilter(null);
                    setRicePackagingFilter('all');
                    setCurrentPage(1);
                  }}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-bold text-xs whitespace-nowrap transition-all cursor-pointer shadow-xs ${
                    isSelected
                      ? 'bg-primary-600 text-white shadow-primary-600/30 ring-1 ring-primary-500 scale-[1.02]'
                      : 'bg-surface-850 hover:bg-surface-800 text-surface-300 hover:text-surface-100 border border-surface-700/60'
                  }`}
                >
                  <span>{dept.icon}</span>
                  <span>{dept.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-1 p-1 px-2 rounded-xl bg-surface-900 border border-surface-700/60 text-xs shadow-xs">
            {/* Category Dropdown and Bigasan Packaging Dropdown on the left (Single Row) */}
            <div className="shrink-0 flex items-center gap-1.5 flex-nowrap overflow-x-auto no-scrollbar">
              <select
                value={categoryFilter ?? 'all'}
                onChange={e => {
                  setCategoryFilter(e.target.value === 'all' ? null : Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="px-2 py-0.5 rounded-lg bg-surface-800 border border-surface-700/80 text-surface-100 text-xs font-bold focus:outline-none focus:border-primary-500 cursor-pointer shadow-xs max-w-[145px] sm:max-w-xs truncate"
              >
                {closingCategories.length > 1 && <option value="all">🏷️ Lahat ng {departments.find(d => d.id === selectedDept)?.label || ''} Kategorya</option>}
                {closingCategories.map(cat => (
                  <option key={cat.id} value={cat.id}>
                    {getCategoryIcon(cat.name)} {cat.name} ({cat.count})
                  </option>
                ))}
              </select>

              {/* Bigasan (Rice) Packaging Filter Dropdown - Inlined */}
              {selectedDept === 'rice' && (
                <select
                  value={ricePackagingFilter}
                  onChange={e => {
                    setRicePackagingFilter(e.target.value as RicePackagingFilter);
                    setCurrentPage(1);
                  }}
                  className="px-2 py-0.5 rounded-lg bg-surface-800 border border-amber-600/60 text-amber-300 text-xs font-bold focus:outline-none focus:border-amber-500 cursor-pointer shadow-xs max-w-[130px] sm:max-w-xs truncate"
                  title="I-filter ayon sa Sukat / Packaging"
                >
                  {RICE_PACKAGING_OPTIONS.map(opt => (
                    <option key={opt.key} value={opt.key}>
                      {opt.icon} {opt.label}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Financial KPI Metrics */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 whitespace-nowrap text-[11px] sm:text-xs">
              <span className="text-surface-400">
                Sales: <strong className="text-surface-100 font-extrabold">{formatCurrency(filteredMetrics.sales)}</strong>
              </span>
              {(!hideCostFromCashier || isOwner) && (
                <>
                  <span className="text-surface-700">•</span>
                  <span className="text-surface-400">
                    Profit: <strong className="text-emerald-400 font-extrabold">{formatCurrency(filteredMetrics.profit)}</strong>
                  </span>
                </>
              )}
            </div>

            {/* Cash Drawer Quick Toggle Pill */}
            <div className="flex items-center shrink-0 ml-auto whitespace-nowrap">
              <button
                type="button"
                onClick={() => setIsCashDrawerOpen(prev => !prev)}
                className={`px-2 py-0.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1 cursor-pointer ${
                  isBlindActive
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                    : (closing.cash_discrepancy ?? 0) === 0
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30'
                    : (closing.cash_discrepancy ?? 0) > 0
                    ? 'bg-primary-500/20 text-primary-300 border-primary-500/40 hover:bg-primary-500/30'
                    : 'bg-danger-500/20 text-danger-300 border-danger-500/40 hover:bg-danger-500/30'
                }`}
                title="Toggle Cash Drawer breakdown"
              >
                <span>
                  {isBlindActive
                    ? '🔒 Count Drawer'
                    : (closing.cash_discrepancy ?? 0) === 0
                    ? '✓ Balanced'
                    : (closing.cash_discrepancy ?? 0) > 0
                    ? `+${formatCurrency(closing.cash_discrepancy || 0)}`
                    : formatCurrency(closing.cash_discrepancy || 0)}
                </span>
                <span className="text-[10px]">Drawer</span>
                <span className="text-[9px]">{isCashDrawerOpen ? '▲' : '▼'}</span>
              </button>
            </div>
          </div>

          {/* Collapsible 4-step drawer panel with Net Pondo and Expense Tracking */}
          {isCashDrawerOpen && (
            <div className="p-2 sm:p-2.5 rounded-xl border border-surface-700/50 bg-surface-950/70 animate-fade-in shadow-sm space-y-2">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5 sm:gap-2">
                {/* Step 1: Beginning Cash & Paid-Out Expenses */}
                <div className="p-1.5 sm:p-2 rounded-lg bg-surface-900 border border-surface-700/50 min-w-0 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] sm:text-[10px] text-amber-400 font-bold uppercase truncate">
                        1. Pondo (Opening Cash)
                      </span>
                      <button
                        type="button"
                        onClick={handleOpenNewExpense}
                        className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 font-bold border border-amber-500/40 cursor-pointer transition-all active:scale-95 flex items-center gap-0.5"
                        title="Magtala ng Gastos mula sa Kaha"
                      >
                        <span>+ 💸</span>
                        <span>Gastos</span>
                      </button>
                    </div>

                    {closing.status === 'FINALIZED' ? (
                      <p className="text-xs sm:text-sm font-extrabold text-surface-100 mt-0.5 truncate">
                        {formatCurrency(closing.opening_cash || 0)}
                      </p>
                    ) : (
                      <input
                        type="number"
                        min="0"
                        value={closing.opening_cash === 0 ? '' : closing.opening_cash}
                        placeholder="0"
                        onFocus={e => e.target.select()}
                        onClick={e => (e.target as HTMLInputElement).select()}
                        onChange={e => handleUpdateCashField('opening_cash', e.target.value === '' ? 0 : parseFloat(e.target.value) || 0)}
                        className="w-full mt-0.5 px-1.5 py-0.5 rounded bg-surface-800 border border-surface-700 text-surface-100 text-xs font-bold focus:border-amber-400 focus:outline-none"
                        title="Starting cash in drawer"
                      />
                    )}
                  </div>

                  {/* Deductions & Net Starting Pondo */}
                  <div className="mt-1 pt-1 border-t border-surface-800/80 space-y-0.5">
                    <div className="flex items-center justify-between text-[10px]">
                      <button
                        type="button"
                        onClick={() => setIsExpenseDrawerExpanded(p => !p)}
                        className="text-rose-400 hover:text-rose-300 font-bold flex items-center gap-1 cursor-pointer truncate"
                        title="I-click para makita ang listahan ng mga gastos"
                      >
                        <span>-{formatCurrency(closing.cash_expenses || 0)}</span>
                        <span className="text-[8px] bg-rose-500/20 px-1 py-0.2 rounded text-rose-300">
                          {dayExpenseList.length} {isExpenseDrawerExpanded ? '▲' : '▼'}
                        </span>
                      </button>
                      <span className="text-[9px] text-surface-400 shrink-0">Bawas Gastos</span>
                    </div>

                    <div className="flex items-center justify-between text-[10px] font-extrabold bg-surface-950/80 px-1.5 py-0.5 rounded border border-surface-800">
                      <span className="text-surface-400 text-[8px] uppercase tracking-tight">Net Pondo:</span>
                      <span className={(closing.opening_cash || 0) - (closing.cash_expenses || 0) >= 0 ? 'text-amber-300' : 'text-rose-400'}>
                        {formatCurrency((closing.opening_cash || 0) - (closing.cash_expenses || 0))}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Step 2: Today's Net Movement (Inflows from Sales & Debt) */}
                <div className="p-1.5 sm:p-2 rounded-lg bg-surface-900 border border-surface-700/50 min-w-0 flex flex-col justify-between">
                  <span className="text-[9px] sm:text-[10px] text-emerald-400 font-bold uppercase truncate">
                    2. Pasok mula Benta
                  </span>
                  <div className="flex items-center justify-between text-[11px] font-semibold mt-0.5">
                    <span className="text-emerald-400 truncate">+{formatCurrency(closing.cash_sales ?? closing.total_revenue)}</span>
                    <span className="text-[9px] text-surface-500 shrink-0 ml-1">Cash Benta</span>
                  </div>
                  {(closing.debt_collections || 0) > 0 ? (
                    <div className="flex items-center justify-between text-[10px] font-medium text-sky-400 mt-0.5">
                      <span className="truncate">+{formatCurrency(closing.debt_collections || 0)}</span>
                      <span className="text-[8px] text-sky-300/80 shrink-0 ml-1">Bayad Utang</span>
                    </div>
                  ) : null}
                  {(closing.credit_sales || 0) > 0 ? (
                    <div className="flex items-center justify-between text-[9px] text-surface-500 mt-0.5">
                      <span className="truncate">({formatCurrency(closing.credit_sales || 0)})</span>
                      <span className="text-[8px] text-surface-500 shrink-0 ml-1">Pina-utang</span>
                    </div>
                  ) : null}
                  {(closing.bills_allocation || 0) > 0 && (
                    <div className="flex items-center justify-between text-[9px] text-amber-400 mt-0.5">
                      <span className="truncate">-{formatCurrency(closing.bills_allocation || 0)}</span>
                      <span className="text-[8px] text-surface-500 shrink-0 ml-1">Bills Hulog</span>
                    </div>
                  )}
                  <span className="text-[8px] sm:text-[9px] text-surface-500 mt-0.5 block truncate">
                    Kabuuang pasok sa kaha
                  </span>
                </div>

                {/* Step 3: Expected Cash */}
                <div className="p-1.5 sm:p-2 rounded-lg bg-surface-900 border border-surface-700/50 min-w-0 flex flex-col justify-between">
                  <span className="text-[9px] sm:text-[10px] text-surface-400 font-semibold uppercase truncate">
                    3. Expected Cash
                  </span>
                  {isBlindActive ? (
                    <div className="my-auto py-1">
                      <p className="text-xs font-bold text-amber-300 flex items-center gap-1">
                        <span>🔒</span> <span>Blind Count</span>
                      </p>
                      <span className="text-[8px] text-surface-500 block">
                        Bilangin muna sa Step 4 bago ipakita
                      </span>
                    </div>
                  ) : (
                    <>
                      <p className="text-xs sm:text-base font-black text-surface-100 mt-0.5 truncate">
                        {formatCurrency(closing.expected_cash_on_hand || 0)}
                      </p>
                      <span className="text-[8px] sm:text-[9px] text-surface-500 mt-0.5 block truncate">
                        (Net Pondo + Benta)
                      </span>
                    </>
                  )}
                </div>

                {/* Step 4: Actual Physical Cash Count */}
                <div className="p-1.5 sm:p-2 rounded-lg bg-emerald-950/40 border border-emerald-500/40 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] sm:text-[10px] text-emerald-300 font-bold uppercase truncate">
                      4. Actual Count
                    </span>
                    <span className="text-[8px] text-emerald-400/80 hidden xs:inline">Counted</span>
                  </div>
                  {closing.status === 'FINALIZED' ? (
                    <p className="text-xs sm:text-sm font-black text-emerald-400 mt-0.5 truncate">
                      {formatCurrency(closing.actual_cash_on_hand || 0)}
                    </p>
                  ) : (
                    <input
                      type="number"
                      min="0"
                      value={closing.actual_cash_on_hand === 0 ? '' : closing.actual_cash_on_hand}
                      placeholder="0"
                      onFocus={e => e.target.select()}
                      onClick={e => (e.target as HTMLInputElement).select()}
                      onChange={e => handleUpdateCashField('actual_cash_on_hand', e.target.value === '' ? 0 : parseFloat(e.target.value) || 0)}
                      className="w-full mt-0.5 px-1.5 py-0.5 rounded bg-surface-900 border border-emerald-500/60 text-emerald-400 text-xs font-extrabold focus:border-emerald-400 focus:outline-none"
                      title="Actual counted cash in drawer tonight"
                    />
                  )}
                  <span className="text-[8px] sm:text-[9px] text-emerald-400/80 mt-0.5 block truncate">
                    Closing drawer total
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsDenominationModalOpen(true)}
                    className="mt-1 w-full flex items-center justify-center gap-1 py-0.5 px-1.5 rounded bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/50 text-[10px] font-bold transition-all cursor-pointer shadow-xs active:scale-95"
                    title="Denomination Counter"
                  >
                    <span>🧮</span>
                    <span>Count Drawer</span>
                  </button>
                  {isBlindActive && (closing.actual_cash_on_hand || 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => setHasRevealedBlindCount(true)}
                      className="mt-1 w-full py-0.5 px-1.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[9px] font-bold cursor-pointer transition-all active:scale-95 text-center"
                    >
                      👁️ Submit & Reveal Reconciliation
                    </button>
                  )}
                </div>
              </div>

              {/* Expandable Today's Drawer Expenses List */}
              {isExpenseDrawerExpanded && (
                <div className="p-2 sm:p-2.5 rounded-lg bg-surface-900/90 border border-surface-700/60 animate-fade-in space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm">💸</span>
                      <span className="text-xs font-bold text-surface-200">
                        Mga Gastos sa Kaha Ngayong Araw ({dayExpenseList.length})
                      </span>
                      <span className="text-xs font-extrabold text-rose-400 ml-1">
                        -{formatCurrency(closing.cash_expenses || 0)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleOpenNewExpense}
                      className="px-2 py-0.5 rounded bg-primary-600 hover:bg-primary-500 text-white text-[11px] font-bold cursor-pointer transition-all flex items-center gap-1"
                    >
                      <span>+</span>
                      <span>Magtala ng Gastos</span>
                    </button>
                  </div>

                  {dayExpenseList.length === 0 ? (
                    <div className="text-center py-3 text-surface-400 text-xs bg-surface-950/40 rounded border border-surface-800">
                      Walang naitalang gastos mula sa kaha ngayong araw.
                    </div>
                  ) : (
                    <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                      {dayExpenseList.map(exp => (
                        <div
                          key={exp.id}
                          className="flex items-center justify-between px-2 py-1 rounded bg-surface-800/60 border border-surface-700/40 text-xs hover:bg-surface-800 transition-colors"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-surface-700 text-surface-300 shrink-0">
                              {exp.category}
                            </span>
                            <span className="text-surface-200 font-medium truncate">
                              {exp.description.replace('[Petty Cash]', '').trim()}
                            </span>
                            {exp.description.includes('[Petty Cash]') ? (
                              <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold shrink-0 border border-amber-500/30">
                                💵 Kaha
                              </span>
                            ) : (
                              <span className="text-[9px] px-1 py-0.2 rounded bg-sky-500/20 text-sky-300 font-bold shrink-0 border border-sky-500/30">
                                💼 Bulsa
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0 ml-2">
                            <span className="font-bold text-rose-400">
                              -{formatCurrency(exp.amount)}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleOpenEditExpense(exp)}
                              className="text-surface-400 hover:text-primary-400 p-0.5 transition-colors cursor-pointer"
                              title="I-edit ang gastos"
                            >
                              ✏️
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteDrawerExpense(exp)}
                              className="text-surface-400 hover:text-rose-400 p-0.5 transition-colors cursor-pointer"
                              title="Tanggalin ang gastos"
                            >
                              🗑️
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Main Table Container (Pure Table - Fills 100% of remaining vertical screen height) */}
      <div className="flex-1 min-h-0 bg-surface-900 rounded-xl border border-surface-700/60 flex flex-col overflow-hidden shadow-sm">

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-3 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
          </div>
        ) : !closing || closing.items.length === 0 ? (
          <div className="text-center py-16">
            <span className="text-4xl mb-3 block">📋</span>
            <p className="text-surface-300 font-medium">No products available for closing</p>
          </div>
        ) : (
          /* Pure Table View: High-density data grid */
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
            {isBbqCategory ? (
              /* BARBEQUE / INIHAW TABLE (9-Column Layout with PREV column) */
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead className="sticky top-0 bg-surface-900 border-b border-surface-700/60 z-20 shadow-sm">
                  <tr>
                    <th className="px-2 py-1.5 text-[11px] font-bold text-surface-300 uppercase tracking-wider text-left min-w-[85px]">
                      PRODUCT
                    </th>
                    <th className="px-0.5 py-1.5 text-[11px] font-bold text-yellow-400 uppercase tracking-wider text-center min-w-[34px]" title="Natirang stocks mula kahapon (Yesterday's unsold)">
                      PREV
                    </th>
                    <th className="px-0.5 py-1.5 text-[11px] font-bold text-primary-300 uppercase tracking-wider text-center min-w-[34px]" title="Ordered mula sa Re-Order Sheet">
                      ORD
                    </th>
                    <th className="px-0.5 py-1.5 text-[11px] font-bold text-surface-200 uppercase tracking-wider text-center min-w-[36px]" title="Total Prepared = Prev + Ordered">
                      PREP
                    </th>
                    <th className="px-0.5 py-1.5 text-[11px] font-bold text-primary-400 uppercase tracking-wider text-center min-w-[34px]" title="Nabili mula sa POS">
                      SOLD
                    </th>
                    <th className="px-0.5 py-1.5 text-[11px] font-bold text-surface-200 uppercase tracking-wider text-center bg-surface-800/40 min-w-[36px]" title="Natirang sticks sa display tray">
                      TRAY
                    </th>
                    <th className="px-0.5 py-1.5 text-[11px] font-bold text-danger-300 uppercase tracking-wider text-center bg-danger-950/20 min-w-[34px]" title="Tapon o Spoilage">
                      SPOIL
                    </th>
                    <th className="px-0.5 py-1.5 text-[10px] font-bold text-surface-300 uppercase tracking-wider text-center min-w-[26px]" title="Discrepancy / Kulang o Sobra">
                      DISC
                    </th>
                    <th className="px-1.5 py-1.5 text-[11px] font-bold text-surface-300 uppercase tracking-wider text-right min-w-[48px]" title="Benta (Revenue) at Tubo (Gross Profit)">
                      TOTAL
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-700/30">
                  {paginatedItems.map(item => {
                    const isLocked = closing.status === 'FINALIZED';
                    return (
                      <tr key={item.product_id} className="hover:bg-surface-700/20 transition-colors">
                        {/* Product Name + Price */}
                        <td className="px-2 py-2 sm:py-2.5">
                          <p className="text-surface-100 font-semibold text-xs truncate max-w-[90px] sm:max-w-none">{item.product_name}</p>
                          <span className="text-amber-400 font-bold text-[10px]">{formatCurrency(item.selling_price)}</span>
                        </td>

                        {/* PREV — Yesterday's unsold (prev_stock) */}
                        <td className="px-0.5 py-2 sm:py-2.5 text-center text-xs font-bold text-yellow-400 whitespace-nowrap">
                          {isLocked ? (
                            safeQty(item.prev_stock)
                          ) : (
                            <input
                              type="number" min="0" step="1"
                              value={Number(item.prev_stock) === 0 ? '' : safeQty(item.prev_stock)}
                              placeholder="0"
                              onFocus={e => e.target.select()}
                              onClick={e => (e.target as HTMLInputElement).select()}
                              onChange={e => handleUpdateItem(item.product_id, 'prev_stock', e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                              className="w-9 sm:w-10 h-7 mx-auto px-0.5 py-0.5 text-center rounded bg-surface-800 border border-yellow-500/40 text-yellow-300 text-xs font-bold focus:border-yellow-400 focus:outline-none"
                            />
                          )}
                        </td>

                        {/* Ordered (received_qty) */}
                        <td className="px-0.5 py-2 sm:py-2.5 text-center text-xs font-semibold text-primary-300 whitespace-nowrap">
                          {isLocked ? (
                            safeQty(item.received_qty)
                          ) : (
                            <input
                              type="number" min="0" step="1"
                              value={Number(item.received_qty) === 0 ? '' : safeQty(item.received_qty)}
                              placeholder="0"
                              onFocus={e => e.target.select()}
                              onClick={e => (e.target as HTMLInputElement).select()}
                              onChange={e => handleUpdateItem(item.product_id, 'received_qty', e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                              className="w-9 sm:w-10 h-7 mx-auto px-0.5 py-0.5 text-center rounded bg-surface-800 border border-primary-500/40 text-primary-300 text-xs font-bold focus:border-primary-400 focus:outline-none"
                            />
                          )}
                        </td>

                        {/* Total Qty. Prepared (prepared_qty) */}
                        <td className="px-0.5 py-2 sm:py-2.5 text-center text-xs font-bold text-surface-100 whitespace-nowrap">
                          {isLocked ? (
                            safeQty(item.prepared_qty)
                          ) : (
                            <input
                              type="number" min="0" step="1"
                              value={Number(item.prepared_qty) === 0 ? '' : safeQty(item.prepared_qty)}
                              placeholder="0"
                              onFocus={e => e.target.select()}
                              onClick={e => (e.target as HTMLInputElement).select()}
                              onChange={e => handleUpdateItem(item.product_id, 'prepared_qty', e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                              className="w-10 sm:w-11 h-7 mx-auto px-0.5 py-0.5 text-center rounded bg-surface-800 border border-surface-600 text-surface-100 text-xs font-bold focus:border-surface-400 focus:outline-none"
                            />
                          )}
                        </td>

                        {/* Sold (sold_qty) */}
                        <td className="px-0.5 py-2 sm:py-2.5 text-center text-xs font-semibold text-primary-300 whitespace-nowrap">
                          {isLocked ? (
                            safeQty(item.sold_qty)
                          ) : (
                            <input
                              type="number" min="0" step="1"
                              value={Number(item.sold_qty) === 0 ? '' : safeQty(item.sold_qty)}
                              placeholder="0"
                              onFocus={e => e.target.select()}
                              onClick={e => (e.target as HTMLInputElement).select()}
                              onChange={e => handleUpdateItem(item.product_id, 'sold_qty', e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                              className="w-9 sm:w-10 h-7 mx-auto px-0.5 py-0.5 text-center rounded bg-surface-800 border border-primary-500/40 text-primary-300 text-xs font-bold focus:border-primary-400 focus:outline-none"
                            />
                          )}
                        </td>

                        {/* Unsold (Tray) (unsold_qty) */}
                        <td className="px-0.5 py-2 sm:py-2.5 text-center text-xs font-bold text-surface-100 whitespace-nowrap bg-surface-800/20">
                          {isLocked ? (
                            safeQty(item.unsold_qty)
                          ) : (
                            <input
                              type="number" min="0" step="1"
                              value={Number(item.unsold_qty) === 0 ? '' : safeQty(item.unsold_qty)}
                              placeholder="0"
                              onFocus={e => e.target.select()}
                              onClick={e => (e.target as HTMLInputElement).select()}
                              onChange={e => handleUpdateItem(item.product_id, 'unsold_qty', e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                              className="w-10 sm:w-11 h-7 mx-auto px-0.5 py-0.5 text-center rounded bg-surface-800 border border-surface-600 text-surface-100 text-xs font-bold focus:border-surface-400 focus:outline-none"
                            />
                          )}
                        </td>

                        {/* Spoilage (spoilage_qty) */}
                        <td className="px-0.5 py-2 sm:py-2.5 text-center text-xs font-semibold text-danger-400 whitespace-nowrap bg-danger-950/10">
                          {isLocked ? (
                            safeQty(item.spoilage_qty)
                          ) : (
                            <input
                              type="number" min="0" step="1"
                              value={Number(item.spoilage_qty) === 0 ? '' : safeQty(item.spoilage_qty)}
                              placeholder="0"
                              onFocus={e => e.target.select()}
                              onClick={e => (e.target as HTMLInputElement).select()}
                              onChange={e => handleUpdateItem(item.product_id, 'spoilage_qty', e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                              className="w-9 sm:w-10 h-7 mx-auto px-0.5 py-0.5 text-center rounded bg-surface-800 border border-danger-500/40 text-danger-300 text-xs font-bold focus:border-danger-400 focus:outline-none"
                            />
                          )}
                        </td>

                        {/* Disc. */}
                        <td className="px-0.5 py-2 sm:py-2.5 text-center text-xs whitespace-nowrap">
                          <span className={`px-1 py-0.5 rounded text-[10px] font-extrabold ${
                            item.discrepancy === 0
                              ? 'text-surface-500'
                              : item.discrepancy > 0
                              ? 'bg-primary-500/20 text-primary-300'
                              : 'bg-danger-500/20 text-danger-300'
                          }`}>
                            {item.discrepancy === 0 ? '0' : item.discrepancy > 0 ? `+${safeQty(item.discrepancy)}` : safeQty(item.discrepancy)}
                          </span>
                        </td>

                        {/* Total: Revenue (top) & Profit (bottom) */}
                        <td className="px-1 py-2 sm:py-2.5 text-right text-xs whitespace-nowrap">
                          <div className="font-bold text-surface-200">{formatCurrency(item.actual_revenue)}</div>
                          <div className="text-[10px] text-emerald-400 font-semibold leading-tight">+{formatCurrency(item.gross_profit)}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : isWeightCategory ? (
              /* BY-WEIGHT & PERISHABLES TABLE (9-Column Unified Layout with PREP) */
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead className="sticky top-0 bg-surface-900 border-b border-surface-700/60 z-20 shadow-sm">
                  <tr>
                    <th className="px-2 py-1.5 text-[11px] font-bold text-surface-300 uppercase tracking-wider text-left min-w-[85px]">
                      PRODUCT
                    </th>
                    <th className="px-0.5 py-1.5 text-[11px] font-bold text-yellow-400 uppercase tracking-wider text-center min-w-[36px]" title="Natirang stocks mula kahapon (Yesterday's unsold)">
                      PREV
                    </th>
                    <th className="px-0.5 py-1.5 text-[11px] font-bold text-primary-300 uppercase tracking-wider text-center min-w-[38px]" title="Inorder / Dumating na Restock">
                      ORD
                    </th>
                    <th className="px-0.5 py-1.5 text-[11px] font-bold text-surface-100 uppercase tracking-wider text-center min-w-[40px]" title="Total Prepared = Prev + Ordered">
                      PREP
                    </th>
                    <th className="px-0.5 py-1.5 text-[11px] font-bold text-primary-400 uppercase tracking-wider text-center min-w-[38px]" title="Nabili mula sa POS">
                      SOLD
                    </th>
                    <th className="px-0.5 py-1.5 text-[11px] font-bold text-surface-200 uppercase tracking-wider text-center bg-surface-800/40 min-w-[42px]" title="Kasalukuyang natirang stock">
                      REMAIN
                    </th>
                    <th className="px-0.5 py-1.5 text-[11px] font-bold text-danger-300 uppercase tracking-wider text-center bg-danger-950/20 min-w-[38px]" title="Tapon o Spoilage/Waste">
                      SPOIL
                    </th>
                    <th className="px-0.5 py-1.5 text-[10px] font-bold text-surface-300 uppercase tracking-wider text-center min-w-[28px]" title="Discrepancy / Kulang o Sobra">
                      DISC
                    </th>
                    <th className="px-1.5 py-1.5 text-[11px] font-bold text-surface-300 uppercase tracking-wider text-right min-w-[50px]" title="Benta (Revenue) at Tubo (Gross Profit)">
                      TOTAL
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-700/30">
                  {paginatedItems.map(item => {
                    const isLocked = closing.status === 'FINALIZED';
                    const unit = item.unit ?? 'kg';
                    const isItemWeight = item.sell_by_weight || unit === 'kg';
                    const isPriceEdit = priceEditId === item.product_id;
                    const stepVal = isItemWeight ? "0.001" : "1";

                    return (
                      <tr key={item.product_id} className="hover:bg-surface-700/20 transition-colors">
                        {/* Product Name + Price */}
                        <td className="px-2 py-2 sm:py-2.5">
                          <p className="text-surface-100 font-semibold text-xs truncate max-w-[90px] sm:max-w-none">{item.product_name}</p>
                          <div className="flex items-center gap-1 text-[10px] text-surface-400 mt-0.5">
                            {!isLocked ? (
                              isPriceEdit ? (
                                <input
                                  type="number" min="0" step="0.01"
                                  value={priceEditVal}
                                  autoFocus
                                  onChange={e => setPriceEditVal(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') handleUpdateItemPrice(item.product_id, parseFloat(priceEditVal) || 0);
                                    if (e.key === 'Escape') setPriceEditId(null);
                                  }}
                                  onBlur={() => handleUpdateItemPrice(item.product_id, parseFloat(priceEditVal) || 0)}
                                  className="w-14 text-center py-0.2 rounded bg-surface-700 border border-amber-500/60 text-amber-300 text-[10px] font-bold focus:outline-none"
                                />
                              ) : (
                                <button
                                  onClick={() => { setPriceEditId(item.product_id); setPriceEditVal(String(item.selling_price)); }}
                                  className="text-amber-400 font-bold hover:underline cursor-pointer"
                                  title="Click to edit selling price"
                                >
                                  {formatCurrency(item.selling_price)}/{unit} ✏️
                                </button>
                              )
                            ) : (
                              <span className="text-amber-400 font-bold">{formatCurrency(item.selling_price)}/{unit}</span>
                            )}
                          </div>
                        </td>

                        {/* PREV — Yesterday's unsold (prev_stock) */}
                        <td className="px-0.5 py-2 sm:py-2.5 text-center text-xs font-bold text-yellow-400 whitespace-nowrap">
                          {isLocked ? (
                            safeQty(item.prev_stock, isItemWeight)
                          ) : (
                            <input
                              type="number" min="0" step={stepVal}
                              value={Number(item.prev_stock) === 0 ? '' : safeQty(item.prev_stock, isItemWeight)}
                              placeholder="0"
                              onFocus={e => e.target.select()}
                              onClick={e => (e.target as HTMLInputElement).select()}
                              onChange={e => handleUpdateItem(item.product_id, 'prev_stock', e.target.value)}
                              className="w-10 sm:w-11 h-7 mx-auto px-0.5 py-0.5 text-center rounded bg-surface-800 border border-yellow-500/40 text-yellow-300 text-xs font-bold focus:border-yellow-400 focus:outline-none"
                            />
                          )}
                        </td>

                        {/* ORD — Restock / Ordered (received_qty) */}
                        <td className="px-0.5 py-2 sm:py-2.5 text-center text-xs font-semibold text-primary-300 whitespace-nowrap">
                          {isLocked ? (
                            safeQty(item.received_qty, isItemWeight)
                          ) : (
                            <input
                              type="number" min="0" step={stepVal}
                              value={Number(item.received_qty) === 0 ? '' : safeQty(item.received_qty, isItemWeight)}
                              placeholder="0"
                              onFocus={e => e.target.select()}
                              onClick={e => (e.target as HTMLInputElement).select()}
                              onChange={e => handleUpdateItem(item.product_id, 'received_qty', e.target.value)}
                              className="w-11 sm:w-12 h-7 mx-auto px-0.5 py-0.5 text-center rounded bg-surface-800 border border-primary-500/40 text-primary-300 text-xs font-bold focus:border-primary-400 focus:outline-none"
                            />
                          )}
                        </td>

                        {/* PREP — Total Prepared = Prev + Ordered */}
                        <td className="px-0.5 py-2 sm:py-2.5 text-center text-xs font-bold text-surface-100 whitespace-nowrap">
                          {isLocked ? (
                            safeQty(item.prepared_qty, isItemWeight)
                          ) : (
                            <input
                              type="number" min="0" step={stepVal}
                              value={Number(item.prepared_qty) === 0 ? '' : safeQty(item.prepared_qty, isItemWeight)}
                              placeholder="0"
                              onFocus={e => e.target.select()}
                              onClick={e => (e.target as HTMLInputElement).select()}
                              onChange={e => handleUpdateItem(item.product_id, 'prepared_qty', e.target.value)}
                              className="w-11 sm:w-12 h-7 mx-auto px-0.5 py-0.5 text-center rounded bg-surface-800 border border-surface-600 text-surface-100 text-xs font-bold focus:border-surface-400 focus:outline-none"
                            />
                          )}
                        </td>

                        {/* Sold (sold_qty) */}
                        <td className="px-0.5 py-2 sm:py-2.5 text-center text-xs font-semibold text-primary-300 whitespace-nowrap">
                          {isLocked ? (
                            safeQty(item.sold_qty, isItemWeight)
                          ) : (
                            <input
                              type="number" min="0" step={stepVal}
                              value={Number(item.sold_qty) === 0 ? '' : safeQty(item.sold_qty, isItemWeight)}
                              placeholder="0"
                              onFocus={e => e.target.select()}
                              onClick={e => (e.target as HTMLInputElement).select()}
                              onChange={e => handleUpdateItem(item.product_id, 'sold_qty', e.target.value)}
                              className="w-11 sm:w-12 h-7 mx-auto px-0.5 py-0.5 text-center rounded bg-surface-800 border border-primary-500/40 text-primary-300 text-xs font-bold focus:border-primary-400 focus:outline-none"
                            />
                          )}
                        </td>

                        {/* Ending Stock / Remaining (unsold_qty) */}
                        <td className="px-0.5 py-2 sm:py-2.5 text-center text-xs font-bold text-surface-100 whitespace-nowrap bg-surface-800/20">
                          {isLocked ? (
                            safeQty(item.unsold_qty, isItemWeight)
                          ) : (
                            <input
                              type="number" min="0" step={stepVal}
                              value={Number(item.unsold_qty) === 0 ? '' : safeQty(item.unsold_qty, isItemWeight)}
                              placeholder="0"
                              onFocus={e => e.target.select()}
                              onClick={e => (e.target as HTMLInputElement).select()}
                              onChange={e => handleUpdateItem(item.product_id, 'unsold_qty', e.target.value)}
                              className="w-11 sm:w-12 h-7 mx-auto px-0.5 py-0.5 text-center rounded bg-surface-800 border border-surface-600 text-surface-100 text-xs font-bold focus:border-surface-400 focus:outline-none"
                            />
                          )}
                        </td>

                        {/* Waste / Spoilage (spoilage_qty) */}
                        <td className="px-0.5 py-2 sm:py-2.5 text-center text-xs font-semibold text-danger-400 whitespace-nowrap bg-danger-950/10">
                          {isLocked ? (
                            safeQty(item.spoilage_qty, isItemWeight)
                          ) : (
                            <input
                              type="number" min="0" step={stepVal}
                              value={Number(item.spoilage_qty) === 0 ? '' : safeQty(item.spoilage_qty, isItemWeight)}
                              placeholder="0"
                              onFocus={e => e.target.select()}
                              onClick={e => (e.target as HTMLInputElement).select()}
                              onChange={e => handleUpdateItem(item.product_id, 'spoilage_qty', e.target.value)}
                              className="w-11 sm:w-12 h-7 mx-auto px-0.5 py-0.5 text-center rounded bg-surface-800 border border-danger-500/40 text-danger-300 text-xs font-bold focus:border-danger-400 focus:outline-none"
                            />
                          )}
                        </td>

                        {/* Disc. */}
                        <td className="px-0.5 py-2 sm:py-2.5 text-center text-xs whitespace-nowrap">
                          <span className={`px-1 py-0.5 rounded text-[10px] font-extrabold ${
                            item.discrepancy === 0
                              ? 'text-surface-500'
                              : item.discrepancy > 0
                              ? 'bg-primary-500/20 text-primary-300'
                              : 'bg-danger-500/20 text-danger-300'
                          }`}>
                            {item.discrepancy === 0 ? '0' : item.discrepancy > 0 ? `+${safeQty(item.discrepancy, isItemWeight)}` : safeQty(item.discrepancy, isItemWeight)}
                          </span>
                        </td>

                        {/* Total: Revenue (top) & Profit (bottom) */}
                        <td className="px-1 py-2 sm:py-2.5 text-right text-xs whitespace-nowrap">
                          <div className="font-bold text-surface-200">{formatCurrency(item.actual_revenue)}</div>
                          <div className="text-[10px] text-emerald-400 font-semibold leading-tight">+{formatCurrency(item.gross_profit)}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              /* RETAIL / PACKAGED GOODS / BEVERAGES TABLE (9-Column Unified Layout with PREP) */
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead className="sticky top-0 bg-surface-900 border-b border-surface-700/60 z-20 shadow-sm">
                  <tr>
                    <th className="px-2 py-1.5 text-[11px] font-bold text-surface-300 uppercase tracking-wider text-left min-w-[85px]">
                      PRODUCT
                    </th>
                    <th className="px-0.5 py-1.5 text-[11px] font-bold text-yellow-400 uppercase tracking-wider text-center min-w-[34px]" title="Natirang stocks mula kahapon (Yesterday's unsold)">
                      PREV
                    </th>
                    <th className="px-0.5 py-1.5 text-[11px] font-bold text-primary-300 uppercase tracking-wider text-center min-w-[36px]" title="Inorder / Dumating na Restock">
                      ORD
                    </th>
                    <th className="px-0.5 py-1.5 text-[11px] font-bold text-surface-100 uppercase tracking-wider text-center min-w-[38px]" title="Total Prepared = Prev + Ordered">
                      PREP
                    </th>
                    <th className="px-0.5 py-1.5 text-[11px] font-bold text-primary-400 uppercase tracking-wider text-center min-w-[36px]" title="Nabili mula sa POS">
                      SOLD
                    </th>
                    <th className="px-0.5 py-1.5 text-[11px] font-bold text-surface-200 uppercase tracking-wider text-center bg-surface-800/40 min-w-[38px]" title="Kasalukuyang natirang stock">
                      REMAIN
                    </th>
                    <th className="px-0.5 py-1.5 text-[11px] font-bold text-danger-300 uppercase tracking-wider text-center bg-danger-950/20 min-w-[36px]" title="Tapon, expired, o damage">
                      SPOIL
                    </th>
                    <th className="px-0.5 py-1.5 text-[10px] font-bold text-surface-300 uppercase tracking-wider text-center min-w-[26px]" title="Discrepancy / Kulang o Sobra">
                      DISC
                    </th>
                    <th className="px-1.5 py-1.5 text-[11px] font-bold text-surface-300 uppercase tracking-wider text-right min-w-[48px]" title="Benta (Revenue) at Tubo (Gross Profit)">
                      TOTAL
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-700/30">
                  {paginatedItems.map(item => {
                    const isLocked = closing.status === 'FINALIZED';
                    const catName = (item.category_name ?? '').toLowerCase();
                    const showSpoilage = !catName.match(/juice|seasoning|coffee|milk|powder|chocolate/);
                    return (
                      <tr key={item.product_id} className="hover:bg-surface-700/20 transition-colors">
                        {/* Product Name + Price */}
                        <td className="px-2 py-2 sm:py-2.5">
                          <p className="text-surface-100 font-semibold text-xs truncate max-w-[90px] sm:max-w-none">{item.product_name}</p>
                          <span className="text-amber-400 font-bold text-[10px]">{formatCurrency(item.selling_price)}</span>
                        </td>

                        {/* PREV — Yesterday's unsold (prev_stock) */}
                        <td className="px-0.5 py-2 sm:py-2.5 text-center text-xs font-bold text-yellow-400 whitespace-nowrap">
                          {isLocked ? (
                            safeQty(item.prev_stock, false)
                          ) : (
                            <input
                              type="number" min="0" step="1"
                              value={Number(item.prev_stock) === 0 ? '' : safeQty(item.prev_stock, false)}
                              placeholder="0"
                              onFocus={e => e.target.select()}
                              onClick={e => (e.target as HTMLInputElement).select()}
                              onChange={e => handleUpdateItem(item.product_id, 'prev_stock', e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                              className="w-9 sm:w-10 h-7 mx-auto px-0.5 py-0.5 text-center rounded bg-surface-800 border border-yellow-500/40 text-yellow-300 text-xs font-bold focus:border-yellow-400 focus:outline-none"
                            />
                          )}
                        </td>

                        {/* ORD — Restock / Ordered (received_qty) */}
                        <td className="px-0.5 py-2 sm:py-2.5 text-center text-xs font-semibold text-primary-300 whitespace-nowrap">
                          {isLocked ? (
                            safeQty(item.received_qty, false)
                          ) : (
                            <input
                              type="number" min="0" step="1"
                              value={Number(item.received_qty) === 0 ? '' : safeQty(item.received_qty, false)}
                              placeholder="0"
                              onFocus={e => e.target.select()}
                              onClick={e => (e.target as HTMLInputElement).select()}
                              onChange={e => handleUpdateItem(item.product_id, 'received_qty', e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                              className="w-10 sm:w-11 h-7 mx-auto px-0.5 py-0.5 text-center rounded bg-surface-800 border border-primary-500/40 text-primary-300 text-xs font-bold focus:border-primary-400 focus:outline-none"
                            />
                          )}
                        </td>

                        {/* PREP — Total Prepared = Prev + Ordered */}
                        <td className="px-0.5 py-2 sm:py-2.5 text-center text-xs font-bold text-surface-100 whitespace-nowrap">
                          {isLocked ? (
                            safeQty(item.prepared_qty, false)
                          ) : (
                            <input
                              type="number" min="0" step="1"
                              value={Number(item.prepared_qty) === 0 ? '' : safeQty(item.prepared_qty, false)}
                              placeholder="0"
                              onFocus={e => e.target.select()}
                              onClick={e => (e.target as HTMLInputElement).select()}
                              onChange={e => handleUpdateItem(item.product_id, 'prepared_qty', e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                              className="w-10 sm:w-11 h-7 mx-auto px-0.5 py-0.5 text-center rounded bg-surface-800 border border-surface-600 text-surface-100 text-xs font-bold focus:border-surface-400 focus:outline-none"
                            />
                          )}
                        </td>

                        {/* Sold (sold_qty) */}
                        <td className="px-0.5 py-2 sm:py-2.5 text-center text-xs font-semibold text-primary-300 whitespace-nowrap">
                          {isLocked ? (
                            safeQty(item.sold_qty, false)
                          ) : (
                            <input
                              type="number" min="0" step="1"
                              value={Number(item.sold_qty) === 0 ? '' : safeQty(item.sold_qty, false)}
                              placeholder="0"
                              onFocus={e => e.target.select()}
                              onClick={e => (e.target as HTMLInputElement).select()}
                              onChange={e => handleUpdateItem(item.product_id, 'sold_qty', e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                              className="w-10 sm:w-11 h-7 mx-auto px-0.5 py-0.5 text-center rounded bg-surface-800 border border-primary-500/40 text-primary-300 text-xs font-bold focus:border-primary-400 focus:outline-none"
                            />
                          )}
                        </td>

                        {/* Ending Stock / Remaining (unsold_qty) */}
                        <td className="px-0.5 py-2 sm:py-2.5 text-center text-xs font-bold text-surface-100 whitespace-nowrap bg-surface-800/20">
                          {isLocked ? (
                            safeQty(item.unsold_qty, false)
                          ) : (
                            <input
                              type="number" min="0" step="1"
                              value={Number(item.unsold_qty) === 0 ? '' : safeQty(item.unsold_qty, false)}
                              placeholder="0"
                              onFocus={e => e.target.select()}
                              onClick={e => (e.target as HTMLInputElement).select()}
                              onChange={e => handleUpdateItem(item.product_id, 'unsold_qty', e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                              className="w-10 sm:w-11 h-7 mx-auto px-0.5 py-0.5 text-center rounded bg-surface-800 border border-surface-600 text-surface-100 text-xs font-bold focus:border-surface-400 focus:outline-none"
                            />
                          )}
                        </td>

                        {/* Damage / Expired (spoilage_qty) */}
                        <td className="px-0.5 py-2 sm:py-2.5 text-center text-xs font-semibold text-danger-400 whitespace-nowrap bg-danger-950/10">
                          {showSpoilage ? (
                            isLocked ? (
                              (Number(item.spoilage_qty) || 0) > 0 ? safeQty(item.spoilage_qty, false) : <span className="text-surface-600">—</span>
                            ) : (
                              <input
                                type="number" min="0" step="1"
                                value={Number(item.spoilage_qty) === 0 ? '' : safeQty(item.spoilage_qty, false)}
                                placeholder="0"
                                onFocus={e => e.target.select()}
                                onClick={e => (e.target as HTMLInputElement).select()}
                                onChange={e => handleUpdateItem(item.product_id, 'spoilage_qty', e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                                className="w-10 sm:w-11 h-7 mx-auto px-0.5 py-0.5 text-center rounded bg-surface-800 border border-danger-500/40 text-danger-300 text-xs font-bold focus:border-danger-400 focus:outline-none"
                              />
                            )
                          ) : (
                            <span className="text-surface-600 text-[10px]">N/A</span>
                          )}
                        </td>

                        {/* Disc. */}
                        <td className="px-0.5 py-2 sm:py-2.5 text-center text-xs whitespace-nowrap">
                          <span className={`px-1 py-0.5 rounded text-[10px] font-extrabold ${
                            item.discrepancy === 0
                              ? 'text-surface-500'
                              : item.discrepancy > 0
                              ? 'bg-primary-500/20 text-primary-300'
                              : 'bg-danger-500/20 text-danger-300'
                          }`}>
                            {item.discrepancy === 0 ? '0' : item.discrepancy > 0 ? `+${safeQty(item.discrepancy, false)}` : safeQty(item.discrepancy, false)}
                          </span>
                        </td>

                        {/* Total: Revenue (top) & Profit (bottom) */}
                        <td className="px-1 py-2 sm:py-2.5 text-right text-xs whitespace-nowrap">
                          <div className="font-bold text-surface-200">{formatCurrency(item.actual_revenue)}</div>
                          <div className="text-[10px] text-emerald-400 font-semibold leading-tight">+{formatCurrency(item.gross_profit)}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Pinned Card Footer: Unified Single-Line Summary & Pagination */}
        {closing && closing.items.length > 0 && (
          <div className="flex-shrink-0 px-2 sm:px-3 py-1.5 bg-surface-900 border-t border-surface-700/60 flex items-center justify-between text-[11px] sm:text-xs flex-nowrap gap-1">
            {/* Left: Counts & Stock totals */}
            <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0 whitespace-nowrap">
              <span className="text-surface-400">
                <strong className="text-surface-200">
                  {pageSize >= 999 ? 1 : (currentPage - 1) * pageSize + 1}-{pageSize >= 999 ? filteredItems.length : Math.min(currentPage * pageSize, filteredItems.length)}
                </strong> of <strong className="text-surface-200">{filteredItems.length}</strong>
              </span>
              <span className="text-surface-600">•</span>
              <span className="text-surface-400">
                Unsold: <strong className="text-surface-100">{safeQty(closing.total_unsold)}</strong>
              </span>
              <span className="text-surface-600">•</span>
              <span className="text-surface-400">
                Spoil: <strong className="text-danger-400">{safeQty(closing.total_spoilage)}</strong>
              </span>
              {/* FIX #5: Custom/Open Item revenue summary */}
              {customItemsRevenue > 0 && (
                <>
                  <span className="text-surface-600">•</span>
                  <span className="text-primary-300/80" title="Kita mula sa Custom / Open Items (hindi naka-track per product)">
                    ⚡ Custom: <strong className="text-primary-300">{formatCurrency(customItemsRevenue)}</strong>
                  </span>
                </>
              )}
            </div>


            {/* Right: Page size & Prev/Next controls */}
            <div className="flex items-center gap-1 shrink-0 flex-nowrap">
              <select
                value={pageSize}
                onChange={e => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="text-[10px] sm:text-[11px] py-0.5 px-1 rounded bg-surface-800 border border-surface-700 text-surface-300 shrink-0 focus:outline-none cursor-pointer"
              >
                <option value={10}>10/p</option>
                <option value={25}>25/p</option>
                <option value={999}>All</option>
              </select>

              {totalPages > 1 && (
                <div className="flex items-center gap-1 shrink-0 flex-nowrap">
                  <button
                    type="button"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-1.5 py-0.5 rounded bg-surface-800 hover:bg-surface-700 disabled:opacity-30 disabled:cursor-not-allowed text-surface-200 font-medium transition-colors cursor-pointer border border-surface-700/60 text-[10px] sm:text-xs whitespace-nowrap shrink-0"
                  >
                    ←
                  </button>
                  <span className="px-0.5 font-bold text-surface-200 text-[10px] sm:text-xs whitespace-nowrap shrink-0">
                    {currentPage}/{totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="px-1.5 py-0.5 rounded bg-surface-800 hover:bg-surface-700 disabled:opacity-30 disabled:cursor-not-allowed text-surface-200 font-medium transition-colors cursor-pointer border border-surface-700/60 text-[10px] sm:text-xs whitespace-nowrap shrink-0"
                  >
                    →
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ============================================================
          Modal 1: Bilangan ng Kaha (Denomination Counter Modal)
          ============================================================ */}
      {isDenominationModalOpen && closing && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-2.5 sm:p-4 animate-fade-in">
          <div className="bg-surface-900 border border-surface-700/80 rounded-2xl max-w-lg w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-scale-up">
            {/* Modal Header */}
            <div className="px-4 py-3 bg-surface-950/80 border-b border-surface-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xl">💵</span>
                <div>
                  <h3 className="text-sm sm:text-base font-extrabold text-surface-100 flex items-center gap-1.5">
                    Bilangan ng Kaha <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-2 py-0.5 rounded-full">Cash Counter</span>
                  </h3>
                  <p className="text-[11px] text-surface-400">
                    I-enter ang piraso ng bawat papel at barya para sa mabilis na pagbilang
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsDenominationModalOpen(false)}
                className="w-8 h-8 rounded-full bg-surface-800 hover:bg-surface-700 text-surface-400 hover:text-surface-100 flex items-center justify-center text-sm transition-colors cursor-pointer shrink-0"
              >
                ✕
              </button>
            </div>

            {/* Modal Body: Denomination Inputs */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
              {/* Paper Bills Section */}
              <div>
                <p className="text-[11px] font-bold text-surface-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <span>💴</span> Perang Papel (Bills)
                </p>
                <div className="space-y-1.5">
                  {[
                    { key: 'd1000' as const, label: '₱1,000', value: 1000, color: 'text-sky-400', bg: 'bg-sky-500/10 border-sky-500/30' },
                    { key: 'd500' as const, label: '₱500', value: 500, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30' },
                    { key: 'd200' as const, label: '₱200', value: 200, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' },
                    { key: 'd100' as const, label: '₱100', value: 100, color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/30' },
                    { key: 'd50' as const, label: '₱50', value: 50, color: 'text-rose-400', bg: 'bg-rose-500/10 border-rose-500/30' },
                    { key: 'd20' as const, label: '₱20', value: 20, color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/30' },
                  ].map(bill => {
                    const count = Number(denominations[bill.key]) || 0;
                    const subtotal = count * bill.value;
                    return (
                      <div
                        key={bill.key}
                        className="flex items-center justify-between gap-2 p-2 rounded-xl bg-surface-800/70 border border-surface-700/60 hover:border-surface-600 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0 w-24 sm:w-28">
                          <span className={`px-2 py-0.5 rounded text-xs font-black border ${bill.bg} ${bill.color}`}>
                            {bill.label}
                          </span>
                        </div>

                        {/* Stepper & Input */}
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setDenominations(p => ({ ...p, [bill.key]: Math.max(0, (Number(p[bill.key]) || 0) - 1) }))}
                            className="w-7 h-7 rounded-lg bg-surface-700 hover:bg-surface-600 text-surface-200 font-bold text-sm flex items-center justify-center transition-colors cursor-pointer shrink-0 active:scale-95"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min="0"
                            inputMode="numeric"
                            value={denominations[bill.key] === 0 ? '' : denominations[bill.key]}
                            placeholder="0"
                            onFocus={e => e.target.select()}
                            onClick={e => (e.target as HTMLInputElement).select()}
                            onChange={e => {
                              const val = e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value) || 0);
                              setDenominations(p => ({ ...p, [bill.key]: val }));
                            }}
                            className="w-14 sm:w-16 text-center py-1 px-1 rounded-lg bg-surface-900 border border-surface-700 text-surface-100 font-extrabold text-xs sm:text-sm focus:border-primary-500 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => setDenominations(p => ({ ...p, [bill.key]: (Number(p[bill.key]) || 0) + 1 }))}
                            className="w-7 h-7 rounded-lg bg-surface-700 hover:bg-surface-600 text-surface-200 font-bold text-sm flex items-center justify-center transition-colors cursor-pointer shrink-0 active:scale-95"
                          >
                            +
                          </button>
                          <button
                            type="button"
                            onClick={() => setDenominations(p => ({ ...p, [bill.key]: (Number(p[bill.key]) || 0) + 5 }))}
                            className="px-1.5 h-7 rounded-lg bg-surface-800 hover:bg-surface-700 text-surface-400 hover:text-surface-200 text-[10px] font-bold border border-surface-700 transition-colors cursor-pointer shrink-0"
                            title="Magdagdag ng 5 piraso"
                          >
                            +5
                          </button>
                        </div>

                        {/* Subtotal */}
                        <div className="w-24 sm:w-28 text-right font-extrabold text-xs sm:text-sm text-surface-200 truncate">
                          {formatCurrency(subtotal)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Coins Section */}
              <div className="pt-2 border-t border-surface-800">
                <p className="text-[11px] font-bold text-surface-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <span>🪙</span> Barya (Coins)
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { key: 'c20' as const, label: '₱20 Coin', value: 20 },
                    { key: 'c10' as const, label: '₱10 Coin', value: 10 },
                    { key: 'c5' as const, label: '₱5 Coin', value: 5 },
                    { key: 'c1' as const, label: '₱1 Coin', value: 1 },
                  ].map(coin => {
                    const count = Number(denominations[coin.key]) || 0;
                    const subtotal = count * coin.value;
                    return (
                      <div
                        key={coin.key}
                        className="flex items-center justify-between gap-1 p-2 rounded-xl bg-surface-800/70 border border-surface-700/60"
                      >
                        <span className="text-[11px] font-bold text-surface-300 shrink-0">{coin.label}</span>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min="0"
                            inputMode="numeric"
                            value={denominations[coin.key] === 0 ? '' : denominations[coin.key]}
                            placeholder="0"
                            onFocus={e => e.target.select()}
                            onClick={e => (e.target as HTMLInputElement).select()}
                            onChange={e => {
                              const val = e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value) || 0);
                              setDenominations(p => ({ ...p, [coin.key]: val }));
                            }}
                            className="w-12 text-center py-1 px-1 rounded-lg bg-surface-900 border border-surface-700 text-surface-100 font-bold text-xs focus:border-primary-500 focus:outline-none"
                          />
                        </div>
                        <span className="text-[11px] font-bold text-emerald-400 shrink-0 text-right w-12">
                          ₱{subtotal}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Loose Coins / Centavos Direct Input */}
                <div className="mt-2 p-2 rounded-xl bg-surface-800/70 border border-surface-700/60 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-surface-200">Iba pang barya / Sentimo (₱)</p>
                    <p className="text-[10px] text-surface-400">Hal. 25¢ barya o kabuuang barya na binilang</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-bold text-surface-400">₱</span>
                    <input
                      type="number"
                      step="0.25"
                      min="0"
                      value={denominations.looseCoins === 0 ? '' : denominations.looseCoins}
                      placeholder="0.00"
                      onFocus={e => e.target.select()}
                      onClick={e => (e.target as HTMLInputElement).select()}
                      onChange={e => {
                        const val = e.target.value === '' ? 0 : Math.max(0, parseFloat(e.target.value) || 0);
                        setDenominations(p => ({ ...p, looseCoins: val }));
                      }}
                      className="w-24 text-right py-1 px-2 rounded-lg bg-surface-900 border border-surface-700 text-emerald-400 font-extrabold text-xs focus:border-emerald-400 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer: Live Totals & Actions */}
            <div className="px-4 py-3 bg-surface-950 border-t border-surface-800 shrink-0 space-y-2.5">
              {/* Total & Variance Callout */}
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-surface-900 border border-surface-700">
                <div>
                  <span className="text-[10px] font-bold text-surface-400 uppercase tracking-wider block">
                    Kabuuang Pera sa Kaha
                  </span>
                  <span className="text-lg sm:text-xl font-black text-emerald-400">
                    {formatCurrency(denomTotal)}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold text-surface-400 uppercase tracking-wider block">
                    Inaasahan: {formatCurrency(closing.expected_cash_on_hand || 0)}
                  </span>
                  {denomTotal === (closing.expected_cash_on_hand || 0) ? (
                    <span className="inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      ✓ Tugma sa Kaha
                    </span>
                  ) : denomTotal > (closing.expected_cash_on_hand || 0) ? (
                    <span className="inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-primary-500/20 text-primary-400 border border-primary-500/30">
                      +{formatCurrency(denomTotal - (closing.expected_cash_on_hand || 0))} Sobra
                    </span>
                  ) : (
                    <span className="inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-danger-500/20 text-danger-400 border border-danger-500/30">
                      -{formatCurrency((closing.expected_cash_on_hand || 0) - denomTotal)} Kulang
                    </span>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleResetDenominations}
                  className="px-3 py-2 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-300 text-xs font-bold transition-colors cursor-pointer border border-surface-700 shrink-0"
                >
                  ↺ I-clear
                </button>
                <button
                  type="button"
                  onClick={() => setIsDenominationModalOpen(false)}
                  className="px-3 py-2 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-300 text-xs font-bold transition-colors cursor-pointer border border-surface-700 shrink-0"
                >
                  Kanselahin
                </button>
                <button
                  type="button"
                  onClick={handleApplyDenominations}
                  disabled={closing.status === 'FINALIZED'}
                  className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs sm:text-sm font-bold shadow-md transition-all cursor-pointer flex items-center justify-center gap-1.5 active:scale-98"
                >
                  <span>✓</span>
                  <span>Ilapat sa Actual Count ({formatCurrency(denomTotal)})</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          Modal: Magtala ng Gastos sa Kaha (Quick Expense Modal)
          ============================================================ */}
      {isExpenseModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-fade-in no-print">
          <div className="bg-surface-900 border border-surface-700 rounded-2xl max-w-lg w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-scale-up">
            {/* Modal Header */}
            <div className="px-4 py-3 bg-surface-950 border-b border-surface-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xl">💸</span>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-surface-100">
                    {editingExpense ? 'I-edit ang Naitalang Gastos' : 'Magtala ng Gastos sa Kaha (Paid Out)'}
                  </h3>
                  <p className="text-[11px] text-surface-400">
                    Awtomatikong ibabawas sa pondo at inaasahang cash sa kaha ngayong {formatDate(selectedDate)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsExpenseModalOpen(false);
                  setEditingExpense(null);
                }}
                className="w-8 h-8 rounded-full bg-surface-800 hover:bg-surface-700 text-surface-400 hover:text-surface-100 flex items-center justify-center text-sm transition-colors cursor-pointer shrink-0"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
              {/* Quick Template Chips */}
              <div>
                <span className="text-[10px] font-bold text-surface-400 uppercase tracking-wider block mb-1.5">
                  ⚡ Mabilisang Pindot (Quick Templates)
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {[
                    { label: '🧊 Yelo', cat: 'Supplies', desc: 'Yelo (Ice)', amt: 30 },
                    { label: '🛍️ Plastic Bags', cat: 'Supplies', desc: 'Plastic Bags / Sando', amt: 25 },
                    { label: '🥪 Merienda', cat: 'Meals', desc: 'Merienda / Staff Meal', amt: 100 },
                    { label: '🛵 Pamasahe', cat: 'Transportation', desc: 'Pamasahe / Delivery', amt: 50 },
                    { label: '🪵 Uling / Gas', cat: 'Supplies', desc: 'Uling (Charcoal)', amt: 100 },
                    { label: '📱 Paload', cat: 'Utilities', desc: 'Mobile Load / Internet', amt: 50 },
                    { label: '🧽 Sabon / Linis', cat: 'Supplies', desc: 'Sabon & Sponge', amt: 35 },
                    { label: '📦 Kahon / Packs', cat: 'Supplies', desc: 'Packaging Supplies', amt: 60 },
                  ].map(tpl => (
                    <button
                      key={tpl.desc}
                      type="button"
                      onClick={() => {
                        setExpenseForm(prev => ({
                          ...prev,
                          category: tpl.cat,
                          description: tpl.desc,
                          amount: String(tpl.amt),
                        }));
                      }}
                      className="px-2 py-1.5 rounded-xl bg-surface-800 hover:bg-surface-700 border border-surface-700 text-left text-xs transition-colors cursor-pointer group"
                    >
                      <div className="font-semibold text-surface-200 group-hover:text-primary-300 truncate">
                        {tpl.label}
                      </div>
                      <div className="text-[10px] font-bold text-amber-400">
                        {formatCurrency(tpl.amt)}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Amount (Halaga) with Quick Amount Buttons */}
              <div className="p-3 rounded-xl bg-surface-950/70 border border-surface-800 space-y-2">
                <label className="text-[11px] font-bold text-surface-300 uppercase tracking-wide block">
                  Halaga ng Gastos (₱) *
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-bold text-surface-400">
                    ₱
                  </span>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    autoFocus
                    value={expenseForm.amount}
                    placeholder="0.00"
                    onChange={e => setExpenseForm(prev => ({ ...prev, amount: e.target.value }))}
                    className="w-full pl-8 pr-3 py-2 rounded-xl bg-surface-900 border border-surface-700 text-surface-100 font-black text-xl focus:border-primary-500 focus:outline-none"
                  />
                </div>
                {/* Quick Add Amount Buttons */}
                <div className="flex flex-wrap gap-1 pt-1">
                  {[20, 50, 100, 200, 500, 1000].map(add => (
                    <button
                      key={add}
                      type="button"
                      onClick={() => {
                        const current = parseFloat(expenseForm.amount) || 0;
                        setExpenseForm(prev => ({ ...prev, amount: String(current + add) }));
                      }}
                      className="px-2 py-1 rounded-lg bg-surface-800 hover:bg-surface-700 border border-surface-700 text-surface-300 text-[11px] font-bold cursor-pointer transition-colors"
                    >
                      +{formatCurrency(add)}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setExpenseForm(prev => ({ ...prev, amount: '' }))}
                    className="px-2 py-1 rounded-lg bg-surface-800 hover:bg-surface-700 text-surface-400 text-[11px] cursor-pointer"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* Description (Deskripsyon) */}
              <div>
                <label className="text-[11px] font-bold text-surface-300 uppercase tracking-wide block mb-1">
                  Deskripsyon / Para Saan *
                </label>
                <input
                  type="text"
                  value={expenseForm.description}
                  placeholder="Hal. 2 supot ng yelo, pambili ng plastic, etc."
                  onChange={e => setExpenseForm(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl bg-surface-800 border border-surface-700 text-surface-100 text-xs font-medium focus:border-primary-500 focus:outline-none"
                />
              </div>

              {/* Category (Kategorya) */}
              <div>
                <label className="text-[11px] font-bold text-surface-300 uppercase tracking-wide block mb-1">
                  Kategorya ng Gastos
                </label>
                <select
                  value={expenseForm.category}
                  onChange={e => setExpenseForm(prev => ({ ...prev, category: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl bg-surface-800 border border-surface-700 text-surface-100 text-xs font-semibold focus:border-primary-500 focus:outline-none cursor-pointer"
                >
                  <option value="Supplies">📦 Supplies (Packaging, plastic, yelo, etc.)</option>
                  <option value="Meals">🥪 Meals / Merienda (Staff meal, pagkain)</option>
                  <option value="Transportation">🛵 Transportation / Pamasahe (Gasolina, delivery)</option>
                  <option value="Utilities">💡 Utilities (Kuryente, tubig, load, internet)</option>
                  <option value="Rent">🏠 Rent / Upa (Stall rent, tindahan)</option>
                  <option value="Maintenance">🔧 Maintenance / Repairs</option>
                  <option value="Salary">👥 Sweldo / Sahod ng Tauhan</option>
                  <option value="Other">🏷️ Iba pa (Other Expense)</option>
                </select>
              </div>

              {/* Source Option: Mula sa Kaha vs Sariling Bulsa */}
              <div className="p-3 rounded-xl bg-surface-950/70 border border-surface-800 space-y-2">
                <span className="text-[11px] font-bold text-surface-300 uppercase tracking-wide block">
                  Pinagkunan ng Pera (Source)
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label
                    className={`flex items-center gap-2 p-2 rounded-xl border cursor-pointer transition-all ${
                      expenseForm.isDrawer
                        ? 'bg-amber-500/10 border-amber-500/50 text-amber-300'
                        : 'bg-surface-850 border-surface-700/60 text-surface-400 hover:text-surface-200'
                    }`}
                  >
                    <input
                      type="radio"
                      name="expense_source"
                      checked={expenseForm.isDrawer}
                      onChange={() => setExpenseForm(prev => ({ ...prev, isDrawer: true }))}
                      className="accent-amber-500"
                    />
                    <div>
                      <p className="text-xs font-bold text-surface-100 flex items-center gap-1">
                        <span>💵</span> Kaha / Pondo (Petty Cash)
                      </p>
                      <p className="text-[10px] text-surface-400">
                        Ibabawas sa float / cash drawer closing
                      </p>
                    </div>
                  </label>

                  <label
                    className={`flex items-center gap-2 p-2 rounded-xl border cursor-pointer transition-all ${
                      !expenseForm.isDrawer
                        ? 'bg-sky-500/10 border-sky-500/50 text-sky-300'
                        : 'bg-surface-850 border-surface-700/60 text-surface-400 hover:text-surface-200'
                    }`}
                  >
                    <input
                      type="radio"
                      name="expense_source"
                      checked={!expenseForm.isDrawer}
                      onChange={() => setExpenseForm(prev => ({ ...prev, isDrawer: false }))}
                      className="accent-sky-500"
                    />
                    <div>
                      <p className="text-xs font-bold text-surface-100 flex items-center gap-1">
                        <span>💼</span> Sariling Bulsa / Bank
                      </p>
                      <p className="text-[10px] text-surface-400">
                        OPEX pero HINDI ibabawas sa kaha
                      </p>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-4 py-3 bg-surface-950 border-t border-surface-800 flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setIsExpenseModalOpen(false);
                  setEditingExpense(null);
                }}
                disabled={savingExpense}
                className="px-3 py-2 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-300 text-xs font-bold transition-colors cursor-pointer border border-surface-700"
              >
                Kanselahin
              </button>
              <button
                type="button"
                onClick={handleSaveDrawerExpense}
                disabled={savingExpense}
                className="px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white text-xs sm:text-sm font-bold shadow-md transition-all cursor-pointer flex items-center gap-1.5 active:scale-98"
              >
                {savingExpense ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Sine-save...</span>
                  </>
                ) : (
                  <>
                    <span>💾</span>
                    <span>{editingExpense ? 'I-update ang Gastos' : 'I-save at Ibawas sa Kaha'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          Modal 2: Z-Reading & Closing Slip Print Preview
          ============================================================ */}
      {isPrintModalOpen && closing && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-fade-in no-print">
          <div className="bg-surface-900 border border-surface-700 rounded-2xl max-w-md w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-scale-up">
            {/* Header */}
            <div className="px-4 py-3 bg-surface-950 border-b border-surface-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xl">🖨️</span>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-surface-100">
                    Z-Reading & Closing Slip
                  </h3>
                  <p className="text-[11px] text-surface-400">
                    Preview bago i-print sa thermal printer (58mm / 80mm)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsPrintModalOpen(false)}
                className="w-8 h-8 rounded-full bg-surface-800 hover:bg-surface-700 text-surface-400 hover:text-surface-100 flex items-center justify-center text-sm transition-colors cursor-pointer shrink-0"
              >
                ✕
              </button>
            </div>

            {/* Paper Preview Card */}
            <div className="flex-1 overflow-y-auto p-4 bg-surface-950 flex justify-center">
              <div className="bg-white text-black font-mono p-4 sm:p-5 rounded-lg shadow-lg w-full max-w-[320px] text-xs space-y-2 border border-surface-300">
                {/* Store Header */}
                <div className="text-center pb-2 border-b border-dashed border-black">
                  <p className="font-bold uppercase text-sm tracking-wide">
                    {storeSettings.store_name || 'AKING TINDAHAN'}
                  </p>
                  {storeSettings.store_address && (
                    <p className="text-[10px] mt-0.5">{storeSettings.store_address}</p>
                  )}
                  {storeSettings.store_contact && (
                    <p className="text-[10px]">{storeSettings.store_contact}</p>
                  )}
                  <p className="text-[11px] font-bold mt-2 uppercase tracking-wider">
                    *** DAILY CLOSING & Z-READING ***
                  </p>
                  <p className="text-[10px]">Petsa: {formatDate(closing.date)}</p>
                  <p className="text-[9px]">Na-print: {formatDateTime(new Date().toISOString())}</p>
                  <span className="inline-block mt-1 px-2 py-0.5 rounded text-[9px] font-bold border border-black uppercase">
                    {closing.status === 'FINALIZED' ? 'FINALIZED (SARADO NA)' : 'DRAFT / BUKAS PA'}
                  </span>
                </div>

                {/* Sales Breakdown */}
                <div className="py-1 border-b border-dashed border-black space-y-0.5 text-[11px]">
                  <p className="font-bold text-[10px] uppercase">=== SALES BREAKDOWN ===</p>
                  <div className="flex justify-between font-bold">
                    <span>Gross Sales:</span>
                    <span>{formatCurrency(closing.total_revenue || 0)}</span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span>  • Cash Benta:</span>
                    <span>{formatCurrency((closing.cash_sales ?? closing.total_revenue) || 0)}</span>
                  </div>
                  {(closing.credit_sales || 0) > 0 && (
                    <div className="flex justify-between text-[10px]">
                      <span>  • Pina-utang (Credit):</span>
                      <span>{formatCurrency(closing.credit_sales || 0)}</span>
                    </div>
                  )}
                  {(closing.debt_collections || 0) > 0 && (
                    <div className="flex justify-between text-[10px]">
                      <span>  • Bayad sa Utang:</span>
                      <span>+{formatCurrency(closing.debt_collections || 0)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-[10px]">
                    <span>Nabentang Dami:</span>
                    <span>{closing.total_sold || 0} pcs / kg</span>
                  </div>
                </div>

                {/* Spoilage & Profit */}
                <div className="py-1 border-b border-dashed border-black space-y-0.5 text-[11px]">
                  <div className="flex justify-between text-[10px]">
                    <span>Puhunan (COGS):</span>
                    <span>{formatCurrency(closing.total_cogs || 0)}</span>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <span>Gross Profit:</span>
                    <span>{formatCurrency(closing.total_gross_profit || 0)}</span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span>Tapon/Spoilage:</span>
                    <span>-{formatCurrency(closing.total_spoilage_loss || 0)} ({closing.total_spoilage || 0} pcs)</span>
                  </div>
                  <div className="flex justify-between font-bold pt-1 border-t border-dotted border-black">
                    <span>NET SHIFT PROFIT:</span>
                    <span>{formatCurrency(netEstimatedProfit)}</span>
                  </div>
                </div>

                {/* Cash Drawer Balancing */}
                <div className="py-1 border-b border-dashed border-black space-y-0.5 text-[11px]">
                  <p className="font-bold text-[10px] uppercase">=== KAHA & BALANCING ===</p>
                  <div className="flex justify-between text-[10px]">
                    <span>Panimulang Pondo:</span>
                    <span>{formatCurrency(closing.opening_cash || 0)}</span>
                  </div>
                  {(closing.cash_expenses || 0) > 0 && (
                    <div className="flex justify-between text-[10px]">
                      <span>- Bawas Gastos sa Kaha:</span>
                      <span>-{formatCurrency(closing.cash_expenses || 0)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-[10px] font-semibold">
                    <span>= Net Starting Pondo:</span>
                    <span>{formatCurrency((closing.opening_cash || 0) - (closing.cash_expenses || 0))}</span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span>+ Cash Benta Pumasok:</span>
                    <span>+{formatCurrency((closing.cash_sales ?? closing.total_revenue) || 0)}</span>
                  </div>
                  {(closing.debt_collections || 0) > 0 && (
                    <div className="flex justify-between text-[10px]">
                      <span>+ Bayad Utang:</span>
                      <span>+{formatCurrency(closing.debt_collections || 0)}</span>
                    </div>
                  )}
                  {(closing.cash_expenses || 0) > 0 && (
                    <div className="flex justify-between text-[10px]">
                      <span>- Gastos (OPEX):</span>
                      <span>-{formatCurrency(closing.cash_expenses || 0)}</span>
                    </div>
                  )}
                  {(closing.bills_allocation || 0) > 0 && (
                    <div className="flex justify-between text-[10px]">
                      <span>- Sinking Bills Hulog:</span>
                      <span>-{formatCurrency(closing.bills_allocation || 0)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-semibold pt-1 border-t border-dotted border-black">
                    <span>Inaasahang Cash:</span>
                    <span>{formatCurrency(closing.expected_cash_on_hand || 0)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-xs">
                    <span>AKTWAL NA CASH:</span>
                    <span>{formatCurrency(closing.actual_cash_on_hand || 0)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-[11px] pt-0.5">
                    <span>STATUS:</span>
                    <span>
                      {(closing.cash_discrepancy ?? 0) === 0
                        ? '✓ TUGMA / BALANSE'
                        : (closing.cash_discrepancy ?? 0) > 0
                        ? `+${formatCurrency(closing.cash_discrepancy || 0)} SOBRA`
                        : `-${formatCurrency(Math.abs(closing.cash_discrepancy || 0))} KULANG`}
                    </span>
                  </div>
                </div>

                {/* Denomination Breakdown if Available */}
                {closing.cash_denominations && (
                  <div className="py-1 border-b border-dashed border-black space-y-0.5 text-[10px]">
                    <p className="font-bold uppercase">=== BILANGAN NG PERA ===</p>
                    {closing.cash_denominations.d1000 ? <div className="flex justify-between"><span>1,000 × {closing.cash_denominations.d1000}</span><span>{formatCurrency(closing.cash_denominations.d1000 * 1000)}</span></div> : null}
                    {closing.cash_denominations.d500 ? <div className="flex justify-between"><span>500 × {closing.cash_denominations.d500}</span><span>{formatCurrency(closing.cash_denominations.d500 * 500)}</span></div> : null}
                    {closing.cash_denominations.d200 ? <div className="flex justify-between"><span>200 × {closing.cash_denominations.d200}</span><span>{formatCurrency(closing.cash_denominations.d200 * 200)}</span></div> : null}
                    {closing.cash_denominations.d100 ? <div className="flex justify-between"><span>100 × {closing.cash_denominations.d100}</span><span>{formatCurrency(closing.cash_denominations.d100 * 100)}</span></div> : null}
                    {closing.cash_denominations.d50 ? <div className="flex justify-between"><span>50 × {closing.cash_denominations.d50}</span><span>{formatCurrency(closing.cash_denominations.d50 * 50)}</span></div> : null}
                    {closing.cash_denominations.d20 ? <div className="flex justify-between"><span>20 × {closing.cash_denominations.d20}</span><span>{formatCurrency(closing.cash_denominations.d20 * 20)}</span></div> : null}
                    {(closing.cash_denominations.coins || 0) > 0 ? <div className="flex justify-between"><span>Barya / Coins</span><span>{formatCurrency(closing.cash_denominations.coins || 0)}</span></div> : null}
                  </div>
                )}

                {/* Signatures */}
                <div className="pt-3 pb-1 text-[10px] space-y-3">
                  <div>
                    <p>Inihanda ni (Cashier):</p>
                    <p className="border-b border-black mt-3"></p>
                  </div>
                  <div>
                    <p>Inaprubahan ni (Owner):</p>
                    <p className="border-b border-black mt-3"></p>
                  </div>
                </div>

                <div className="text-center text-[9px] pt-1 mt-1 border-t border-dashed border-black">
                  {storeSettings.receipt_footer || 'Maraming salamat sa masipag na pagtatrabaho!'}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="p-3 bg-surface-950 border-t border-surface-800 flex items-center justify-between gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCopyDailySummary}
                className="px-3 py-2 rounded-xl bg-surface-800 hover:bg-surface-700 text-sky-400 text-xs font-bold transition-colors cursor-pointer border border-surface-700 flex items-center gap-1.5"
                title="Kopyahin para sa Messenger"
              >
                <span>📋</span>
                <span>Copy sa Messenger</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsPrintModalOpen(false)}
                  className="px-3 py-2 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-300 text-xs font-bold transition-colors cursor-pointer border border-surface-700"
                >
                  Isara
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-bold shadow-md transition-all cursor-pointer flex items-center gap-1.5 active:scale-95"
                >
                  <span>🖨️</span>
                  <span>I-print Ngayon</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          Hidden Thermal Receipt for 58mm / 80mm POS Printers
          ============================================================ */}
      {closing && (
        <div
          id="thermal-receipt"
          className={`hidden font-mono text-black ${
            storeSettings.printer_width === '80mm' ? 'thermal-80mm' : 'thermal-58mm'
          }`}
        >
          <div className="text-center pb-2 border-b border-dashed border-black">
            <p className="font-bold uppercase text-xs">
              {storeSettings.store_name || 'AKING TINDAHAN'}
            </p>
            {storeSettings.store_address && (
              <p className="text-[10px] mt-0.5">{storeSettings.store_address}</p>
            )}
            {storeSettings.store_contact && (
              <p className="text-[10px]">{storeSettings.store_contact}</p>
            )}
            <p className="text-[11px] font-bold mt-1 tracking-wider uppercase">*** Z-READING / DAILY CLOSING ***</p>
            <p className="text-[10px] mt-0.5">Petsa: {formatDate(closing.date)}</p>
            <p className="text-[9px]">Na-print: {formatDateTime(new Date().toISOString())}</p>
            <p className="text-[9px] font-bold uppercase mt-0.5">
              Katayuan: {closing.status === 'FINALIZED' ? 'FINALIZED (SARADO NA)' : 'DRAFT / BUKAS PA'}
            </p>
          </div>

          {/* Sales Breakdown */}
          <div className="pt-1.5 pb-1 text-xs border-b border-dashed border-black space-y-0.5">
            <p className="font-bold text-[10px] uppercase">=== SALES BREAKDOWN ===</p>
            <div className="flex justify-between">
              <span>Gross Sales:</span>
              <span className="font-bold">{formatCurrency(closing.total_revenue || 0)}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span>  • Cash Benta:</span>
              <span>{formatCurrency((closing.cash_sales ?? closing.total_revenue) || 0)}</span>
            </div>
            {(closing.credit_sales || 0) > 0 && (
              <div className="flex justify-between text-[10px]">
                <span>  • Pina-utang (Credit):</span>
                <span>{formatCurrency(closing.credit_sales || 0)}</span>
              </div>
            )}
            {(closing.debt_collections || 0) > 0 && (
              <div className="flex justify-between text-[10px]">
                <span>  • Bayad sa Utang:</span>
                <span>+{formatCurrency(closing.debt_collections || 0)}</span>
              </div>
            )}
            <div className="flex justify-between text-[10px]">
              <span>Nabentang Dami:</span>
              <span>{closing.total_sold || 0} piraso / kg</span>
            </div>
          </div>

          {/* Profit & Spoilage */}
          <div className="pt-1 pb-1 text-xs border-b border-dashed border-black space-y-0.5">
            <div className="flex justify-between text-[10px]">
              <span>Puhunan (COGS):</span>
              <span>{formatCurrency(closing.total_cogs || 0)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Gross Profit:</span>
              <span>{formatCurrency(closing.total_gross_profit || 0)}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span>Tapon/Spoilage:</span>
              <span>-{formatCurrency(closing.total_spoilage_loss || 0)} ({closing.total_spoilage || 0} pcs)</span>
            </div>
            <div className="flex justify-between font-bold pt-0.5 border-t border-dotted border-black">
              <span>NET SHIFT PROFIT:</span>
              <span>{formatCurrency(netEstimatedProfit)}</span>
            </div>
          </div>

          {/* Cash Drawer Balancing */}
          <div className="pt-1 pb-1 text-xs border-b border-dashed border-black space-y-0.5">
            <p className="font-bold text-[10px] uppercase">=== KAHA & BALANCING ===</p>
            <div className="flex justify-between text-[10px]">
              <span>Panimulang Pondo:</span>
              <span>{formatCurrency(closing.opening_cash || 0)}</span>
            </div>
            {(closing.cash_expenses || 0) > 0 && (
              <div className="flex justify-between text-[10px]">
                <span>- Bawas Gastos sa Kaha:</span>
                <span>-{formatCurrency(closing.cash_expenses || 0)}</span>
              </div>
            )}
            <div className="flex justify-between text-[10px] font-semibold">
              <span>= Net Starting Pondo:</span>
              <span>{formatCurrency((closing.opening_cash || 0) - (closing.cash_expenses || 0))}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span>+ Cash Sales Pumasok:</span>
              <span>+{formatCurrency((closing.cash_sales ?? closing.total_revenue) || 0)}</span>
            </div>
            {(closing.debt_collections || 0) > 0 && (
              <div className="flex justify-between text-[10px]">
                <span>+ Bayad Utang Pumasok:</span>
                <span>+{formatCurrency(closing.debt_collections || 0)}</span>
              </div>
            )}
            {(closing.cash_expenses || 0) > 0 && (
              <div className="flex justify-between text-[10px]">
                <span>- Gastos (OPEX):</span>
                <span>-{formatCurrency(closing.cash_expenses || 0)}</span>
              </div>
            )}
            {(closing.bills_allocation || 0) > 0 && (
              <div className="flex justify-between text-[10px]">
                <span>- Sinking Bills Hulog:</span>
                <span>-{formatCurrency(closing.bills_allocation || 0)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold pt-0.5 border-t border-dotted border-black">
              <span>Inaasahan sa Kaha:</span>
              <span>{formatCurrency(closing.expected_cash_on_hand || 0)}</span>
            </div>
            <div className="flex justify-between font-bold text-sm">
              <span>AKTWAL NA BILANG:</span>
              <span>{formatCurrency(closing.actual_cash_on_hand || 0)}</span>
            </div>
            <div className="flex justify-between font-bold text-[11px] pt-0.5">
              <span>STATUS:</span>
              <span>
                {(closing.cash_discrepancy ?? 0) === 0
                  ? '✓ TUGMA / BALANSE'
                  : (closing.cash_discrepancy ?? 0) > 0
                  ? `+${formatCurrency(closing.cash_discrepancy || 0)} SOBRA`
                  : `-${formatCurrency(Math.abs(closing.cash_discrepancy || 0))} KULANG`}
              </span>
            </div>
          </div>

          {/* Cash Denominations Breakdown if available */}
          {closing.cash_denominations && (
            <div className="pt-1 pb-1 text-[10px] border-b border-dashed border-black space-y-0.5">
              <p className="font-bold uppercase">=== BILANGAN NG PERA ===</p>
              {closing.cash_denominations.d1000 ? <div className="flex justify-between"><span>1,000 × {closing.cash_denominations.d1000}</span><span>{formatCurrency(closing.cash_denominations.d1000 * 1000)}</span></div> : null}
              {closing.cash_denominations.d500 ? <div className="flex justify-between"><span>500 × {closing.cash_denominations.d500}</span><span>{formatCurrency(closing.cash_denominations.d500 * 500)}</span></div> : null}
              {closing.cash_denominations.d200 ? <div className="flex justify-between"><span>200 × {closing.cash_denominations.d200}</span><span>{formatCurrency(closing.cash_denominations.d200 * 200)}</span></div> : null}
              {closing.cash_denominations.d100 ? <div className="flex justify-between"><span>100 × {closing.cash_denominations.d100}</span><span>{formatCurrency(closing.cash_denominations.d100 * 100)}</span></div> : null}
              {closing.cash_denominations.d50 ? <div className="flex justify-between"><span>50 × {closing.cash_denominations.d50}</span><span>{formatCurrency(closing.cash_denominations.d50 * 50)}</span></div> : null}
              {closing.cash_denominations.d20 ? <div className="flex justify-between"><span>20 × {closing.cash_denominations.d20}</span><span>{formatCurrency(closing.cash_denominations.d20 * 20)}</span></div> : null}
              {(closing.cash_denominations.coins || 0) > 0 ? <div className="flex justify-between"><span>Barya / Coins</span><span>{formatCurrency(closing.cash_denominations.coins || 0)}</span></div> : null}
            </div>
          )}

          {/* Signatures */}
          <div className="pt-4 pb-2 text-[10px] space-y-4">
            <div>
              <p>Inihanda ni (Cashier):</p>
              <p className="border-b border-black mt-4"></p>
            </div>
            <div>
              <p>Inaprubahan / Na-remit kay (Owner):</p>
              <p className="border-b border-black mt-4"></p>
            </div>
          </div>

          <div className="text-center text-[9px] pt-1 mt-1 border-t border-dashed border-black">
            {storeSettings.receipt_footer || 'Salamat sa masipag na pagtatrabaho!'}
          </div>
        </div>
      )}
    </div>
  );
}
