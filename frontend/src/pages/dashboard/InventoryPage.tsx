/**
 * Inventory Page - Stock levels and adjustments
 */

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { fetchInventory, fetchCategories, createStockAdjustment } from '../../api/endpoints';
import { formatCurrency } from '../../utils/currency';
import type { InventoryItem } from '../../types/inventory';
import type { Category } from '../../types/product';

export function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, per_page: 50, total_pages: 0 });
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState<InventoryItem | null>(null);

  const loadInventory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchInventory({
        page: pagination.page,
        per_page: 50,
        low_stock_only: lowStockOnly || undefined,
        category_id: categoryFilter,
      });
      setItems(res.data);
      setPagination(res.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [pagination.page, lowStockOnly, categoryFilter]);

  useEffect(() => { loadInventory(); }, [loadInventory]);
  useEffect(() => { fetchCategories().then(r => setCategories(r.data)).catch(() => {}); }, []);

  return (
    <div className="space-y-5 animate-fade-in pb-20 lg:pb-0">
      <div>
        <h1 className="text-2xl font-bold text-surface-50">Inventory</h1>
        <p className="text-surface-400 mt-1">Stock levels and adjustments</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => { setLowStockOnly(!lowStockOnly); setPagination(p => ({ ...p, page: 1 })); }}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
            lowStockOnly ? 'bg-warning-500/20 text-warning-500 border border-warning-500/30' : 'bg-surface-800 text-surface-300 border border-surface-700 hover:bg-surface-700'
          }`}
        >
          ⚠️ Low Stock Only
        </button>
        <select
          value={categoryFilter ?? ''}
          onChange={e => { setCategoryFilter(e.target.value ? Number(e.target.value) : undefined); setPagination(p => ({ ...p, page: 1 })); }}
          className="form-input w-auto"
        >
          <option value="">All Categories</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {error && (
        <div className="bg-danger-500/10 border border-danger-500/30 rounded-xl p-4">
          <p className="text-danger-500 text-sm">⚠️ {error}</p>
        </div>
      )}

      <div className="bg-surface-800/50 rounded-xl border border-surface-700/50 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12"><div className="w-8 h-8 border-3 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" /></div>
        ) : items.length === 0 ? (
          <div className="text-center py-12">
            <span className="text-4xl mb-3 block">📋</span>
            <p className="text-surface-300 font-medium">No items found</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-surface-700/50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-surface-400 uppercase tracking-wider">Product</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-surface-400 uppercase tracking-wider">Category</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-surface-400 uppercase tracking-wider">Price</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-surface-400 uppercase tracking-wider">Stock</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-surface-400 uppercase tracking-wider">Threshold</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-surface-400 uppercase tracking-wider">Status</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-surface-400 uppercase tracking-wider">Adjust</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-700/30">
                  {items.map(item => (
                    <tr key={item.id} className="hover:bg-surface-700/20 transition-colors">
                      <td className="px-4 py-3">
                        <p className="text-surface-100 font-medium text-sm">{item.name}</p>
                        <p className="text-surface-500 text-xs">{item.sku}</p>
                      </td>
                      <td className="px-4 py-3 text-surface-300 text-sm">{item.category_name}</td>
                      <td className="px-4 py-3 text-surface-100 text-sm text-right">{formatCurrency(item.selling_price)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-sm font-bold ${
                          item.current_stock === 0 ? 'text-danger-500' :
                          item.is_low_stock ? 'text-warning-500' : 'text-success-500'
                        }`}>{item.current_stock}</span>
                      </td>
                      <td className="px-4 py-3 text-surface-400 text-sm text-right">{item.low_stock_threshold}</td>
                      <td className="px-4 py-3 text-center">
                        {item.current_stock === 0 ? (
                          <span className="px-2 py-0.5 rounded-full bg-danger-500/20 text-danger-500 text-xs font-medium">Out of Stock</span>
                        ) : item.is_low_stock ? (
                          <span className="px-2 py-0.5 rounded-full bg-warning-500/20 text-warning-500 text-xs font-medium">Low Stock</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-success-500/20 text-success-500 text-xs font-medium">In Stock</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => setAdjusting(item)} className="px-2.5 py-1 rounded-lg text-primary-400 text-xs font-medium hover:bg-primary-500/10 transition-colors">
                          Adjust
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-surface-700/30">
              {items.map(item => (
                <div key={item.id} className="p-4 hover:bg-surface-700/20 transition-colors">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-surface-100 font-medium text-sm">{item.name}</p>
                      <p className="text-surface-500 text-xs">{item.category_name}</p>
                    </div>
                    <button onClick={() => setAdjusting(item)} className="px-2 py-1 rounded-lg text-primary-400 text-xs hover:bg-primary-500/10">Adjust</button>
                  </div>
                  <div className="flex items-center gap-3 mt-2">
                    <span className={`text-sm font-bold ${item.current_stock === 0 ? 'text-danger-500' : item.is_low_stock ? 'text-warning-500' : 'text-success-500'}`}>
                      {item.current_stock} units
                    </span>
                    <span className="text-surface-500 text-xs">min: {item.low_stock_threshold}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Pagination */}
      {pagination.total_pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-surface-400 text-sm">Page {pagination.page} of {pagination.total_pages}</p>
          <div className="flex gap-1">
            <button onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))} disabled={pagination.page <= 1} className="px-3 py-1.5 rounded-lg bg-surface-800 text-surface-300 text-sm disabled:opacity-40 transition-colors">← Prev</button>
            <button onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))} disabled={pagination.page >= pagination.total_pages} className="px-3 py-1.5 rounded-lg bg-surface-800 text-surface-300 text-sm disabled:opacity-40 transition-colors">Next →</button>
          </div>
        </div>
      )}

      {/* Stock adjustment modal */}
      {adjusting && (
        <StockAdjustModal
          item={adjusting}
          onClose={() => setAdjusting(null)}
          onSaved={() => { setAdjusting(null); loadInventory(); }}
        />
      )}
    </div>
  );
}

function StockAdjustModal({ item, onClose, onSaved }: {
  item: InventoryItem; onClose: () => void; onSaved: () => void;
}) {
  const [type, setType] = useState<'STOCK_IN' | 'ADJUSTMENT'>('STOCK_IN');
  const [quantity, setQuantity] = useState(0);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (quantity <= 0) { setFormError('Quantity must be greater than 0'); return; }
    setSaving(true);
    setFormError('');
    try {
      await createStockAdjustment({
        product_id: item.id,
        type,
        quantity: type === 'ADJUSTMENT' ? -quantity : quantity,
        notes: notes.trim() || undefined,
      });
      onSaved();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-800 rounded-2xl p-6 max-w-sm w-full border border-surface-700 shadow-2xl animate-fade-in">
        <h3 className="text-lg font-bold text-surface-100 mb-1">Adjust Stock</h3>
        <p className="text-surface-400 text-sm mb-5">{item.name} — Current: <strong className="text-surface-200">{item.current_stock}</strong></p>
        {formError && <div className="mb-4 p-3 rounded-lg bg-danger-500/10 border border-danger-500/30 text-danger-500 text-sm">{formError}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1.5">Type</label>
            <select value={type} onChange={e => setType(e.target.value as 'STOCK_IN' | 'ADJUSTMENT')} className="form-input">
              <option value="STOCK_IN">Stock In (Add)</option>
              <option value="ADJUSTMENT">Adjustment (Remove)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1.5">Quantity</label>
            <input type="number" min="1" value={quantity || ''} onChange={e => setQuantity(parseInt(e.target.value) || 0)} className="form-input" required />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1.5">Notes</label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)} className="form-input" placeholder="Optional note" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl bg-surface-700 text-surface-200 text-sm font-medium hover:bg-surface-600 transition-colors">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 px-4 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-500 disabled:opacity-50 transition-colors">
              {saving ? 'Saving...' : 'Apply'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
