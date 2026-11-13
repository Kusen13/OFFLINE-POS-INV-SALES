import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatCurrency } from '../../utils/currency';
import { SYSTEM_START_DATE, getTodayStr } from '../../utils/date';
import {
  generateSuggestedReorder,
  saveReorderSheet,
  getPreviousDate,
} from '../../db/reorderRepository';
import { getAllSuppliers } from '../../db/supplierRepository';
import { setProductStock } from '../../db/productRepository';
import type { ReorderSheet, ReorderItem } from '../../types/reorder';
import type { Supplier } from '../../types/supplier';
import { getCategoryIcon } from '../../types/product';
import type { BusinessType, BusinessDepartment } from '../../types/product';
import { getAllBusinessDepartments } from '../../utils/businessStorage';
import { type RicePackagingFilter, RICE_PACKAGING_OPTIONS, matchRicePackaging } from '../../utils/ricePackaging';

const getItemDept = (it: ReorderItem): BusinessType => {
  if (it.business_type) return it.business_type as BusinessType;
  const cat = (it.category_name || '').toLowerCase();
  if (cat.includes('bigas') || cat.includes('rice')) return 'rice';
  if (cat.includes('gulay') || cat.includes('veg')) return 'vegetables';
  if (cat.includes('bbq') || cat.includes('inihaw') || cat.includes('barbeque') || cat.includes('pork') || cat.includes('chicken')) return 'barbeque';
  return 'groceries';
};

const getDeptStatus = (sheet: ReorderSheet | null, dept: BusinessType): 'DRAFT' | 'ORDERED' | 'LOCKED' | 'RECEIVED' => {
  if (!sheet) return 'DRAFT';
  if (sheet.dept_status && sheet.dept_status[dept]) {
    return sheet.dept_status[dept];
  }
  return sheet.status || 'DRAFT';
};

const safeQty = (val: number | string | undefined | null, isWeight = false): string | number => {
  if (val === undefined || val === null || val === '') return 0;
  const num = typeof val === 'number' ? val : parseFloat(String(val));
  if (isNaN(num)) return 0;
  return isWeight ? Number(num.toFixed(2)) : Math.round(num);
};

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
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemQty, setNewItemQty] = useState('10');
  const [newItemPrice, setNewItemPrice] = useState('15');
  const [newItemUnit, setNewItemUnit] = useState('sticks');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierFilter, setSupplierFilter] = useState<string>('');
  const [itemTypeFilter, setItemTypeFilter] = useState<'all' | 'product' | 'supply'>('all');
  const [departments, setDepartments] = useState<BusinessDepartment[]>(() => getAllBusinessDepartments());
  const [selectedDept, setSelectedDept] = useState<BusinessType>('barbeque');

  useEffect(() => {
    const handleDeptUpdated = () => setDepartments(getAllBusinessDepartments());
    window.addEventListener('pos_departments_updated', handleDeptUpdated);
    return () => window.removeEventListener('pos_departments_updated', handleDeptUpdated);
  }, []);
  const [categoryFilter, setCategoryFilter] = useState<number | null>(null);
  const [ricePackagingFilter, setRicePackagingFilter] = useState<RicePackagingFilter>('all');
  const [isDirty, setIsDirty] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const [editingPriceKey, setEditingPriceKey] = useState<string | null>(null);

  // All items in the currently selected business department
  const deptAllItems = useMemo(() => {
    if (!sheet || !sheet.items) return [];
    return sheet.items.filter(it => getItemDept(it) === selectedDept);
  }, [sheet, selectedDept]);

  const productCount = useMemo(() => deptAllItems.filter(it => (it.item_type || 'product') !== 'supply').length, [deptAllItems]);
  const supplyCount = useMemo(() => deptAllItems.filter(it => it.item_type === 'supply').length, [deptAllItems]);

  // Derive unique categories from sheet items filtered by selectedDept and itemTypeFilter
  const reorderCategories = useMemo(() => {
    const seen = new Map<number, { id: number; name: string; business_type?: string; count: number }>();
    for (const it of deptAllItems) {
      if (itemTypeFilter !== 'all' && (it.item_type || 'product') !== itemTypeFilter) continue;
      const catId = it.category_id ?? 1;
      const catName = it.category_name || 'General';
      if (seen.has(catId)) {
        seen.get(catId)!.count++;
      } else {
        seen.set(catId, { id: catId, name: catName, business_type: selectedDept, count: 1 });
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [deptAllItems, itemTypeFilter, selectedDept]);

  // Suppliers that supply items in this department
  const deptSuppliers = useMemo(() => {
    const seen = new Set<string>();
    for (const it of deptAllItems) {
      if (it.supplier_name && it.supplier_name.trim().length > 0) {
        seen.add(it.supplier_name.trim());
      }
    }
    for (const sup of suppliers) {
      const sName = sup.name.trim();
      if (selectedDept === 'barbeque' && (sName.toLowerCase().includes('bbq') || sName.toLowerCase().includes('saog') || sName.toLowerCase().includes('meyc'))) {
        seen.add(sName);
      } else if (selectedDept === 'rice' && (sName.toLowerCase().includes('rice') || sName.toLowerCase().includes('bocaue') || sName.toLowerCase().includes('bigas'))) {
        seen.add(sName);
      } else if (selectedDept === 'vegetables' && (sName.toLowerCase().includes('veg') || sName.toLowerCase().includes('gulay') || sName.toLowerCase().includes('bagsakan') || sName.toLowerCase().includes('market'))) {
        seen.add(sName);
      } else if (selectedDept === 'groceries' && (sName.toLowerCase().includes('groc') || sName.toLowerCase().includes('puregold') || sName.toLowerCase().includes('whole'))) {
        seen.add(sName);
      }
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [deptAllItems, suppliers, selectedDept]);

  // Reset category filter if it no longer exists in selectedDept
  useEffect(() => {
    if (categoryFilter !== null && reorderCategories.length > 0 && !reorderCategories.some(c => c.id === categoryFilter)) {
      setCategoryFilter(null);
    }
  }, [reorderCategories, categoryFilter]);

  const activeCategory = useMemo(() => {
    if (reorderCategories.length === 0) return null;
    return reorderCategories.find(c => c.id === categoryFilter) || reorderCategories[0];
  }, [reorderCategories, categoryFilter]);

  const activeCatName = (activeCategory?.name ?? '').toLowerCase();
  const isBbqCategory = 
    activeCatName.includes('inihaw') || 
    activeCatName.includes('bbq') || 
    activeCatName.includes('barbeque') ||
    activeCatName.includes('ulam') ||
    activeCatName.includes('luto') ||
    activeCatName.includes('cooked') ||
    activeCatName.includes('tinapay') ||
    activeCatName.includes('bakery') ||
    activeCatName.includes('bread');

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

  // Load suppliers
  useEffect(() => {
    getAllSuppliers().then(all => {
      const active = all.filter(s => s.is_active);
      setSuppliers(active);
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

  // Status is strictly scoped to the currently selected business department
  const activeDeptStatus = useMemo(() => getDeptStatus(sheet, selectedDept), [sheet, selectedDept]);
  const isLocked = activeDeptStatus === 'ORDERED' || activeDeptStatus === 'LOCKED' || activeDeptStatus === 'RECEIVED';

  // Update a single item's property by product name (prevents index mismatch when filtered)
  const handleItemChange = (productName: string, field: keyof ReorderItem, value: any) => {
    if (!sheet) return;
    const realIndex = sheet.items.findIndex(
      it => it.product_name.toLowerCase().trim() === productName.toLowerCase().trim()
    );
    if (realIndex === -1) return;

    const currentItem = sheet.items[realIndex];
    const itemDept = getItemDept(currentItem);
    const itemDeptStatus = getDeptStatus(sheet, itemDept);
    if (itemDeptStatus === 'ORDERED' || itemDeptStatus === 'LOCKED' || itemDeptStatus === 'RECEIVED') {
      return; // Locked for this department!
    }

    const newItems = [...sheet.items];
    const current = { ...currentItem };
    const isWeight = current.sell_by_weight ?? false;

    if (field === 'prev_stock') {
      const prev = value === '' ? 0 : Math.max(0, Number(value) || 0);
      current.prev_stock = isWeight ? Number(prev.toFixed(2)) : Math.round(prev);
      current.unsold_qty = current.prev_stock; // Keep in sync for legacy compatibility
      current.suggested_qty = Math.max(0, current.target_stock - current.prev_stock);
    } else if (field === 'target_stock') {
      const target = value === '' ? 0 : Math.max(0, Number(value) || 0);
      current.target_stock = isWeight ? Number(target.toFixed(2)) : Math.round(target);
      const prev = current.prev_stock ?? current.unsold_qty ?? 0;
      current.suggested_qty = Math.max(0, current.target_stock - prev);
    } else if (field === 'order_qty') {
      const qty = value === '' ? 0 : Math.max(0, Number(value) || 0);
      current.order_qty = isWeight ? Number(qty.toFixed(2)) : Math.round(qty);
      current.total_cost = Number((current.order_qty * current.reseller_price).toFixed(2));
    } else if (field === 'min_stock_level') {
      const minVal = value === '' ? 0 : Math.max(0, Number(value) || 0);
      current.min_stock_level = Math.round(minVal);
    } else if (field === 'reseller_price') {
      const price = value === '' ? 0 : Math.max(0, Number(value) || 0);
      current.reseller_price = Number(price.toFixed(2));
      current.total_cost = Number((current.order_qty * current.reseller_price).toFixed(2));
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
   * PREP Stock Sync — called right after locking/receiving a re-order sheet per department.
   *
   * Formula:  current_stock = prev_stock + order_qty  (same as Daily Closing PREP column)
   *
   * This lets POS and Inventory show the correct prepared/available stock for the day
   * WITHOUT requiring the user to Finalize Daily Closing first.
   *
   * At end-of-shift, Daily Closing Finalize will overwrite current_stock with unsold_qty
   * (the actual leftover after sales). This two-step approach mirrors a real-world kitchen:
   *   1. Morning: Prep your stock → shelves get filled (this function)
   *   2. Night:   Count what's left → shelves get updated (Daily Closing Finalize)
   */
  const syncPrepStockFromReorder = async (reorderSheet: ReorderSheet, targetDept: BusinessType) => {
    const itemsToSync = reorderSheet.items.filter(it => getItemDept(it) === targetDept);

    for (const it of itemsToSync) {
      if (!it.product_id || it.product_id < 0) continue; // skip custom/ad-hoc items
      const prevStock = Math.max(0, it.prev_stock ?? it.unsold_qty ?? 0);
      const ordered   = Math.max(0, it.order_qty ?? 0);
      const prepStock = prevStock + ordered; // PREP = yesterday's unsold + today's delivery
      try {
        await setProductStock(
          it.product_id,
          prepStock,
          `PREP stock from Re-order (${reorderSheet.order_date}) [${targetDept}]: ${prevStock} prev + ${ordered} ordered = ${prepStock}`
        );
      } catch (err) {
        console.warn(`Hindi ma-update ang stock ng product ${it.product_id}:`, err);
      }
    }

    // Broadcast para mag-refresh agad ang POS at Inventory
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('pos_inventory_updated'));
      window.dispatchEvent(new CustomEvent('pos_sync_completed'));
      try {
        const ch = new BroadcastChannel('pos_channel');
        ch.postMessage({ type: 'INVENTORY_UPDATED' });
        ch.close();
      } catch (_) {}
    }
  };

  // Lock re-order sheet → sets PREP stock (prev + ordered) in POS/Inventory immediately.
  // Flow: Re-order Lock → current_stock = PREP (prev + ordered) → POS sells against PREP
  //       → End of shift: Daily Closing Finalize → current_stock = unsold_qty (actual leftover)
  const handleLockReorder = async () => {
    if (!sheet) return;
    const deptItems = deptAllItems.filter(it => (it.order_qty || 0) > 0);
    const deptLabel = departments.find(d => d.id === selectedDept)?.label || selectedDept;

    const confirmed = window.confirm(
      `🔒 Sigurado ka bang nais mong I-LOCK ang Re-Order Sheet para sa ${deptLabel}?\n\n` +
      `📦 Awtomatikong mag-a-update ng PREP stocks ang POS at Inventory para sa ${deptItems.length} items ng ${deptLabel}.\n` +
      `   PREP = Dati (prev) + Naiorder ngayon (ordered)\n\n` +
      `Ang ibang mga negosyo ay mananatiling bukas (Draft).`
    );
    if (!confirmed) return;

    setSaving(true);
    try {
      // 1. Write PREP stock (prev + ordered) to POS/Inventory IMMEDIATELY — no need to Finalize
      await syncPrepStockFromReorder(sheet, selectedDept);

      // 2. Mark this dept as RECEIVED in the sheet
      const updatedDeptStatus = { ...(sheet.dept_status || {}), [selectedDept]: 'RECEIVED' as const };
      const updatedReceivedAt = { ...(sheet.dept_received_at || {}), [selectedDept]: new Date().toISOString() };
      const allDeptsReceived = departments.every(d => updatedDeptStatus[d.id] === 'RECEIVED');

      const receivedSheet: ReorderSheet = {
        ...sheet,
        dept_status: updatedDeptStatus,
        dept_received_at: updatedReceivedAt,
        status: allDeptsReceived ? 'RECEIVED' : sheet.status,
      };
      await saveReorderSheet(receivedSheet);
      setSheet(receivedSheet);
      setIsDirty(false);

      // Broadcast so Daily Closing refreshes its PREP column display
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('pos_reorder_saved', { detail: receivedSheet }));
        try {
          const ch = new BroadcastChannel('pos_channel');
          ch.postMessage({ type: 'REORDER_SAVED', sheet: receivedSheet });
          ch.close();
        } catch (_) {}
      }
      showToast(`🔒 Naka-lock na ang ${deptLabel}! Na-update na ang POS stocks (PREP = prev + ordered). Mag-Finalize ng Daily Closing sa katapusan ng shift.`);
    } catch (err) {
      console.error('Error locking reorder:', err);
      setErrorMsg('Hindi ma-lock ang Re-Order Sheet. Subukan muli.');
    } finally {
      setSaving(false);
    }
  };

  // Reopen re-order sheet for adjustments (strictly per-department)
  const handleReopenReorder = async () => {
    if (!sheet) return;
    const deptLabel = departments.find(d => d.id === selectedDept)?.label || selectedDept;
    if (!confirm(`Sigurado ka bang nais mong buksan muli (re-open) ang Re-Order Sheet para sa ${deptLabel}?`)) {
      return;
    }
    const updatedDeptStatus = { ...(sheet.dept_status || {}), [selectedDept]: 'DRAFT' as const };
    const updatedSheet: ReorderSheet = {
      ...sheet,
      dept_status: updatedDeptStatus,
      status: 'DRAFT',
    };
    await saveReorderSheet(updatedSheet);
    setSheet(updatedSheet);
    setIsDirty(false);
    showToast(`🔓 Bukas na muli ang Re-Order Sheet para sa ${deptLabel}.`);
  };

  // Save changes
  const handleSave = async (statusOverride?: 'DRAFT' | 'ORDERED' | 'RECEIVED' | 'LOCKED') => {
    if (!sheet) return;
    setSaving(true);
    try {
      const updatedDeptStatus = statusOverride
        ? { ...(sheet.dept_status || {}), [selectedDept]: statusOverride }
        : sheet.dept_status;

      const sheetToSave: ReorderSheet = {
        ...sheet,
        dept_status: updatedDeptStatus,
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

  // Mark delivery as received per-department → writes PREP stock to POS/Inventory immediately.
  // Flow: Receive Delivery → current_stock = PREP (prev + ordered) → POS sells against PREP
  //       → End of shift: Daily Closing Finalize → current_stock = unsold_qty
  const handleReceiveDelivery = async () => {
    if (!sheet) return;
    const deptItems = deptAllItems.filter(it => (it.order_qty || 0) > 0);
    const deptLabel = departments.find(d => d.id === selectedDept)?.label || selectedDept;

    if (deptItems.length === 0) {
      alert(`Walang mga items na may oorderin (0 qty) para sa ${deptLabel}.`);
      return;
    }
    if (!confirm(
      `Nakumpirma mo bang na-deliver na ang paninda para sa ${deptLabel}?\n\n` +
      `📦 Awtomatikong mag-a-update ng PREP stocks ang POS at Inventory para sa ${deptItems.length} produkto.\n` +
      `   PREP = Dati (prev) + Naiorder ngayon (ordered)\n\n` +
      `I-Finalize ang Daily Closing sa katapusan ng shift para i-record ang unsold.`
    )) {
      return;
    }

    setSaving(true);
    try {
      // 1. Write PREP stock (prev + ordered) to POS/Inventory IMMEDIATELY
      await syncPrepStockFromReorder(sheet, selectedDept);

      // 2. Mark dept as RECEIVED
      const updatedDeptStatus = { ...(sheet.dept_status || {}), [selectedDept]: 'RECEIVED' as const };
      const updatedReceivedAt = { ...(sheet.dept_received_at || {}), [selectedDept]: new Date().toISOString() };
      const allDeptsReceived = departments.every(d => updatedDeptStatus[d.id] === 'RECEIVED');

      const receivedSheet: ReorderSheet = {
        ...sheet,
        dept_status: updatedDeptStatus,
        dept_received_at: updatedReceivedAt,
        status: allDeptsReceived ? 'RECEIVED' : sheet.status,
      };
      await saveReorderSheet(receivedSheet);
      setSheet(receivedSheet);
      setIsDirty(false);

      // Broadcast so Daily Closing refreshes its PREP column display
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('pos_reorder_saved', { detail: receivedSheet }));
        try {
          const ch = new BroadcastChannel('pos_channel');
          ch.postMessage({ type: 'REORDER_SAVED', sheet: receivedSheet });
          ch.close();
        } catch (_) {}
      }
      showToast(`📦 Matagumpay na natanggap ang delivery para sa ${deptLabel}! Na-update na ang POS stocks (PREP = prev + ordered). Mag-Finalize ng Daily Closing sa katapusan ng shift.`);
    } catch (err) {
      console.error('Error receiving delivery:', err);
      setErrorMsg('Hindi ma-update ang Re-Order sheet para sa delivery.');
    } finally {
      setSaving(false);
    }
  };

  // Filter items by selectedDept, itemTypeFilter, Category, and Supplier
  const displayedItems = useMemo(() => {
    let items = deptAllItems;

    if (itemTypeFilter !== 'all') {
      items = items.filter(it => (it.item_type || 'product') === itemTypeFilter);
    }

    if (categoryFilter !== null) {
      items = items.filter(it => (it.category_id ?? 1) === categoryFilter);
    }

    if (selectedDept === 'rice' && ricePackagingFilter !== 'all') {
      items = items.filter(it => matchRicePackaging(it.product_name, it.unit, it.sell_by_weight, ricePackagingFilter));
    }

    if (supplierFilter && supplierFilter.trim() !== '') {
      const normFilter = supplierFilter.toLowerCase().replace(/[^a-z0-9]/g, '');
      const supMatched = items.filter(it => {
        const itSup = (it.supplier_name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
        return itSup === normFilter;
      });
      if (supMatched.length > 0) items = supMatched;
    }

    return items;
  }, [deptAllItems, itemTypeFilter, categoryFilter, selectedDept, ricePackagingFilter, supplierFilter]);

  const isWeightCategory = !isBbqCategory && (
    activeCatName.includes('gulay') ||
    activeCatName.includes('vegetable') ||
    activeCatName.includes('bigas') ||
    activeCatName.includes('rice') ||
    displayedItems.some(it => it.sell_by_weight)
  );



  // Copy order list to clipboard for messaging to supplier
  const handleCopyOrder = () => {
    if (!sheet) return;
    const activeItems = displayedItems.filter(it => it.order_qty > 0);
    if (activeItems.length === 0) {
      alert(`Walang mga produkto na may oorderin (0 qty) para sa ${activeCategory?.name || 'kategoryang ito'}.`);
      return;
    }

    const currentTotalCost = activeItems.reduce((s, it) => s + (Number(it.total_cost) || 0), 0);
    const currentTotalQty = activeItems.reduce((s, it) => s + (Number(it.order_qty) || 0), 0);

    const lines: string[] = [
      `📝 ORDER LIST PARA SA: ${sheet.order_date}`,
      `Category: ${activeCategory?.name || 'General'}`,
      `Supplier: ${supplierFilter || 'Lahat ng Supplier'}`,
      `-----------------------------------------`,
    ];

    for (const it of activeItems) {
      const formattedQty = it.sell_by_weight ? it.order_qty.toFixed(2) : it.order_qty;
      lines.push(`• ${it.product_name}: ${formattedQty} ${it.unit || 'pcs'} @ ${formatCurrency(it.reseller_price)} = ${formatCurrency(it.total_cost)}`);
    }

    lines.push(`-----------------------------------------`);
    lines.push(`Kabuuan: ${isWeightCategory ? currentTotalQty.toFixed(2) + ' kg' : currentTotalQty + ' items'}`);
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
      [`${sheet.order_date}`, 'Product Name', 'Quantity', 'Reseller Price', 'Total Cost', 'Category', 'Supplier'],
    ];

    for (const it of displayedItems) {
      rows.push([
        '',
        it.product_name,
        it.order_qty.toString(),
        it.reseller_price.toString(),
        it.total_cost.toString(),
        it.category_name || '',
        it.supplier_name || '',
      ]);
    }
    rows.push(['', '', '', 'TOTAL =', displayedTotalCost.toString(), '', '']);

    const csvContent = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.setAttribute('download', `ReOrder_${activeCategory?.name || 'Sheet'}_${sheet.order_date}.csv`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('📥 Na-download na ang CSV file ng Re-order!');
  };

  // Apply suggested quantities to order_qty for displayed items
  const handleApplyAllSuggested = () => {
    if (!sheet || isLocked) return;
    const displayedNames = new Set(displayedItems.map(it => it.product_name.toLowerCase().trim()));
    const newItems = sheet.items.map(it => {
      if (!displayedNames.has(it.product_name.toLowerCase().trim())) return it;
      const orderQty = Math.max(0, it.suggested_qty || 0);
      return {
        ...it,
        order_qty: orderQty,
        total_cost: Number((orderQty * (it.reseller_price || 0)).toFixed(2)),
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

  // Reset all order_qty to 0 for displayed items
  const handleResetAllOrdersToZero = () => {
    if (!sheet || isLocked) return;
    const displayedNames = new Set(displayedItems.map(it => it.product_name.toLowerCase().trim()));
    const newItems = sheet.items.map(it => {
      if (!displayedNames.has(it.product_name.toLowerCase().trim())) return it;
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
    showToast('🧹 Naka-default na sa 0 ang lahat ng oorderin sa kategoryang ito!');
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
      category_id: categoryFilter ?? 1,
      category_name: activeCategory?.name || 'Supplies',
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
    <div className="flex-1 min-h-0 flex flex-col space-y-1.5 sm:space-y-2 animate-fade-in pb-16 lg:pb-0">
      {/* Toast Alert */}
      {toastMsg && (
        <div className="fixed top-4 right-4 z-50 bg-emerald-500 text-white font-medium px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2 animate-slide-up">
          <span>✅</span>
          <span className="text-xs sm:text-sm">{toastMsg}</span>
        </div>
      )}

      {/* Error Alert */}
      {errorMsg && (
        <div className="rounded-xl p-2.5 bg-danger-500/10 border border-danger-500/30 text-danger-400 text-xs sm:text-sm flex items-center justify-between shrink-0">
          <span>⚠️ {errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-danger-300 font-bold ml-2 cursor-pointer">✕</button>
        </div>
      )}

      {/* Row 1: Date, Quick Days, Status, and Action Buttons (Strictly max 1 slim row, zero cutoffs on mobile) */}
      <div className="flex-shrink-0 flex items-center justify-between gap-1.5">
        {/* Left: Date & Status */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center gap-1 bg-surface-900 border border-surface-700/80 rounded-lg px-2 py-0.5 shadow-xs">
            <span className="text-[11px] text-surface-400">📅</span>
            <input
              type="date"
              value={orderDate}
              min={SYSTEM_START_DATE}
              onChange={e => handleDateChange(e.target.value)}
              className="text-xs bg-transparent text-surface-100 font-semibold cursor-pointer focus:outline-none w-25 sm:w-28"
            />
          </div>

          {/* Quick Date pill buttons (visible on sm/desktop, mobile has native date + shortcuts in ⋯) */}
          <div className="hidden sm:flex items-center bg-surface-900 border border-surface-700/80 rounded-lg p-0.5 shadow-xs">
            <button
              type="button"
              onClick={() => setQuickDate(-1)}
              className="px-1.5 py-0.5 text-[10px] font-medium text-surface-400 hover:text-white rounded hover:bg-surface-800 transition-colors cursor-pointer"
              title="Kahapon"
            >
              Kahapon
            </button>
            <button
              type="button"
              onClick={() => setQuickDate(0)}
              className="px-1.5 py-0.5 text-[10px] font-bold text-primary-400 hover:text-primary-300 rounded hover:bg-surface-800 transition-colors cursor-pointer"
              title="Ngayon"
            >
              Ngayon
            </button>
            <button
              type="button"
              onClick={() => setQuickDate(1)}
              className="px-1.5 py-0.5 text-[10px] font-bold text-emerald-400 hover:text-emerald-300 rounded hover:bg-surface-800 transition-colors cursor-pointer"
              title="Bukas (Order para sa susunod na araw)"
            >
              Bukas 🚀
            </button>
          </div>

          {sheet && (
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap shadow-xs ${
                activeDeptStatus === 'RECEIVED'
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                  : isLocked
                  ? 'bg-primary-500/20 text-primary-300 border-primary-500/30'
                  : 'bg-warning-500/20 text-warning-400 border-warning-500/30'
              }`}
            >
              {activeDeptStatus === 'RECEIVED' ? '✓ Received' : isLocked ? '🔒 Locked' : 'Draft'}
            </span>
          )}

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

        {/* Right: Consolidated Action Buttons (Save, Lock / Re-open, Stock-In + More Actions Overflow Menu) */}
        <div className="flex items-center gap-1 shrink-0 py-0.5 relative">
          {!isLocked ? (
            <>
              <button
                type="button"
                onClick={() => handleSave('DRAFT')}
                disabled={saving || loading}
                className="px-2.5 py-1 rounded-lg bg-surface-800 hover:bg-surface-700 text-surface-200 border border-surface-600 text-xs font-bold whitespace-nowrap shrink-0 shadow-xs transition-all cursor-pointer flex items-center gap-1 active:scale-95 disabled:opacity-50"
                title="I-save ang kasalukuyang draft"
              >
                <span>💾</span>
                <span>{saving ? '...' : 'Save'}</span>
              </button>

              <button
                type="button"
                onClick={handleLockReorder}
                disabled={saving || loading}
                className="px-2.5 py-1 rounded-lg bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold whitespace-nowrap shrink-0 shadow-xs transition-all cursor-pointer flex items-center gap-1 active:scale-95 disabled:opacity-50"
                title="I-lock ang Re-Order Sheet para sa negosyong ito"
              >
                <span>🔒</span>
                <span>Lock</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handleReopenReorder}
                disabled={saving || loading}
                className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold whitespace-nowrap shrink-0 shadow-xs transition-all cursor-pointer flex items-center gap-1 active:scale-95 disabled:opacity-50"
                title="Buksan muli ang Re-Order Sheet"
              >
                <span>🔓</span>
                <span>Re-open</span>
              </button>

              {activeDeptStatus !== 'RECEIVED' && (
                <button
                  type="button"
                  onClick={handleReceiveDelivery}
                  disabled={saving || loading}
                  className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold whitespace-nowrap shrink-0 shadow-xs transition-all cursor-pointer flex items-center gap-1 active:scale-95 disabled:opacity-50"
                  title="Tanggapin ang delivery at i-stock in sa inventory"
                >
                  <span>📦</span>
                  <span>Stock In</span>
                </button>
              )}
            </>
          )}

          {/* More Actions Dropdown Menu (No Refresh clutter on main toolbar!) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsMoreMenuOpen(prev => !prev)}
              className="p-1 px-1.5 rounded-lg bg-surface-800 hover:bg-surface-700 text-surface-200 border border-surface-700 text-xs font-bold cursor-pointer transition-all active:scale-95 flex items-center"
              title="Higit pang Aksyon"
            >
              <span>⋯</span>
            </button>

            {isMoreMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setIsMoreMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-1 z-40 bg-surface-850 border border-surface-700/80 rounded-xl shadow-xl py-1 min-w-[170px] animate-fade-in text-xs">
                  {/* Date Quick Jump on mobile inside ⋯ */}
                  <div className="sm:hidden px-3 py-1.5 border-b border-surface-700/40 flex items-center gap-1 bg-surface-900/50">
                    <button
                      type="button"
                      onClick={() => { setQuickDate(-1); setIsMoreMenuOpen(false); }}
                      className="flex-1 py-1 text-[10px] text-surface-300 hover:text-white text-center rounded bg-surface-800"
                    >
                      Kahapon
                    </button>
                    <button
                      type="button"
                      onClick={() => { setQuickDate(0); setIsMoreMenuOpen(false); }}
                      className="flex-1 py-1 text-[10px] text-primary-300 font-bold text-center rounded bg-surface-800"
                    >
                      Ngayon
                    </button>
                    <button
                      type="button"
                      onClick={() => { setQuickDate(1); setIsMoreMenuOpen(false); }}
                      className="flex-1 py-1 text-[10px] text-emerald-400 font-bold text-center rounded bg-surface-800"
                    >
                      Bukas 🚀
                    </button>
                  </div>

                  {!isLocked && (
                    <>
                      <button
                        type="button"
                        onClick={() => { handleApplyAllSuggested(); setIsMoreMenuOpen(false); }}
                        className="w-full text-left flex items-center gap-2 px-3 py-2 text-purple-300 hover:bg-surface-700/60 font-semibold cursor-pointer"
                      >
                        <span>🎯</span>
                        <span>Apply Suggested</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { handleResetAllOrdersToZero(); setIsMoreMenuOpen(false); }}
                        className="w-full text-left flex items-center gap-2 px-3 py-2 text-surface-200 hover:bg-surface-700/60 font-semibold cursor-pointer"
                      >
                        <span>🧹</span>
                        <span>Clear All (0)</span>
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => { handleCopyOrder(); setIsMoreMenuOpen(false); }}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 text-sky-300 hover:bg-surface-700/60 font-semibold cursor-pointer"
                  >
                    <span>📋</span>
                    <span>Copy List (SMS/Viber)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { handleExportCSV(); setIsMoreMenuOpen(false); }}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 text-surface-200 hover:bg-surface-700/60 font-semibold cursor-pointer"
                  >
                    <span>📥</span>
                    <span>Export CSV</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setIsAddingItem(true); setIsMoreMenuOpen(false); }}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 text-emerald-300 hover:bg-surface-700/60 font-semibold cursor-pointer border-t border-surface-700/40"
                  >
                    <span>➕</span>
                    <span>Add Custom Supply</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { loadSheet(orderDate, true); setIsMoreMenuOpen(false); }}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 text-surface-300 hover:bg-surface-700/60 font-semibold cursor-pointer border-t border-surface-700/40"
                  >
                    <span>🔄</span>
                    <span>Recalculate Sheet</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── BUSINESS DEPARTMENTS SELECTOR RIBBON ── */}
      <div className="flex-shrink-0 flex items-center gap-1.5 py-1 flex-nowrap overflow-x-auto no-scrollbar">
        {departments.map(dept => {
          const deptCount = (sheet?.items || []).filter(it => getItemDept(it) === dept.id).length;
          const isSelected = selectedDept === dept.id;
          const deptSt = getDeptStatus(sheet, dept.id);
          const statusIcon = deptSt === 'RECEIVED' ? '✅' : (deptSt === 'LOCKED' || deptSt === 'ORDERED' ? '🔒' : null);
          return (
            <button
              key={dept.id}
              type="button"
              onClick={() => { setSelectedDept(dept.id); setCategoryFilter(null); setRicePackagingFilter('all'); setSupplierFilter(''); }}
              className={`h-7 px-3 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer border ${
                isSelected
                  ? `${dept.activeColor} shadow-md`
                  : 'bg-surface-800/80 text-surface-300 border-surface-700/60 hover:bg-surface-700/70 hover:text-white'
              }`}
            >
              <span>{dept.icon}</span>
              <span>{dept.label}</span>
              {statusIcon && <span className="text-[10px]" title={`Status: ${deptSt}`}>{statusIcon}</span>}
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${isSelected ? 'bg-black/25 text-white' : 'bg-surface-700 text-surface-400'}`}>
                {deptCount}
              </span>
            </button>
          );
        })}
      </div>

      {/* Row 2: Type Filter + Category Selector + Packaging Filter + Supplier Filter + Financial Ribbon + Notes */}
      <div className="flex-shrink-0 space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-1 p-1 px-2 rounded-xl bg-surface-900 border border-surface-700/60 text-xs shadow-xs">
          {/* Left: Item Type Pills + Category Dropdown + Sukat Dropdown + Supplier Dropdown */}
          <div className="flex items-center gap-1 flex-wrap shrink-0">
            {/* Products vs Supplies toggle */}
            <div className="flex items-center bg-surface-800/90 border border-surface-700/80 rounded-lg p-0.5 shadow-xs">
              <button
                type="button"
                onClick={() => setItemTypeFilter('all')}
                className={`px-2 py-0.5 text-[11px] font-bold rounded-md transition-all cursor-pointer ${
                  itemTypeFilter === 'all'
                    ? 'bg-surface-700 text-white shadow-xs'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                Lahat ({deptAllItems.length})
              </button>
              <button
                type="button"
                onClick={() => setItemTypeFilter('product')}
                className={`px-2 py-0.5 text-[11px] font-bold rounded-md transition-all flex items-center gap-1 cursor-pointer ${
                  itemTypeFilter === 'product'
                    ? 'bg-primary-600 text-white shadow-xs'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                <span>🛒</span>
                <span>Products ({productCount})</span>
              </button>
              <button
                type="button"
                onClick={() => setItemTypeFilter('supply')}
                className={`px-2 py-0.5 text-[11px] font-bold rounded-md transition-all flex items-center gap-1 cursor-pointer ${
                  itemTypeFilter === 'supply'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                <span>📦</span>
                <span>Supplies ({supplyCount})</span>
              </button>
            </div>

            {/* Category Dropdown */}
            <select
              value={categoryFilter ?? ''}
              onChange={e => {
                const val = e.target.value;
                setCategoryFilter(val ? Number(val) : null);
              }}
              className="px-2 py-0.5 rounded-lg bg-surface-800 border border-surface-700/80 text-surface-100 text-xs font-bold focus:outline-none focus:border-primary-500 cursor-pointer shadow-xs max-w-[135px] sm:max-w-xs truncate"
            >
              <option value="">🏷️ Lahat ng Kategorya ({reorderCategories.length})</option>
              {reorderCategories.map(cat => (
                <option key={cat.id} value={cat.id}>
                  {getCategoryIcon(cat.name)} {cat.name} ({cat.count})
                </option>
              ))}
            </select>

            {/* Bigasan (Rice) Packaging Filter Dropdown - Inlined */}
            {selectedDept === 'rice' && (
              <select
                value={ricePackagingFilter}
                onChange={e => setRicePackagingFilter(e.target.value as RicePackagingFilter)}
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

            {/* Supplier Filter Dropdown - Permanently Visible! */}
            <select
              value={supplierFilter}
              onChange={e => setSupplierFilter(e.target.value)}
              className="px-2 py-0.5 rounded-lg bg-surface-800 border border-surface-700/80 text-surface-100 text-xs font-bold focus:outline-none focus:border-primary-500 cursor-pointer shadow-xs max-w-[145px] sm:max-w-xs truncate"
              title="I-filter ayon sa Supplier ng negosyong ito"
            >
              <option value="">🏢 Lahat ng Supplier ({deptSuppliers.length})</option>
              {deptSuppliers.map(sup => (
                <option key={sup} value={sup}>
                  🏪 {sup}
                </option>
              ))}
            </select>
          </div>

          {/* Center: Live Order Metrics Ribbon */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0 whitespace-nowrap text-[11px] sm:text-xs">
            <span className="text-surface-400">
              Order: <strong className="text-surface-100 font-extrabold">{safeQty(displayedTotalQty, isWeightCategory)} {isWeightCategory ? 'kg' : isBbqCategory ? 'stk' : 'pcs'}</strong>
            </span>
            <span className="text-surface-700">•</span>
            <span className="text-surface-400">
              Halaga: <strong className="text-amber-400 font-extrabold">{formatCurrency(displayedTotalCost)}</strong>
            </span>
            <span className="text-surface-700 hidden md:inline">•</span>
            <span className="text-surface-400 hidden md:inline">
              Prev: <strong className="text-sky-400 font-extrabold">{safeQty(totalPrevStock, isWeightCategory)}</strong>
            </span>
          </div>

          {/* Right: Notes Toggle Button */}
          <div className="flex items-center shrink-0 ml-auto whitespace-nowrap">
            <button
              type="button"
              onClick={() => setIsNotesOpen(prev => !prev)}
              className="px-2 py-0.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1 cursor-pointer bg-surface-800 text-surface-300 border-surface-700/80 hover:bg-surface-700"
              title="Toggle Notes & Supplier details"
            >
              <span>📝</span>
              <span className="text-[10px] hidden xs:inline">Notes</span>
              <span className="text-[9px]">{isNotesOpen ? '▲' : '▼'}</span>
            </button>
          </div>
        </div>

        {/* Collapsible Notes & Supplier Panel */}
        {isNotesOpen && sheet && (
          <div className="p-2 rounded-xl border border-surface-700/50 bg-surface-950/70 animate-fade-in shadow-sm flex flex-col sm:flex-row items-center gap-2 text-xs">
            {/* Supplier selector inside panel */}
            <div className="flex items-center gap-1.5 w-full sm:w-auto">
              <span className="text-surface-400 text-[11px] whitespace-nowrap">Supplier:</span>
              <select
                value={sheet.supplier_name || ''}
                onChange={e => {
                  setSheet({ ...sheet, supplier_name: e.target.value });
                  setIsDirty(true);
                }}
                className="bg-surface-800 border border-surface-700 text-surface-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-primary-500 w-full sm:w-48 cursor-pointer"
              >
                <option value="">— Piliin ang Supplier —</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5 w-full sm:flex-1">
              <span className="text-surface-400 text-[11px] whitespace-nowrap">Paalala:</span>
              <input
                type="text"
                value={sheet.notes || ''}
                onChange={e => {
                  setSheet({ ...sheet, notes: e.target.value });
                  setIsDirty(true);
                }}
                placeholder="Hal. Paki-deliver bago mag-3pm..."
                className="bg-surface-800 border border-surface-700 text-surface-200 rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-primary-500 w-full"
              />
            </div>
          </div>
        )}

        {/* Collapsible Custom Item Drawer */}
        {isAddingItem && (
          <div className="p-2 sm:p-2.5 bg-surface-950/90 rounded-xl border border-surface-700/80 grid grid-cols-1 sm:grid-cols-5 gap-2 items-end text-xs shadow-sm animate-fade-in">
            <div className="sm:col-span-2">
              <label className="text-[10px] font-medium text-surface-400 block mb-0.5">Pangalan ng Item / Supply</label>
              <input
                type="text"
                placeholder="Hal. Uling, Tuhog, Suka..."
                value={newItemName}
                onChange={e => setNewItemName(e.target.value)}
                className="w-full bg-surface-800 border border-surface-700 text-surface-100 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-primary-500"
              />
            </div>
            <div>
              <label className="text-[10px] font-medium text-surface-400 block mb-0.5">Dami (Qty)</label>
              <input
                type="number"
                value={newItemQty}
                placeholder="0"
                onFocus={e => e.target.select()}
                onClick={e => (e.target as HTMLInputElement).select()}
                onChange={e => setNewItemQty(e.target.value)}
                className="w-full bg-surface-800 border border-surface-700 text-surface-100 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-primary-500"
              />
            </div>
            <div>
              <label className="text-[10px] font-medium text-surface-400 block mb-0.5">Presyo (₱)</label>
              <input
                type="number"
                value={newItemPrice}
                placeholder="0.00"
                onFocus={e => e.target.select()}
                onClick={e => (e.target as HTMLInputElement).select()}
                onChange={e => setNewItemPrice(e.target.value)}
                className="w-full bg-surface-800 border border-surface-700 text-surface-100 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-primary-500"
              />
            </div>
            <div className="flex gap-1">
              <select
                value={newItemUnit}
                onChange={e => setNewItemUnit(e.target.value)}
                className="bg-surface-800 border border-surface-700 text-surface-100 rounded-lg px-1.5 py-1 text-xs focus:outline-none focus:border-primary-500 cursor-pointer"
              >
                <option value="sticks">sticks</option>
                <option value="pcs">pcs</option>
                <option value="packs">packs</option>
                <option value="bottle">bottle</option>
                <option value="kg">kg</option>
              </select>
              <button
                type="button"
                onClick={handleAddCustomItem}
                className="flex-1 py-1 bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold rounded-lg cursor-pointer transition-colors"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => setIsAddingItem(false)}
                className="px-2 py-1 bg-surface-800 hover:bg-surface-700 text-surface-400 text-xs rounded-lg cursor-pointer"
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main Table Container (Pure Table - Fills 100% of remaining vertical screen height) */}
      <div className="flex-1 min-h-0 bg-surface-900 rounded-xl border border-surface-700/60 flex flex-col overflow-hidden shadow-sm">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-3 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
          </div>
        ) : !sheet || displayedItems.length === 0 ? (
          <div className="text-center py-16">
            <span className="text-4xl mb-3 block">📋</span>
            <p className="text-surface-300 font-medium">Walang produkto sa kategoryang ito</p>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead className="sticky top-0 bg-surface-900 border-b border-surface-700/60 z-20 shadow-sm">
                <tr>
                  <th className="px-2 py-1.5 text-[11px] font-bold text-surface-300 uppercase tracking-wider text-left min-w-[95px]">
                    PRODUCT
                  </th>
                  <th className="px-1 py-1.5 text-[11px] font-bold text-surface-200 uppercase tracking-wider text-center min-w-[42px]" title={isBbqCategory ? 'Target Prep Limit' : 'Par Stock / Target'}>
                    TARGET
                  </th>
                  <th className="px-1 py-1.5 text-[11px] font-bold text-purple-300 uppercase tracking-wider text-center min-w-[40px]" title="Suggested Replenishment Qty">
                    SUGG
                  </th>
                  <th className="px-1 py-1.5 text-[11px] font-bold text-primary-300 uppercase tracking-wider text-center min-w-[46px]" title="Order Quantity">
                    ORDER
                  </th>
                  <th className="px-2 py-1.5 text-[11px] font-bold text-amber-300 uppercase tracking-wider text-right min-w-[55px]" title="Total Cost">
                    TOTAL
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-700/30">
                {displayedItems.map((item, idx) => {
                  const isWeightItem = item.sell_by_weight ?? false;
                  const prevStockVal = item.prev_stock ?? item.unsold_qty ?? 0;
                  const isLowStock = prevStockVal <= (item.min_stock_level ?? 5);
                  const isZero = (item.order_qty || 0) === 0;
                  const isFastMoving = item.suggested_qty > 0 && item.suggested_qty >= (item.target_stock || 10) * 0.6;
                  const isSlowMoving = prevStockVal >= (item.target_stock || 10) && item.suggested_qty === 0;

                  return (
                    <tr
                      key={item.product_id || idx}
                      className={`hover:bg-surface-750/30 transition-colors ${
                        isZero ? 'bg-surface-900/20 opacity-75' : 'bg-surface-900/40'
                      }`}
                    >
                      {/* Col 1: PRODUCT + Price + Prev Stock */}
                      <td className="px-2 py-2 sm:py-2.5">
                        <div className="flex items-center gap-1 flex-wrap">
                          <p className="text-surface-100 font-semibold text-xs truncate max-w-[105px] sm:max-w-none">
                            {item.product_name}
                          </p>
                          {item.item_type === 'supply' && (
                            <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1 py-0.2 rounded font-bold border border-amber-500/40">
                              Supply
                            </span>
                          )}
                          {isLowStock && (
                            <span className="text-[9px] bg-rose-500/20 text-rose-300 px-1 py-0.2 rounded font-bold border border-rose-500/40" title="Kritikal: Mababa na ang stock sa estante">
                              LOW
                            </span>
                          )}
                          {isFastMoving && (
                            <span className="text-[9px] bg-emerald-500/20 text-emerald-300 px-1 py-0.2 rounded font-bold border border-emerald-500/40" title="Mabilis mabenta, nangangailangan ng replenishment">
                              🔥 Fast
                            </span>
                          )}
                          {isSlowMoving && (
                            <span className="text-[9px] bg-surface-700/80 text-surface-400 px-1 py-0.2 rounded font-medium border border-surface-600/60" title="Walang gaanong bawas, nakatengga ang stock">
                              💤 Slow
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-surface-400 mt-0.5">
                          {editingPriceKey === item.product_name ? (
                            <input
                              type="number"
                              min="0"
                              step="0.5"
                              autoFocus
                              defaultValue={item.reseller_price}
                              onBlur={e => {
                                handleItemChange(item.product_name, 'reseller_price', e.target.value);
                                setEditingPriceKey(null);
                              }}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  handleItemChange(item.product_name, 'reseller_price', (e.target as HTMLInputElement).value);
                                  setEditingPriceKey(null);
                                } else if (e.key === 'Escape') {
                                  setEditingPriceKey(null);
                                }
                              }}
                              className="w-14 h-5 px-1 bg-surface-800 border border-amber-500/80 rounded text-amber-300 text-[10px] font-bold focus:outline-none"
                            />
                          ) : (
                            <span
                              onClick={() => !isLocked && setEditingPriceKey(item.product_name)}
                              className={`text-amber-400 font-bold ${!isLocked ? 'cursor-pointer hover:underline' : ''}`}
                              title={!isLocked ? 'Pindutin upang i-edit ang presyo' : ''}
                            >
                              {formatCurrency(item.reseller_price)}
                            </span>
                          )}
                          <span>•</span>
                          <span title="Prev Stock / Leftover">{safeQty(item.prev_stock ?? item.unsold_qty, isWeightItem)} prev</span>
                        </div>
                      </td>

                      {/* Col 2: TARGET */}
                      <td className="px-1 py-2 sm:py-2.5 text-center">
                        {!isLocked ? (
                          <input
                            type="number"
                            min="0"
                            step={isWeightItem ? '0.1' : '1'}
                            value={Number(item.target_stock) === 0 ? '' : safeQty(item.target_stock, isWeightItem)}
                            placeholder="0"
                            onFocus={e => e.target.select()}
                            onClick={e => (e.target as HTMLInputElement).select()}
                            onChange={e => handleItemChange(item.product_name, 'target_stock', e.target.value)}
                            className="w-10 sm:w-11 h-7 mx-auto px-0.5 text-center rounded bg-surface-800 border border-surface-700 text-surface-100 text-xs font-bold focus:border-primary-400 focus:outline-none"
                            title={isBbqCategory ? 'Target Prep Limit' : 'Par Stock / Target'}
                          />
                        ) : (
                          <span className="text-xs font-bold text-surface-200">
                            {safeQty(item.target_stock, isWeightItem)}
                          </span>
                        )}
                      </td>

                      {/* Col 3: SUGG */}
                      <td className="px-1 py-2 sm:py-2.5 text-center">
                        <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-bold text-xs">
                          {safeQty(item.suggested_qty, isWeightItem)}
                        </span>
                      </td>

                      {/* Col 4: ORDER */}
                      <td className="px-1 py-2 sm:py-2.5 text-center">
                        {!isLocked ? (
                          <input
                            type="number"
                            min="0"
                            step={isWeightItem ? '0.05' : '1'}
                            value={Number(item.order_qty) === 0 ? '' : safeQty(item.order_qty, isWeightItem)}
                            placeholder="0"
                            onFocus={e => e.target.select()}
                            onClick={e => (e.target as HTMLInputElement).select()}
                            onChange={e => handleItemChange(item.product_name, 'order_qty', e.target.value)}
                            className="w-11 sm:w-12 h-7 mx-auto px-0.5 text-center rounded bg-surface-800 border border-primary-500/50 text-primary-300 text-xs font-black focus:border-primary-400 focus:outline-none"
                            title="Dami na oorderin"
                          />
                        ) : (
                          <span className="text-xs font-black text-primary-300">
                            {safeQty(item.order_qty, isWeightItem)}
                          </span>
                        )}
                      </td>

                      {/* Col 5: TOTAL */}
                      <td className="px-2 py-2 sm:py-2.5 text-right font-black text-amber-300 text-xs sm:text-sm">
                        {formatCurrency(item.total_cost)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pinned Card Footer: Unified Single-Line Summary */}
        {sheet && displayedItems.length > 0 && (
          <div className="flex-shrink-0 px-2.5 sm:px-3 py-1.5 bg-surface-900 border-t border-surface-700/60 flex items-center justify-between text-[11px] sm:text-xs flex-nowrap gap-1">
            <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0 whitespace-nowrap">
              <span className="text-surface-400">
                Kabuuan: <strong className="text-surface-200">{displayedItems.length} items</strong>
              </span>
              <span className="text-surface-600">•</span>
              <span className="text-surface-400">
                Target: <strong className="text-surface-100">{safeQty(totalTargetCapacity, isWeightCategory)}</strong>
              </span>
              <span className="text-surface-600">•</span>
              <span className="text-surface-400">
                Prev: <strong className="text-sky-400">{safeQty(totalPrevStock, isWeightCategory)}</strong>
              </span>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-auto whitespace-nowrap">
              <span className="text-surface-400">
                Order: <strong className="text-primary-400 font-black">{safeQty(displayedTotalQty, isWeightCategory)}</strong>
              </span>
              <span className="text-surface-600">•</span>
              <span className="text-amber-400 font-black">
                {formatCurrency(displayedTotalCost)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
