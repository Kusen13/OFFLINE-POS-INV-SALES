import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
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
import type { Product } from '../../types/product';
import type { Supplier } from '../../types/supplier';

export function InventoryPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [search, setSearch] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'low' | 'out' | 'healthy'>('all');
  const [toast, setToast] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  // Modals
  const [showBatchStockIn, setShowBatchStockIn] = useState(false);
  const [showWasteModal, setShowWasteModal] = useState(false);
  const [selectedProductForAction, setSelectedProductForAction] = useState<Product | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyLogs, setHistoryLogs] = useState<StockMovementRecord[]>([]);

  // ─── Data Loading ──────────────────────────────────────────
  const reload = useCallback(async () => {
    try {
      const all = await getAllProducts();
      setProducts(all);
      setHistoryLogs(getStockMovementLogs(50));
    } catch (err) {
      console.error('Failed to reload inventory products:', err);
    }
  }, []);

  useEffect(() => {
    reload();

    const handleSaleEvent = () => reload();
    window.addEventListener('pos_sale_completed', handleSaleEvent);
    window.addEventListener('pos_sync_completed', handleSaleEvent);
    window.addEventListener('pos_inventory_updated', handleSaleEvent);

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel('pos_channel');
      channel.onmessage = (msg) => {
        if (
          msg.data?.type === 'SALE_COMPLETED' ||
          msg.data?.type === 'SYNC_COMPLETED' ||
          msg.data?.type === 'INVENTORY_UPDATED'
        ) {
          reload();
        }
      };
    } catch (_) {}

    return () => {
      window.removeEventListener('pos_sale_completed', handleSaleEvent);
      window.removeEventListener('pos_sync_completed', handleSaleEvent);
      window.removeEventListener('pos_inventory_updated', handleSaleEvent);
      if (channel) channel.close();
    };
  }, [reload]);

  useEffect(() => {
    getAllSuppliers()
      .then(s => setSuppliers(s.filter(sup => sup.is_active)))
      .catch(() => {});
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // ─── Stock Adjustments ─────────────────────────────────────
  const handleQuickDelta = async (p: Product, delta: number) => {
    setUpdatingId(p.id);
    try {
      const type = delta > 0 ? 'STOCK_IN' : 'ADJUSTMENT';
      const reason = delta > 0 ? 'Mabilisang Dagdag' : 'Mabilisang Bawas';
      await adjustProductStock(p.id, delta, type, reason);
      await reload();
      showToast(`${delta > 0 ? '➕ Dinagdagan' : '➖ Binawasan'} ang stock ng ${p.name}`);
    } catch {
      showToast('⚠️ Hindi ma-update ang stock');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDirectStockChange = async (p: Product, rawVal: string) => {
    const val = Math.max(0, parseInt(rawVal, 10) || 0);
    if (val === p.current_stock) return;
    try {
      await setProductStock(p.id, val, 'Physical count update sa Inventory');
      await reload();
      showToast(`🔄 Na-update ang stock ng ${p.name} sa ${val}`);
    } catch {
      showToast('⚠️ Hindi ma-save ang bilang ng stock');
    }
  };

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

      const isOut = (p.current_stock ?? 0) === 0;
      const isLow = !isOut && (p.current_stock ?? 0) <= (p.low_stock_threshold || 5);
      const isHealthy = !isOut && !isLow;

      let matchStatus = true;
      if (statusFilter === 'out') matchStatus = isOut;
      if (statusFilter === 'low') matchStatus = isLow;
      if (statusFilter === 'healthy') matchStatus = isHealthy;

      return matchSearch && matchSupplier && matchStatus;
    });
  }, [products, search, supplierFilter, statusFilter]);

  // Overall Statistics
  const totalUnits = useMemo(
    () => products.reduce((sum, p) => sum + (Number(p.current_stock) || 0), 0),
    [products]
  );

  const lowStockProducts = useMemo(
    () => products.filter(p => (p.current_stock ?? 0) <= (p.low_stock_threshold || 5) && p.is_active),
    [products]
  );

  const totalInventoryValue = useMemo(
    () => products.reduce((sum, p) => sum + (Number(p.current_stock) || 0) * (Number(p.cost_price) || 0), 0),
    [products]
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 animate-fade-in pb-16 lg:pb-0">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-4 right-4 z-[100] px-4 py-2.5 rounded-xl bg-surface-900 border border-emerald-500/50 text-emerald-300 text-xs sm:text-sm font-semibold shadow-2xl animate-fade-in flex items-center gap-2">
          <span>✅</span>
          <span>{toast}</span>
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg sm:text-xl font-black text-surface-50 tracking-tight flex items-center gap-2">
            <span>📦</span>
            <span>Inventory (Stock Control)</span>
          </h1>
          <p className="text-[11px] text-surface-400 mt-0.5">
            Real-time stock monitoring, pagtanggap ng delivery, at pag-audit ng mga paninda
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <Link
            to="/dashboard/products"
            className="flex items-center gap-1.5 px-3 py-1.5 sm:py-2 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-200 text-xs font-semibold border border-surface-700 transition-colors shadow-xs"
            title="Pumunta sa Products Catalog para mag-add o mag-edit ng paninda"
          >
            <span>⚙️</span>
            <span>Products Catalog →</span>
          </Link>

          <Link
            to="/dashboard/reorder"
            className="flex items-center gap-1.5 px-3 py-1.5 sm:py-2 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-200 text-xs font-semibold border border-surface-700 transition-colors shadow-xs"
            title="Pumunta sa Re-Order Sheet para mag-order sa supplier"
          >
            <span>🍢</span>
            <span>Re-Order →</span>
          </Link>

          <button
            onClick={() => {
              setSelectedProductForAction(null);
              setShowWasteModal(true);
            }}
            className="flex items-center gap-1 px-3 py-1.5 sm:py-2 rounded-xl bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 text-xs font-semibold border border-rose-800/60 transition-colors cursor-pointer"
            title="Itala ang nasira, napaso, o itinapong items"
          >
            <span>⚠️</span>
            <span>Spoilage / Tapon</span>
          </button>

          <button
            onClick={() => setShowBatchStockIn(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 sm:py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-bold shadow-lg shadow-emerald-600/20 transition-all cursor-pointer whitespace-nowrap"
            title="Magdagdag ng delivery stocks para sa mga paninda"
          >
            <span>📥</span>
            <span>Batch Stock-In</span>
          </button>
        </div>
      </div>

      {/* ── 4 Summary Stat Cards ────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 shrink-0">
        {/* Total Unique Products */}
        <div className="bg-surface-850/90 rounded-xl p-3 border border-surface-700/60 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[10px] sm:text-[11px] font-bold text-surface-400 uppercase tracking-wider block">
              Paninda (Items)
            </span>
            <span className="text-xl sm:text-2xl font-black text-surface-100 mt-0.5 block">
              {products.length}
              <span className="text-xs font-medium text-surface-500 ml-1">klase</span>
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-surface-800 border border-surface-700 flex items-center justify-center text-lg text-surface-300">
            🍢
          </div>
        </div>

        {/* Total Units in Stock */}
        <div className="bg-surface-850/90 rounded-xl p-3 border border-surface-700/60 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[10px] sm:text-[11px] font-bold text-sky-400 uppercase tracking-wider block">
              Aktwal na Stocks
            </span>
            <span className="text-xl sm:text-2xl font-black text-sky-300 mt-0.5 block">
              {totalUnits}
              <span className="text-xs font-medium text-surface-400 ml-1">sticks/pcs</span>
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-lg text-sky-400">
            📊
          </div>
        </div>

        {/* Low Stock Alerts */}
        <div className="bg-surface-850/90 rounded-xl p-3 border border-surface-700/60 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[10px] sm:text-[11px] font-bold text-amber-400 uppercase tracking-wider block">
              Kailangang I-order
            </span>
            <span className="text-xl sm:text-2xl font-black text-amber-300 mt-0.5 block">
              {lowStockProducts.length}
              <span className="text-xs font-medium text-surface-400 ml-1">items low</span>
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-lg text-amber-400">
            ⚠️
          </div>
        </div>

        {/* Total Cost Value */}
        <div className="bg-surface-850/90 rounded-xl p-3 border border-surface-700/60 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[10px] sm:text-[11px] font-bold text-emerald-400 uppercase tracking-wider block">
              Halaga ng Inventory
            </span>
            <span className="text-xl sm:text-2xl font-black text-emerald-300 mt-0.5 block">
              {formatCurrency(totalInventoryValue)}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-lg text-emerald-400">
            💰
          </div>
        </div>
      </div>

      {/* ── Filters & Controls Bar ──────────────────────────── */}
      <div className="bg-surface-850/80 rounded-2xl border border-surface-700/60 p-3 flex flex-col sm:flex-row gap-2.5 items-center justify-between shrink-0 shadow-xs">
        <div className="flex items-center gap-2 flex-1 w-full sm:w-auto">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Hanapin ang paninda o SKU..."
            className="flex-1 sm:max-w-xs px-3.5 py-1.5 rounded-xl bg-surface-800 border border-surface-700 text-surface-100 text-xs placeholder:text-surface-500 focus:outline-none focus:border-primary-500"
          />

          <select
            value={supplierFilter}
            onChange={e => setSupplierFilter(e.target.value)}
            className="px-3 py-1.5 rounded-xl bg-surface-800 border border-surface-700 text-surface-200 text-xs cursor-pointer focus:outline-none focus:border-primary-500"
          >
            <option value="">🏪 Lahat ng Supplier</option>
            {suppliers.map(s => (
              <option key={s.id} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {/* Status Pill Filter */}
        <div className="flex items-center gap-1 bg-surface-800 p-0.5 rounded-xl border border-surface-700 text-xs self-start sm:self-auto">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
              statusFilter === 'all' ? 'bg-primary-600 text-white shadow-xs' : 'text-surface-400 hover:text-white'
            }`}
          >
            Lahat ({products.length})
          </button>
          <button
            onClick={() => setStatusFilter('low')}
            className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
              statusFilter === 'low' ? 'bg-amber-600 text-white shadow-xs' : 'text-surface-400 hover:text-amber-300'
            }`}
          >
            ⚠️ Low ({lowStockProducts.length})
          </button>
          <button
            onClick={() => setStatusFilter('out')}
            className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
              statusFilter === 'out' ? 'bg-rose-600 text-white shadow-xs' : 'text-surface-400 hover:text-rose-300'
            }`}
          >
            🔴 Ubos ({products.filter(p => (p.current_stock ?? 0) === 0).length})
          </button>
          <button
            onClick={() => setShowHistoryModal(true)}
            className="px-2.5 py-1 rounded-lg text-surface-300 hover:text-white font-medium flex items-center gap-1 cursor-pointer"
            title="Tingnan ang Log ng Galaw ng Stocks"
          >
            <span>📜</span>
            <span className="hidden xs:inline">Logs</span>
          </button>
        </div>
      </div>

      {/* ── Main Stock Items List ────────────────────────────── */}
      <div className="flex-1 min-h-0 bg-surface-850/80 rounded-2xl border border-surface-700/60 overflow-hidden shadow-xs flex flex-col">
        {filteredProducts.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-16 text-center text-surface-400">
            <span className="text-3xl mb-2">📦</span>
            <p className="text-sm font-semibold text-surface-200">Walang nahanap na paninda</p>
            <p className="text-xs text-surface-500 mt-0.5">
              Subukan ang ibang filter o magdagdag ng bagong paninda sa Products Catalog.
            </p>
            <Link
              to="/dashboard/products"
              className="mt-3 px-3.5 py-1.5 rounded-xl bg-primary-600 text-white text-xs font-bold hover:bg-primary-500 transition-colors"
            >
              Pumunta sa Products Catalog →
            </Link>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-auto">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-surface-900 border-b border-surface-700/80 z-10 shadow-xs">
                <tr>
                  <th className="px-3.5 py-2.5 text-[11px] font-bold text-surface-400 uppercase whitespace-nowrap">
                    Pangalan ng Paninda
                  </th>
                  <th className="px-3 py-2.5 text-[11px] font-bold text-surface-400 uppercase whitespace-nowrap hidden sm:table-cell">
                    Supplier
                  </th>
                  <th className="px-3 py-2.5 text-[11px] font-bold text-surface-400 uppercase text-center whitespace-nowrap">
                    Target Par Stock
                  </th>
                  <th className="px-3 py-2.5 text-[11px] font-bold text-surface-400 uppercase text-center whitespace-nowrap">
                    Live Current Stock
                  </th>
                  <th className="px-3 py-2.5 text-[11px] font-bold text-surface-400 uppercase text-center whitespace-nowrap hidden md:table-cell">
                    Status
                  </th>
                  <th className="px-3 py-2.5 text-[11px] font-bold text-surface-400 uppercase text-right whitespace-nowrap">
                    Quick Action
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
                  const unit = p.unit || 'sticks';

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
                          <span className="text-base">🍢</span>
                          <div>
                            <p className="font-bold text-surface-100 flex items-center gap-1.5">
                              <span>{p.name}</span>
                              <span className="text-[10px] font-normal text-surface-400">({unit})</span>
                            </p>
                            <p className="text-[10px] font-mono text-surface-500 mt-0.5">
                              {p.sku} • Puhunan: {formatCurrency(p.cost_price)}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Supplier Badge */}
                      <td className="px-3 py-2.5 text-xs whitespace-nowrap hidden sm:table-cell">
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
                      <td className="px-3 py-2.5 text-center whitespace-nowrap hidden md:table-cell">
                        {isOut ? (
                          <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-bold inline-flex items-center gap-1">
                            🔴 Ubos na
                          </span>
                        ) : isLow ? (
                          <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-bold inline-flex items-center gap-1">
                            ⚠️ Low Stock ({stock}/{par})
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold inline-flex items-center gap-1">
                            🟢 Sapat ({stock})
                          </span>
                        )}
                      </td>

                      {/* Row Action Buttons */}
                      <td className="px-3 py-2.5 text-right whitespace-nowrap text-xs">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
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
