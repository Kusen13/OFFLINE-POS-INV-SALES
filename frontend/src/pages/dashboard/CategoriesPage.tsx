/**
 * Categories Page - Category management with CRUD
 */

import { useState, useEffect } from 'react';
import { fetchCategories, createCategory, updateCategory, deleteCategory } from '../../api/endpoints';
import type { Category } from '../../types/product';

export function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Category | null>(null);

  async function loadCategories() {
    setLoading(true);
    try {
      const res = await fetchCategories(true);
      setCategories(res.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadCategories(); }, []);

  async function handleSave(data: { name: string; description: string; sort_order: number }) {
    if (editing) {
      await updateCategory(editing.id, data);
    } else {
      await createCategory(data);
    }
    setShowForm(false);
    setEditing(null);
    loadCategories();
  }

  async function handleDelete() {
    if (!deleteConfirm) return;
    try {
      await deleteCategory(deleteConfirm.id);
      setDeleteConfirm(null);
      loadCategories();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <div className="space-y-5 animate-fade-in pb-20 lg:pb-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-50">Categories</h1>
          <p className="text-surface-400 mt-1">{categories.length} categories</p>
        </div>
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="px-4 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-500 transition-colors shadow-lg shadow-primary-600/20 flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Add Category
        </button>
      </div>

      {error && (
        <div className="bg-danger-500/10 border border-danger-500/30 rounded-xl p-4">
          <p className="text-danger-500 text-sm">⚠️ {error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><div className="w-8 h-8 border-3 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {categories.map(cat => (
            <div key={cat.id} className="bg-surface-800/50 rounded-xl p-5 border border-surface-700/50 hover:border-primary-500/30 transition-all group">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-bold text-surface-100">{cat.name}</h3>
                  {cat.description && <p className="text-surface-400 text-sm mt-1">{cat.description}</p>}
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => { setEditing(cat); setShowForm(true); }} className="p-1.5 rounded-lg text-surface-400 hover:text-primary-400 hover:bg-primary-500/10">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  </button>
                  <button onClick={() => setDeleteConfirm(cat)} className="p-1.5 rounded-lg text-surface-400 hover:text-danger-500 hover:bg-danger-500/10">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-4">
                <span className="px-2.5 py-1 rounded-lg bg-primary-500/10 text-primary-400 text-xs font-bold">
                  {cat.product_count ?? 0} products
                </span>
                <span className="text-surface-500 text-xs">Order: {cat.sort_order}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <CategoryFormModal
          category={editing}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditing(null); }}
        />
      )}

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-surface-800 rounded-2xl p-6 max-w-sm w-full border border-surface-700 shadow-2xl animate-fade-in">
            <h3 className="text-lg font-bold text-surface-100 mb-2">Delete Category?</h3>
            <p className="text-surface-400 text-sm mb-6">
              Delete <strong className="text-surface-200">{deleteConfirm.name}</strong>? Products in this category will become uncategorized.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 px-4 py-2.5 rounded-xl bg-surface-700 text-surface-200 text-sm font-medium hover:bg-surface-600 transition-colors">Cancel</button>
              <button onClick={handleDelete} className="flex-1 px-4 py-2.5 rounded-xl bg-danger-600 text-white text-sm font-medium hover:bg-danger-500 transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryFormModal({ category, onSave, onClose }: {
  category: Category | null;
  onSave: (data: { name: string; description: string; sort_order: number }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [sortOrder, setSortOrder] = useState(category?.sort_order ?? 0);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setFormError('Name is required'); return; }
    setSaving(true);
    setFormError('');
    try {
      await onSave({ name: name.trim(), description: description.trim(), sort_order: sortOrder });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-800 rounded-2xl p-6 max-w-md w-full border border-surface-700 shadow-2xl animate-fade-in">
        <h3 className="text-lg font-bold text-surface-100 mb-5">{category ? 'Edit Category' : 'New Category'}</h3>
        {formError && <div className="mb-4 p-3 rounded-lg bg-danger-500/10 border border-danger-500/30 text-danger-500 text-sm">{formError}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1.5">Name *</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} className="form-input" placeholder="e.g., Coffee" required />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1.5">Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} className="form-input" rows={2} placeholder="Optional description" />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1.5">Sort Order</label>
            <input type="number" min="0" value={sortOrder} onChange={e => setSortOrder(parseInt(e.target.value) || 0)} className="form-input" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl bg-surface-700 text-surface-200 text-sm font-medium hover:bg-surface-600 transition-colors">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 px-4 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-500 disabled:opacity-50 transition-colors">
              {saving ? 'Saving...' : category ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
