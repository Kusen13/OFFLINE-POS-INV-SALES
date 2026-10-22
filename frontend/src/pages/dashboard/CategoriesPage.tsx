/**
 * Categories Page - Category management with CRUD
 */

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { fetchCategories, createCategory, updateCategory, deleteCategory } from '../../api/endpoints';
import { replaceAllCategories, getAllCategories, saveLocalCategory, deleteLocalCategory } from '../../db/productRepository';
import { addPendingMutation, removeMutationByTempId } from '../../db/mutationRepository';
import { useSyncStore } from '../../features/sync/syncStore';
import type { Category } from '../../types/product';

export function CategoriesPage() {
  const [categories, setCategories] = useState<(Category & { is_pending?: boolean })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Category | null>(null);

  async function loadCategories() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchCategories(true);
      await replaceAllCategories(res.data);
      const localAll = await getAllCategories();
      const pendingItems = localAll.filter(c => c.id < 0 || c.is_pending);
      setCategories([...pendingItems, ...res.data]);
    } catch {
      // Fallback to local IndexedDB
      try {
        const local = await getAllCategories();
        setCategories(local);
      } catch (localErr) {
        setError(localErr instanceof Error ? localErr.message : 'Failed to load categories');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadCategories(); }, []);

  async function handleSave(data: { name: string; description: string; sort_order: number }) {
    try {
      if (editing) {
        if (editing.id > 0) {
          try {
            await updateCategory(editing.id, data);
            await saveLocalCategory({ ...editing, ...data });
          } catch {
            await saveLocalCategory({ ...editing, ...data, is_pending: true });
            await addPendingMutation({
              entity: 'category',
              action: 'update',
              payload: data,
              entityId: editing.id,
            });
            setNoticeMsg('Updated offline! It will sync automatically when connected to the laptop.');
          }
        } else {
          // Editing offline-created item
          await saveLocalCategory({ ...editing, ...data, is_pending: true });
          setNoticeMsg('Updated offline! It will sync automatically when connected to the laptop.');
        }
      } else {
        // Create category
        try {
          const res = await createCategory(data);
          if (res.data) {
            await saveLocalCategory(res.data);
          }
        } catch {
          const tempId = -Date.now();
          const newCat: Category & { is_pending?: boolean } = {
            id: tempId,
            name: data.name,
            description: data.description,
            sort_order: data.sort_order,
            is_active: true,
            product_count: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            is_pending: true,
          };
          await saveLocalCategory(newCat);
          await addPendingMutation({
            entity: 'category',
            action: 'create',
            payload: data,
            tempId,
          });
          setNoticeMsg('Saved offline! It will sync automatically when connected to the laptop.');
        }
      }
      useSyncStore.getState().refreshCounts();
    } catch (err) {
      console.error('Save category error:', err);
    } finally {
      setShowForm(false);
      setEditing(null);
      loadCategories();
    }
  }

  async function handleDelete() {
    if (!deleteConfirm) return;
    try {
      if (deleteConfirm.id > 0) {
        try {
          await deleteCategory(deleteConfirm.id);
          await deleteLocalCategory(deleteConfirm.id);
        } catch {
          await deleteLocalCategory(deleteConfirm.id);
          await addPendingMutation({
            entity: 'category',
            action: 'delete',
            payload: {},
            entityId: deleteConfirm.id,
          });
          setNoticeMsg('Deleted offline! It will sync automatically when connected to the laptop.');
        }
      } else {
        await deleteLocalCategory(deleteConfirm.id);
        await removeMutationByTempId(deleteConfirm.id);
      }
      useSyncStore.getState().refreshCounts();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleteConfirm(null);
      loadCategories();
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-3 sm:space-y-4 animate-fade-in">
      <div className="flex items-center justify-between gap-2.5">
        <div className="hidden lg:block">
          <h1 className="text-xl sm:text-2xl font-bold text-surface-50 tracking-tight">Categories</h1>
          <p className="text-surface-400 mt-0.5 text-xs sm:text-sm">{categories.length} categories</p>
        </div>
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-primary-600 text-white text-xs sm:text-sm font-semibold hover:bg-primary-500 transition-colors shadow-lg shadow-primary-600/20 flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ml-auto"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          <span>Add Category</span>
        </button>
      </div>

      {noticeMsg && (
        <div className="bg-primary-500/10 border border-primary-500/30 rounded-xl p-3 flex items-center justify-between text-xs text-primary-300 font-medium">
          <span>💾 {noticeMsg}</span>
          <button onClick={() => setNoticeMsg(null)} className="text-surface-400 hover:text-white ml-2">✕</button>
        </div>
      )}

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
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => { setEditing(cat); setShowForm(true); }}
                    className="p-2 rounded-lg text-surface-300 hover:text-primary-400 bg-surface-700/60 hover:bg-surface-700 border border-surface-600/40 transition-colors"
                    title="Edit Category"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(cat)}
                    className="p-2 rounded-lg text-surface-300 hover:text-danger-500 bg-surface-700/60 hover:bg-surface-700 border border-surface-600/40 transition-colors"
                    title="Delete Category"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-4">
                <span className="px-2.5 py-1 rounded-lg bg-primary-500/10 text-primary-400 text-xs font-bold">
                  {cat.product_count ?? 0} products
                </span>
                <span className="text-surface-500 text-xs">Order: {cat.sort_order}</span>
                {(cat.is_pending || cat.id < 0) && (
                  <span className="px-2 py-0.5 rounded-full bg-warning-500/20 text-warning-400 text-xs font-semibold">
                    ⏳ Pending Sync
                  </span>
                )}
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
      {deleteConfirm && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-surface-800 rounded-2xl p-5 sm:p-6 max-w-sm w-full border border-surface-700 shadow-2xl animate-fade-in max-h-[90dvh] overflow-y-auto">
            <h3 className="text-lg font-bold text-surface-100 mb-2">Delete Category?</h3>
            <p className="text-surface-400 text-sm mb-6">
              Delete <strong className="text-surface-200">{deleteConfirm.name}</strong>? Products in this category will become uncategorized.
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

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-800 rounded-2xl p-5 sm:p-6 max-w-md w-full border border-surface-700 shadow-2xl animate-fade-in max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-surface-100">{category ? 'Edit Category' : 'New Category'}</h3>
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-surface-400 hover:text-surface-200 hover:bg-surface-700">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
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
            <input
              type="number"
              min="0"
              value={sortOrder === 0 ? '' : sortOrder}
              placeholder="0"
              onFocus={e => e.target.select()}
              onClick={e => (e.target as HTMLInputElement).select()}
              onChange={e => setSortOrder(parseInt(e.target.value) || 0)}
              className="form-input"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl bg-surface-700 text-surface-200 text-sm font-medium hover:bg-surface-600 transition-colors">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 px-4 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-500 disabled:opacity-50 transition-colors">
              {saving ? 'Saving...' : category ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
