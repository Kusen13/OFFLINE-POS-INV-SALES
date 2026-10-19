/**
 * Products Page - Full product management with CRUD, search, filters, and pagination
 */

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { fetchProducts, fetchCategories, createProduct, updateProduct, deleteProduct } from '../../api/endpoints';
import { formatCurrency } from '../../utils/currency';
import { getTodayStr } from '../../utils/date';
import { exportToCSV, formatProductsForCSV } from '../../utils/csv';
import type { Product, Category, ProductFormData } from '../../types/product';

interface ProductFilters {
  page: number;
  per_page: number;
  search: string;
  category_id: number | undefined;
}

export function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, per_page: 15, total_pages: 0 });
  const [filters, setFilters] = useState<ProductFilters>({ page: 1, per_page: 15, search: '', category_id: undefined });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Product | null>(null);
  const [searchInput, setSearchInput] = useState('');

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchProducts({
        page: filters.page,
        per_page: filters.per_page,
        search: filters.search || undefined,
        category_id: filters.category_id,
      });
      setProducts(res.data);
      setPagination(res.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load products');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    fetchCategories(true).then(res => setCategories(res.data)).catch(() => {});
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters(f => ({ ...f, page: 1, search: searchInput }));
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  async function handleSaveProduct(data: ProductFormData) {
    try {
      if (editingProduct) {
        await updateProduct(editingProduct.id, data);
      } else {
        await createProduct(data);
      }
      setShowForm(false);
      setEditingProduct(null);
      loadProducts();
    } catch (err) {
      throw err;
    }
  }

  async function handleDelete() {
    if (!deleteConfirm) return;
    try {
      await deleteProduct(deleteConfirm.id);
      setDeleteConfirm(null);
      loadProducts();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-4 animate-fade-in">
      <div className="flex-shrink-0 space-y-3">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-surface-50">Products</h1>
            <p className="text-surface-400 mt-1">{pagination.total} products in catalog</p>
          </div>
          <div className="flex gap-2">
            {products.length > 0 && (
              <button
                onClick={() => exportToCSV(formatProductsForCSV(products), `products_export_${getTodayStr()}`)}
                className="px-4 py-2.5 rounded-xl bg-surface-700 text-surface-200 text-sm font-medium hover:bg-surface-600 transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                CSV
              </button>
            )}
            <button
              onClick={() => { setEditingProduct(null); setShowForm(true); }}
              className="px-4 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-500 transition-colors shadow-lg shadow-primary-600/20 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              Add Product
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search products..."
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-surface-800 border border-surface-700 text-surface-100 text-sm placeholder:text-surface-500 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/50 transition-colors"
            />
          </div>
          <select
            value={filters.category_id ?? ''}
            onChange={e => setFilters(f => ({ ...f, page: 1, category_id: e.target.value ? Number(e.target.value) : undefined }))}
            className="px-4 py-2.5 rounded-xl bg-surface-800 border border-surface-700 text-surface-100 text-sm focus:outline-none focus:border-primary-500 transition-colors"
          >
            <option value="">All Categories</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.name} ({c.product_count ?? 0})</option>
            ))}
          </select>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-danger-500/10 border border-danger-500/30 rounded-xl p-4 flex items-center justify-between">
          <p className="text-danger-500 text-sm">⚠️ {error}</p>
          <button onClick={loadProducts} className="text-primary-400 text-sm hover:text-primary-300">Retry</button>
        </div>
      )}

      {/* Products table card */}
      <div className="flex-1 min-h-0 bg-surface-800/50 rounded-xl border border-surface-700/50 flex flex-col overflow-hidden shadow-sm">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-3 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-12">
            <span className="text-4xl mb-3 block">📦</span>
            <p className="text-surface-300 font-medium">No products found</p>
            <p className="text-surface-500 text-sm mt-1">{searchInput ? 'Try a different search term' : 'Add your first product to get started'}</p>
          </div>
        ) : (
          <>
            {/* Scrollable table rows container */}
            <div className="flex-1 min-h-0 overflow-auto">
              {/* Desktop table */}
              <div className="hidden md:block">
                <table className="w-full text-left">
                  <thead className="sticky top-0 bg-surface-900 border-b border-surface-700/50 z-10 shadow-sm">
                    <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-surface-400 uppercase tracking-wider">Product</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-surface-400 uppercase tracking-wider">Category</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-surface-400 uppercase tracking-wider">Cost</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-surface-400 uppercase tracking-wider">Price</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-surface-400 uppercase tracking-wider">Stock</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-surface-400 uppercase tracking-wider">Status</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-surface-400 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-700/30">
                  {products.map(p => (
                    <tr key={p.id} className="hover:bg-surface-700/20 transition-colors">
                      <td className="px-4 py-3">
                        <div>
                          <p className="text-surface-100 font-medium text-sm">{p.name}</p>
                          <p className="text-surface-500 text-xs">SKU: {p.sku}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-surface-300 text-sm">{p.category_name}</td>
                      <td className="px-4 py-3 text-surface-400 text-sm text-right">{formatCurrency(p.cost_price)}</td>
                      <td className="px-4 py-3 text-surface-100 text-sm text-right font-medium">{formatCurrency(p.selling_price)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-sm font-bold ${
                          p.current_stock === 0 ? 'text-danger-500' :
                          p.current_stock <= p.low_stock_threshold ? 'text-warning-500' :
                          'text-success-500'
                        }`}>
                          {p.current_stock}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          p.is_active ? 'bg-success-500/20 text-success-500' : 'bg-surface-600 text-surface-400'
                        }`}>
                          {p.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => { setEditingProduct(p); setShowForm(true); }}
                            className="p-1.5 rounded-lg text-surface-400 hover:text-primary-400 hover:bg-primary-500/10 transition-colors"
                            title="Edit"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(p)}
                            className="p-1.5 rounded-lg text-surface-400 hover:text-danger-500 hover:bg-danger-500/10 transition-colors"
                            title="Delete"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-surface-700/30">
              {products.map(p => (
                <div key={p.id} className="p-4 hover:bg-surface-700/20 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-surface-100 font-medium">{p.name}</p>
                      <p className="text-surface-500 text-xs mt-0.5">{p.category_name} • {p.sku}</p>
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      <button onClick={() => { setEditingProduct(p); setShowForm(true); }} className="p-1.5 rounded-lg text-surface-400 hover:text-primary-400">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                      </button>
                      <button onClick={() => setDeleteConfirm(p)} className="p-1.5 rounded-lg text-surface-400 hover:text-danger-500">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 mt-2">
                    <span className="text-surface-100 font-bold text-sm">{formatCurrency(p.selling_price)}</span>
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                      p.current_stock === 0 ? 'bg-danger-500/20 text-danger-500' :
                      p.current_stock <= p.low_stock_threshold ? 'bg-warning-500/20 text-warning-500' :
                      'bg-success-500/20 text-success-500'
                    }`}>
                      {p.current_stock} in stock
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

            {/* Pinned Card Footer: Pagination */}
            <div className="flex-shrink-0 px-4 py-3 bg-surface-900/60 border-t border-surface-700/50 flex items-center justify-between">
              <p className="text-surface-400 text-xs sm:text-sm">
                Page {pagination.page} of {pagination.total_pages || 1} <span className="hidden sm:inline">({pagination.total} items)</span>
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}
                  disabled={pagination.page <= 1}
                  className="px-3 py-1.5 rounded-lg bg-surface-800 text-surface-300 text-xs sm:text-sm hover:bg-surface-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ← Prev
                </button>
                <button
                  onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}
                  disabled={pagination.page >= pagination.total_pages}
                  className="px-3 py-1.5 rounded-lg bg-surface-800 text-surface-300 text-xs sm:text-sm hover:bg-surface-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next →
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Product form modal */}
      {showForm && (
        <ProductFormModal
          product={editingProduct}
          categories={categories}
          onSave={handleSaveProduct}
          onClose={() => { setShowForm(false); setEditingProduct(null); }}
        />
      )}

      {/* Delete confirmation modal */}
      {deleteConfirm && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-surface-800 rounded-2xl p-6 max-w-sm w-full border border-surface-700 shadow-2xl animate-fade-in">
            <h3 className="text-lg font-bold text-surface-100 mb-2">Delete Product?</h3>
            <p className="text-surface-400 text-sm mb-6">
              Are you sure you want to delete <strong className="text-surface-200">{deleteConfirm.name}</strong>? This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 px-4 py-2.5 rounded-xl bg-surface-700 text-surface-200 text-sm font-medium hover:bg-surface-600 transition-colors">Cancel</button>
              <button onClick={handleDelete} className="flex-1 px-4 py-2.5 rounded-xl bg-danger-600 text-white text-sm font-medium hover:bg-danger-500 transition-colors">Delete</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ============================================================
// Product Form Modal
// ============================================================

function ProductFormModal({ product, categories, onSave, onClose }: {
  product: Product | null;
  categories: Category[];
  onSave: (data: ProductFormData) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<ProductFormData>({
    name: product?.name ?? '',
    sku: product?.sku ?? '',
    category_id: product?.category_id ?? (categories[0]?.id ?? 0),
    description: product?.description ?? '',
    cost_price: product?.cost_price ?? 0,
    selling_price: product?.selling_price ?? 0,
    current_stock: product?.current_stock ?? 0,
    low_stock_threshold: product?.low_stock_threshold ?? 10,
    is_active: product?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.sku.trim() || form.selling_price <= 0) {
      setFormError('Name, SKU, and selling price are required.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await onSave(form);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh] bg-black/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-surface-800 rounded-2xl p-6 max-w-lg w-full border border-surface-700 shadow-2xl animate-fade-in my-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-surface-100">{product ? 'Edit Product' : 'New Product'}</h3>
          <button onClick={onClose} className="p-1 rounded-lg text-surface-400 hover:text-surface-200 hover:bg-surface-700">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {formError && (
          <div className="mb-4 p-3 rounded-lg bg-danger-500/10 border border-danger-500/30 text-danger-500 text-sm">{formError}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Product Name *">
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="form-input" placeholder="e.g., Iced Americano" required />
            </FormField>
            <FormField label="SKU *">
              <input type="text" value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} className="form-input" placeholder="e.g., ICE-AME-001" required />
            </FormField>
          </div>

          <FormField label="Category">
            <select value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: Number(e.target.value) }))} className="form-input">
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </FormField>

          <FormField label="Description">
            <textarea value={form.description ?? ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="form-input" rows={2} placeholder="Optional description" />
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Cost Price *">
              <input type="number" step="0.01" min="0" value={form.cost_price} onChange={e => setForm(f => ({ ...f, cost_price: parseFloat(e.target.value) || 0 }))} className="form-input" required />
            </FormField>
            <FormField label="Selling Price *">
              <input type="number" step="0.01" min="0.01" value={form.selling_price} onChange={e => setForm(f => ({ ...f, selling_price: parseFloat(e.target.value) || 0 }))} className="form-input" required />
            </FormField>
          </div>

          {!product && (
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Initial Stock">
                <input type="number" min="0" value={form.current_stock ?? 0} onChange={e => setForm(f => ({ ...f, current_stock: parseInt(e.target.value) || 0 }))} className="form-input" />
              </FormField>
              <FormField label="Low Stock Threshold">
                <input type="number" min="0" value={form.low_stock_threshold ?? 10} onChange={e => setForm(f => ({ ...f, low_stock_threshold: parseInt(e.target.value) || 10 }))} className="form-input" />
              </FormField>
            </div>
          )}

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_active ?? true} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} className="w-4 h-4 rounded bg-surface-700 border-surface-600 text-primary-600 focus:ring-primary-500/50" />
            <span className="text-surface-200 text-sm">Active (visible in POS)</span>
          </label>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl bg-surface-700 text-surface-200 text-sm font-medium hover:bg-surface-600 transition-colors">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 px-4 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-500 disabled:opacity-50 transition-colors">
              {saving ? 'Saving...' : product ? 'Update Product' : 'Create Product'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-surface-400 mb-1.5">{label}</label>
      {children}
    </div>
  );
}
