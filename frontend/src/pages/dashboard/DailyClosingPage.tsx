import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { formatCurrency } from '../../utils/currency';
import { getTodayStr, getLocalDateStr, SYSTEM_START_DATE } from '../../utils/date';
import { getAllProducts, setProductStock } from '../../db/productRepository';
import { getDailyClosingByDate, saveDailyClosing, deleteDailyClosing } from '../../db/closingRepository';
import { getAllSales } from '../../db/salesRepository';
import { getAllExpenses } from '../../db/expenseRepository';
import { getDailyBillsTotalForDate } from '../../db/billsRepository';
import { getReorderSheetByDate } from '../../db/reorderRepository';
import { fetchSales } from '../../api/endpoints';
import type { DailyClosing, DailyClosingItem } from '../../types/closing';

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
  const [viewMode, setViewMode] = useState<'cards' | 'table'>(() =>
    typeof window !== 'undefined' && window.innerWidth >= 1024 ? 'table' : 'cards'
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [isCashDrawerOpen, setIsCashDrawerOpen] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);

  const nextDateStr = useMemo(() => {
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    return getLocalDateStr(d);
  }, [selectedDate]);

  // Paginated items
  const paginatedItems = useMemo(() => {
    if (!closing) return [];
    if (pageSize >= 999) return closing.items;
    const start = (currentPage - 1) * pageSize;
    return closing.items.slice(start, start + pageSize);
  }, [closing, currentPage, pageSize]);

  const totalPages = useMemo(() => {
    if (!closing) return 1;
    if (pageSize >= 999) return 1;
    return Math.ceil(closing.items.length / pageSize) || 1;
  }, [closing, pageSize]);

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
        setClosing(existing);
        setLastSavedTime(
          (existing as any).updated_at
            ? new Date((existing as any).updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : null
        );
        setLoading(false);
        return;
      }

      // Map existing draft item inputs so user edits (prepared_qty, spoilage_qty, manual sold) are preserved
      const existingItemMap = new Map<number, DailyClosingItem>();
      const existingItemByName = new Map<string, DailyClosingItem>();
      if (existing && existing.items) {
        for (const it of existing.items) {
          existingItemMap.set(it.product_id, it);
          if (it.product_name) {
            existingItemByName.set(it.product_name.toLowerCase().trim(), it);
          }
        }
      }

      // 2. Otherwise initialize from current products and sales
      const products = await getAllProducts();
      
      // Fetch sales for this date to determine sold_qty per product
      const salesQtyMap: Record<number, number> = {};
      const seenUuids = new Set<string>();

      // A. Fetch from server API
      try {
        const salesRes = await fetchSales({ date_from: date, date_to: date, per_page: 500, with_items: true });
        for (const sale of salesRes.data) {
          if (sale.uuid) seenUuids.add(sale.uuid);
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
          isReorderLocked = reorderSheet.status === 'ORDERED' || reorderSheet.status === 'LOCKED' || reorderSheet.status === 'RECEIVED';
          if (reorderSheet.items) {
            for (const it of reorderSheet.items) {
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
        };
      });

      // C. Calculate Cash Drawer & On-Hand Reconciliation
      // 1. Opening Cash (Yesterday's ending cash or manual opening count)
      const openingCash = existing?.opening_cash ?? prevClosing?.actual_cash_on_hand ?? prevClosing?.expected_cash_on_hand ?? 0;

      // 2. Cash Expenses (OPEX) paid today
      let dayExpenses = 0;
      try {
        const allExp = await getAllExpenses();
        dayExpenses = allExp
          .filter(e => e.expense_date === date)
          .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
      } catch (expErr) {
        console.warn('Could not fetch daily expenses:', expErr);
      }

      // 3. Sinking Bills allocation today
      let dayBills = 0;
      try {
        dayBills = await getDailyBillsTotalForDate(date);
      } catch (billsErr) {
        console.warn('Could not fetch daily bills allocation:', billsErr);
      }

      const totalRev = items.reduce((s, i) => s + i.actual_revenue, 0);
      const cashSales = (existing && existing.status === 'FINALIZED') ? (existing.cash_sales ?? totalRev) : totalRev;
      const expectedCashOnHand = openingCash + cashSales - dayExpenses - dayBills;
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
        // Cash Drawer Fields
        opening_cash: openingCash,
        cash_sales: cashSales,
        cash_expenses: dayExpenses,
        bills_allocation: dayBills,
        expected_cash_on_hand: expectedCashOnHand,
        actual_cash_on_hand: actualCashOnHand,
        cash_discrepancy: cashDiscrepancy,
        created_at: new Date().toISOString(),
      };

      setClosing(newClosing);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load closing data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadClosingData(selectedDate);
  }, [selectedDate, loadClosingData]);

  // Real-time synchronization: listen for POS transactions, Sync events, window focus, and cross-tab broadcasts
  useEffect(() => {
    const handlePosUpdate = () => {
      loadClosingData(selectedDate);
    };

    // 1. Same-window custom events
    window.addEventListener('pos_sale_completed', handlePosUpdate);
    window.addEventListener('pos_sync_completed', handlePosUpdate);
    window.addEventListener('pos_reorder_saved', handlePosUpdate);
    window.addEventListener('pos_inventory_updated', handlePosUpdate);

    // 2. Window focus and visibility change (e.g. switching back from POS to Daily Closing)
    window.addEventListener('focus', handlePosUpdate);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handlePosUpdate();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // 3. Cross-tab BroadcastChannel
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
      window.removeEventListener('pos_sale_completed', handlePosUpdate);
      window.removeEventListener('pos_sync_completed', handlePosUpdate);
      window.removeEventListener('pos_reorder_saved', handlePosUpdate);
      window.removeEventListener('pos_inventory_updated', handlePosUpdate);
      window.removeEventListener('focus', handlePosUpdate);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
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
      const exp = prev.cash_expenses || 0;
      const bills = prev.bills_allocation || 0;

      const expected = opening + sales - exp - bills;
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

  // Editable fields: Ordered, Prev. Stocks, Prepared/Inihaw, Sold, Unsold, Spoilage
  const handleUpdateItem = (
    productId: number,
    field: 'received_qty' | 'prev_stock' | 'prepared_qty' | 'sold_qty' | 'unsold_qty' | 'spoilage_qty',
    val: number
  ) => {
    if (!closing) return;
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
          // Auto-adjust Unsold when Prepared changes
          updated.unsold_qty = Math.max(0, updated.prepared_qty - updated.sold_qty - updated.spoilage_qty);
        } else if (field === 'sold_qty') {
          updated.sold_qty = cleanVal;
          updated.actual_revenue = updated.sold_qty * updated.selling_price;
          updated.cogs = updated.sold_qty * updated.unit_cost;
          updated.gross_profit = updated.actual_revenue - updated.cogs;
          // Auto-adjust Unsold when Sold changes
          updated.unsold_qty = Math.max(0, updated.prepared_qty - updated.sold_qty - updated.spoilage_qty);
        } else if (field === 'spoilage_qty') {
          updated.spoilage_qty = cleanVal;
          // Spoilage loss is based on Selling Price (SRP)
          updated.spoilage_loss = updated.spoilage_qty * updated.selling_price;
          // Auto-adjust Unsold when Spoilage changes
          updated.unsold_qty = Math.max(0, updated.prepared_qty - updated.sold_qty - updated.spoilage_qty);
        } else if (field === 'unsold_qty') {
          // Manually overridden physical tray count
          updated.unsold_qty = cleanVal;
        }

        // Calculate discrepancy between Prepared and (Sold + Unsold + Spoilage)
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
      setSuccessMsg(`💾 Nai-save ang Draft para sa ${selectedDate}! Naka-sync na rin ito sa database.`);
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
      setSuccessMsg(`✓ Matagumpay na na-finalize ang Closing para sa ${selectedDate}! Ang natirang stock ay nai-save na para bukas.`);
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
      setSuccessMsg('🔓 Re-opened! You can now adjust unsold/spoilage counts and re-finalize when ready.');
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

  const netEstimatedProfit = useMemo(() => {
    if (!closing) return 0;
    return closing.total_gross_profit - closing.total_spoilage_loss;
  }, [closing]);

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-2.5 sm:space-y-3.5 animate-fade-in pb-16 lg:pb-0">
      {/* Page Header */}
      <div className="flex-shrink-0 flex items-center justify-between gap-2">
        <div className="hidden lg:block">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold text-surface-50 tracking-tight">Daily Closing & Balancing</h1>
            {closing?.status === 'FINALIZED' ? (
              <span className="px-2 py-0.5 rounded-full bg-success-500/20 text-success-400 text-xs font-bold border border-success-500/30 whitespace-nowrap">
                ✓ FINALIZED
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full bg-warning-500/20 text-warning-400 text-xs font-bold border border-warning-500/30 whitespace-nowrap">
                DRAFT / IN PROGRESS
              </span>
            )}
          </div>
          <p className="text-surface-400 mt-0.5 text-xs">
            Araw-araw na balancing ng benta, pisikal na bilang ng natirang ihaw, at talaan ng spoilage
          </p>
        </div>

        {/* Date Selector & Status Badge - Clean full width on mobile without button clutter */}
        <div className="flex items-center justify-between w-full lg:w-auto gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-surface-300">⚖️ Petsa:</span>
            <input
              type="date"
              value={selectedDate}
              min={SYSTEM_START_DATE}
              onChange={e => {
                const val = e.target.value;
                setSelectedDate(val < SYSTEM_START_DATE ? SYSTEM_START_DATE : val);
                setCurrentPage(1);
              }}
              className="text-xs sm:text-sm py-1.5 px-3 rounded-xl bg-surface-900 border border-surface-700 text-surface-100 font-semibold cursor-pointer focus:outline-none focus:border-primary-500 shadow-xs w-38 sm:w-44 shrink-0"
            />
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {isDirty ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 whitespace-nowrap animate-pulse">
                💾 Nagsa-save...
              </span>
            ) : lastSavedTime ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-surface-800 text-surface-400 border border-surface-700 whitespace-nowrap hidden sm:inline" title="Huling na-save sa database">
                ✓ {lastSavedTime}
              </span>
            ) : null}

            <span className={`px-2.5 py-1 rounded-full text-xs font-bold border whitespace-nowrap shrink-0 shadow-xs ${
              closing?.status === 'FINALIZED'
                ? 'bg-success-500/20 text-success-400 border-success-500/30'
                : 'bg-warning-500/20 text-warning-400 border-warning-500/30'
            }`}>
              {closing?.status === 'FINALIZED' ? '✓ Closed' : '📝 Draft'}
            </span>
          </div>
        </div>
      </div>

      {successMsg && (
        <div className="p-2.5 sm:p-3 rounded-xl bg-success-500/10 border border-success-500/30 text-success-400 text-xs sm:text-sm flex items-center justify-between">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="text-success-400 hover:text-success-200 ml-2">✕</button>
        </div>
      )}

      {errorMsg && (
        <div className="p-2.5 sm:p-3 rounded-xl bg-danger-500/10 border border-danger-500/30 text-danger-400 text-xs sm:text-sm flex items-center justify-between">
          <span>⚠️ {errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-danger-400 hover:text-danger-200 ml-2">✕</button>
        </div>
      )}

      {/* Financial KPI Summary */}
      {closing && (
        <>
          {/* Mobile High-Density KPI Grid (< md) - Compact space-saving layout */}
          <div className="md:hidden flex-shrink-0 space-y-1">
            <div className="grid grid-cols-2 gap-1.5">
              <div className="p-1.5 px-2 rounded-lg bg-surface-800/90 border border-surface-700/60 flex items-center justify-between">
                <div>
                  <span className="text-[9px] text-surface-400 font-bold uppercase tracking-wider block">Gross Sales</span>
                  <span className="text-xs font-black text-surface-100 block">{formatCurrency(closing.total_revenue)}</span>
                </div>
                <span className="text-[9px] text-surface-500 font-semibold">{closing.total_sold} pcs</span>
              </div>
              <div className="p-1.5 px-2 rounded-lg bg-primary-950/40 border border-primary-500/40 flex items-center justify-between">
                <div>
                  <span className="text-[9px] text-primary-300 font-bold uppercase tracking-wider block">Net Shift</span>
                  <span className="text-xs font-black text-primary-400 block">{formatCurrency(netEstimatedProfit)}</span>
                </div>
                <span className="text-[9px] text-primary-400/80 font-medium">kita</span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-1">
              <div className="p-1 px-1.5 rounded-lg bg-surface-800/70 border border-surface-700/40 flex items-center justify-between">
                <span className="text-[9px] text-surface-400 font-medium truncate">COGS</span>
                <span className="text-[10px] font-bold text-warning-400">{formatCurrency(closing.total_cogs)}</span>
              </div>
              <div className="p-1 px-1.5 rounded-lg bg-surface-800/70 border border-surface-700/40 flex items-center justify-between">
                <span className="text-[9px] text-surface-400 font-medium truncate">GP</span>
                <span className="text-[10px] font-bold text-emerald-400">{formatCurrency(closing.total_gross_profit)}</span>
              </div>
              <div className="p-1 px-1.5 rounded-lg bg-surface-800/70 border border-surface-700/40 flex items-center justify-between">
                <span className="text-[9px] text-surface-400 font-medium truncate">Spoilage</span>
                <span className="text-[10px] font-bold text-danger-400">{formatCurrency(closing.total_spoilage_loss)}</span>
              </div>
            </div>
          </div>

          {/* Desktop/Tablet Full KPI Cards (>= md) */}
          <div className="hidden md:grid flex-shrink-0 grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-2.5">
            <div className="p-2.5 sm:p-3 rounded-xl bg-surface-800/80 border border-surface-700/60 shadow-sm min-w-0">
              <p className="text-[11px] sm:text-xs text-surface-400 font-medium truncate">Actual Gross Sales</p>
              <p className="text-base sm:text-lg font-extrabold text-surface-100 mt-0.5 truncate">
                {formatCurrency(closing.total_revenue)}
              </p>
              <p className="text-[10px] sm:text-[11px] text-surface-500 mt-0.5 truncate">{closing.total_sold} pcs sold</p>
            </div>

            <div className="p-2.5 sm:p-3 rounded-xl bg-surface-800/80 border border-surface-700/60 shadow-sm min-w-0">
              <p className="text-[11px] sm:text-xs text-surface-400 font-medium truncate">Cost of Goods (COGS)</p>
              <p className="text-base sm:text-lg font-extrabold text-warning-400 mt-0.5 truncate">
                {formatCurrency(closing.total_cogs)}
              </p>
              <p className="text-[10px] sm:text-[11px] text-surface-500 mt-0.5 truncate">Puhunan sa nabenta</p>
            </div>

            <div className="p-2.5 sm:p-3 rounded-xl bg-surface-800/80 border border-surface-700/60 shadow-sm min-w-0">
              <p className="text-[11px] sm:text-xs text-surface-400 font-medium truncate">Gross Profit</p>
              <p className="text-base sm:text-lg font-extrabold text-emerald-400 mt-0.5 truncate">
                {formatCurrency(closing.total_gross_profit)}
              </p>
              <p className="text-[10px] sm:text-[11px] text-surface-500 mt-0.5 truncate">Benta minus puhunan</p>
            </div>

            <div className="p-2.5 sm:p-3 rounded-xl bg-surface-800/80 border border-surface-700/60 shadow-sm min-w-0">
              <p className="text-[11px] sm:text-xs text-surface-400 font-medium truncate">Spoilage Loss</p>
              <p className="text-base sm:text-lg font-extrabold text-danger-400 mt-0.5 truncate">
                {formatCurrency(closing.total_spoilage_loss)}
              </p>
              <p className="text-[10px] sm:text-[11px] text-surface-500 mt-0.5 truncate">{closing.total_spoilage} sticks (benta)</p>
            </div>

            <div className="col-span-2 md:col-span-1 lg:col-span-1 p-2.5 sm:p-3 rounded-xl bg-primary-950/40 border border-primary-500/30 shadow-sm min-w-0">
              <p className="text-[11px] sm:text-xs text-primary-300 font-medium truncate">Net Shift Income</p>
              <p className="text-base sm:text-lg font-black text-primary-400 mt-0.5 truncate">
                {formatCurrency(netEstimatedProfit)}
              </p>
              <p className="text-[10px] sm:text-[11px] text-primary-400/70 mt-0.5 truncate">GP minus Spoilage</p>
            </div>
          </div>

          {/* Cash Drawer & Cash On-Hand Reconciliation (Drawer / Accordion Style) */}
          <div className="rounded-xl bg-surface-900/90 border border-surface-700/60 shadow-sm flex-shrink-0 overflow-hidden">
            {/* Drawer Header & Trigger Button */}
            <div className="p-2 sm:p-2.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-base sm:text-lg shrink-0">💵</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-xs sm:text-sm font-bold text-surface-100 truncate">
                      Cash On-Hand Balancing
                    </h3>
                    <span className="text-[10px] text-surface-400 hidden sm:inline truncate">
                      (Kahapon • Ngayon • Bukas)
                    </span>
                  </div>
                  <span className="text-[10px] text-surface-400 block truncate">
                    Binilang: <strong className="text-emerald-400">{formatCurrency(closing.actual_cash_on_hand || 0)}</strong> • Dapat: {formatCurrency(closing.expected_cash_on_hand || 0)}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {/* Real-Time Cash Variance Status Badge */}
                {(closing.cash_discrepancy ?? 0) === 0 ? (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] sm:text-[11px] font-extrabold border border-emerald-500/40 whitespace-nowrap">
                    ✓ Sakto
                  </span>
                ) : (closing.cash_discrepancy ?? 0) > 0 ? (
                  <span className="px-2 py-0.5 rounded-full bg-primary-500/20 text-primary-400 text-[10px] sm:text-[11px] font-extrabold border border-primary-500/40 whitespace-nowrap">
                    +{formatCurrency(closing.cash_discrepancy || 0)} Over
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-danger-500/20 text-danger-400 text-[10px] sm:text-[11px] font-extrabold border border-danger-500/40 whitespace-nowrap">
                    {formatCurrency(closing.cash_discrepancy || 0)} Short
                  </span>
                )}

                {/* Drawer Style Toggle Button */}
                <button
                  type="button"
                  onClick={() => setIsCashDrawerOpen(prev => !prev)}
                  className="px-2.5 py-1 rounded-lg bg-surface-800 hover:bg-surface-700 text-primary-400 hover:text-primary-300 border border-surface-700 text-xs font-bold transition-all cursor-pointer flex items-center gap-1 shadow-xs whitespace-nowrap"
                  title="Buksan ang Cash Drawer Balancing panel"
                >
                  <span>{isCashDrawerOpen ? 'Itago ▲' : 'Balansehin ▼'}</span>
                </button>
              </div>
            </div>

            {/* Collapsible 4 Cash Balancing Steps (Drawer Body) */}
            {isCashDrawerOpen && (
              <div className="p-2 sm:p-2.5 pt-1.5 border-t border-surface-700/50 bg-surface-950/40 animate-fade-in">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5 sm:gap-2">
                  {/* Step 1: Beginning Cash (Kahapon) */}
                  <div className="p-1.5 sm:p-2 rounded-lg bg-surface-800/80 border border-surface-700/50 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] sm:text-[10px] text-surface-400 font-semibold uppercase truncate">
                        1. Pera Kahapon
                      </span>
                      <span className="text-[8px] text-surface-500 hidden xs:inline">Float</span>
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
                        className="w-full mt-0.5 px-1.5 py-0.5 rounded bg-surface-900 border border-surface-700 text-surface-100 text-xs font-bold focus:border-primary-400 focus:outline-none"
                        title="Panimulang barya sa kaha"
                      />
                    )}
                    <span className="text-[8px] sm:text-[9px] text-surface-500 mt-0.5 block truncate">Barya mula kahapon</span>
                  </div>

                  {/* Step 2: Today's Net Movement */}
                  <div className="p-1.5 sm:p-2 rounded-lg bg-surface-800/80 border border-surface-700/50 min-w-0 flex flex-col justify-between">
                    <span className="text-[9px] sm:text-[10px] text-surface-400 font-semibold uppercase truncate">
                      2. Cash Flow Ngayon
                    </span>
                    <div className="flex items-center justify-between text-[11px] font-semibold mt-0.5">
                      <span className="text-emerald-400 truncate">+{formatCurrency(closing.cash_sales ?? closing.total_revenue)}</span>
                      <span className="text-[9px] text-surface-500 shrink-0 ml-1">Benta</span>
                    </div>
                    <div className="flex items-center justify-between text-[9px] text-surface-400 mt-0.5">
                      <span className="text-danger-400 truncate">-{formatCurrency(closing.cash_expenses || 0)} OPEX</span>
                      <span className="text-amber-400 shrink-0 ml-1">-{formatCurrency(closing.bills_allocation || 0)} Bills</span>
                    </div>
                  </div>

                  {/* Step 3: Expected Cash */}
                  <div className="p-1.5 sm:p-2 rounded-lg bg-surface-800/80 border border-surface-700/50 min-w-0 flex flex-col justify-between">
                    <span className="text-[9px] sm:text-[10px] text-surface-400 font-semibold uppercase truncate">
                      3. Dapat sa Kaha
                    </span>
                    <p className="text-xs sm:text-sm font-extrabold text-surface-100 mt-0.5 truncate">
                      {formatCurrency(closing.expected_cash_on_hand || 0)}
                    </p>
                    <span className="text-[8px] sm:text-[9px] text-surface-500 mt-0.5 block truncate">Expected bago magsara</span>
                  </div>

                  {/* Step 4: Actual Physical Cash Count */}
                  <div className="p-1.5 sm:p-2 rounded-lg bg-emerald-950/30 border border-emerald-500/40 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] sm:text-[10px] text-emerald-300 font-bold uppercase truncate">
                        4. Aktwal sa Kaha
                      </span>
                      <span className="text-[8px] text-emerald-400/80 hidden xs:inline">Binilang</span>
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
                        title="Aktwal na binilang sa kaha ngayong gabi"
                      />
                    )}
                    <span className="text-[8px] sm:text-[9px] text-emerald-400/80 mt-0.5 block truncate">
                      Barya para bukas!
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Action Toolbar Below Cash Balancing & Summary Cards */}
      <div className="flex items-center justify-between gap-2 flex-shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs sm:text-sm font-bold text-surface-200 truncate">
            Reconciliation ng Paninda ({closing?.items.length || 0})
          </span>
          <span className="text-[11px] text-surface-500 hidden md:inline">
            • Sold, Natirang Tray, at Spoilage
          </span>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 flex-nowrap shrink-0 ml-auto">
          <button
            type="button"
            onClick={handleRecalculate}
            disabled={saving || loading}
            className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-200 border border-surface-700/80 text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer shadow-xs"
            title="Recalculate live sales"
          >
            <span>🔄</span>
            <span className="hidden xs:inline">Refresh</span>
          </button>

          {closing?.status === 'FINALIZED' ? (
            <button
              type="button"
              onClick={handleReopen}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs sm:text-sm font-bold whitespace-nowrap shrink-0 shadow-xs transition-all cursor-pointer"
              title="Unlock to edit counts or recalculate sales"
            >
              <span>🔓</span>
              <span>{saving ? 'Opening...' : 'Re-open'}</span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={saving || loading}
                className="flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 rounded-xl bg-primary-600/20 hover:bg-primary-600/30 text-primary-300 border border-primary-500/40 text-xs sm:text-sm font-bold whitespace-nowrap shrink-0 shadow-xs transition-all cursor-pointer"
                title="I-save ang draft para mag-reflect sa lahat ng device"
              >
                <span>💾</span>
                <span>{saving ? 'Saving...' : 'Save Draft'}</span>
              </button>

              <button
                type="button"
                onClick={handleFinalize}
                disabled={saving || loading}
                className="flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 rounded-xl bg-success-600 hover:bg-success-500 disabled:opacity-50 text-white text-xs sm:text-sm font-bold whitespace-nowrap shrink-0 shadow-xs transition-all cursor-pointer"
                title="I-finalize at i-carry over ang natirang stock bukas"
              >
                <span>🔒</span>
                <span>{saving ? 'Finalizing...' : 'Finalize'}</span>
              </button>
            </div>
          )}

          <Link
            to={`/reorder?date=${nextDateStr}`}
            className="flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs sm:text-sm font-bold whitespace-nowrap shrink-0 shadow-xs transition-all cursor-pointer"
            title="Kalkulahin ang re-order para bukas batay sa natirang ihaw"
          >
            <span>🍢</span>
            <span className="hidden sm:inline">Re-order Bukas</span>
            <span className="sm:hidden">Re-order</span>
          </Link>
        </div>
      </div>

      {/* Main Content Card (Cards or Table) */}
      <div className="flex-1 min-h-0 bg-surface-800/50 rounded-xl border border-surface-700/50 flex flex-col overflow-hidden shadow-sm">
        {/* Card/Table View Mode Switcher Toolbar */}
        <div className="flex items-center justify-between px-3 py-2 bg-surface-900 border-b border-surface-700/60 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-surface-200">
              Products ({closing?.items.length || 0})
            </span>
            <span className="text-[11px] text-surface-500 hidden sm:inline">
              • Mag-input ng Sold, Unsold tray count, at Spoilage
            </span>
          </div>

          <div className="flex items-center gap-1 bg-surface-800 p-0.5 rounded-lg border border-surface-700">
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                viewMode === 'cards' ? 'bg-primary-600 text-white shadow-sm' : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              <span>📱</span>
              <span>Cards</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                viewMode === 'table' ? 'bg-primary-600 text-white shadow-sm' : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              <span>📋</span>
              <span>Table</span>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-3 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
          </div>
        ) : !closing || closing.items.length === 0 ? (
          <div className="text-center py-16">
            <span className="text-4xl mb-3 block">📝</span>
            <p className="text-surface-300 font-medium">No products available for closing</p>
          </div>
        ) : viewMode === 'cards' ? (
          /* Mobile/Tablet Card List View with Pagination */
          <div className="flex-1 min-h-0 overflow-y-auto p-2 sm:p-3 space-y-2.5">
            {paginatedItems.map(item => {
              const isLocked = closing.status === 'FINALIZED';
              return (
                <div
                  key={item.product_id}
                  className="p-3 rounded-xl bg-surface-800/80 border border-surface-700/60 shadow-sm space-y-2.5 hover:border-surface-600/70 transition-colors"
                >
                  {/* Card Header: Product Name, SKU, SRP/Cost, Discrepancy */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-bold text-surface-100 text-sm">{item.product_name}</h3>
                        {item.discrepancy !== 0 && (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold whitespace-nowrap ${
                              item.discrepancy > 0
                                ? 'bg-primary-500/20 text-primary-300 border border-primary-500/30'
                                : 'bg-danger-500/20 text-danger-300 border border-danger-500/30'
                            }`}
                          >
                            Disc: {item.discrepancy > 0 ? `+${item.discrepancy}` : item.discrepancy}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-surface-400 mt-0.5">
                        <span>SKU: <span className="font-mono text-surface-300">{item.sku}</span></span>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="text-xs font-bold text-surface-100">{formatCurrency(item.selling_price)}</p>
                      <p className="text-[10px] text-surface-400">Cost: {formatCurrency(item.unit_cost)}</p>
                    </div>
                  </div>

                  {/* Stock Prep Grid: Ordered, Prev. Stocks, Total Qty. Prepared */}
                  <div className="grid grid-cols-3 gap-2 p-2 rounded-lg bg-surface-900/60 border border-surface-700/40">
                    <div className="flex flex-col items-center">
                      <span className="text-[10px] font-bold text-primary-300 uppercase tracking-tight whitespace-nowrap">
                        Ordered
                      </span>
                      {isLocked ? (
                        <span className="mt-1 font-bold text-primary-300 text-sm py-0.5">{item.received_qty || 0}</span>
                      ) : (
                        <input
                          type="number"
                          min="0"
                          value={item.received_qty === 0 ? '' : item.received_qty}
                          placeholder="0"
                          onFocus={e => e.target.select()}
                          onClick={e => (e.target as HTMLInputElement).select()}
                          onChange={e => handleUpdateItem(item.product_id, 'received_qty', e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                          className="w-full text-center py-0.5 mt-1 rounded bg-surface-800 border border-primary-500/40 text-primary-300 text-sm font-bold focus:border-primary-400 focus:outline-none"
                          title="Ordered stock mula sa Re-order sheet"
                        />
                      )}
                    </div>

                    <div className="flex flex-col items-center">
                      <span className="text-[10px] font-bold text-surface-400 uppercase tracking-tight whitespace-nowrap">
                        Prev. Stocks
                      </span>
                      {isLocked ? (
                        <span className="mt-1 font-bold text-surface-300 text-sm py-0.5">{item.prev_stock || 0}</span>
                      ) : (
                        <input
                          type="number"
                          min="0"
                          value={item.prev_stock === 0 ? '' : item.prev_stock}
                          placeholder="0"
                          onFocus={e => e.target.select()}
                          onClick={e => (e.target as HTMLInputElement).select()}
                          onChange={e => handleUpdateItem(item.product_id, 'prev_stock', e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                          className="w-full text-center py-0.5 mt-1 rounded bg-surface-800 border border-surface-600 text-surface-300 text-sm font-semibold focus:border-surface-400 focus:outline-none"
                          title="Natirang stock kahapon"
                        />
                      )}
                    </div>

                    <div className="flex flex-col items-center">
                      <span className="text-[10px] font-bold text-surface-200 uppercase tracking-tight whitespace-nowrap">
                        Total Prepared
                      </span>
                      {isLocked ? (
                        <span className="mt-1 font-bold text-surface-100 text-sm py-0.5">{item.prepared_qty}</span>
                      ) : (
                        <input
                          type="number"
                          min="0"
                          value={item.prepared_qty === 0 ? '' : item.prepared_qty}
                          placeholder="0"
                          onFocus={e => e.target.select()}
                          onClick={e => (e.target as HTMLInputElement).select()}
                          onChange={e => handleUpdateItem(item.product_id, 'prepared_qty', e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                          className="w-full text-center py-0.5 mt-1 rounded bg-surface-800 border border-surface-500 text-surface-100 text-sm font-bold focus:border-primary-400 focus:outline-none"
                          title="Kabuuang Paninda (Ordered + Prev. Stocks)"
                        />
                      )}
                    </div>
                  </div>

                  {/* 3 Touch-Friendly Inputs: Sold (POS), Unsold (Tray), Spoilage */}
                  <div className="grid grid-cols-3 gap-2 p-2 rounded-lg bg-surface-900/70 border border-surface-700/50">
                    {/* Sold (POS) */}
                    <div className="flex flex-col items-center">
                      <span className="text-[10px] font-bold text-primary-400 uppercase tracking-tight whitespace-nowrap">
                        Sold (POS)
                      </span>
                      {isLocked ? (
                        <span className="mt-1 font-bold text-primary-300 text-sm py-1">
                          {item.sold_qty}
                        </span>
                      ) : (
                        <input
                          type="number"
                          min="0"
                          value={item.sold_qty === 0 ? '' : item.sold_qty}
                          placeholder="0"
                          onFocus={e => e.target.select()}
                          onClick={e => (e.target as HTMLInputElement).select()}
                          onChange={e => handleUpdateItem(item.product_id, 'sold_qty', e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                          className="w-full text-center py-1 mt-1 rounded-md bg-surface-800 border border-primary-500/50 text-primary-300 text-sm font-bold focus:border-primary-400 focus:outline-none"
                          title="Sold quantity from POS (editable)"
                        />
                      )}
                    </div>

                    {/* Unsold (Tray) */}
                    <div className="flex flex-col items-center">
                      <span className="text-[10px] font-bold text-surface-300 uppercase tracking-tight whitespace-nowrap">
                        Unsold (Tray)
                      </span>
                      {isLocked ? (
                        <span className="mt-1 font-bold text-surface-200 text-sm py-1">
                          {item.unsold_qty}
                        </span>
                      ) : (
                        <input
                          type="number"
                          min="0"
                          value={item.unsold_qty === 0 ? '' : item.unsold_qty}
                          placeholder="0"
                          onFocus={e => e.target.select()}
                          onClick={e => (e.target as HTMLInputElement).select()}
                          onChange={e => handleUpdateItem(item.product_id, 'unsold_qty', e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                          className="w-full text-center py-1 mt-1 rounded-md bg-surface-800 border border-surface-600 text-surface-100 text-sm font-bold focus:border-surface-400 focus:outline-none"
                          title="Unsold tray count (editable)"
                        />
                      )}
                    </div>

                    {/* Spoilage (Input) */}
                    <div className="flex flex-col items-center">
                      <span className="text-[10px] font-bold text-danger-400 uppercase tracking-tight whitespace-nowrap">
                        Spoilage
                      </span>
                      {isLocked ? (
                        <span className="mt-1 font-bold text-danger-300 text-sm py-1">
                          {item.spoilage_qty}
                        </span>
                      ) : (
                        <input
                          type="number"
                          min="0"
                          value={item.spoilage_qty === 0 ? '' : item.spoilage_qty}
                          placeholder="0"
                          onFocus={e => e.target.select()}
                          onClick={e => (e.target as HTMLInputElement).select()}
                          onChange={e => handleUpdateItem(item.product_id, 'spoilage_qty', e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                          className="w-full text-center py-1 mt-1 rounded-md bg-surface-800 border border-danger-500/50 text-danger-300 text-sm font-bold focus:border-danger-400 focus:outline-none"
                          title="Spoiled or burnt sticks"
                        />
                      )}
                    </div>
                  </div>

                  {/* Financial Mini-Row */}
                  <div className="flex items-center justify-between pt-1 border-t border-surface-700/40 text-[11px] text-surface-400">
                    <span>Sales: <strong className="text-surface-200">{formatCurrency(item.actual_revenue)}</strong></span>
                    <span>Profit: <strong className="text-emerald-400">{formatCurrency(item.gross_profit)}</strong></span>
                    {item.spoilage_loss > 0 && (
                      <span className="text-danger-400">Spoilage: <strong>-{formatCurrency(item.spoilage_loss)}</strong></span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Table View - Fits 100% width with NO horizontal scrollbar */
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-surface-900 border-b border-surface-700/60 z-20 shadow-sm">
                <tr>
                  <th className="px-2.5 sm:px-3 py-2 text-xs font-bold text-surface-300 uppercase tracking-wider">
                    Product
                  </th>
                  <th className="hidden xl:table-cell px-2 py-2 text-xs font-bold text-surface-300 uppercase tracking-wider text-right">
                    Cost
                  </th>
                  <th className="hidden sm:table-cell px-2 py-2 text-xs font-bold text-surface-300 uppercase tracking-wider text-right">
                    Price
                  </th>
                  <th className="px-1.5 sm:px-2 py-2 text-xs font-bold text-primary-300 uppercase tracking-wider text-center whitespace-nowrap" title="Ordered mula sa Re-Order Sheet">
                    Ordered
                  </th>
                  <th className="px-1.5 sm:px-2 py-2 text-xs font-bold text-surface-400 uppercase tracking-wider text-center whitespace-nowrap" title="Natirang stock kahapon">
                    Prev. Stocks
                  </th>
                  <th className="px-1.5 sm:px-2 py-2 text-xs font-bold text-surface-200 uppercase tracking-wider text-center whitespace-nowrap" title="Total Qty. Prepared (Ordered + Prev. Stocks)">
                    Total Qty. Prepared
                  </th>
                  <th className="px-1.5 sm:px-2 py-2 text-xs font-bold text-primary-400 uppercase tracking-wider text-center">
                    Sold
                  </th>
                  <th className="px-1.5 sm:px-2 py-2 text-xs font-bold text-surface-200 uppercase tracking-wider text-center bg-surface-800/60">
                    Unsold
                  </th>
                  <th className="px-1.5 sm:px-2 py-2 text-xs font-bold text-danger-300 uppercase tracking-wider text-center bg-danger-950/20">
                    Spoilage
                  </th>
                  <th className="hidden md:table-cell px-2 py-2 text-xs font-bold text-surface-300 uppercase tracking-wider text-center">
                    Disc.
                  </th>
                  <th className="hidden xl:table-cell px-2 py-2 text-xs font-bold text-surface-300 uppercase tracking-wider text-right">
                    Sales
                  </th>
                  <th className="px-2 sm:px-3 py-2 text-xs font-bold text-emerald-400 uppercase tracking-wider text-right">
                    Profit
                  </th>
                  <th className="hidden 2xl:table-cell px-2 py-2 text-xs font-bold text-danger-300 uppercase tracking-wider text-right">
                    Loss (SRP)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-700/30">
                {paginatedItems.map(item => {
                  const isLocked = closing.status === 'FINALIZED';
                  return (
                    <tr key={item.product_id} className="hover:bg-surface-700/20 transition-colors">
                      <td className="px-2.5 sm:px-3 py-2">
                        <p className="text-surface-100 font-semibold text-xs sm:text-sm">{item.product_name}</p>
                        <div className="flex items-center gap-1.5 text-[10px] text-surface-400 sm:hidden">
                          <span>{formatCurrency(item.selling_price)}</span>
                          {item.discrepancy !== 0 && (
                            <span className={item.discrepancy > 0 ? 'text-primary-400 font-bold' : 'text-danger-400 font-bold'}>
                              ({item.discrepancy > 0 ? `+${item.discrepancy}` : item.discrepancy})
                            </span>
                          )}
                        </div>
                        <span className="hidden sm:inline text-[10px] text-surface-500">{item.sku}</span>
                      </td>
                      <td className="hidden xl:table-cell px-2 py-2 text-right text-xs text-surface-400 whitespace-nowrap">
                        {formatCurrency(item.unit_cost)}
                      </td>
                      <td className="hidden sm:table-cell px-2 py-2 text-right text-xs text-surface-200 font-medium whitespace-nowrap">
                        {formatCurrency(item.selling_price)}
                      </td>
                      {/* Ordered */}
                      <td className="px-1.5 sm:px-2 py-2 text-center text-xs font-semibold text-primary-300 whitespace-nowrap">
                        {isLocked ? (
                          item.received_qty || 0
                        ) : (
                          <input
                            type="number"
                            min="0"
                            value={item.received_qty === 0 ? '' : item.received_qty}
                            placeholder="0"
                            onFocus={e => e.target.select()}
                            onClick={e => (e.target as HTMLInputElement).select()}
                            onChange={e => handleUpdateItem(item.product_id, 'received_qty', e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                            className="w-10 sm:w-12 px-0.5 py-0.5 text-center rounded bg-surface-800 border border-primary-500/40 text-primary-300 text-xs font-bold focus:border-primary-400 focus:outline-none"
                            title="Ordered quantity"
                          />
                        )}
                      </td>

                      {/* Prev. Stocks */}
                      <td className="px-1.5 sm:px-2 py-2 text-center text-xs font-medium text-surface-300 whitespace-nowrap">
                        {isLocked ? (
                          item.prev_stock || 0
                        ) : (
                          <input
                            type="number"
                            min="0"
                            value={item.prev_stock === 0 ? '' : item.prev_stock}
                            placeholder="0"
                            onFocus={e => e.target.select()}
                            onClick={e => (e.target as HTMLInputElement).select()}
                            onChange={e => handleUpdateItem(item.product_id, 'prev_stock', e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                            className="w-10 sm:w-12 px-0.5 py-0.5 text-center rounded bg-surface-800 border border-surface-600 text-surface-300 text-xs font-semibold focus:border-surface-400 focus:outline-none"
                            title="Natirang stock kahapon"
                          />
                        )}
                      </td>

                      {/* Total Qty. Prepared */}
                      <td className="px-1.5 sm:px-2 py-2 text-center text-xs font-bold text-surface-100 whitespace-nowrap">
                        {isLocked ? (
                          item.prepared_qty
                        ) : (
                          <input
                            type="number"
                            min="0"
                            value={item.prepared_qty === 0 ? '' : item.prepared_qty}
                            placeholder="0"
                            onFocus={e => e.target.select()}
                            onClick={e => (e.target as HTMLInputElement).select()}
                            onChange={e => handleUpdateItem(item.product_id, 'prepared_qty', e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                            className="w-10 sm:w-12 px-0.5 py-0.5 text-center rounded bg-surface-800 border border-surface-600 text-surface-100 text-xs font-bold focus:border-primary-400 focus:outline-none"
                            title="Total Qty. Prepared (Ordered + Prev. Stocks)"
                          />
                        )}
                      </td>
                      {/* Sold */}
                      <td className="px-1 sm:px-2 py-2 text-center">
                        {isLocked ? (
                          <span className="font-bold text-primary-300 text-xs">
                            {item.sold_qty}
                          </span>
                        ) : (
                          <input
                            type="number"
                            min="0"
                            value={item.sold_qty === 0 ? '' : item.sold_qty}
                            placeholder="0"
                            onFocus={e => e.target.select()}
                            onClick={e => (e.target as HTMLInputElement).select()}
                            onChange={e => handleUpdateItem(item.product_id, 'sold_qty', e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                            className="w-10 sm:w-12 px-0.5 py-0.5 text-center rounded bg-surface-800 border border-primary-500/40 text-primary-300 text-xs font-bold focus:border-primary-400 focus:outline-none"
                          />
                        )}
                      </td>
                      {/* Unsold */}
                      <td className="px-1 sm:px-2 py-2 text-center bg-surface-800/30">
                        {isLocked ? (
                          <span className="font-bold text-surface-200 text-xs">
                            {item.unsold_qty}
                          </span>
                        ) : (
                          <input
                            type="number"
                            min="0"
                            value={item.unsold_qty === 0 ? '' : item.unsold_qty}
                            placeholder="0"
                            onFocus={e => e.target.select()}
                            onClick={e => (e.target as HTMLInputElement).select()}
                            onChange={e => handleUpdateItem(item.product_id, 'unsold_qty', e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                            className="w-10 sm:w-12 px-0.5 py-0.5 text-center rounded bg-surface-800 border border-surface-600/70 text-surface-100 text-xs font-bold focus:border-surface-400 focus:outline-none"
                          />
                        )}
                      </td>
                      {/* Spoilage */}
                      <td className="px-1 sm:px-2 py-2 text-center bg-danger-950/10">
                        {isLocked ? (
                          <span className="font-bold text-danger-300 text-xs">
                            {item.spoilage_qty}
                          </span>
                        ) : (
                          <input
                            type="number"
                            min="0"
                            value={item.spoilage_qty === 0 ? '' : item.spoilage_qty}
                            placeholder="0"
                            onFocus={e => e.target.select()}
                            onClick={e => (e.target as HTMLInputElement).select()}
                            onChange={e => handleUpdateItem(item.product_id, 'spoilage_qty', e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                            className="w-10 sm:w-12 px-0.5 py-0.5 text-center rounded bg-surface-800 border border-danger-500/40 text-danger-300 text-xs font-bold focus:border-danger-400 focus:outline-none"
                          />
                        )}
                      </td>
                      {/* Discrepancy indicator */}
                      <td className="hidden md:table-cell px-2 py-2 text-center whitespace-nowrap">
                        <span
                          className={`text-xs font-extrabold px-1.5 py-0.5 rounded ${
                            item.discrepancy === 0
                              ? 'text-surface-500'
                              : item.discrepancy > 0
                              ? 'bg-primary-500/20 text-primary-400'
                              : 'bg-danger-500/20 text-danger-400'
                          }`}
                        >
                          {item.discrepancy === 0 ? '0' : item.discrepancy > 0 ? `+${item.discrepancy}` : item.discrepancy}
                        </span>
                      </td>
                      <td className="hidden xl:table-cell px-2 py-2 text-right text-xs font-semibold text-surface-200 whitespace-nowrap">
                        {formatCurrency(item.actual_revenue)}
                      </td>
                      <td className="px-2 sm:px-3 py-2 text-right text-xs font-bold text-emerald-400 whitespace-nowrap">
                        {formatCurrency(item.gross_profit)}
                      </td>
                      <td className="hidden 2xl:table-cell px-2 py-2 text-right text-xs font-semibold text-danger-400 whitespace-nowrap">
                        {formatCurrency(item.spoilage_loss)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pinned Card Footer: Unified Single-Line Summary & Pagination */}
        {closing && closing.items.length > 0 && (
          <div className="flex-shrink-0 px-2.5 sm:px-4 py-2 bg-surface-900 border-t border-surface-700/60 flex items-center justify-between text-[11px] sm:text-xs flex-nowrap gap-2">
            {/* Left: Counts & Stock totals */}
            <div className="flex items-center gap-2 sm:gap-3.5 shrink-0 whitespace-nowrap">
              <span className="text-surface-400">
                <strong className="text-surface-200">
                  {pageSize >= 999 ? 1 : (currentPage - 1) * pageSize + 1}-{pageSize >= 999 ? closing.items.length : Math.min(currentPage * pageSize, closing.items.length)}
                </strong> of <strong className="text-surface-200">{closing.items.length}</strong> items
              </span>
              <span className="text-surface-600 hidden xs:inline">•</span>
              <span className="text-surface-400 hidden xs:inline">
                Unsold: <strong className="text-surface-100">{closing.total_unsold}</strong>
              </span>
              <span className="text-surface-600 hidden sm:inline">•</span>
              <span className="text-surface-400 hidden sm:inline">
                Spoilage: <strong className="text-danger-400">{closing.total_spoilage}</strong>
              </span>
              <span className="text-surface-600 hidden md:inline">•</span>
              <span className="text-surface-400 hidden md:inline">
                Net Profit: <strong className="text-emerald-400 font-bold">{formatCurrency(netEstimatedProfit)}</strong>
              </span>
            </div>

            {/* Right: Page size & Prev/Next controls */}
            <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 flex-nowrap">
              <select
                value={pageSize}
                onChange={e => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="text-[10px] sm:text-[11px] py-0.5 px-1.5 rounded bg-surface-800 border border-surface-700 text-surface-300 shrink-0 focus:outline-none cursor-pointer"
              >
                <option value={5}>5/page</option>
                <option value={10}>10/page</option>
                <option value={999}>All</option>
              </select>

              {totalPages > 1 && (
                <div className="flex items-center gap-1 shrink-0 flex-nowrap">
                  <button
                    type="button"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-2 py-0.5 rounded bg-surface-800 hover:bg-surface-700 disabled:opacity-30 disabled:cursor-not-allowed text-surface-200 font-medium transition-colors cursor-pointer border border-surface-700/60 text-[10px] sm:text-xs whitespace-nowrap shrink-0"
                  >
                    ← Prev
                  </button>
                  <span className="px-1 font-bold text-surface-200 text-[10px] sm:text-xs whitespace-nowrap shrink-0">
                    {currentPage}/{totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="px-2 py-0.5 rounded bg-surface-800 hover:bg-surface-700 disabled:opacity-30 disabled:cursor-not-allowed text-surface-200 font-medium transition-colors cursor-pointer border border-surface-700/60 text-[10px] sm:text-xs whitespace-nowrap shrink-0"
                  >
                    Next →
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
