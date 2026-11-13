import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  getAllProducts,
  adjustProductStock,
  setProductStock,
  batchStockIn,
  getStockMovementLogs,
  recordStockMovement,
  type StockMovementRecord,
} from '../../db/productRepository';
import { getAllSuppliers } from '../../db/supplierRepository';
import { formatCurrency } from '../../utils/currency';
import type { Product, Category, BusinessType } from '../../types/product';
import { getCategoryIcon } from '../../types/product';
import { getAllBusinessDepartments } from '../../utils/businessStorage';
import type { BusinessDepartment } from '../../types/product';
import type { Supplier } from '../../types/supplier';
import { getAllCategories } from '../../db/productRepository';
import { type RicePackagingFilter, RICE_PACKAGING_OPTIONS, matchRicePackaging } from '../../utils/ricePackaging';

export function InventoryPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [departments, setDepartments] = useState<BusinessDepartment[]>(() => getAllBusinessDepartments());

  useEffect(() => {
    const handleDeptUpdated = () => setDepartments(getAllBusinessDepartments());
    window.addEventListener('pos_departments_updated', handleDeptUpdated);
    return () => window.removeEventListener('pos_departments_updated', handleDeptUpdated);
  }, []);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [search, setSearch] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [businessFilter, setBusinessFilter] = useState<BusinessType>('barbeque');
  const [categoryFilter, setCategoryFilter] = useState<number | null>(null);
  const [ricePackagingFilter, setRicePackagingFilter] = useState<RicePackagingFilter>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'low' | 'out' | 'healthy'>('all');
  const [categories, setCategories] = useState<Category[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  // Modals
  const [showBatchStockIn, setShowBatchStockIn] = useState(false);
  const [showWasteModal, setShowWasteModal] = useState(false);
  const [showRepackModal, setShowRepackModal] = useState(false);
  const [selectedProductForAction, setSelectedProductForAction] = useState<Product | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyLogs, setHistoryLogs] = useState<StockMovementRecord[]>([]);

  // ─── Data Loading ──────────────────────────────────────────
  const reload = useCallback(async () => {
    try {
      const all = await getAllProducts();
      setProducts(all.filter(p => p.id !== 999 && p.item_type !== 'service'));
      setHistoryLogs(getStockMovementLogs(50));
    } catch (err) {
      console.error('Failed to reload inventory products:', err);
    }
  }, []);

  useEffect(() => {
    reload();

    let debounceTimer: any = null;
    const debouncedReload = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        reload();
      }, 500);
    };

    window.addEventListener('pos_sale_completed', debouncedReload);
    window.addEventListener('pos_sync_completed', debouncedReload);
    window.addEventListener('pos_inventory_updated', debouncedReload);

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel('pos_channel');
      channel.onmessage = (msg) => {
        if (
          msg.data?.type === 'SALE_COMPLETED' ||
          msg.data?.type === 'SYNC_COMPLETED' ||
          msg.data?.type === 'INVENTORY_UPDATED'
        ) {
          debouncedReload();
        }
      };
    } catch (_) {}

    return () => {
      clearTimeout(debounceTimer);
      window.removeEventListener('pos_sale_completed', debouncedReload);
      window.removeEventListener('pos_sync_completed', debouncedReload);
      window.removeEventListener('pos_inventory_updated', debouncedReload);
      if (channel) channel.close();
    };
  }, [reload]);

  useEffect(() => {
    getAllSuppliers()
      .then(s => setSuppliers(s.filter(sup => sup.is_active)))
      .catch(() => {});
    getAllCategories()
      .then((cats: Category[]) => setCategories(cats))
      .catch(() => {});
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // ─── Stock Adjustments ─────────────────────────────────────
  const handleQuickDelta = async (p: Product, delta: number) => {
    setUpdatingId(p.id);
    // Use smaller step for by-weight items (±0.1 kg instead of ±1 pcs)
    const isWeight = (p as any).sell_by_weight ?? false;
    const step = isWeight ? (delta > 0 ? 0.1 : -0.1) : delta;
    try {
      const type = delta > 0 ? 'STOCK_IN' : 'ADJUSTMENT';
      const reason = delta > 0 ? 'Mabilisang Dagdag' : 'Mabilisang Bawas';
      await adjustProductStock(p.id, step, type, reason);
      await reload();
      showToast(`${delta > 0 ? '➕ Dinagdagan' : '➖ Binawasan'} ang stock ng ${p.name}`);
    } catch {
      showToast('⚠️ Hindi ma-update ang stock');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDirectStockChange = async (p: Product, rawVal: string) => {
    const isWeight = (p as any).sell_by_weight ?? false;
    const val = Math.max(0, isWeight ? parseFloat(rawVal) || 0 : parseInt(rawVal, 10) || 0);
    if (val === p.current_stock) return;
    try {
      await setProductStock(p.id, val, 'Physical count update sa Inventory');
      await reload();
      showToast(`🔄 Na-update ang stock ng ${p.name} sa ${val}`);
    } catch {
      showToast('⚠️ Hindi ma-save ang bilang ng stock');
    }
  };

  // ─── Categories derivation: combines categories with products filtered by business ───
  const displayCategories = useMemo(() => {
    const seen = new Map<number, Category>();
    for (const c of categories) {
      seen.set(c.id, c);
    }
    for (const p of products) {
      if (p.category_id && !seen.has(p.category_id)) {
        seen.set(p.category_id, {
          id: p.category_id,
          name: p.category_name || 'Category ' + p.category_id,
          business_type: p.business_type || 'groceries',
          description: null,
          sort_order: seen.size + 1,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    }
    let list = Array.from(seen.values()).filter(c => products.some(p => p.category_id === c.id));
    list = list.filter(c => (c.business_type || 'groceries') === businessFilter);
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [categories, products, businessFilter]);

  // Reset category filter if it does not belong to active business
  useEffect(() => {
    if (categoryFilter !== null && displayCategories.length > 0 && !displayCategories.some(c => c.id === categoryFilter)) {
      setCategoryFilter(null);
    }
  }, [displayCategories, categoryFilter]);

  // ─── Filters & Derivations ─────────────────────────────────
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const q = search.toLowerCase().trim();
      const matchSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.supplier_name && p.supplier_name.toLowerCase().includes(q));

      const matchSupplier =
        !supplierFilter ||
        (p.supplier_name &&
          p.supplier_name.toLowerCase().replace(/[^a-z0-9]/g, '') ===
            supplierFilter.toLowerCase().replace(/[^a-z0-9]/g, ''));

      const matchBusiness = (p.business_type || categories.find(c => c.id === p.category_id)?.business_type || 'groceries') === businessFilter;
      const matchCategory = categoryFilter !== null ? p.category_id === categoryFilter : true;
      const matchRice = businessFilter === 'rice' && ricePackagingFilter !== 'all'
        ? matchRicePackaging(p.name, p.unit, (p as any).sell_by_weight, ricePackagingFilter)
        : true;

      const isOut = (p.current_stock ?? 0) === 0;
      const isLow = !isOut && (p.current_stock ?? 0) <= (p.low_stock_threshold || 5);
      const isHealthy = !isOut && !isLow;

      let matchStatus = true;
      if (statusFilter === 'out') matchStatus = isOut;
      if (statusFilter === 'low') matchStatus = isLow;
      if (statusFilter === 'healthy') matchStatus = isHealthy;

      return matchSearch && matchSupplier && matchBusiness && matchCategory && matchRice && matchStatus;
    });
  }, [products, search, supplierFilter, businessFilter, categoryFilter, ricePackagingFilter, categories, statusFilter]);

  // Business-scoped Statistics (strictly per selected department)
  const businessProducts = useMemo(() => {
    return products.filter(p => {
      const bType = p.business_type || categories.find(c => c.id === p.category_id)?.business_type || 'groceries';
      return bType === businessFilter;
    });
  }, [products, categories, businessFilter]);

  const totalUnits = useMemo(
    () => businessProducts.reduce((sum, p) => sum + (Number(p.current_stock) || 0), 0),
    [businessProducts]
  );

  const lowStockProducts = useMemo(
    () => businessProducts.filter(p => (p.current_stock ?? 0) <= (p.low_stock_threshold || 5) && p.is_active),
    [businessProducts]
  );

  const totalInventoryValue = useMemo(
    () => businessProducts.reduce((sum, p) => sum + (Number(p.current_stock) || 0) * (Number(p.cost_price) || 0), 0),
    [businessProducts]
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-1.5 sm:space-y-2 animate-fade-in pb-16 lg:pb-0 w-full">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-4 right-4 z-[100] px-4 py-2.5 rounded-xl bg-surface-900 border border-emerald-500/50 text-emerald-300 text-xs sm:text-sm font-semibold shadow-2xl animate-fade-in flex items-center gap-2">
          <span>✅</span>
          <span>{toast}</span>
        </div>
      )}

      {/* ── ROW 1: Title + Category + Status Pills + Action Buttons ── */}
      <div className="flex-shrink-0 flex items-center justify-between gap-1.5 flex-nowrap overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-sm font-bold text-surface-100 whitespace-nowrap shrink-0 flex items-center gap-1">
            <span>📦</span> Inventory
          </span>

          {/* Category Dropdown Select */}
          <select
            value={categoryFilter ?? ''}
            onChange={e => setCategoryFilter(e.target.value ? Number(e.target.value) : null)}
            className="h-7 px-2 rounded-lg bg-surface-900 border border-surface-700/60 text-surface-200 text-[11px] font-semibold focus:outline-none focus:border-primary-500 cursor-pointer shrink-0 max-w-[140px] sm:max-w-[180px] truncate"
          >
            {displayCategories.length > 1 && <option value="">🏷️ Lahat ng {departments.find(d => d.id === businessFilter)?.label || ''} Kategorya</option>}
            {displayCategories.map(cat => {
              const count = products.filter(p => p.category_id === cat.id).length;
              return (
                <option key={cat.id} value={cat.id}>
                  {getCategoryIcon(cat.name)} {cat.name} ({count})
                </option>
              );
            })}
          </select>

          {/* Status Filter Pills */}
          <div className="flex items-center bg-surface-900 border border-surface-700/60 rounded-lg p-0.5 shrink-0">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer whitespace-nowrap ${
                statusFilter === 'all' ? 'bg-surface-700 text-white shadow-xs' : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('low')}
              className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer whitespace-nowrap ${
                statusFilter === 'low' ? 'bg-amber-600 text-white shadow-xs' : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              Low ({lowStockProducts.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('out')}
              className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer whitespace-nowrap ${
                statusFilter === 'out' ? 'bg-rose-600 text-white shadow-xs' : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              Out ({products.filter(p => (p.current_stock ?? 0) === 0).length})
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setShowRepackModal(true)}
            className="h-7 px-2 rounded-lg bg-amber-950/40 hover:bg-amber-900/50 text-amber-300 text-[11px] font-semibold border border-amber-800/60 transition-colors cursor-pointer shadow-xs whitespace-nowrap shrink-0 flex items-center gap-1"
            title="Buwagin ang bulto, kahon, tray, o sako papuntang tingi / retail"
          >
            <span>📦</span>
            <span className="hidden sm:inline">Repack</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedProductForAction(null);
              setShowWasteModal(true);
            }}
            className="h-7 px-2 rounded-lg bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 text-[11px] font-semibold border border-rose-800/60 transition-colors cursor-pointer shadow-xs whitespace-nowrap shrink-0 flex items-center gap-1"
            title="Itala ang nasira, napaso, o itinapong items"
          >
            <span>⚠️</span>
            <span className="hidden sm:inline">Spoilage</span>
          </button>

          <button
            type="button"
            onClick={() => setShowHistoryModal(true)}
            className="h-7 px-2 rounded-lg bg-surface-800 hover:bg-surface-700 text-surface-300 text-[11px] font-semibold border border-surface-700/60 transition-colors cursor-pointer shadow-xs whitespace-nowrap shrink-0 flex items-center gap-1"
            title="Tingnan ang talaan ng lahat ng inventory movements"
          >
            <span>📜</span>
            <span className="hidden sm:inline">Logs</span>
          </button>

          <button
            type="button"
            onClick={() => setShowBatchStockIn(true)}
            className="h-7 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold shadow-xs transition-all cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1"
            title="Magdagdag ng delivery stocks para sa mga paninda"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>+ Stock-In</span>
          </button>
        </div>
      </div>

      {/* ── BUSINESS DEPARTMENTS SELECTOR RIBBON ── */}
      <div className="flex-shrink-0 flex items-center gap-1.5 py-1 flex-nowrap overflow-x-auto no-scrollbar">
        {departments.map(dept => {
          const count = products.filter(p => {
            const cat = categories.find(c => c.id === p.category_id);
            return (p.business_type || cat?.business_type || 'groceries') === dept.id;
          }).length;
          const isSelected = businessFilter === dept.id;
          return (
            <button
              key={dept.id}
              type="button"
              onClick={() => { setBusinessFilter(dept.id); setCategoryFilter(null); setRicePackagingFilter('all'); }}
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

      {/* ── ROW 2: Search + Supplier Select + Packaging Select + KPI Ribbon (Single Line) ── */}
      <div className="flex-shrink-0 flex items-center gap-1.5 flex-nowrap overflow-x-auto no-scrollbar">
        <div className="relative flex-1 min-w-[120px] max-w-xs">
          <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name or SKU..."
            className="w-full h-7 pl-7 pr-3 text-[11px] rounded-lg bg-surface-900 border border-surface-700/60 text-surface-100 placeholder-surface-500 focus:outline-none focus:border-primary-500"
          />
        </div>

        <select
          value={supplierFilter}
          onChange={e => setSupplierFilter(e.target.value)}
          className="h-7 px-2 rounded-lg bg-surface-900 border border-surface-700/60 text-surface-200 text-[11px] font-semibold focus:outline-none focus:border-primary-500 cursor-pointer shrink-0 max-w-[120px] sm:max-w-[150px] truncate"
        >
          <option value="">🏪 All Suppliers</option>
          {suppliers.map(s => (
            <option key={s.id} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>

        {/* Bigasan (Rice) Packaging Filter Dropdown - Inlined */}
        {businessFilter === 'rice' && (
          <select
            value={ricePackagingFilter}
            onChange={e => setRicePackagingFilter(e.target.value as RicePackagingFilter)}
            className="h-7 px-2 rounded-lg bg-surface-900 border border-amber-600/60 text-amber-300 text-[11px] font-bold focus:outline-none focus:border-amber-500 cursor-pointer shrink-0 max-w-[125px] sm:max-w-[145px] truncate shadow-xs"
            title="I-filter ayon sa Sukat / Packaging"
          >
            {RICE_PACKAGING_OPTIONS.map(opt => (
              <option key={opt.key} value={opt.key}>
                {opt.icon} {opt.label}
              </option>
            ))}
          </select>
        )}

        <span className="h-7 px-2 rounded-lg bg-surface-800/70 border border-surface-700/40 flex items-center gap-1 text-[10px] font-bold shrink-0">
          <span className="text-surface-400">SKUs</span>
          <span className="text-surface-100">{products.length}</span>
        </span>
        <span className="h-7 px-2 rounded-lg bg-surface-800/70 border border-surface-700/40 flex items-center gap-1 text-[10px] font-bold shrink-0">
          <span className="text-surface-400">Units</span>
          <span className="text-sky-300">{totalUnits}</span>
        </span>
        <span className="h-7 px-2 rounded-lg bg-surface-800/70 border border-surface-700/40 flex items-center gap-1 text-[10px] font-bold shrink-0">
          <span className="text-surface-400">Alerts</span>
          <span className={lowStockProducts.length > 0 ? 'text-amber-400' : 'text-surface-300'}>{lowStockProducts.length}</span>
        </span>
        <span className="h-7 px-2 rounded-lg bg-surface-800/70 border border-surface-700/40 flex items-center gap-1 text-[10px] font-bold shrink-0 hidden sm:flex">
          <span className="text-surface-400">Valuation</span>
          <span className="text-emerald-400">{formatCurrency(totalInventoryValue)}</span>
        </span>
      </div>

      {/* Main Table Container */}
      <div className="flex-1 min-h-0 bg-surface-800/50 rounded-xl border border-surface-700/50 flex flex-col overflow-hidden shadow-sm">
        {filteredProducts.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-16 text-center text-surface-400">
            <span className="text-3xl mb-2">📦</span>
            <p className="text-sm font-semibold text-surface-200">No items found</p>
            <p className="text-xs text-surface-500 mt-0.5">
              Walang nahanap na paninda. Subukan ang ibang filter o category.
            </p>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[700px] whitespace-nowrap">
              <thead className="sticky top-0 bg-surface-900 border-b border-surface-700/80 z-10 shadow-xs">
                <tr>
                  <th className="px-3.5 py-2.5 text-[11px] font-bold text-surface-400 uppercase whitespace-nowrap">
                    Product
                  </th>
                  <th className="px-3 py-2.5 text-[11px] font-bold text-surface-400 uppercase whitespace-nowrap hidden lg:table-cell">
                    Supplier
                  </th>
                  <th className="px-3 py-2.5 text-[11px] font-bold text-surface-400 uppercase text-center whitespace-nowrap">
                    Target Par
                  </th>
                  <th className="px-3 py-2.5 text-[11px] font-bold text-surface-400 uppercase text-center whitespace-nowrap">
                    Live Stock
                  </th>
                  <th className="px-3 py-2.5 text-[11px] font-bold text-surface-400 uppercase text-center whitespace-nowrap">
                    Status
                  </th>
                  <th className="px-3 py-2.5 text-[11px] font-bold text-surface-400 uppercase text-right whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-700/40">
                {filteredProducts.map(p => {
                  const stock = p.current_stock ?? 0;
                  const par = p.target_stock ?? 20;
                  const threshold = p.low_stock_threshold || 5;
                  const isOut = stock === 0;
                  const isLow = !isOut && stock <= threshold;
                  const unit = p.unit || 'pcs';

                  return (
                    <tr
                      key={p.id}
                      className={`hover:bg-surface-750/30 transition-colors ${
                        isOut ? 'bg-rose-950/10' : isLow ? 'bg-amber-950/10' : ''
                      }`}
                    >
                      {/* Name & SKU */}
                      <td className="px-3.5 py-2.5 text-xs whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="text-base shrink-0">{getCategoryIcon(p.category_name || '')}</span>
                          <div>
                            <p className="font-bold text-surface-100 flex items-center gap-1.5">
                              <span>{p.name}</span>
                              <span className="text-[10px] font-normal text-surface-400">({unit})</span>
                              {p.sell_by_weight && (
                                <span className="text-[9px] px-1 py-0.5 rounded bg-sky-500/15 text-sky-400 border border-sky-500/30 font-bold">⚖️</span>
                              )}
                            </p>
                            <p className="text-[10px] font-mono text-surface-500 mt-0.5">
                              {p.sku} • Puhunan: {formatCurrency(p.cost_price)}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Supplier Badge */}
                      <td className="px-3 py-2.5 text-xs whitespace-nowrap hidden lg:table-cell">
                        {p.supplier_name ? (
                          <span className="px-2 py-0.5 rounded-lg bg-surface-800 border border-surface-700/70 text-surface-300 font-medium text-[11px]">
                            🏪 {p.supplier_name}
                          </span>
                        ) : (
                          <span className="text-surface-600 text-[11px] italic">Walang Supplier</span>
                        )}
                      </td>

                      {/* Target Par Stock */}
                      <td className="px-3 py-2.5 text-center text-xs whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded bg-surface-800 text-surface-300 font-bold font-mono">
                          {par} {unit}
                        </span>
                      </td>

                      {/* Live Stock Counter & Quick Stepper */}
                      <td className="px-3 py-2.5 text-center whitespace-nowrap">
                        <div className="inline-flex items-center gap-1 bg-surface-900 p-0.5 rounded-xl border border-surface-700 shadow-inner">
                          <button
                            type="button"
                            onClick={() => handleQuickDelta(p, -1)}
                            disabled={updatingId === p.id || stock <= 0}
                            className="w-6 h-6 rounded-lg bg-surface-800 hover:bg-surface-700 disabled:opacity-30 text-surface-300 font-black text-xs flex items-center justify-center cursor-pointer transition-colors"
                            title="Bawasan ng 1"
                          >
                            -
                          </button>

                          <input
                            type="number"
                            min="0"
                            step={(p as any).sell_by_weight ? '0.01' : '1'}
                            value={stock}
                            onFocus={e => e.target.select()}
                            onClick={e => (e.target as HTMLInputElement).select()}
                            onChange={e => handleDirectStockChange(p, e.target.value)}
                            className={`w-14 text-center bg-transparent text-xs font-black focus:outline-none ${
                              isOut ? 'text-rose-400 font-extrabold' : isLow ? 'text-amber-300' : 'text-emerald-300'
                            }`}
                            title="I-type ang aktwal na bilang ayon sa physical audit"
                          />

                          <button
                            type="button"
                            onClick={() => handleQuickDelta(p, 1)}
                            disabled={updatingId === p.id}
                            className="w-6 h-6 rounded-lg bg-surface-800 hover:bg-surface-700 disabled:opacity-30 text-surface-300 font-black text-xs flex items-center justify-center cursor-pointer transition-colors"
                            title="Dagdag ng 1"
                          >
                            +
                          </button>
                        </div>
                      </td>

                      {/* Health Status Badge */}
                      <td className="px-3 py-2.5 text-center whitespace-nowrap">
                        {isOut ? (
                          <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-bold inline-flex items-center gap-1">
                            🔴 Ubos na
                          </span>
                        ) : isLow ? (
                          <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-bold inline-flex items-center gap-1">
                            ⚠️ Low ({(p as any).sell_by_weight ? stock.toFixed(2) : stock} / {par} {unit})
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold inline-flex items-center gap-1">
                            🟢 Sapat ({(p as any).sell_by_weight ? stock.toFixed(2) : stock} {unit})
                          </span>
                        )}
                      </td>

                      {/* Row Action Buttons */}
                      <td className="px-3 py-2.5 text-right whitespace-nowrap text-xs">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedProductForAction(p);
                              setShowWasteModal(true);
                            }}
                            className="px-2 py-1 rounded-lg bg-rose-950/50 hover:bg-rose-900/60 text-rose-300 text-[11px] font-semibold border border-rose-800/40 cursor-pointer transition-colors"
                            title="Itala kung may nasunog o nasira"
                          >
                            ⚠️ Spoilage
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setSelectedProductForAction(p);
                              setShowBatchStockIn(true);
                            }}
                            className="px-2 py-1 rounded-lg bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-300 text-[11px] font-semibold border border-emerald-800/40 cursor-pointer transition-colors"
                            title="Magdagdag ng bagong delivery stock"
                          >
                            📥 Stock-In
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Batch Stock In Modal ────────────────────────────── */}
      {showBatchStockIn && createPortal(
        <BatchStockInModal
          products={products}
          suppliers={suppliers}
          preselectedProduct={selectedProductForAction}
          onSuccess={async () => {
            await reload();
            setShowBatchStockIn(false);
            setSelectedProductForAction(null);
            showToast('📦 Matagumpay na na-stock in ang delivery!');
          }}
          onClose={() => {
            setShowBatchStockIn(false);
            setSelectedProductForAction(null);
          }}
        />,
        document.body
      )}

      {/* ── Spoilage / Wastage Modal ────────────────────────── */}
      {showWasteModal && createPortal(
        <SpoilageModal
          products={products}
          preselectedProduct={selectedProductForAction}
          onSuccess={async () => {
            await reload();
            setShowWasteModal(false);
            setSelectedProductForAction(null);
            showToast('⚠️ Naitala na ang nasirang stock / spoilage.');
          }}
          onClose={() => {
            setShowWasteModal(false);
            setSelectedProductForAction(null);
          }}
        />,
        document.body
      )}

      {/* ── Movement History Logs Modal ──────────────────────── */}
      {showHistoryModal && createPortal(
        <MovementLogsModal
          logs={historyLogs}
          onClose={() => setShowHistoryModal(false)}
        />,
        document.body
      )}

      {/* ── Bukas ng Sako (Bigasan Repack) Modal ─────────────── */}
      {showRepackModal && createPortal(
        <RepackModal
          products={products}
          onClose={() => setShowRepackModal(false)}
          onSuccess={(msg) => {
            setShowRepackModal(false);
            reload();
            showToast(msg);
          }}
        />,
        document.body
      )}
    </div>
  );
}

// ============================================================
// Batch Stock In Modal
// ============================================================
function BatchStockInModal({
  products,
  suppliers,
  preselectedProduct,
  onSuccess,
  onClose,
}: {
  products: Product[];
  suppliers: Supplier[];
  preselectedProduct: Product | null;
  onSuccess: () => Promise<void>;
  onClose: () => void;
}) {
  const [selectedSupplier, setSelectedSupplier] = useState(
    preselectedProduct?.supplier_name || suppliers[0]?.name || ''
  );
  const [stockIns, setStockIns] = useState<Record<number, number>>(() => {
    if (preselectedProduct) {
      return { [preselectedProduct.id]: 10 };
    }
    return {};
  });
  const [saving, setSaving] = useState(false);

  // Filter products by selected supplier
  const eligibleProducts = useMemo(() => {
    if (!selectedSupplier) return products;
    const norm = selectedSupplier.toLowerCase().replace(/[^a-z0-9]/g, '');
    return products.filter(
      p => (p.supplier_name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') === norm
    );
  }, [products, selectedSupplier]);

  const totalAddedUnits = useMemo(() => {
    return Object.values(stockIns).reduce((sum, q) => sum + (Number(q) || 0), 0);
  }, [stockIns]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (totalAddedUnits <= 0) {
      alert('Maglagay ng dami ng stock na idadagdag.');
      return;
    }

    setSaving(true);
    try {
      const itemsToStockIn: { productId: number; quantity: number; unitCost?: number }[] = [];
      for (const [pIdStr, qty] of Object.entries(stockIns)) {
        const pId = Number(pIdStr);
        const quantity = Number(qty) || 0;
        if (quantity > 0) {
          const product = products.find(p => p.id === pId);
          itemsToStockIn.push({
            productId: pId,
            quantity,
            unitCost: product?.cost_price,
          });

          recordStockMovement({
            productId: pId,
            productName: product?.name || 'Paninda',
            type: 'STOCK_IN',
            quantityChange: quantity,
            stockBefore: product?.current_stock || 0,
            stockAfter: (product?.current_stock || 0) + quantity,
            reason: `Delivery mula sa ${selectedSupplier || 'Supplier'}`,
          });
        }
      }

      if (itemsToStockIn.length > 0) {
        await batchStockIn(itemsToStockIn);
      }
      await onSuccess();
    } catch (err) {
      console.error('Batch stock-in failed:', err);
      alert('Nagka-problema sa pag-save ng stock in.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-850 rounded-2xl p-4 sm:p-6 max-w-lg w-full border border-surface-700 shadow-2xl animate-fade-in max-h-[90dvh] flex flex-col">
        <div className="flex items-center justify-between pb-3 border-b border-surface-700/60">
          <div>
            <h3 className="text-base sm:text-lg font-black text-surface-100 flex items-center gap-1.5">
              <span>📥</span>
              <span>Tanggapin ang Delivery (Stock-In)</span>
            </h3>
            <p className="text-[11px] text-surface-400 mt-0.5">
              Direktang idadagdag ang bilang sa kasalukuyang stock ng paninda
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-surface-400 hover:text-white hover:bg-surface-700"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col pt-3">
          {/* Supplier Selector */}
          <div className="mb-3">
            <label className="text-[11px] font-semibold text-surface-300 block mb-1">
              Pumili ng Supplier:
            </label>
            <select
              value={selectedSupplier}
              onChange={e => setSelectedSupplier(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-surface-900 border border-surface-700 text-surface-100 text-xs font-semibold focus:outline-none focus:border-primary-500"
            >
              {suppliers.map(s => (
                <option key={s.id} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Items List */}
          <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
            {eligibleProducts.length === 0 ? (
              <p className="text-xs text-surface-500 text-center py-6">
                Walang paninda na nakakabit sa supplier na ito.
              </p>
            ) : (
              eligibleProducts.map(p => {
                const qty = stockIns[p.id] ?? '';
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-2 p-2 rounded-xl bg-surface-900/60 border border-surface-750"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-surface-100 truncate">{p.name}</p>
                      <p className="text-[10px] text-surface-400">
                        Current: <strong className="text-emerald-400">{p.current_stock ?? 0}</strong> {p.unit || 'sticks'}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-xs text-surface-400">+</span>
                      <input
                        type="number"
                        min="0"
                        value={qty}
                        placeholder="0"
                        onFocus={e => e.target.select()}
                        onClick={e => (e.target as HTMLInputElement).select()}
                        onChange={e => {
                          const val = Math.max(0, parseInt(e.target.value, 10) || 0);
                          setStockIns(prev => ({ ...prev, [p.id]: val }));
                        }}
                        className="w-20 px-2 py-1 text-center bg-surface-800 border border-surface-700 rounded-lg text-xs font-black text-emerald-300 focus:outline-none focus:border-emerald-500"
                      />
                      <span className="text-[11px] text-surface-500 w-10">{p.unit || 'sticks'}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer with totals */}
          <div className="pt-3 border-t border-surface-700/60 mt-3 flex items-center justify-between">
            <div>
              <span className="text-[11px] text-surface-400 block">Kabuuan Idadagdag:</span>
              <span className="text-base font-black text-emerald-400">{totalAddedUnits} units</span>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-xl bg-surface-750 text-surface-300 hover:text-white text-xs font-semibold"
              >
                Kanselahin
              </button>
              <button
                type="submit"
                disabled={saving || totalAddedUnits <= 0}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-emerald-600/20"
              >
                {saving ? 'Isina-save...' : 'I-Stock In Ngayon'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================
// Spoilage / Wastage Modal
// ============================================================
function SpoilageModal({
  products,
  preselectedProduct,
  onSuccess,
  onClose,
}: {
  products: Product[];
  preselectedProduct: Product | null;
  onSuccess: () => Promise<void>;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState<number>(
    preselectedProduct?.id || products[0]?.id || 0
  );
  const [wasteQty, setWasteQty] = useState<number>(1);
  const [reason, setReason] = useState<string>('Nasunog sa ihawan');
  const [saving, setSaving] = useState(false);

  const currentProduct = products.find(p => p.id === selectedId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProduct || wasteQty <= 0) return;

    setSaving(true);
    try {
      await adjustProductStock(currentProduct.id, -wasteQty, 'WASTE', reason);
      await onSuccess();
    } catch (err) {
      console.error('Spoilage log error:', err);
      alert('Hindi ma-record ang spoilage.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-850 rounded-2xl p-5 max-w-sm w-full border border-surface-700 shadow-2xl animate-fade-in">
        <div className="flex items-center justify-between pb-3 border-b border-surface-700/60">
          <h3 className="text-base font-black text-rose-300 flex items-center gap-1.5">
            <span>⚠️</span>
            <span>Itala ang Nasira / Spoilage</span>
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg text-surface-400 hover:text-white">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 pt-3">
          <div>
            <label className="text-[11px] font-semibold text-surface-300 block mb-1">
              Pangalan ng Paninda:
            </label>
            <select
              value={selectedId}
              onChange={e => setSelectedId(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-xl bg-surface-900 border border-surface-700 text-surface-100 text-xs font-semibold"
            >
              {products.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} (Kasalukuyang stock: {p.current_stock ?? 0})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-surface-300 block mb-1">
              Ilang Piraso / Tuhog ang Nasira:
            </label>
            <input
              type="number"
              min="1"
              max={currentProduct?.current_stock || 999}
              value={wasteQty}
              onChange={e => setWasteQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="w-full px-3 py-2 text-center rounded-xl bg-surface-900 border border-surface-700 text-rose-300 text-sm font-black"
              required
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold text-surface-300 block mb-1">Dahilan:</label>
            <select
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-surface-900 border border-surface-700 text-surface-100 text-xs font-semibold"
            >
              <option value="Nasunog sa ihawan">Nasunog sa ihawan</option>
              <option value="Nahulog o nadumihan">Nahulog o nadumihan</option>
              <option value="Napaso o na-spoil">Napaso o na-spoil</option>
              <option value="Physical count discrepancy">Physical count discrepancy (Kulang sa tray)</option>
              <option value="Iba pa">Iba pa</option>
            </select>
          </div>

          <div className="pt-2 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-xl bg-surface-750 text-surface-300 text-xs font-semibold"
            >
              Kanselahin
            </button>
            <button
              type="submit"
              disabled={saving || !currentProduct}
              className="flex-1 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold"
            >
              {saving ? 'Isina-save...' : 'Ibawas sa Stock'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================
// Movement Logs Modal
// ============================================================
function MovementLogsModal({
  logs,
  onClose,
}: {
  logs: StockMovementRecord[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-850 rounded-2xl p-5 max-w-lg w-full border border-surface-700 shadow-2xl animate-fade-in max-h-[85dvh] flex flex-col">
        <div className="flex items-center justify-between pb-3 border-b border-surface-700/60">
          <div>
            <h3 className="text-base font-black text-surface-100 flex items-center gap-1.5">
              <span>📜</span>
              <span>Talaan ng Galaw ng Stocks (History Logs)</span>
            </h3>
            <p className="text-[11px] text-surface-400 mt-0.5">
              Audit trail ng lahat ng stock in, bawas, at adjustments
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-surface-400 hover:text-white">
            ✕
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-surface-750 pt-2">
          {logs.length === 0 ? (
            <p className="text-xs text-surface-500 text-center py-8">
              Wala pang naitalang galaw ng stock.
            </p>
          ) : (
            logs.map(log => {
              const isIn = log.quantityChange > 0;
              return (
                <div key={log.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <p className="font-bold text-surface-100 truncate">{log.productName}</p>
                    <p className="text-[10px] text-surface-400">
                      {log.reason || log.type} • {new Date(log.timestamp).toLocaleString()}
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    <span
                      className={`text-xs font-black px-2 py-0.5 rounded-lg ${
                        isIn ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                      }`}
                    >
                      {isIn ? `+${log.quantityChange}` : log.quantityChange}
                    </span>
                    <p className="text-[10px] text-surface-500 mt-0.5">
                      {log.stockBefore} ➔ {log.stockAfter}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="pt-3 border-t border-surface-700/60 mt-3 text-right">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-surface-750 text-surface-200 text-xs font-semibold hover:bg-surface-700"
          >
            Isara
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Bigasan / Bulk Repacking Modal ("Bukas ng Sako")
// ============================================================
function RepackModal({
  products,
  onClose,
  onSuccess,
}: {
  products: Product[];
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const [sourceProductId, setSourceProductId] = useState<number | ''>(() => {
    const found = products.find(p => /sako|sack|box|kahon|case|tray|bulto|50kg|25kg/i.test(p.name));
    return found ? found.id : (products[0]?.id || '');
  });

  const [targetProductId, setTargetProductId] = useState<number | ''>(() => {
    const found = products.find(p => /kilo|kg|tingi|retail|piraso|can|lata|pack/i.test(p.name));
    return found ? found.id : (products[1]?.id || '');
  });

  const [bulkQtyToOpen, setBulkQtyToOpen] = useState<number>(1);
  const [yieldPerBulk, setYieldPerBulk] = useState<number>(50);
  const [saving, setSaving] = useState(false);

  const sourceProduct = products.find(p => p.id === Number(sourceProductId));
  const targetProduct = products.find(p => p.id === Number(targetProductId));

  const totalYield = bulkQtyToOpen * yieldPerBulk;
  const sourceStock = sourceProduct?.current_stock ?? 0;
  const targetStock = targetProduct?.current_stock ?? 0;
  const hasEnoughStock = sourceStock >= bulkQtyToOpen;

  const sourceUnit = sourceProduct?.unit || 'bulto/kahon/sako';
  const targetUnit = targetProduct?.unit || 'pcs/kg';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceProduct || !targetProduct) return;
    if (sourceProduct.id === targetProduct.id) {
      alert('Magkaiba dapat ang Pinagmulang Bulto at ang Paglalagyan na Tingi!');
      return;
    }
    if (bulkQtyToOpen <= 0 || yieldPerBulk <= 0) {
      alert('Paki-lagay ang tamang dami na bubuwagin at yield bawat bulto.');
      return;
    }

    setSaving(true);
    try {
      // 1. Deduct bulk from wholesale product
      await adjustProductStock(
        sourceProduct.id,
        -bulkQtyToOpen,
        'ADJUSTMENT',
        `Buwag ng Bulto: -${bulkQtyToOpen} ${sourceUnit} papunta sa ${targetProduct.name}`
      );

      // 2. Add yield units to retail product
      await adjustProductStock(
        targetProduct.id,
        totalYield,
        'STOCK_IN',
        `Buwag ng Bulto: +${totalYield} ${targetUnit} mula sa ${sourceProduct.name}`
      );

      onSuccess(`📦 Matagumpay na nabuwag ang ${bulkQtyToOpen} ${sourceUnit}! (+${totalYield} ${targetUnit} sa ${targetProduct.name})`);
    } catch (err) {
      console.error('Failed to repack bulk:', err);
      alert('Nagka-problema sa pagbuwag ng bulto.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-850 rounded-2xl p-5 max-w-md w-full border border-surface-700 shadow-2xl animate-fade-in flex flex-col">
        <div className="flex items-center justify-between pb-3 border-b border-surface-700/60">
          <div>
            <h3 className="text-base font-black text-surface-100 flex items-center gap-1.5">
              <span>📦</span>
              <span>Buwag ng Bulto / Repack</span>
            </h3>
            <p className="text-[11px] text-surface-400 mt-0.5">
              I-convert ang Wholesale Bulto, Kahon, Tray, o Sako papuntang Retail / Tingi
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-surface-400 hover:text-white">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 pt-3">
          {/* Source Bulk */}
          <div>
            <label className="block text-xs font-bold text-surface-300 mb-1">
              📦 Ang Bubuwaging Bulto / Kahon / Sako:
            </label>
            <select
              value={sourceProductId}
              onChange={e => setSourceProductId(e.target.value ? Number(e.target.value) : '')}
              className="w-full py-2 px-3 rounded-xl bg-surface-900 border border-surface-700 text-surface-100 text-xs font-semibold focus:border-amber-500 focus:outline-none"
              required
            >
              <option value="">-- Pumili ng Bulto / Sako / Kahon --</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.current_stock} {p.unit || 'unit'})
                </option>
              ))}
            </select>
            {sourceProduct && (
              <p className="text-[11px] text-surface-400 mt-1 flex justify-between">
                <span>Stock ngayon: <b className="text-amber-400">{sourceStock} {sourceUnit}</b></span>
                {!hasEnoughStock && <span className="text-rose-400 font-bold">⚠️ Kulang ang stock</span>}
              </p>
            )}
          </div>

          {/* Target Retail */}
          <div>
            <label className="block text-xs font-bold text-surface-300 mb-1">
              🛒 Ang Paglalagyan (Retail / Tingi Item):
            </label>
            <select
              value={targetProductId}
              onChange={e => setTargetProductId(e.target.value ? Number(e.target.value) : '')}
              className="w-full py-2 px-3 rounded-xl bg-surface-900 border border-surface-700 text-surface-100 text-xs font-semibold focus:border-amber-500 focus:outline-none"
              required
            >
              <option value="">-- Pumili ng Tingi / Kilo / Piraso Item --</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.current_stock} {p.unit || 'pcs'})
                </option>
              ))}
            </select>
            {targetProduct && (
              <p className="text-[11px] text-surface-400 mt-1">
                Stock ngayon sa retail: <b className="text-emerald-400">{targetStock} {targetUnit}</b>
              </p>
            )}
          </div>

          {/* Quantity Controls */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-surface-300 mb-1">
                Ilang {sourceUnit} ang bubuwagin:
              </label>
              <input
                type="number"
                min={1}
                value={bulkQtyToOpen || ''}
                onChange={e => setBulkQtyToOpen(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full py-2 px-3 rounded-xl bg-surface-900 border border-surface-700 text-surface-100 text-xs font-bold focus:border-amber-500 focus:outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-surface-300 mb-1">
                Laman ({targetUnit}) bawat {sourceUnit}:
              </label>
              <input
                type="number"
                min={0.1}
                step="0.01"
                value={yieldPerBulk || ''}
                onChange={e => setYieldPerBulk(Math.max(0.01, parseFloat(e.target.value) || 1))}
                className="w-full py-2 px-3 rounded-xl bg-surface-900 border border-surface-700 text-surface-100 text-xs font-bold focus:border-amber-500 focus:outline-none"
                required
              />
            </div>
          </div>

          {/* Quick preset chips */}
          <div className="flex items-center gap-1.5 pt-1 flex-wrap">
            <span className="text-[10px] text-surface-400 font-medium">Quick sizes:</span>
            {[
              { val: 50, label: '50kg (Sako)' },
              { val: 25, label: '25kg (½ Sako)' },
              { val: 30, label: '30 pcs (Tray)' },
              { val: 24, label: '24 pcs (Case)' },
              { val: 12, label: '12 pcs (Dozen)' },
              { val: 6, label: '6-pack' },
            ].map(preset => (
              <button
                key={preset.val}
                type="button"
                onClick={() => setYieldPerBulk(preset.val)}
                className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-colors ${
                  yieldPerBulk === preset.val
                    ? 'bg-amber-600 text-white'
                    : 'bg-surface-750 text-surface-300 hover:bg-surface-700'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Preview Transformation Card */}
          <div className="p-3 rounded-xl bg-surface-900 border border-amber-500/30 text-xs space-y-1.5">
            <p className="font-bold text-amber-300 flex items-center gap-1">
              <span>⚡</span> Resulta ng Pagbuwag:
            </p>
            <div className="flex items-center justify-between text-surface-300 text-[11px]">
              <span>Bawas sa Bulto:</span>
              <span className="text-rose-400 font-bold font-mono">-{bulkQtyToOpen} {sourceUnit}</span>
            </div>
            <div className="flex items-center justify-between text-surface-300 text-[11px]">
              <span>Dagdag sa Tingi Stock:</span>
              <span className="text-emerald-400 font-bold font-mono">+{totalYield} {targetUnit}</span>
            </div>
            {targetProduct && (
              <div className="flex items-center justify-between text-surface-200 text-[11px] pt-1 border-t border-surface-800">
                <span>Magiging Bago na Tingi Stock:</span>
                <span className="text-emerald-300 font-black font-mono">
                  {(targetStock + totalYield) % 1 === 0 ? targetStock + totalYield : (targetStock + totalYield).toFixed(2)} {targetUnit}
                </span>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 py-2 rounded-xl bg-surface-750 hover:bg-surface-700 text-surface-300 text-xs font-semibold"
            >
              Kanselahin
            </button>
            <button
              type="submit"
              disabled={saving || !sourceProduct || !targetProduct || !hasEnoughStock}
              className="flex-1 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-amber-600/20"
            >
              {saving ? 'Isinasalin ang Stock...' : '📦 Buwagin ang Bulto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
