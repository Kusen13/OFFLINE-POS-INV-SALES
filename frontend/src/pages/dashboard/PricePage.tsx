/**
 * Price Update Page — Bulk inline price editing
 *
 * Shows all products in an editable table so the owner can quickly
 * update selling prices without opening each product's edit modal.
 * Particularly useful for Vegetables & Bigas whose prices change daily.
 *
 * Features:
 * - Category dropdown filter
 * - Inline price editing (Tab key to move between fields)
 * - Auto-calculate markup % from cost
 * - ⚠️  highlight for items with ₱0.00 selling price
 * - Save All button + individual auto-save on blur
 * - Syncs to MySQL via API and updates local IndexedDB
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { fetchProducts, updateProduct } from '../../api/endpoints';
import { replaceAllProducts, getAllProducts, getAllCategories } from '../../db/productRepository';
import { getCategoryIcon } from '../../types/product';
import type { Category, BusinessType, BusinessDepartment } from '../../types/product';
import { getAllBusinessDepartments } from '../../utils/businessStorage';

interface PriceRow {
  id: number;
  name: string;
  sku: string;
  unit: string;
  sell_by_weight: boolean;
  category_id: number;
  category_name: string;
  business_type?: BusinessType;
  cost_price: number;
  selling_price: number;          // current saved selling price
  draft_price: string;            // selling price user is typing
  draft_cost: string;             // buying/cost price user is typing
  isCostDirty: boolean;           // cost price changed but not saved
  isDirty: boolean;               // selling price changed but not saved
  isSaving: boolean;
  saveError: string | null;
}

function markupPct(cost: number, sell: number): string {
  if (!cost || !sell) return '—';
  const pct = ((sell - cost) / cost) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

export function PricePage() {
  const [rows, setRows]             = useState<PriceRow[]>([]);
  const [departments, setDepartments] = useState<BusinessDepartment[]>(() => getAllBusinessDepartments());
  const [categories, setCategories] = useState<Category[]>([]);
  const [deptFilter, setDeptFilter] = useState<BusinessType>('barbeque');

  useEffect(() => {
    const handleDeptUpdated = () => setDepartments(getAllBusinessDepartments());
    window.addEventListener('pos_departments_updated', handleDeptUpdated);
    return () => window.removeEventListener('pos_departments_updated', handleDeptUpdated);
  }, []);
  const [catFilter, setCatFilter]   = useState<number | ''>('');
  const [search, setSearch]         = useState('');
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [toast, setToast]           = useState<string | null>(null);
  const [showZeroOnly, setShowZeroOnly] = useState(false);
  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Try server first, fallback to local IndexedDB
      try {
        const res = await fetchProducts({ per_page: 999 });
        await replaceAllProducts(res.data);
      } catch {
        // Offline — use cached local data
      }
      const [products, cats] = await Promise.all([getAllProducts(), getAllCategories()]);
      setCategories(cats);

      const productRows: PriceRow[] = products
        .filter(p => p.id !== 999 && p.item_type !== 'service' && p.is_active !== false)
        .map(p => {
          const cat = cats.find(c => c.id === p.category_id);
        return {
          id:            p.id,
          name:          p.name,
          sku:           p.sku,
          unit:          (p as any).unit       ?? 'pcs',
          sell_by_weight:(p as any).sell_by_weight ?? false,
          category_id:   p.category_id,
          category_name: cat?.name ?? '',
          business_type: p.business_type || cat?.business_type || 'groceries',
          cost_price:    Number(p.cost_price)    || 0,
          selling_price: Number(p.selling_price) || 0,
          draft_price:   String(Number(p.selling_price) || 0),
          draft_cost:    String(Number(p.cost_price)    || 0),
          isCostDirty:   false,
          isDirty:       false,
          isSaving:      false,
          saveError:     null,
        };
      });

      // Sort: zero-price first within each category, then alphabetically
      productRows.sort((a, b) => {
        if (a.category_name !== b.category_name) return a.category_name.localeCompare(b.category_name);
        if ((a.selling_price === 0) !== (b.selling_price === 0)) return a.selling_price === 0 ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      setRows(productRows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Derived categories: combines categories with rows filtered by deptFilter ──
  const displayCategories = useMemo(() => {
    const seen = new Map<number, Category>();
    for (const c of categories) {
      seen.set(c.id, c);
    }
    for (const r of rows) {
      if (r.category_id && !seen.has(r.category_id)) {
        seen.set(r.category_id, {
          id: r.category_id,
          name: r.category_name || 'Category ' + r.category_id,
          business_type: r.business_type || 'groceries',
          description: null,
          sort_order: seen.size + 1,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    }
    let list = Array.from(seen.values()).filter(c => rows.some(r => r.category_id === c.id));
    list = list.filter(c => (c.business_type || 'groceries') === deptFilter);
    return list.sort((a, b) => {
      const aBbq = a.name.toLowerCase().includes('inihaw') || a.name.toLowerCase().includes('bbq') || a.name.toLowerCase().includes('barbeque');
      const bBbq = b.name.toLowerCase().includes('inihaw') || b.name.toLowerCase().includes('bbq') || b.name.toLowerCase().includes('barbeque');
      if (aBbq && !bBbq) return -1;
      if (!aBbq && bBbq) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [categories, rows, deptFilter]);

  // Reset category filter if not found in active business categories
  useEffect(() => {
    if (catFilter !== '' && displayCategories.length > 0 && !displayCategories.some(c => c.id === catFilter)) {
      setCatFilter('');
    }
  }, [displayCategories, catFilter]);

  // ── Filtered rows ────────────────────────────────────────────
  const filtered = useMemo(() => {
    return rows.filter(r => {
      const bType = r.business_type || categories.find(c => c.id === r.category_id)?.business_type || 'groceries';
      if (bType !== deptFilter) return false;
      if (catFilter !== '' && r.category_id !== catFilter) return false;
      if (showZeroOnly && r.selling_price > 0) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!r.name.toLowerCase().includes(q) && !r.sku.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [rows, deptFilter, catFilter, categories, search, showZeroOnly]);

  const deptRows = useMemo(() => {
    return rows.filter(r => {
      const bType = r.business_type || categories.find(c => c.id === r.category_id)?.business_type || 'groceries';
      return bType === deptFilter;
    });
  }, [rows, categories, deptFilter]);

  const zeroPriceCount = deptRows.filter(r => r.selling_price === 0).length;
  const dirtyCount     = deptRows.filter(r => r.isDirty || r.isCostDirty).length;

  // ── Update draft selling price (while typing) ────────────────
  const handleDraftChange = (id: number, val: string) => {
    setRows(prev => prev.map(r =>
      r.id !== id ? r : { ...r, draft_price: val, isDirty: true }
    ));
  };

  // ── Update draft cost/buying price (while typing) ────────────
  const handleCostChange = (id: number, val: string) => {
    setRows(prev => prev.map(r =>
      r.id !== id ? r : { ...r, draft_cost: val, isCostDirty: true, isDirty: r.isDirty }
    ));
  };

  // ── Save single row (on blur or Enter) ───────────────────────
  const saveRow = useCallback(async (id: number) => {
    const row = rows.find(r => r.id === id);
    if (!row || (!row.isDirty && !row.isCostDirty)) return;
    const newPrice = parseFloat(row.draft_price) || 0;
    const newCost  = parseFloat(row.draft_cost)  || 0;
    const priceChanged = newPrice !== row.selling_price;
    const costChanged  = newCost  !== row.cost_price;
    if (!priceChanged && !costChanged) {
      setRows(prev => prev.map(r => r.id !== id ? r : { ...r, isDirty: false, isCostDirty: false }));
      return;
    }

    setRows(prev => prev.map(r => r.id !== id ? r : { ...r, isSaving: true, saveError: null }));
    try {
      const patch: Record<string, number> = {};
      if (priceChanged) patch.selling_price = newPrice;
      if (costChanged)  patch.cost_price    = newCost;
      await updateProduct(id, patch as any);
      setRows(prev => prev.map(r =>
        r.id !== id ? r : {
          ...r,
          selling_price: newPrice,
          cost_price:    newCost,
          draft_price:   String(newPrice),
          draft_cost:    String(newCost),
          isDirty:       false,
          isCostDirty:   false,
          isSaving:      false,
        }
      ));
    } catch {
      setRows(prev => prev.map(r =>
        r.id !== id ? r : { ...r, isSaving: false, saveError: 'Hindi na-save' }
      ));
    }
  }, [rows]);

  // ── Save ALL dirty rows ──────────────────────────────────────
  const handleSaveAll = async () => {
    const dirty = rows.filter(r => r.isDirty || r.isCostDirty);
    if (dirty.length === 0) return;
    setSaving(true);
    let saved = 0;
    let failed = 0;
    for (const row of dirty) {
      const newPrice = parseFloat(row.draft_price) || 0;
      const newCost  = parseFloat(row.draft_cost)  || 0;
      const patch: Record<string, number> = {};
      if (newPrice !== row.selling_price) patch.selling_price = newPrice;
      if (newCost  !== row.cost_price)    patch.cost_price    = newCost;
      if (Object.keys(patch).length === 0) continue;
      try {
        await updateProduct(row.id, patch as any);
        setRows(prev => prev.map(r =>
          r.id !== row.id ? r : {
            ...r,
            selling_price: newPrice,
            cost_price:    newCost,
            draft_price:   String(newPrice),
            draft_cost:    String(newCost),
            isDirty: false, isCostDirty: false, isSaving: false,
          }
        ));
        saved++;
      } catch {
        setRows(prev => prev.map(r =>
          r.id !== row.id ? r : { ...r, saveError: 'Error', isSaving: false }
        ));
        failed++;
      }
    }
    setSaving(false);
    showToast(failed === 0
      ? `✅ Nai-save ang ${saved} product${saved !== 1 ? 's' : ''}`
      : `⚠️ ${saved} na-save, ${failed} na hindi`
    );
  };
  // ── Keyboard: Enter saves + moves to next, Tab moves naturally ─
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, id: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveRow(id);
      // Move to next input
      const ids = filtered.map(r => r.id);
      const idx = ids.indexOf(id);
      if (idx < ids.length - 1) {
        inputRefs.current[ids[idx + 1]]?.focus();
      }
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-1.5 sm:space-y-2 animate-fade-in pb-16 lg:pb-0">

      {/* ── ROW 1: Title + Category Dropdown + Actions ── */}
      <div className="flex-shrink-0 flex items-center justify-between gap-1.5 flex-nowrap overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-sm font-bold text-surface-100 whitespace-nowrap shrink-0 flex items-center gap-1">
            <span>💲</span> Price Editor
          </span>

          {/* Category dropdown */}
          <select
            value={catFilter}
            onChange={e => setCatFilter(e.target.value ? Number(e.target.value) : '')}
            className="h-7 px-2 rounded-lg bg-surface-900 border border-surface-700/60 text-surface-200 text-[11px] font-semibold focus:outline-none focus:border-primary-500 cursor-pointer shrink-0 max-w-[150px] sm:max-w-[200px] truncate"
          >
            {displayCategories.length > 1 && <option value="">🏷️ Lahat ng {departments.find(d => d.id === deptFilter)?.label || ''} Kategorya</option>}
            {displayCategories.map(cat => {
              const count = rows.filter(r => r.category_id === cat.id).length;
              const zeroCount = rows.filter(r => r.category_id === cat.id && r.selling_price === 0).length;
              return (
                <option key={cat.id} value={cat.id}>
                  {getCategoryIcon(cat.name)} {cat.name} ({count}){zeroCount > 0 ? ` ⚠️${zeroCount}` : ''}
                </option>
              );
            })}
          </select>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {zeroPriceCount > 0 && (
            <button
              type="button"
              onClick={() => setShowZeroOnly(v => !v)}
              className={`h-7 px-2 rounded-lg text-[10px] font-bold border transition-all cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1 ${
                showZeroOnly
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                  : 'bg-surface-800 border-surface-700 text-amber-400 hover:bg-amber-500/10'
              }`}
            >
              ⚠️ Zero Price ({zeroPriceCount})
            </button>
          )}
          {dirtyCount > 0 && (
            <button
              type="button"
              onClick={handleSaveAll}
              disabled={saving}
              className="h-7 px-3 rounded-lg bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white text-[11px] font-bold transition-all cursor-pointer shadow-xs whitespace-nowrap shrink-0 flex items-center gap-1"
            >
              {saving ? (
                <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving...</>
              ) : (
                <>💾 Save All ({dirtyCount})</>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="h-7 px-2 rounded-lg bg-surface-800 hover:bg-surface-700 border border-surface-700/60 text-surface-300 text-[11px] font-semibold transition-all cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
            title="Refresh"
          >
            🔄 <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* ── BUSINESS DEPARTMENTS SELECTOR RIBBON ── */}
      <div className="flex-shrink-0 flex items-center gap-1.5 py-1 flex-nowrap overflow-x-auto no-scrollbar">
        {departments.map(dept => {
          const count = rows.filter(r => {
            const bType = r.business_type || categories.find(c => c.id === r.category_id)?.business_type || 'groceries';
            return bType === dept.id;
          }).length;
          const isSelected = deptFilter === dept.id;
          return (
            <button
              key={dept.id}
              type="button"
              onClick={() => { setDeptFilter(dept.id); setCatFilter(''); }}
              className={`h-7 px-3 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer border ${
                isSelected
                  ? `${dept.activeColor} shadow-md`
                  : 'bg-surface-800/80 text-surface-300 border-surface-700/60 hover:bg-surface-700/70 hover:text-white'
              }`}
            >
              <span>{dept.icon}</span>
              <span>{dept.label}</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${isSelected ? 'bg-black/25 text-white' : 'bg-surface-700 text-surface-400'}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── ROW 2: Search + KPI Ribbon ── */}
      <div className="flex-shrink-0 flex items-center gap-1.5 flex-nowrap overflow-x-auto no-scrollbar">
        <div className="relative flex-1 min-w-[130px] max-w-xs">
          <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search product name or SKU..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full h-7 pl-7 pr-3 text-[11px] rounded-lg bg-surface-900 border border-surface-700/60 text-surface-100 placeholder-surface-500 focus:outline-none focus:border-primary-500"
          />
        </div>
        <span className="h-7 px-2 rounded-lg bg-surface-800/70 border border-surface-700/40 flex items-center gap-1 text-[10px] font-bold shrink-0">
          <span className="text-surface-400">Total</span>
          <span className="text-surface-100">{filtered.length}</span>
        </span>
        <span className="h-7 px-2 rounded-lg bg-surface-800/70 border border-surface-700/40 flex items-center gap-1 text-[10px] font-bold shrink-0">
          <span className="text-surface-400">Zero Price</span>
          <span className={zeroPriceCount > 0 ? 'text-amber-400' : 'text-surface-300'}>{zeroPriceCount}</span>
        </span>
        {dirtyCount > 0 && (
          <span className="h-7 px-2 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center gap-1 text-[10px] font-bold text-amber-300 shrink-0">
            <span>● Unsaved</span>
            <span>{dirtyCount}</span>
          </span>
        )}
      </div>

      {/* Main Table Container */}
      <div className="flex-1 min-h-0 bg-surface-800/50 rounded-xl border border-surface-700/50 flex flex-col overflow-hidden shadow-sm">
        {loading ? (
          <div className="flex-1 min-h-0 flex items-center justify-center py-16">
            <div className="w-8 h-8 border-3 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center py-12 text-center">
            <span className="text-3xl mb-2 block">💲</span>
            <p className="text-surface-300 font-medium text-xs sm:text-sm">No products found</p>
            <p className="text-surface-500 text-[11px] mt-0.5">Walang produkto na tumutugma sa filter</p>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[700px] whitespace-nowrap">
              <thead className="sticky top-0 bg-surface-900 border-b border-surface-700/60 z-10">
                <tr>
                  <th className="px-3.5 py-2 text-xs font-bold text-surface-300 uppercase tracking-wider">
                    Product
                  </th>
                  <th className="px-2 py-2 text-xs font-bold text-surface-400 uppercase tracking-wider text-right w-16">
                    Unit
                  </th>
                  <th className="px-3 py-2 text-xs font-bold text-surface-400 uppercase tracking-wider text-center w-36">
                    Cost Price ✏️
                  </th>
                  <th className="px-3 py-2 text-xs font-bold text-amber-400 uppercase tracking-wider text-center w-36">
                    Selling Price ✏️
                  </th>
                  <th className="px-2 py-2 text-xs font-bold text-emerald-400 uppercase tracking-wider text-center w-24">
                    Markup
                  </th>
                  <th className="px-3 py-2 text-xs font-bold text-surface-300 uppercase tracking-wider text-right w-28">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-700/30">
                {filtered.map(row => {
                  const hasZeroPrice = row.selling_price === 0;
                  const draftSell    = parseFloat(row.draft_price) || 0;
                  const draftCost    = parseFloat(row.draft_cost)  || 0;
                  const markup       = markupPct(
                    row.isCostDirty ? draftCost : row.cost_price,
                    row.isDirty     ? draftSell : row.selling_price
                  );

                  return (
                    <tr
                      key={row.id}
                      className={`transition-colors ${
                        hasZeroPrice
                          ? 'bg-amber-500/5 hover:bg-amber-500/10'
                          : 'hover:bg-surface-700/20'
                      }`}
                    >
                      {/* Product name + category */}
                      <td className="px-3.5 py-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {hasZeroPrice && <span className="text-amber-400 text-xs shrink-0">⚠️</span>}
                          <div className="min-w-0">
                            <p className="text-surface-100 font-semibold text-xs sm:text-sm truncate">{row.name}</p>
                            <p className="text-[10px] text-surface-500 truncate">
                              {getCategoryIcon(row.category_name)} {row.category_name}
                              {row.sell_by_weight && <span className="ml-1 text-amber-400">⚖️</span>}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Unit */}
                      <td className="px-2 py-2 text-right text-xs text-surface-400 font-medium whitespace-nowrap">
                        {row.unit}
                      </td>

                      {/* Puhunan / Cost price — editable ✏️ */}
                      <td className="px-3 py-2">
                        <div className="relative flex items-center justify-center">
                          <span className="absolute left-2.5 text-surface-500 text-xs pointer-events-none">₱</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.draft_cost}
                            onChange={e => handleCostChange(row.id, e.target.value)}
                            onBlur={() => saveRow(row.id)}
                            onFocus={e => e.target.select()}
                            disabled={row.isSaving}
                            className={`w-full pl-6 pr-2 py-1.5 text-center rounded-lg border text-sm font-bold transition-all focus:outline-none disabled:opacity-50 ${
                              row.isCostDirty
                                ? 'bg-sky-900/30 border-sky-500/70 text-sky-200 focus:border-sky-400'
                                : 'bg-surface-800 border-surface-700/60 text-surface-400 focus:border-sky-500'
                            }`}
                          />
                        </div>
                      </td>

                      {/* Selling price INPUT — the main field */}
                      <td className="px-3 py-2">
                        <div className="relative flex items-center justify-center">
                          <span className="absolute left-2.5 text-surface-500 text-xs pointer-events-none">₱</span>
                          <input
                            ref={el => { inputRefs.current[row.id] = el; }}
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.draft_price}
                            onChange={e => handleDraftChange(row.id, e.target.value)}
                            onBlur={() => saveRow(row.id)}
                            onFocus={e => e.target.select()}
                            onKeyDown={e => handleKeyDown(e, row.id)}
                            disabled={row.isSaving}
                            className={`w-full pl-6 pr-2 py-1.5 text-center rounded-lg border text-sm font-bold transition-all focus:outline-none disabled:opacity-50 ${
                              row.isDirty
                                ? 'bg-primary-900/30 border-primary-500/70 text-primary-200 focus:border-primary-400'
                                : hasZeroPrice
                                ? 'bg-amber-900/20 border-amber-500/40 text-amber-300 focus:border-amber-400'
                                : 'bg-surface-800 border-surface-700/60 text-surface-100 focus:border-primary-500'
                            }`}
                          />
                          {row.isSaving && (
                            <span className="absolute right-2 w-3 h-3 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
                          )}
                        </div>
                        {row.saveError && (
                          <p className="text-[10px] text-danger-400 text-center mt-0.5">{row.saveError}</p>
                        )}
                      </td>

                      {/* Markup % */}
                      <td className="px-2 py-2 text-center text-xs font-bold whitespace-nowrap">
                        <span className={`${
                          markup === '—' ? 'text-surface-600'
                          : markup.startsWith('+') ? 'text-emerald-400'
                          : 'text-danger-400'
                        }`}>
                          {markup}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="px-3 py-2 text-right text-xs whitespace-nowrap">
                        {row.isSaving ? (
                          <span className="text-primary-400 font-semibold">Saving...</span>
                        ) : row.isDirty ? (
                          <span className="text-amber-400 font-semibold">● Unsaved</span>
                        ) : hasZeroPrice ? (
                          <span className="text-amber-400/80">No price</span>
                        ) : (
                          <span className="text-emerald-500 font-semibold">✓ OK</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer summary */}
        {!loading && filtered.length > 0 && (
          <div className="flex-shrink-0 px-3 py-2 bg-surface-900 border-t border-surface-700/60 flex items-center justify-between text-xs text-surface-400">
            <span>{filtered.length} products • {zeroPriceCount > 0 ? `⚠️ ${zeroPriceCount} without price` : '✅ All prices set'}</span>
            {dirtyCount > 0 && (
              <span className="text-amber-400 font-semibold">{dirtyCount} unsaved — press Enter or Save All</span>
            )}
          </div>
        )}
      </div>

      {/* ── Toast ────────────────────────────────────────────── */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl bg-surface-800 border border-surface-700 text-surface-100 text-sm font-semibold shadow-xl animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  );
}
