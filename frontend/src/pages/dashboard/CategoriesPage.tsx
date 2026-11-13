/**
 * Categories Page - Category management with CRUD and Dynamic Business Line Scoping
 * 
 * Strict Department Isolation:
 * - NO "Lahat" button: Every view is strictly scoped to one Business Line at a time
 * - Custom Business Lines support (e.g. Kapehan, Bakery) via [ + Bagong Negosyo ]
 * - Auto-preselects active Business Department when creating a new category
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { fetchCategories, createCategory, updateCategory, deleteCategory } from '../../api/endpoints';
import { replaceAllCategories, getAllCategories, saveLocalCategory, deleteLocalCategory } from '../../db/productRepository';
import { addPendingMutation, removeMutationByTempId } from '../../db/mutationRepository';
import { useSyncStore } from '../../features/sync/syncStore';
import type { Category, BusinessType, BusinessDepartment } from '../../types/product';
import { getAllBusinessDepartments } from '../../utils/businessStorage';
import { BusinessDepartmentModal } from '../../components/categories/BusinessDepartmentModal';

export function CategoriesPage() {
  const [categories, setCategories] = useState<(Category & { is_pending?: boolean })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Category | null>(null);

  // Dynamic Business Departments
  const [departments, setDepartments] = useState<BusinessDepartment[]>(() => getAllBusinessDepartments());
  const [selectedDept, setSelectedDept] = useState<BusinessType>('barbeque');
  const [showDeptModal, setShowDeptModal] = useState(false);
  const [deptToEdit, setDeptToEdit] = useState<BusinessDepartment | null>(null);

  // Listen for dynamic business line updates (from modal or other tabs)
  useEffect(() => {
    const handleDeptUpdated = () => {
      const updated = getAllBusinessDepartments();
      setDepartments(updated);
    };
    window.addEventListener('pos_departments_updated', handleDeptUpdated);
    return () => window.removeEventListener('pos_departments_updated', handleDeptUpdated);
  }, []);

  const loadCategories = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  async function handleSave(data: { name: string; business_type: BusinessType; description: string; sort_order: number }) {
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
            business_type: data.business_type,
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
  }

  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>(() =>
    typeof window !== 'undefined' && window.innerWidth < 1024 ? 'cards' : 'table'
  );

  // Helper to resolve business department of a category (defaulting by legacy names if unset)
  const getDeptOfCategory = useCallback((cat: Category): BusinessType => {
    if (cat.business_type) return cat.business_type;
    const n = cat.name.toLowerCase();
    if (n.includes('bbq') || n.includes('ihaw') || n.includes('barbeque')) return 'barbeque';
    if (n.includes('rice') || n.includes('bigas')) return 'rice';
    if (n.includes('gulay') || n.includes('vegetable')) return 'vegetables';
    return 'groceries';
  }, []);

  // User preference: default to only listing categories that have products!
  const [onlyWithProducts, setOnlyWithProducts] = useState(true);
  const [cleaningUp, setCleaningUp] = useState(false);

  // Strict Department Scoping (No "Lahat" button)
  const allDeptCategories = useMemo(() => {
    return categories.filter(c => getDeptOfCategory(c) === selectedDept);
  }, [categories, selectedDept, getDeptOfCategory]);

  const deptCategories = useMemo(() => {
    if (!onlyWithProducts) return allDeptCategories;
    return allDeptCategories.filter(c => (c.product_count ?? 0) > 0);
  }, [allDeptCategories, onlyWithProducts]);

  const filteredCategories = useMemo(() => {
    if (!search.trim()) return deptCategories;
    const q = search.toLowerCase();
    return deptCategories.filter(c =>
      c.name.toLowerCase().includes(q) || (c.description && c.description.toLowerCase().includes(q))
    );
  }, [deptCategories, search]);

  const totalProducts = allDeptCategories.reduce((sum, c) => sum + (c.product_count ?? 0), 0);
  const activeCount = allDeptCategories.filter(c => (c.product_count ?? 0) > 0).length;
  const emptyCategoriesInDept = allDeptCategories.filter(c => (c.product_count ?? 0) === 0);
  const activeDeptInfo = departments.find(d => d.id === selectedDept) || departments[0];

  async function handleCleanupEmptyCategories() {
    if (emptyCategoriesInDept.length === 0) {
      alert('Walang walang-lamang kategorya sa ' + activeDeptInfo?.label);
      return;
    }
    if (!window.confirm(`Sigurado ka bang nais mong tanggalin ang ${emptyCategoriesInDept.length} kategorya na walang laman na produkto sa ${activeDeptInfo?.label}?`)) {
      return;
    }
    setCleaningUp(true);
    try {
      for (const cat of emptyCategoriesInDept) {
        if (cat.id > 0) {
          try {
            await deleteCategory(cat.id);
          } catch (_) {}
        }
        await deleteLocalCategory(cat.id);
      }
      setNoticeMsg(`Matagumpay na natanggal ang ${emptyCategoriesInDept.length} kategorya na walang produkto!`);
      await loadCategories();
      useSyncStore.getState().refreshCounts();
    } catch (err) {
      alert('May naging problema sa pag-delete: ' + String(err));
    } finally {
      setCleaningUp(false);
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-2.5 sm:space-y-3.5 animate-fade-in pb-16 lg:pb-0">
      {/* Page Header */}
      <div className="flex-shrink-0 flex items-center justify-between gap-2">
        <div className="hidden lg:block">
          <h1 className="text-xl sm:text-2xl font-bold text-surface-50 tracking-tight flex items-center gap-2">
            <span>🏷️</span>
            <span>Categories & Negosyo</span>
          </h1>
          <p className="text-surface-400 mt-0.5 text-xs sm:text-sm">
            Pamahalaan ang mga kategorya kada linya ng negosyo nang hiwalay at organisado
          </p>
        </div>
        <div className="flex items-center gap-1.5 w-full lg:w-auto justify-end flex-wrap">
          {emptyCategoriesInDept.length > 0 && (
            <button
              onClick={handleCleanupEmptyCategories}
              disabled={cleaningUp}
              className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-xs font-semibold transition-all cursor-pointer whitespace-nowrap shadow-xs"
              title="Tanggalin lahat ng kategorya na 0 ang laman"
            >
              <span>🗑️</span>
              <span>{cleaningUp ? 'Tinatanggal...' : `Tanggalin Walang Laman (${emptyCategoriesInDept.length})`}</span>
            </button>
          )}
          <button
            onClick={() => setOnlyWithProducts(prev => !prev)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer whitespace-nowrap shadow-xs ${
              onlyWithProducts
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                : 'bg-surface-800 border-surface-700 text-surface-300 hover:text-surface-100'
            }`}
            title="I-filter ang mga kategoryang may laman lang"
          >
            <span>{onlyWithProducts ? '✅' : '👁️'}</span>
            <span>{onlyWithProducts ? `May Produkto Lang (${activeCount})` : `Lahat ng Categories (${allDeptCategories.length})`}</span>
          </button>
          <button
            onClick={() => setShowDeptModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-200 border border-surface-700 text-xs sm:text-sm font-semibold transition-all cursor-pointer whitespace-nowrap shadow-xs"
            title="Magdagdag o mag-ayos ng mga Negosyo"
          >
            <span>🏢</span>
            <span>+ Bagong Negosyo</span>
          </button>
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

      {/* ── Strict Department Ribbon (NO "Lahat" button) ── */}
      <div className="flex-shrink-0 flex items-center justify-between gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] font-bold text-surface-400 uppercase tracking-wider shrink-0 mr-1 hidden sm:inline">
            Negosyo:
          </span>
          {departments.map(dept => {
            const isActive = selectedDept === dept.id;
            return (
              <button
                key={dept.id}
                onClick={() => setSelectedDept(dept.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer border ${
                  isActive
                    ? `${dept.activeColor} shadow-md`
                    : 'bg-surface-800/80 hover:bg-surface-700/80 text-surface-400 hover:text-surface-200 border-surface-700/60'
                }`}
              >
                <span>{dept.icon}</span>
                <span>{dept.label}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                  isActive ? 'bg-white/20 text-white' : 'bg-surface-700/60 text-surface-400'
                }`}>
                  {categories.filter(c => getDeptOfCategory(c) === dept.id).length}
                </span>
              </button>
            );
          })}
        </div>

        {/* In-place Edit Button for Active Department */}
        <button
          onClick={() => {
            setDeptToEdit(activeDeptInfo);
            setShowDeptModal(true);
          }}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-surface-800/90 hover:bg-surface-700 text-surface-300 hover:text-surface-100 border border-surface-700/60 text-xs font-semibold transition-all cursor-pointer whitespace-nowrap shadow-xs shrink-0"
          title={`I-edit ang Profile, Icon, o Unit ng ${activeDeptInfo?.label}`}
        >
          <span>⚙️</span>
          <span className="hidden xs:inline">Ayusin ang {activeDeptInfo?.label}</span>
        </button>
      </div>

      {/* KPI Summary Cards (Scoped strictly to active department) */}
      <div className="flex-shrink-0 grid grid-cols-3 gap-1.5 sm:gap-2">
        <div className="p-1.5 sm:p-2.5 rounded-xl bg-surface-800/90 border border-surface-700/60 shadow-xs flex items-center justify-between">
          <div className="min-w-0">
            <span className="text-[9px] sm:text-[10px] font-bold text-surface-400 uppercase tracking-wider block truncate">
              {activeDeptInfo?.label} Categories
            </span>
            <span className="text-xs sm:text-base font-extrabold text-surface-100 block truncate">{deptCategories.length}</span>
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
          <span className="text-[9px] sm:text-[10px] text-surface-500 font-medium shrink-0 ml-1">sa {activeDeptInfo?.label}</span>
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
          placeholder={`Maghanap ng kategorya sa ${activeDeptInfo?.label || 'Negosyo'}...`}
          className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-surface-900 border border-surface-700 text-surface-100 text-xs placeholder:text-surface-500 focus:outline-none focus:border-primary-500 transition-colors"
        />
      </div>

      {/* Main Table / Cards Card Container */}
      <div className="flex-1 min-h-0 bg-surface-800/50 rounded-xl border border-surface-700/50 flex flex-col overflow-hidden shadow-sm">
        {/* Header Bar with View Switcher */}
        <div className="px-3 py-2 sm:px-4 sm:py-2.5 bg-surface-900/70 border-b border-surface-700/50 flex items-center justify-between gap-2 flex-nowrap shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-xs sm:text-sm font-bold text-surface-100 flex items-center gap-1.5 truncate">
              <span>{activeDeptInfo?.icon || '🏷️'}</span>
              <span>Kategorya sa {activeDeptInfo?.label}</span>
            </h3>
            <span className="text-[10px] sm:text-xs text-surface-400 hidden sm:inline whitespace-nowrap">
              ({filteredCategories.length} kategorya)
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
              <span className="text-3xl mb-2 block">{activeDeptInfo?.icon || '🏷️'}</span>
              <p className="text-surface-300 font-medium text-xs sm:text-sm">
                {search ? 'Walang nahanap na kategorya' : `Wala pang kategorya sa ${activeDeptInfo?.label}`}
              </p>
              <p className="text-surface-500 text-[11px] mt-0.5 mb-3">
                {search ? 'Subukan ang ibang keyword sa paghahanap' : `Magdagdag ng kategorya para sa ${activeDeptInfo?.label}`}
              </p>
              {!search && (
                <button
                  onClick={() => { setEditing(null); setShowForm(true); }}
                  className="px-3.5 py-1.5 rounded-lg bg-primary-600 text-white text-xs font-semibold hover:bg-primary-500 transition-colors cursor-pointer"
                >
                  + Magdagdag sa {activeDeptInfo?.label}
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
                    <th className="px-3 py-2">Negosyo</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2 text-center">Products</th>
                    <th className="px-3 py-2 text-center">Status</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-700/40 font-medium text-surface-200">
                  {filteredCategories.map(cat => {
                    const dept = departments.find(d => d.id === getDeptOfCategory(cat));
                    return (
                      <tr key={cat.id} className="hover:bg-surface-700/30 transition-colors">
                        <td className="px-3 py-2 text-center text-surface-400 font-mono">
                          {cat.sort_order}
                        </td>
                        <td className="px-3 py-2 font-bold text-surface-100">
                          {cat.name}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border ${dept?.badgeBg || 'bg-surface-700 text-surface-300 border-surface-600'}`}>
                            <span>{dept?.icon || '🏢'}</span>
                            <span>{dept?.label || cat.business_type}</span>
                          </span>
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
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pinned Card Footer */}
        <div className="flex-shrink-0 px-3 py-2 bg-surface-900/90 border-t border-surface-700/60 flex items-center justify-between text-[11px] text-surface-400">
          <span className="truncate">
            {activeDeptInfo?.label} Kategorya: <strong className="text-surface-200">{filteredCategories.length}</strong>
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
          defaultDept={selectedDept}
          departments={departments}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditing(null); }}
        />
      )}

      {/* Business Department Management Modal */}
      {showDeptModal && (
        <BusinessDepartmentModal
          departments={departments}
          initialDeptToEdit={deptToEdit}
          onClose={() => {
            setShowDeptModal(false);
            setDeptToEdit(null);
          }}
          onUpdated={(updatedDepts, activeId) => {
            setDepartments(updatedDepts);
            if (activeId) setSelectedDept(activeId);
            setDeptToEdit(null);
          }}
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

function CategoryFormModal({ category, defaultDept, departments, onSave, onClose }: {
  category: Category | null;
  defaultDept: BusinessType;
  departments: BusinessDepartment[];
  onSave: (data: { name: string; business_type: BusinessType; description: string; sort_order: number }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [businessType, setBusinessType] = useState<BusinessType>(category?.business_type || defaultDept);
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
      await onSave({
        name: name.trim(),
        business_type: businessType,
        description: description.trim(),
        sort_order: sortOrder,
      });
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
          {/* Business Line Selector */}
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1.5">Linya ng Negosyo (Business Line) *</label>
            <div className="grid grid-cols-2 gap-2">
              {departments.map(dept => {
                const isSelected = businessType === dept.id;
                return (
                  <button
                    key={dept.id}
                    type="button"
                    onClick={() => setBusinessType(dept.id)}
                    className={`flex items-center gap-2 p-2 rounded-xl border text-xs font-bold transition-all text-left cursor-pointer ${
                      isSelected
                        ? `${dept.activeColor} border-white/20 shadow-xs`
                        : 'bg-surface-900 border-surface-700 text-surface-300 hover:border-surface-600'
                    }`}
                  >
                    <span className="text-base">{dept.icon}</span>
                    <span className="truncate">{dept.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1.5">Category Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="form-input"
              placeholder="e.g., Hot Beverages, Pork Skewers"
              required
            />
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
