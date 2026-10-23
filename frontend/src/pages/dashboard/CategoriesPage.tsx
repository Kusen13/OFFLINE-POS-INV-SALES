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

  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>(() =>
    typeof window !== 'undefined' && window.innerWidth < 1024 ? 'cards' : 'table'
  );

  const filteredCategories = categories.filter(c => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) || (c.description && c.description.toLowerCase().includes(q));
  });

  const totalProducts = categories.reduce((sum, c) => sum + (c.product_count ?? 0), 0);
  const activeCount = categories.filter(c => (c.product_count ?? 0) > 0).length;

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-2.5 sm:space-y-3.5 animate-fade-in pb-16 lg:pb-0">
      {/* Page Header */}
      <div className="flex-shrink-0 flex items-center justify-between gap-2">
        <div className="hidden lg:block">
          <h1 className="text-xl sm:text-2xl font-bold text-surface-50 tracking-tight">Categories</h1>
          <p className="text-surface-400 mt-0.5 text-xs sm:text-sm">
            Pamahalaan ang mga kategorya ng produkto at ayos ng menu
          </p>
        </div>
        <div className="flex items-center gap-1.5 w-full lg:w-auto justify-end">
          <button
            onClick={() => { setEditing(null); setShowForm(true); }}
            className="flex items-center gap-1.5 px-3 sm:px-4 py-1.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs sm:text-sm font-semibold shadow-xs shadow-primary-600/20 transition-all cursor-pointer whitespace-nowrap"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>+ Add Category</span>
          </button>
        </div>
      </div>

      {noticeMsg && (
        <div className="flex-shrink-0 bg-primary-500/10 border border-primary-500/30 rounded-xl px-3 py-2 flex items-center justify-between text-xs text-primary-300 font-medium">
          <span>💾 {noticeMsg}</span>
          <button onClick={() => setNoticeMsg(null)} className="text-surface-400 hover:text-white ml-2 cursor-pointer">✕</button>
        </div>
      )}

      {error && (
        <div className="flex-shrink-0 bg-danger-500/10 border border-danger-500/30 rounded-xl p-3">
          <p className="text-danger-500 text-xs sm:text-sm">⚠️ {error}</p>
        </div>
      )}

      {/* KPI Summary Cards */}
      <div className="flex-shrink-0 grid grid-cols-3 gap-1.5 sm:gap-2">
        <div className="p-1.5 sm:p-2.5 rounded-xl bg-surface-800/90 border border-surface-700/60 shadow-xs flex items-center justify-between">
          <div className="min-w-0">
            <span className="text-[9px] sm:text-[10px] font-bold text-surface-400 uppercase tracking-wider block truncate">Total Categories</span>
            <span className="text-xs sm:text-base font-extrabold text-surface-100 block truncate">{categories.length}</span>
          </div>
          <span className="text-[9px] sm:text-[10px] text-surface-500 font-medium shrink-0 ml-1">uri</span>
        </div>
        <div className="p-1.5 sm:p-2.5 rounded-xl bg-surface-800/90 border border-surface-700/60 shadow-xs flex items-center justify-between">
          <div className="min-w-0">
            <span className="text-[9px] sm:text-[10px] font-bold text-surface-400 uppercase tracking-wider block truncate">With Items</span>
            <span className="text-xs sm:text-base font-extrabold text-emerald-400 block truncate">{activeCount}</span>
          </div>
          <span className="text-[9px] sm:text-[10px] text-surface-500 font-medium shrink-0 ml-1">may laman</span>
        </div>
        <div className="p-1.5 sm:p-2.5 rounded-xl bg-surface-800/90 border border-surface-700/60 shadow-xs flex items-center justify-between">
          <div className="min-w-0">
            <span className="text-[9px] sm:text-[10px] font-bold text-surface-400 uppercase tracking-wider block truncate">Total Products</span>
            <span className="text-xs sm:text-base font-extrabold text-primary-400 block truncate">{totalProducts}</span>
          </div>
          <span className="text-[9px] sm:text-[10px] text-surface-500 font-medium shrink-0 ml-1">nakatalaga</span>
        </div>
      </div>

      {/* Search Bar */}
      <div className="flex-shrink-0 relative">
        <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search categories by name or description..."
          className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-surface-900 border border-surface-700 text-surface-100 text-xs placeholder:text-surface-500 focus:outline-none focus:border-primary-500 transition-colors"
        />
      </div>

      {/* Main Table / Cards Card Container */}
      <div className="flex-1 min-h-0 bg-surface-800/50 rounded-xl border border-surface-700/50 flex flex-col overflow-hidden shadow-sm">
        {/* Header Bar with View Switcher */}
        <div className="px-3 py-2 sm:px-4 sm:py-2.5 bg-surface-900/70 border-b border-surface-700/50 flex items-center justify-between gap-2 flex-nowrap shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-xs sm:text-sm font-bold text-surface-100 flex items-center gap-1.5 truncate">
              <span>🏷️</span> <span>Talaan ng mga Kategorya</span>
            </h3>
            <span className="text-[10px] sm:text-xs text-surface-400 hidden sm:inline whitespace-nowrap">
              ({filteredCategories.length} total)
            </span>
          </div>

          {/* View Switcher */}
          <div className="flex items-center gap-1 bg-surface-800/80 p-0.5 rounded-lg border border-surface-700/60 shrink-0">
            <button
              onClick={() => setViewMode('cards')}
              className={`px-2 py-0.5 text-xs font-medium rounded transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap ${
                viewMode === 'cards'
                  ? 'bg-primary-600 text-white shadow-xs'
                  : 'text-surface-400 hover:text-surface-200'
              }`}
              title="Cards View"
            >
              <span>📱</span> <span className="hidden xs:inline">Cards</span>
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`px-2 py-0.5 text-xs font-medium rounded transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap ${
                viewMode === 'table'
                  ? 'bg-primary-600 text-white shadow-xs'
                  : 'text-surface-400 hover:text-surface-200'
              }`}
              title="Table View"
            >
              <span>📋</span> <span className="hidden xs:inline">Table</span>
            </button>
          </div>
        </div>

        {/* Content Container */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading ? (
            <div className="flex-1 min-h-0 flex items-center justify-center py-16">
              <div className="flex flex-col items-center gap-2">
                <div className="w-8 h-8 border-3 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
                <p className="text-xs text-surface-400">Kinukuha ang talaan ng mga kategorya...</p>
              </div>
            </div>
          ) : filteredCategories.length === 0 ? (
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center py-12 text-center p-4">
              <span className="text-3xl mb-2 block">🏷️</span>
              <p className="text-surface-300 font-medium text-xs sm:text-sm">
                {search ? 'Walang nahanap na kategorya' : 'Wala pang kategorya'}
              </p>
              <p className="text-surface-500 text-[11px] mt-0.5 mb-3">
                {search ? 'Subukan ang ibang keyword sa paghahanap' : 'Magdagdag ng unang kategorya para sa inyong mga produkto'}
              </p>
              {!search && (
                <button
                  onClick={() => { setEditing(null); setShowForm(true); }}
                  className="px-3.5 py-1.5 rounded-lg bg-primary-600 text-white text-xs font-semibold hover:bg-primary-500 transition-colors cursor-pointer"
                >
                  + Add Category
                </button>
              )}
            </div>
          ) : viewMode === 'cards' ? (
            /* Cards View */
            <div className="p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredCategories.map(cat => (
                <div
                  key={cat.id}
                  className="bg-surface-900/60 rounded-xl p-3.5 border border-surface-700/60 hover:border-primary-500/40 transition-all flex flex-col justify-between group shadow-xs"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h4 className="text-sm font-bold text-surface-100 group-hover:text-primary-400 transition-colors truncate">
                            {cat.name}
                          </h4>
                          {(cat.is_pending || cat.id < 0) && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              Pending Sync
                            </span>
                          )}
                        </div>
                        {cat.description ? (
                          <p className="text-surface-400 text-xs mt-1 line-clamp-2">{cat.description}</p>
                        ) : (
                          <p className="text-surface-500 text-xs mt-1 italic">Walang deskripsyon</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => { setEditing(cat); setShowForm(true); }}
                          className="p-1.5 rounded-lg text-surface-300 hover:text-primary-400 bg-surface-800 hover:bg-surface-700 border border-surface-700/60 transition-colors cursor-pointer"
                          title="Edit Category"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(cat)}
                          className="p-1.5 rounded-lg text-surface-300 hover:text-danger-400 bg-surface-800 hover:bg-surface-700 border border-surface-700/60 transition-colors cursor-pointer"
                          title="Delete Category"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-surface-700/40 text-[11px]">
                    <span className="px-2 py-0.5 rounded-md bg-primary-500/10 text-primary-400 font-semibold border border-primary-500/20">
                      {cat.product_count ?? 0} products
                    </span>
                    <span className="text-surface-400 font-medium">
                      Order: <strong className="text-surface-200">{cat.sort_order}</strong>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Table View */
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="sticky top-0 bg-surface-900/95 z-10 backdrop-blur-xs border-b border-surface-700/80 text-[10px] font-bold text-surface-400 uppercase tracking-wider">
                    <th className="px-3 py-2 w-16 text-center">Order</th>
                    <th className="px-3 py-2">Category Name</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2 text-center">Products</th>
                    <th className="px-3 py-2 text-center">Status</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-700/40 font-medium text-surface-200">
                  {filteredCategories.map(cat => (
                    <tr key={cat.id} className="hover:bg-surface-700/30 transition-colors">
                      <td className="px-3 py-2 text-center text-surface-400 font-mono">
                        {cat.sort_order}
                      </td>
                      <td className="px-3 py-2 font-bold text-surface-100">
                        {cat.name}
                      </td>
                      <td className="px-3 py-2 text-surface-400 max-w-xs truncate">
                        {cat.description || <span className="italic text-surface-600">—</span>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className="px-2 py-0.5 rounded-md bg-primary-500/10 text-primary-400 font-bold border border-primary-500/20">
                          {cat.product_count ?? 0}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {(cat.is_pending || cat.id < 0) ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 whitespace-nowrap">
                            Pending Sync
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 whitespace-nowrap">
                            Active
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => { setEditing(cat); setShowForm(true); }}
                            className="p-1 rounded text-surface-300 hover:text-primary-400 hover:bg-surface-700 transition-colors cursor-pointer"
                            title="Edit Category"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(cat)}
                            className="p-1 rounded text-surface-300 hover:text-danger-400 hover:bg-surface-700 transition-colors cursor-pointer"
                            title="Delete Category"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pinned Card Footer */}
        <div className="flex-shrink-0 px-3 py-2 bg-surface-900/90 border-t border-surface-700/60 flex items-center justify-between text-[11px] text-surface-400">
          <span className="truncate">
            Kabuuang Kategorya: <strong className="text-surface-200">{filteredCategories.length}</strong>
          </span>
          <span className="truncate ml-2">
            Kabuuang Produkto: <strong className="text-primary-400">{totalProducts}</strong>
          </span>
        </div>
      </div>

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
