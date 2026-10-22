import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatCurrency } from '../../utils/currency';
import { SYSTEM_START_DATE, getTodayStr } from '../../utils/date';
import {
  generateSuggestedReorder,
  saveReorderSheet,
  getPreviousDate,
} from '../../db/reorderRepository';
import { setProductStock } from '../../db/productRepository';

import type { ReorderSheet, ReorderItem } from '../../types/reorder';
import { getAllSuppliers } from '../../db/supplierRepository';
import type { Supplier } from '../../types/supplier';

export function ReorderPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawDate = searchParams.get('date') || getTodayStr();
  const initialDate = rawDate < SYSTEM_START_DATE ? SYSTEM_START_DATE : rawDate;

  const [orderDate, setOrderDate] = useState<string>(initialDate);
  const [sheet, setSheet] = useState<ReorderSheet | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>(() =>
    typeof window !== 'undefined' && window.innerWidth >= 1024 ? 'table' : 'cards'
  );
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemQty, setNewItemQty] = useState('10');
  const [newItemPrice, setNewItemPrice] = useState('15');
  const [newItemUnit, setNewItemUnit] = useState('sticks');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierFilter, setSupplierFilter] = useState<string>(''); // selected supplier name
  const [isDirty, setIsDirty] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);

  // Load or generate reorder sheet for selected date
  const loadSheet = useCallback(async (date: string, forceRecalculate = false) => {
    setLoading(true);
    setErrorMsg(null);
    setIsDirty(false);
    try {
      const basedOn = getPreviousDate(date);
      const sheetData = await generateSuggestedReorder(date, basedOn, forceRecalculate);
      setSheet(sheetData);
    } catch (err) {
      console.error('Failed to load reorder sheet:', err);
      setErrorMsg('Hindi ma-load ang re-order sheet para sa petsang ito.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced auto-save for reorder sheet changes (saves 1.5s after user edits)
  useEffect(() => {
    if (!isDirty || !sheet || sheet.status === 'LOCKED' || sheet.status === 'RECEIVED') return;

    const timer = setTimeout(async () => {
      try {
        await saveReorderSheet(sheet);
        setIsDirty(false);
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setLastSavedTime(timeStr);
      } catch (err) {
        console.warn('Reorder auto-save error:', err);
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, [sheet, isDirty]);

  // Load suppliers and auto-select first one
  useEffect(() => {
    getAllSuppliers().then(all => {
      const active = all.filter(s => s.is_active);
      setSuppliers(active);
      // Auto-select first supplier if none selected yet
      if (active.length > 0) {
        setSupplierFilter(prev => prev || active[0].name);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadSheet(orderDate);
  }, [orderDate, loadSheet]);

  // Sync date change with URL
  const handleDateChange = (newDate: string) => {
    const validDate = newDate < SYSTEM_START_DATE ? SYSTEM_START_DATE : newDate;
    setOrderDate(validDate);
    setSearchParams({ date: validDate });
  };

  // Quick date jump helpers
  const setQuickDate = (offsetDays: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const targetDate = d.toISOString().slice(0, 10);
    handleDateChange(targetDate < SYSTEM_START_DATE ? SYSTEM_START_DATE : targetDate);
  };

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  const isLocked = sheet?.status === 'ORDERED' || sheet?.status === 'LOCKED' || sheet?.status === 'RECEIVED';

  // Update a single item's property by product name (prevents index mismatch when filtered)
  const handleItemChange = (productName: string, field: keyof ReorderItem, value: any) => {
    if (!sheet || isLocked) return;
    const realIndex = sheet.items.findIndex(
      it => it.product_name.toLowerCase().trim() === productName.toLowerCase().trim()
    );
    if (realIndex === -1) return;

    const newItems = [...sheet.items];
    const current = { ...newItems[realIndex] };

    if (field === 'prev_stock') {
      const prev = value === '' ? 0 : Math.max(0, Number(value) || 0);
      current.prev_stock = prev;
      current.unsold_qty = prev; // Keep in sync for legacy compatibility
      // Auto-calculate Replenishment needed = Math.max(0, Prep Limit - Prev. Stocks)
      current.suggested_qty = Math.max(0, current.target_stock - prev);
      // Do not overwrite user's manual order_qty decision
    } else if (field === 'target_stock') {
      const target = value === '' ? 0 : Math.max(0, Number(value) || 0);
      current.target_stock = target;
      const prev = current.prev_stock ?? current.unsold_qty ?? 0;
      current.suggested_qty = Math.max(0, target - prev);
      // Do not overwrite user's manual order_qty decision
    } else if (field === 'order_qty') {
      // User manual override for order quantity (e.g. want to order more or less every day)
      const qty = value === '' ? 0 : Math.max(0, Number(value) || 0);
      current.order_qty = qty;
      current.total_cost = qty * current.reseller_price;
    } else if (field === 'reseller_price') {
      const price = value === '' ? 0 : Math.max(0, Number(value) || 0);
      current.reseller_price = price;
      current.total_cost = current.order_qty * price;
    } else {
      (current as any)[field] = value;
    }

    newItems[realIndex] = current;
    const totalQty = newItems.reduce((s, it) => s + (Number(it.order_qty) || 0), 0);
    const totalCost = newItems.reduce((s, it) => s + (Number(it.total_cost) || 0), 0);

    setSheet({
      ...sheet,
      items: newItems,
      total_quantity: totalQty,
      total_cost: totalCost,
    });
    setIsDirty(true);
  };

  /**
   * Syncs product current_stock directly from the re-order sheet.
   * Formula: new stock = prev_stock (unsold kahapon) + order_qty (ino-order ngayon)
   * We compute this directly from the sheet — NOT from Daily Closing —
   * because the Daily Closing in the DB is stale (computed before the lock).
   */
  const syncInventoryFromReorderSheet = async (reorderSheet: ReorderSheet) => {
    try {
      for (const it of reorderSheet.items) {
        if (!it.product_id || it.product_id < 0) continue; // skip custom/temp items
        const prevStock = Math.max(0, it.prev_stock ?? it.unsold_qty ?? 0);
        const ordered = Math.max(0, it.order_qty ?? 0);
        const exactStock = prevStock + ordered;
        await setProductStock(
          it.product_id,
          exactStock,
          `Re-order Locked (${reorderSheet.order_date}) — ${prevStock} prev + ${ordered} ordered = ${exactStock}`
        );
      }

      // Broadcast so POS page immediately re-renders with new stock
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('pos_inventory_updated'));
        try {
          const ch = new BroadcastChannel('pos_channel');
          ch.postMessage({ type: 'INVENTORY_UPDATED' });
          ch.close();
        } catch (_) {}
      }
    } catch (err) {
      console.warn('Could not sync inventory from reorder sheet:', err);
    }
  };

  // Lock re-order sheet → directly syncs prev_stock + order_qty into POS inventory
  const handleLockReorder = async () => {
    if (!sheet) return;
    const lockedSheet = { ...sheet, status: 'ORDERED' as const };
    await handleSave('ORDERED');
    // Compute stock from the sheet itself (not from DB — DB closing is stale at this point)
    await syncInventoryFromReorderSheet(lockedSheet);
    showToast('🔒 Naka-lock na! Ang POS stocks ay na-update na (Prev + Ordered).');
  };

  // Reopen re-order sheet for adjustments
  const handleReopenReorder = async () => {
    if (!sheet) return;
    if (!confirm('Sigurado ka bang nais mong buksan muli (re-open) ang Re-Order Sheet para baguhin ang mga numero?')) {
      return;
    }
    await handleSave('DRAFT');
    showToast('🔓 Bukas na muli ang Re-Order Sheet para sa pag-edit.');
  };

  // Save changes
  const handleSave = async (statusOverride?: 'DRAFT' | 'ORDERED' | 'RECEIVED' | 'LOCKED') => {
    if (!sheet) return;
    setSaving(true);
    try {
      const sheetToSave = {
        ...sheet,
        status: statusOverride || sheet.status,
      };
      await saveReorderSheet(sheetToSave);
      setSheet(sheetToSave);
      setIsDirty(false);
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setLastSavedTime(timeStr);

      // Broadcast update so Daily Closing immediately reflects new received_qty / orders
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('pos_reorder_saved', { detail: sheetToSave }));
        try {
          const ch = new BroadcastChannel('pos_channel');
          ch.postMessage({ type: 'REORDER_SAVED', sheet: sheetToSave });
          ch.close();
        } catch (_) {}
      }

      showToast('💾 Matagumpay na na-save ang Re-order Sheet!');
    } catch (err) {
      console.error('Error saving reorder:', err);
      setErrorMsg('Nagka-problema sa pag-save ng re-order.');
    } finally {
      setSaving(false);
    }
  };

  // Mark delivery as received + re-sync inventory (prev_stock + order_qty)
  const handleReceiveDelivery = async () => {
    if (!sheet) return;
    if (!confirm(`Nakumpirma mo bang na-deliver na ang mga orders? Ia-update ang POS stocks: Prev Stocks + Ordered.`)) {
      return;
    }

    setSaving(true);
    try {
      // Re-sync using the sheet directly (same formula: prev_stock + order_qty)
      await syncInventoryFromReorderSheet(sheet);

      const receivedSheet = {
        ...sheet,
        status: 'RECEIVED' as const,
        received_at: new Date().toISOString(),
      };
      await saveReorderSheet(receivedSheet);
      setSheet(receivedSheet);
      showToast('📦 Na-receive na! POS stocks = Prev Stocks + Ordered.');
    } catch (err) {
      console.error('Error receiving delivery:', err);
      setErrorMsg('Hindi ma-update ang inventory para sa delivery.');
    } finally {
      setSaving(false);
    }
  };

  // Copy order list to clipboard for messaging to supplier
  const handleCopyOrder = () => {
    if (!sheet) return;
    const activeItems = displayedItems.filter(it => it.order_qty > 0);
    if (activeItems.length === 0) {
      alert(`Walang mga produkto na may oorderin (0 qty) para sa ${supplierFilter || 'supplier na ito'}.`);
      return;
    }

    const currentTotalCost = activeItems.reduce((s, it) => s + (Number(it.total_cost) || 0), 0);
    const currentTotalQty = activeItems.reduce((s, it) => s + (Number(it.order_qty) || 0), 0);

    const lines: string[] = [
      `🍢 ORDER LIST PARA SA: ${sheet.order_date}`,
      `Supplier: ${supplierFilter || sheet.supplier_name || 'BBQ-SUPPLIER(Saog)'}`,
      `-----------------------------------------`,
    ];

    for (const it of activeItems) {
      lines.push(`• ${it.product_name}: ${it.order_qty} ${it.unit || 'sticks'} @ ${formatCurrency(it.reseller_price)} = ${formatCurrency(it.total_cost)}`);
    }

    lines.push(`-----------------------------------------`);
    lines.push(`Kabuuan: ${currentTotalQty} items`);
    lines.push(`Kabuuang Halaga: ${formatCurrency(currentTotalCost)}`);
    if (sheet.notes) {
      lines.push(`\nPaalala: ${sheet.notes}`);
    }

    const fullText = lines.join('\n');
    navigator.clipboard.writeText(fullText).then(() => {
      showToast('📋 Nakopya na ang Order List! Pwede mo nang i-paste sa Messenger, Viber, o text sa supplier.');
    }).catch(() => {
      prompt('Kopyahin ang Order List sa ibaba:', fullText);
    });
  };

  // Export CSV matching scripts/re_order.csv
  const handleExportCSV = () => {
    if (!sheet) return;
    const rows = [
      [`${sheet.order_date}`, 'Product Name', 'Quantity', 'Reseller Price', 'Total Cost', '', ''],
    ];

    for (const it of sheet.items) {
      rows.push([
        '',
        it.product_name,
        it.order_qty.toString(),
        it.reseller_price.toString(),
        it.total_cost.toString(),
        '',
        '',
      ]);
    }
    rows.push(['', '', '', 'TOTAL =', sheet.total_cost.toString(), '', '']);

    const csvContent = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.setAttribute('download', `ReOrder_${sheet.order_date}.csv`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('📥 Na-download na ang CSV file ng Re-order!');
  };

  // Apply suggested quantities to order_qty for displayed items
  const handleApplyAllSuggested = () => {
    if (!sheet || isLocked) return;
    const filterNorm = (supplierFilter ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const newItems = sheet.items.map(it => {
      const itSup = (it.supplier_name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (filterNorm && itSup !== filterNorm) return it;

      const orderQty = Math.max(0, it.suggested_qty || 0);
      return {
        ...it,
        order_qty: orderQty,
        total_cost: orderQty * (it.reseller_price || 0),
      };
    });
    setSheet({
      ...sheet,
      items: newItems,
      total_quantity: newItems.reduce((s, it) => s + (Number(it.order_qty) || 0), 0),
      total_cost: newItems.reduce((s, it) => s + (Number(it.total_cost) || 0), 0),
    });
    setIsDirty(true);
    showToast('🎯 Na-apply na ang Suggested Quantities sa Order Qty!');
  };

  // Reset all order_qty to 0
  const handleResetAllOrdersToZero = () => {
    if (!sheet || isLocked) return;
    const filterNorm = (supplierFilter ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const newItems = sheet.items.map(it => {
      const itSup = (it.supplier_name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (filterNorm && itSup !== filterNorm) return it;

      return {
        ...it,
        order_qty: 0,
        total_cost: 0,
      };
    });
    setSheet({
      ...sheet,
      items: newItems,
      total_quantity: newItems.reduce((s, it) => s + (Number(it.order_qty) || 0), 0),
      total_cost: newItems.reduce((s, it) => s + (Number(it.total_cost) || 0), 0),
    });
    setIsDirty(true);
    showToast('🧹 Naka-default na sa 0 ang lahat ng oorderin!');
  };

  // Add custom supply item
  const handleAddCustomItem = () => {
    if (!newItemName.trim() || !sheet) return;
    const qty = Math.max(0, Number(newItemQty) || 0);
    const price = Math.max(0, Number(newItemPrice) || 0);
    const item: ReorderItem = {
      product_id: Math.floor(Math.random() * -1000),
      product_name: newItemName.trim(),
      sku: `SUP-${Date.now().toString().slice(-4)}`,
      category_name: 'Supplies',
      target_stock: qty,
      prev_stock: 0,
      suggested_qty: qty,
      order_qty: qty,
      reseller_price: price,
      total_cost: qty * price,
      unit: newItemUnit,
    };

    const newItems = [...sheet.items, item];
    setSheet({
      ...sheet,
      items: newItems,
      total_quantity: newItems.reduce((s, it) => s + (Number(it.order_qty) || 0), 0),
      total_cost: newItems.reduce((s, it) => s + (Number(it.total_cost) || 0), 0),
    });
    setIsDirty(true);

    setNewItemName('');
    setIsAddingItem(false);
    showToast(`Idinagdag ang ${item.product_name}!`);
  };

  // Filter items by selected supplier
  const displayedItems = useMemo(() => {
    if (!sheet) return [];
    if (!supplierFilter) return sheet.items;
    const normFilter = supplierFilter.toLowerCase().replace(/[^a-z0-9]/g, '');
    const filtered = sheet.items.filter(it => {
      const itSup = (it.supplier_name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return itSup === normFilter;
    });
    // Fallback if sheet has items but no matching supplier (legacy) -> return all
    if (filtered.length === 0 && sheet.items.length > 0) return sheet.items;
    return filtered;
  }, [sheet, supplierFilter]);

  const displayedTotalQty = useMemo(() => {
    return displayedItems.reduce((s, it) => s + (Number(it.order_qty) || 0), 0);
  }, [displayedItems]);

  const displayedTotalCost = useMemo(() => {
    return displayedItems.reduce((s, it) => s + (Number(it.total_cost) || 0), 0);
  }, [displayedItems]);

  const totalPrevStock = useMemo(() => {
    return displayedItems.reduce((s, it) => s + (Number(it.prev_stock ?? it.unsold_qty) || 0), 0);
  }, [displayedItems]);

  const totalTargetCapacity = useMemo(() => {
    return displayedItems.reduce((s, it) => s + (Number(it.target_stock) || 0), 0);
  }, [displayedItems]);

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-2.5 sm:space-y-3.5 animate-fade-in">
      {/* Toast Alert */}
      {toastMsg && (
        <div className="fixed top-4 right-4 z-50 bg-emerald-500 text-white font-medium px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2 animate-slide-up">
          <span>✅</span>
          <span className="text-xs sm:text-sm">{toastMsg}</span>
        </div>
      )}

      {/* Error Alert */}
      {errorMsg && (
        <div className="rounded-xl p-3 bg-danger-500/10 border border-danger-500/30 text-danger-400 text-xs sm:text-sm flex items-center justify-between">
          <span>⚠️ {errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-danger-300 font-bold ml-2">✕</button>
        </div>
      )}

      {/* Top Header & Controls */}
      <div className="bg-surface-850/80 rounded-2xl border border-surface-700/60 p-3 sm:p-4 shadow-sm shrink-0">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Title & Info */}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xl sm:text-2xl">🍢</span>
              <h1 className="text-lg sm:text-xl font-bold text-surface-50 tracking-tight">
                BBQ Re-order Sheet
              </h1>
              {sheet && (
                <span
                  className={`text-[10px] sm:text-xs font-semibold px-2.5 py-0.5 rounded-full border ${
                    sheet.status === 'RECEIVED'
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                      : isLocked
                      ? 'bg-primary-500/20 text-primary-300 border-primary-500/30'
                      : 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                  }`}
                >
                  {sheet.status === 'RECEIVED'
                    ? '✅ Na-Deliver / Stock-In Na'
                    : isLocked
                    ? '🔒 Naka-Lock (Na-Order Na)'
                    : '📝 Draft Re-order (Bukas)'}
                </span>
              )}
            </div>
            <p className="text-[11px] sm:text-xs text-surface-400 mt-1 flex items-center gap-1.5 flex-wrap">
              <span>Formula:</span>
              <span className="text-amber-400 font-semibold font-mono">
                Suggested = Prep Limit - Natirang Unsold
              </span>
              <span className="text-surface-500">•</span>
              <span>Batay sa closing noong: <strong className="text-surface-200">{sheet?.based_on_date || getPreviousDate(orderDate)}</strong></span>
            </p>
          </div>

          {/* Date Picker & Quick Days */}
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap shrink-0">
            {/* Quick buttons */}
            <div className="flex items-center bg-surface-800 p-0.5 rounded-xl border border-surface-700/70 shrink-0">
              <button
                onClick={() => setQuickDate(-1)}
                className="px-2 py-1 text-[11px] font-medium text-surface-300 hover:text-white rounded-lg hover:bg-surface-700 transition-colors cursor-pointer"
                title="Kahapon"
              >
                Kahapon
              </button>
              <button
                onClick={() => setQuickDate(0)}
                className="px-2.5 py-1 text-[11px] font-bold text-primary-400 hover:text-primary-300 rounded-lg hover:bg-surface-700 transition-colors cursor-pointer"
                title="Ngayon"
              >
                Ngayon
              </button>
              <button
                onClick={() => setQuickDate(1)}
                className="px-2.5 py-1 text-[11px] font-bold text-emerald-400 hover:text-emerald-300 rounded-lg hover:bg-surface-700 transition-colors cursor-pointer"
                title="Bukas (Next Day Order)"
              >
                Bukas 🚀
              </button>
            </div>

            {/* Native Date Input */}
            <div className="relative">
              <input
                type="date"
                value={orderDate}
                min={SYSTEM_START_DATE}
                onChange={e => handleDateChange(e.target.value)}
                className="bg-surface-800 border border-surface-700 text-surface-100 text-xs sm:text-sm font-semibold rounded-xl px-3 py-1.5 focus:outline-none focus:border-primary-500 cursor-pointer shadow-xs"
              />
            </div>

            {/* Recalculate button */}
            <button
              onClick={() => loadSheet(orderDate, true)}
              className="p-2 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-300 border border-surface-700 text-xs cursor-pointer transition-colors"
              title="I-recalculate batay sa pinakabagong unsold"
            >
              🔄
            </button>
          </div>
        </div>

        {/* Action Button Row */}
        <div className="mt-3 pt-3 border-t border-surface-700/50 flex items-center justify-between gap-2 flex-wrap">
          {/* Left Actions */}
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            {!isLocked ? (
              <>
                <button
                  onClick={() => handleSave('DRAFT')}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 sm:py-2 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-200 border border-surface-600 text-xs font-bold transition-all cursor-pointer whitespace-nowrap disabled:opacity-50"
                  title="I-save ang kasalukuyang draft"
                >
                  <span>💾</span>
                  <span>{saving ? 'Nag-i-save...' : 'I-save Draft'}</span>
                </button>

                <button
                  onClick={handleLockReorder}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 sm:py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold shadow-xs shadow-primary-600/20 transition-all cursor-pointer whitespace-nowrap disabled:opacity-50"
                  title="I-lock ang Re-Order Sheet para maging opisyal na batayan ng Ordered items sa Daily Closing"
                >
                  <span>🔒</span>
                  <span>I-lock ang Re-Order</span>
                </button>

                {lastSavedTime && !isDirty && (
                  <span className="text-[11px] text-emerald-400 font-medium whitespace-nowrap ml-1">
                    ✓ Na-save {lastSavedTime}
                  </span>
                )}
                {isDirty && (
                  <span className="text-[11px] text-amber-400 font-medium whitespace-nowrap ml-1 animate-pulse">
                    💾 Nagse-save...
                  </span>
                )}
              </>
            ) : (
              <>
                <button
                  onClick={handleReopenReorder}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 sm:py-2 rounded-xl bg-amber-600/20 text-amber-300 hover:bg-amber-600/30 border border-amber-500/40 text-xs font-bold transition-all cursor-pointer whitespace-nowrap disabled:opacity-50"
                  title="Buksan muli (re-open) ang Re-Order Sheet para baguhin ang mga numero"
                >
                  <span>🔓</span>
                  <span>Buksan Muli (Re-open)</span>
                </button>

                {sheet?.status !== 'RECEIVED' && (
                  <button
                    onClick={handleReceiveDelivery}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-3 py-1.5 sm:py-2 rounded-xl bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 border border-emerald-500/40 text-xs font-bold transition-all cursor-pointer whitespace-nowrap"
                    title="Tanggapin ang delivery at i-stock in sa inventory"
                  >
                    <span>🚚</span>
                    <span>Tanggapin ang Delivery (Stock In)</span>
                  </button>
                )}
              </>
            )}

            {!isLocked && (
              <>
                <button
                  onClick={handleApplyAllSuggested}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 sm:py-2 rounded-xl bg-purple-600/20 text-purple-300 hover:bg-purple-600/30 border border-purple-500/40 text-xs font-bold transition-all cursor-pointer whitespace-nowrap"
                  title="I-fill ang Order Qty batay sa Suggested Replenishment"
                >
                  <span>🎯</span>
                  <span>Gamitin ang Suggested</span>
                </button>

                <button
                  onClick={handleResetAllOrdersToZero}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 sm:py-2 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-300 border border-surface-700 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                  title="I-reset sa 0 ang lahat ng order qty"
                >
                  <span>🧹</span>
                  <span>I-reset sa 0</span>
                </button>
              </>
            )}

            <button
              onClick={handleCopyOrder}
              className="flex items-center gap-1.5 px-3 py-1.5 sm:py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold shadow-xs shadow-sky-600/20 transition-all cursor-pointer whitespace-nowrap"
              title="Kopyahin para sa SMS / Viber / Messenger"
            >
              <span>📋</span>
              <span>Kopyahin ang Order List</span>
            </button>

            <button
              onClick={handleExportCSV}
              className="flex items-center gap-1.5 px-2.5 py-1.5 sm:py-2 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-300 border border-surface-700 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
            >
              <span>📥</span>
              <span className="hidden xs:inline">Export CSV</span>
            </button>
          </div>

          {/* Right toggle */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsAddingItem(!isAddingItem)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-300 border border-surface-700 text-xs font-semibold cursor-pointer"
            >
              <span>➕</span>
              <span className="text-[11px] sm:text-xs">Dagdag Item / Supply</span>
            </button>

            <div className="flex items-center bg-surface-800 p-0.5 rounded-lg border border-surface-700">
              <button
                onClick={() => setViewMode('cards')}
                className={`px-2 py-1 text-xs rounded transition-colors cursor-pointer ${
                  viewMode === 'cards' ? 'bg-primary-600 text-white' : 'text-surface-400 hover:text-white'
                }`}
                title="Cards View"
              >
                📱 Cards
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`px-2 py-1 text-xs rounded transition-colors cursor-pointer ${
                  viewMode === 'table' ? 'bg-primary-600 text-white' : 'text-surface-400 hover:text-white'
                }`}
                title="Table View"
              >
                📋 Table
              </button>
            </div>
          </div>
        </div>

        {/* Supplier Selector Dropdown */}
        <div className="mt-3 pt-3 border-t border-surface-700/50 flex items-center gap-3 flex-wrap">
          <span className="text-[11px] font-semibold text-surface-400 whitespace-nowrap shrink-0">
            🏪 Supplier:
          </span>
          <div className="flex-1 min-w-0">
            <select
              value={supplierFilter}
              onChange={e => setSupplierFilter(e.target.value)}
              className="w-full sm:w-auto min-w-[220px] px-3 py-1.5 rounded-xl bg-surface-800 border border-surface-700 text-surface-100 text-xs font-semibold focus:outline-none focus:border-primary-500 cursor-pointer transition-colors"
            >
              {suppliers.length === 0 && (
                <option value="">— Mag-add muna ng Supplier sa Settings —</option>
              )}
              {suppliers.filter(s => s.is_active).map(s => (
                <option key={s.id} value={s.name}>{s.name}</option>
              ))}
            </select>
          </div>
          {supplierFilter && (
            <span className="text-[10px] text-emerald-400 font-medium whitespace-nowrap">
              {displayedItems.length} item{displayedItems.length !== 1 ? 's' : ''} na nakita
            </span>
          )}
        </div>

        {/* Add custom item drawer */}
        {isAddingItem && (
          <div className="mt-3 p-3 bg-surface-900 rounded-xl border border-surface-700/80 grid grid-cols-1 sm:grid-cols-5 gap-2 items-end">
            <div className="sm:col-span-2">
              <label className="text-[11px] font-medium text-surface-400 block mb-1">Pangalan ng Item / Supply</label>
              <input
                type="text"
                placeholder="Hal. Uling, Tuhog, Suka, Mantika..."
                value={newItemName}
                onChange={e => setNewItemName(e.target.value)}
                className="w-full bg-surface-800 border border-surface-700 text-surface-100 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-primary-500"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-surface-400 block mb-1">Dami (Qty)</label>
              <input
                type="number"
                value={newItemQty}
                placeholder="0"
                onFocus={e => e.target.select()}
                onClick={e => (e.target as HTMLInputElement).select()}
                onChange={e => setNewItemQty(e.target.value)}
                className="w-full bg-surface-800 border border-surface-700 text-surface-100 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-primary-500"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-surface-400 block mb-1">Presyo / Cost (₱)</label>
              <input
                type="number"
                value={newItemPrice}
                placeholder="0.00"
                onFocus={e => e.target.select()}
                onClick={e => (e.target as HTMLInputElement).select()}
                onChange={e => setNewItemPrice(e.target.value)}
                className="w-full bg-surface-800 border border-surface-700 text-surface-100 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-primary-500"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-surface-400 block mb-1">Unit</label>
              <select
                value={newItemUnit}
                onChange={e => setNewItemUnit(e.target.value)}
                className="w-full bg-surface-800 border border-surface-700 text-surface-100 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-primary-500 cursor-pointer"
              >
                <option value="sticks">sticks</option>
                <option value="pcs">pcs</option>
                <option value="packs">packs</option>
                <option value="bottle">bottle</option>
                <option value="kg">kg</option>
              </select>
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={handleAddCustomItem}
                className="flex-1 py-1.5 bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold rounded-lg cursor-pointer transition-colors"
              >
                Idagdag
              </button>
              <button
                onClick={() => setIsAddingItem(false)}
                className="px-2.5 py-1.5 bg-surface-800 hover:bg-surface-700 text-surface-400 text-xs rounded-lg cursor-pointer transition-colors"
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 4 Summary Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 shrink-0">
        {/* Total Order Qty */}
        <div className="bg-surface-850/90 rounded-xl p-3 border border-surface-700/60 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] sm:text-[11px] font-bold text-primary-400 uppercase tracking-wider block">
              🍢 Kabuuang Oorderin
            </span>
            <span className="text-xl sm:text-2xl font-black text-surface-50 mt-0.5 block">
              {displayedTotalQty}
              <span className="text-xs font-medium text-surface-400 ml-1">sticks/pcs</span>
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-primary-500/10 border border-primary-500/20 flex items-center justify-center text-lg text-primary-400">
            📦
          </div>
        </div>

        {/* Total Cost */}
        <div className="bg-surface-850/90 rounded-xl p-3 border border-surface-700/60 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] sm:text-[11px] font-bold text-amber-400 uppercase tracking-wider block">
              💰 Kabuuang Halaga
            </span>
            <span className="text-xl sm:text-2xl font-black text-amber-300 mt-0.5 block">
              {formatCurrency(displayedTotalCost)}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-lg text-amber-400">
            💵
          </div>
        </div>

        {/* Prev Stocks Yesterday */}
        <div className="bg-surface-850/90 rounded-xl p-3 border border-surface-700/60 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] sm:text-[11px] font-bold text-sky-400 uppercase tracking-wider block">
              ⚖️ Prev. Stocks
            </span>
            <span className="text-xl sm:text-2xl font-black text-sky-300 mt-0.5 block">
              {totalPrevStock}
              <span className="text-xs font-medium text-surface-400 ml-1">sticks sa tray</span>
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-lg text-sky-400">
            🍢
          </div>
        </div>

        {/* Target Capacity */}
        <div className="bg-surface-850/90 rounded-xl p-3 border border-surface-700/60 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] sm:text-[11px] font-bold text-emerald-400 uppercase tracking-wider block">
              🎯 Target Par Stock
            </span>
            <span className="text-xl sm:text-2xl font-black text-emerald-300 mt-0.5 block">
              {totalTargetCapacity}
              <span className="text-xs font-medium text-surface-400 ml-1">par capacity</span>
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-lg text-emerald-400">
            🎯
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 bg-surface-850/80 rounded-2xl border border-surface-700/60 flex flex-col overflow-hidden shadow-sm">
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20">
            <div className="w-10 h-10 border-3 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
            <p className="text-xs text-surface-400 mt-3 font-medium">Kinakalkula ang re-order sheet...</p>
          </div>
        ) : !sheet || sheet.items.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-16 text-center">
            <span className="text-4xl mb-2">🍢</span>
            <p className="text-surface-200 font-bold text-sm">Walang data para sa re-order sheet</p>
            <button
              onClick={() => loadSheet(orderDate, true)}
              className="mt-3 px-4 py-2 bg-primary-600 text-white text-xs rounded-xl font-semibold hover:bg-primary-500 cursor-pointer"
            >
              Kalkulahin Ngayon
            </button>
          </div>
        ) : viewMode === 'cards' ? (
          /* Mobile Friendly Card View */
          <div className="flex-1 min-h-0 overflow-y-auto p-2.5 sm:p-3 space-y-2">
            {displayedItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-surface-500 gap-2">
                <span className="text-3xl">🏪</span>
                <p className="text-sm font-medium">Walang items para sa supplier na "{supplierFilter}".</p>
                <p className="text-xs text-surface-600">Mag-add ng items sa Inventory → Order Items tab.</p>
              </div>
            ) : displayedItems.map((item, idx) => {
              const isZeroOrder = item.order_qty === 0;
              return (
                <div
                  key={item.product_id || idx}
                  className={`p-3 rounded-xl border transition-all ${
                    isZeroOrder
                      ? 'bg-surface-900/40 border-surface-800/60 opacity-75'
                      : 'bg-surface-900/80 border-surface-700/80 shadow-xs'
                  }`}
                >
                  {/* Card Header: Product name & Cost */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-sm font-bold text-surface-100 block truncate">
                        {item.product_name}
                      </span>
                      <span className="text-[10px] text-surface-400 font-mono">
                        Reseller: {formatCurrency(item.reseller_price)} / {item.unit || 'stick'}
                      </span>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="text-xs text-surface-400 block text-[10px]">Subtotal:</span>
                      <span className={`text-sm font-black ${isZeroOrder ? 'text-surface-500' : 'text-amber-400'}`}>
                        {formatCurrency(item.total_cost)}
                      </span>
                    </div>
                  </div>

                  {/* Math Breakdown Badges */}
                  <div className="grid grid-cols-4 gap-1.5 sm:gap-2 mt-2.5 pt-2 border-t border-surface-800/80 text-center">
                    {/* Prep / Limit */}
                    <div className="bg-surface-800/80 p-1.5 rounded-lg border border-surface-700/50">
                      <span className="text-[9px] uppercase font-bold text-surface-400 block truncate">Prep / Limit</span>
                      <div className="flex items-center justify-center gap-1 mt-0.5">
                        {!isLocked ? (
                          <input
                            type="number"
                            min="0"
                            value={item.target_stock === 0 ? '' : item.target_stock}
                            placeholder="0"
                            onFocus={e => e.target.select()}
                            onClick={e => (e.target as HTMLInputElement).select()}
                            onChange={e => handleItemChange(item.product_name, 'target_stock', e.target.value)}
                            className="w-10 sm:w-12 text-center bg-surface-900 border border-surface-700/70 text-xs font-bold text-surface-100 rounded py-0.5 focus:outline-none focus:border-primary-500"
                            title="Prep / Target Limit"
                          />
                        ) : (
                          <span className="text-xs font-bold text-surface-200">{item.target_stock}</span>
                        )}
                      </div>
                    </div>

                    {/* Prev. Stocks */}
                    <div className="bg-surface-800/80 p-1.5 rounded-lg border border-sky-500/40">
                      <span className="text-[9px] uppercase font-bold text-sky-400 block truncate" title="Natirang stock kahapon">Prev. Stocks</span>
                      <div className="flex items-center justify-center gap-1 mt-0.5">
                        {!isLocked ? (
                          <input
                            type="number"
                            min="0"
                            value={(item.prev_stock ?? item.unsold_qty ?? 0) === 0 ? '' : (item.prev_stock ?? item.unsold_qty)}
                            placeholder="0"
                            onFocus={e => e.target.select()}
                            onClick={e => (e.target as HTMLInputElement).select()}
                            onChange={e => handleItemChange(item.product_name, 'prev_stock', e.target.value)}
                            className="w-10 sm:w-12 text-center bg-surface-900 border border-sky-500/60 text-xs font-bold text-sky-300 rounded py-0.5 focus:outline-none focus:border-sky-400"
                            title="Natirang stock / Previous stocks kahapon"
                          />
                        ) : (
                          <span className="text-xs font-bold text-sky-300">{item.prev_stock ?? item.unsold_qty ?? 0}</span>
                        )}
                      </div>
                    </div>

                    {/* Suggested (Prep - Prev. Stocks) */}
                    <div className="bg-surface-800/80 p-1.5 rounded-lg border border-surface-600/50">
                      <span className="text-[9px] uppercase font-bold text-surface-400 block truncate" title="Prep minus Prev. Stocks">Suggested</span>
                      <div className="flex items-center justify-center mt-1">
                        <span className="text-xs font-bold text-surface-300">{item.suggested_qty}</span>
                      </div>
                    </div>

                    {/* Quantity Ordered */}
                    <div className="bg-primary-950/40 p-1.5 rounded-lg border border-primary-500/40">
                      <span className="text-[9px] uppercase font-bold text-primary-300 block truncate">Ordered</span>
                      <div className="flex items-center justify-center gap-0.5 sm:gap-1 mt-0.5">
                        {!isLocked ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleItemChange(item.product_name, 'order_qty', Math.max(0, item.order_qty - 1))}
                              className="w-4 h-5 sm:w-5 sm:h-5 rounded bg-surface-800 hover:bg-surface-700 text-surface-200 text-xs font-bold flex items-center justify-center cursor-pointer"
                            >
                              -
                            </button>
                            <input
                              type="number"
                              min="0"
                              value={item.order_qty === 0 ? '' : item.order_qty}
                              placeholder="0"
                              onFocus={e => e.target.select()}
                              onClick={e => (e.target as HTMLInputElement).select()}
                              onChange={e => handleItemChange(item.product_name, 'order_qty', e.target.value)}
                              className="w-9 sm:w-11 text-center bg-surface-900 border border-primary-500/60 text-xs font-black text-primary-200 rounded py-0.5 focus:outline-none focus:border-primary-400"
                              title="Dami na oorderin (pwedeng i-override)"
                            />
                            <button
                              type="button"
                              onClick={() => handleItemChange(item.product_name, 'order_qty', item.order_qty + 1)}
                              className="w-4 h-5 sm:w-5 sm:h-5 rounded bg-surface-800 hover:bg-surface-700 text-surface-200 text-xs font-bold flex items-center justify-center cursor-pointer"
                            >
                              +
                            </button>
                          </>
                        ) : (
                          <span className="text-xs font-black text-primary-300 flex items-center gap-0.5">
                            🔒 {item.order_qty}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Math explanation sentence */}
                  <p className="text-[10px] text-surface-400 mt-1.5 text-center italic">
                    Prep ({item.target_stock}) - Prev. Stocks ({item.prev_stock ?? item.unsold_qty ?? 0}) = Suggested ({item.suggested_qty}) ➔ <strong className={item.order_qty > 0 ? 'text-primary-300' : 'text-surface-400'}>Ordered: {item.order_qty} {item.unit || 'sticks'} ({formatCurrency(item.total_cost)})</strong>
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          /* Desktop / Tablet Table View */
          <div className="flex-1 min-h-0 overflow-auto">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-surface-900 border-b border-surface-700/80 z-10 shadow-xs">
                <tr>
                  <th className="px-3 py-2.5 text-[11px] font-bold text-surface-400 uppercase whitespace-nowrap">
                    Pangalan ng Item
                  </th>
                  <th className="px-2.5 py-2.5 text-[11px] font-bold text-surface-300 uppercase text-center whitespace-nowrap">
                    Prep / Limit
                  </th>
                  <th className="px-2.5 py-2.5 text-[11px] font-bold text-sky-400 uppercase text-center whitespace-nowrap" title="Natirang stock kahapon">
                    Prev. Stocks
                  </th>
                  <th className="px-2.5 py-2.5 text-[11px] font-bold text-surface-400 uppercase text-center whitespace-nowrap" title="Mungkahi batay sa Prep minus Prev. Stocks">
                    Suggested
                  </th>
                  <th className="px-2.5 py-2.5 text-[11px] font-bold text-primary-300 uppercase text-center whitespace-nowrap" title="Aktwal na oorderin">
                    Ordered {isLocked && '🔒'}
                  </th>
                  <th className="px-3 py-2.5 text-[11px] font-bold text-surface-400 uppercase text-right whitespace-nowrap">
                    Reseller Price
                  </th>
                  <th className="px-3 py-2.5 text-[11px] font-bold text-amber-400 uppercase text-right whitespace-nowrap">
                    Total Cost
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-700/40 text-xs">
                {displayedItems.map((item, idx) => {
                  const isZero = item.order_qty === 0;
                  return (
                    <tr
                      key={item.product_id || idx}
                      className={`hover:bg-surface-750/30 transition-colors ${
                        isZero ? 'bg-surface-900/30 opacity-70' : 'bg-surface-900/10'
                      }`}
                    >
                      {/* Name */}
                      <td className="px-3 py-2 text-surface-100 font-semibold whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="text-amber-400">🍢</span>
                          <span>{item.product_name}</span>
                          <span className="text-[10px] text-surface-500 font-normal">({item.unit || 'sticks'})</span>
                        </div>
                      </td>

                      {/* Prep / Limit */}
                      <td className="px-2 py-2 text-center whitespace-nowrap">
                        {!isLocked ? (
                          <input
                            type="number"
                            min="0"
                            value={item.target_stock === 0 ? '' : item.target_stock}
                            placeholder="0"
                            onFocus={e => e.target.select()}
                            onClick={e => (e.target as HTMLInputElement).select()}
                            onChange={e => handleItemChange(item.product_name, 'target_stock', e.target.value)}
                            className="w-14 text-center bg-surface-800 border border-surface-700 rounded px-1 py-1 text-xs font-bold text-surface-100 focus:outline-none focus:border-primary-500"
                            title="Target Limit / Panimulang Inihaw"
                          />
                        ) : (
                          <span className="font-bold text-surface-200">{item.target_stock}</span>
                        )}
                      </td>

                      {/* Prev. Stocks */}
                      <td className="px-2 py-2 text-center whitespace-nowrap">
                        {!isLocked ? (
                          <input
                            type="number"
                            min="0"
                            value={(item.prev_stock ?? item.unsold_qty ?? 0) === 0 ? '' : (item.prev_stock ?? item.unsold_qty)}
                            placeholder="0"
                            onFocus={e => e.target.select()}
                            onClick={e => (e.target as HTMLInputElement).select()}
                            onChange={e => handleItemChange(item.product_name, 'prev_stock', e.target.value)}
                            className="w-14 text-center bg-surface-800 border border-sky-500/50 rounded px-1 py-1 text-xs font-bold text-sky-300 focus:outline-none focus:border-sky-400"
                            title="Natira sa tray / Previous stocks kahapon"
                          />
                        ) : (
                          <span className="font-bold text-sky-300">{item.prev_stock ?? item.unsold_qty ?? 0}</span>
                        )}
                      </td>

                      {/* Suggested */}
                      <td className="px-2 py-2 text-center whitespace-nowrap">
                        <span className="px-2 py-0.5 bg-surface-800 text-surface-300 font-bold rounded">
                          {item.suggested_qty}
                        </span>
                      </td>

                      {/* Order Qty */}
                      <td className="px-2 py-2 text-center whitespace-nowrap">
                        {!isLocked ? (
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleItemChange(item.product_name, 'order_qty', Math.max(0, item.order_qty - 1))}
                              className="w-6 h-6 rounded bg-surface-800 hover:bg-surface-700 text-surface-200 text-xs font-bold flex items-center justify-center cursor-pointer"
                            >
                              -
                            </button>
                            <input
                              type="number"
                              min="0"
                              value={item.order_qty === 0 ? '' : item.order_qty}
                              placeholder="0"
                              onFocus={e => e.target.select()}
                              onClick={e => (e.target as HTMLInputElement).select()}
                              onChange={e => handleItemChange(item.product_name, 'order_qty', e.target.value)}
                              className="w-14 text-center bg-surface-800 border border-primary-500/50 rounded px-1 py-1 text-xs font-black text-primary-300 focus:outline-none focus:border-primary-400"
                              title="Dami na oorderin (pwedeng i-override kung ilan gusto orderin)"
                            />
                            <button
                              type="button"
                              onClick={() => handleItemChange(item.product_name, 'order_qty', item.order_qty + 1)}
                              className="w-6 h-6 rounded bg-surface-800 hover:bg-surface-700 text-surface-200 text-xs font-bold flex items-center justify-center cursor-pointer"
                            >
                              +
                            </button>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-primary-950/60 border border-primary-500/40 text-primary-300 font-black rounded-lg">
                            🔒 {item.order_qty}
                          </span>
                        )}
                      </td>

                      {/* Price */}
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        {!isLocked ? (
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={item.reseller_price === 0 ? '' : item.reseller_price}
                            placeholder="0.00"
                            onFocus={e => e.target.select()}
                            onClick={e => (e.target as HTMLInputElement).select()}
                            onChange={e => handleItemChange(item.product_name, 'reseller_price', e.target.value)}
                            className="w-16 text-right bg-surface-800 border border-surface-700 rounded px-1.5 py-1 text-xs text-surface-200 focus:outline-none focus:border-primary-500"
                          />
                        ) : (
                          <span className="text-surface-300 font-mono">{formatCurrency(item.reseller_price)}</span>
                        )}
                      </td>

                      {/* Total Cost */}
                      <td className="px-3 py-2 text-right font-black text-amber-300 whitespace-nowrap">
                        {formatCurrency(item.total_cost)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="sticky bottom-0 bg-surface-900 border-t-2 border-surface-700 z-10 shadow-md">
                <tr>
                  <td colSpan={4} className="px-3 py-2.5 text-xs font-bold text-surface-300 uppercase">
                    KABUUANG OORDERIN AT GASTOS:
                  </td>
                  <td className="px-3 py-2.5 text-center text-sm font-black text-primary-400">
                    {sheet.total_quantity} sticks
                  </td>
                  <td></td>
                  <td className="px-3 py-2.5 text-right text-sm font-black text-amber-300">
                    {formatCurrency(sheet.total_cost)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Footer Notes & Supplier */}
        {sheet && (
          <div className="p-3 bg-surface-900/90 border-t border-surface-700/60 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs shrink-0">
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <span className="text-surface-400 font-medium whitespace-nowrap">Supplier:</span>
              {/* Dropdown from saved suppliers */}
              <select
                value={sheet.supplier_name}
                onChange={e => setSheet({ ...sheet, supplier_name: e.target.value })}
                className="bg-surface-800 border border-surface-700 text-surface-200 rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-primary-500 w-full sm:w-56 cursor-pointer"
              >
                <option value="">— Piliin ang Supplier —</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <span className="text-surface-400 font-medium whitespace-nowrap">Paalala (Notes):</span>
              <input
                type="text"
                value={sheet.notes || ''}
                onChange={e => setSheet({ ...sheet, notes: e.target.value })}
                placeholder="Hal. Paki-deliver bago mag-3pm..."
                className="bg-surface-800 border border-surface-700 text-surface-200 rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-primary-500 w-full sm:w-64"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
