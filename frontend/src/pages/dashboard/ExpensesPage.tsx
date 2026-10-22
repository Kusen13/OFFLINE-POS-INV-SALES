/**
 * Expenses Page - Expense tracking with CRUD
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { fetchExpenses, createExpense, updateExpense, deleteExpense } from '../../api/endpoints';
import { replaceAllExpenses, getAllExpenses, saveLocalExpense, deleteLocalExpense } from '../../db/expenseRepository';
import { addPendingMutation, removeMutationByTempId } from '../../db/mutationRepository';
import { useSyncStore } from '../../features/sync/syncStore';
import { formatCurrency } from '../../utils/currency';
import { formatDate, getTodayStr, SYSTEM_START_DATE } from '../../utils/date';
import type { Expense } from '../../types/inventory';

export function ExpensesPage() {
  const [expenses, setExpenses] = useState<(Expense & { is_pending?: boolean })[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, per_page: 15, total_pages: 0 });
  const [filters, setFilters] = useState(() => {
    const today = getTodayStr();
    const start = today < SYSTEM_START_DATE ? SYSTEM_START_DATE : today;
    return { page: 1, per_page: 15, date_from: start, date_to: start };
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Expense | null>(null);

  // Layout & View Switcher States
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('table');
  const [showQuickPills, setShowQuickPills] = useState(false);

  const loadExpenses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Try fetching from server first
      const res = await fetchExpenses({
        page: filters.page,
        per_page: filters.per_page,
        date_from: filters.date_from || undefined,
        date_to: filters.date_to || undefined,
      });
      await replaceAllExpenses(res.data);
      const localAll = await getAllExpenses();
      const pendingItems = localAll.filter(e => e.id < 0 || e.is_pending);
      // Combine pending offline expenses at the top
      setExpenses([...pendingItems, ...res.data]);
      setPagination(res.pagination);
    } catch {
      // If server unreachable, load from local IndexedDB
      try {
        const localAll = await getAllExpenses();
        let filtered = localAll;
        if (filters.date_from) {
          filtered = filtered.filter(e => e.expense_date >= filters.date_from);
        }
        if (filters.date_to) {
          filtered = filtered.filter(e => e.expense_date <= filters.date_to);
        }
        setExpenses(filtered);
        setPagination({
          page: 1,
          per_page: filtered.length || 15,
          total: filtered.length,
          total_pages: 1,
        });
      } catch (localErr) {
        setError(localErr instanceof Error ? localErr.message : 'Failed to load expenses');
      }
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { loadExpenses(); }, [loadExpenses]);

  async function handleSave(data: { category: string; description: string; amount: number; expense_date: string }) {
    try {
      if (editing) {
        if (editing.id > 0) {
          try {
            await updateExpense(editing.id, data);
            await saveLocalExpense({ ...editing, ...data });
          } catch {
            await saveLocalExpense({ ...editing, ...data, is_pending: true });
            await addPendingMutation({
              entity: 'expense',
              action: 'update',
              payload: data,
              entityId: editing.id,
            });
            setNoticeMsg('Updated offline! It will sync automatically when connected to the laptop.');
          }
        } else {
          // Editing pending offline item
          await saveLocalExpense({ ...editing, ...data, is_pending: true });
          setNoticeMsg('Updated offline! It will sync automatically when connected to the laptop.');
        }
      } else {
        // Create new expense
        try {
          const res = await createExpense(data);
          if (res.data) {
            await saveLocalExpense(res.data);
          }
        } catch {
          const tempId = -Date.now();
          const newExp: Expense & { is_pending?: boolean } = {
            id: tempId,
            category: data.category,
            description: data.description,
            amount: data.amount,
            expense_date: data.expense_date,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            is_pending: true,
          };
          await saveLocalExpense(newExp);
          await addPendingMutation({
            entity: 'expense',
            action: 'create',
            payload: data,
            tempId,
          });
          setNoticeMsg('Saved offline! It will sync automatically when connected to the laptop.');
        }
      }
      useSyncStore.getState().refreshCounts();
    } catch (err) {
      console.error('Save error:', err);
    } finally {
      setShowForm(false);
      setEditing(null);
      loadExpenses();
    }
  }

  async function handleDelete() {
    if (!deleteConfirm) return;
    try {
      if (deleteConfirm.id > 0) {
        try {
          await deleteExpense(deleteConfirm.id);
          await deleteLocalExpense(deleteConfirm.id);
        } catch {
          await deleteLocalExpense(deleteConfirm.id);
          await addPendingMutation({
            entity: 'expense',
            action: 'delete',
            payload: {},
            entityId: deleteConfirm.id,
          });
          setNoticeMsg('Deleted offline! It will sync automatically when connected to the laptop.');
        }
      } else {
        // Created offline, remove locally and remove from queue
        await deleteLocalExpense(deleteConfirm.id);
        await removeMutationByTempId(deleteConfirm.id);
      }
      useSyncStore.getState().refreshCounts();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleteConfirm(null);
      loadExpenses();
    }
  }

  const totalAmount = useMemo(() => expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0), [expenses]);
  const todayStr = getTodayStr();
  const todayExpenses = useMemo(() => expenses.filter(e => e.expense_date === todayStr), [expenses, todayStr]);
  const todayTotal = useMemo(() => todayExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0), [todayExpenses]);

  const topCategory = useMemo(() => {
    const map = new Map<string, number>();
    expenses.forEach(e => {
      map.set(e.category, (map.get(e.category) || 0) + (Number(e.amount) || 0));
    });
    let maxCat = 'None';
    let maxAmt = 0;
    map.forEach((amt, cat) => {
      if (amt > maxAmt) {
        maxAmt = amt;
        maxCat = cat;
      }
    });
    return { category: maxCat, amount: maxAmt };
  }, [expenses]);

  const quickTemplates = [
    { label: '+ Uling', category: 'Supplies', desc: 'Uling (Charcoal)', amount: 100 },
    { label: '+ Mantika', category: 'Supplies', desc: 'Mantika (Cooking Oil)', amount: 95 },
    { label: '+ Sticks', category: 'Supplies', desc: 'Hotdog / BBQ Sticks', amount: 20 },
    { label: '+ Plastic Bags', category: 'Supplies', desc: 'Plastic Bags (Tiny/Mini)', amount: 22 },
    { label: '+ Paper Bags', category: 'Supplies', desc: 'Paper Bags', amount: 40 },
    { label: '+ Sili / Sibuyas', category: 'Supplies', desc: 'Sili & Sibuyas (Sauce)', amount: 30 },
    { label: '+ Stall Rent', category: 'Rent', desc: 'Daily Stall Rent', amount: 400 },
    { label: '+ Kuryente', category: 'Utilities', desc: 'Daily Kuryente / Electricity', amount: 300 },
  ];

  const handleQuickAdd = (tpl: typeof quickTemplates[0]) => {
    setEditing({
      id: 0,
      category: tpl.category,
      description: tpl.desc,
      amount: tpl.amount,
      expense_date: getTodayStr(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    setShowForm(true);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-2.5 sm:space-y-3.5 animate-fade-in">
      {/* Top Header Bar - Date Filters above Summary Cards */}
      <div className="flex-shrink-0 flex items-center justify-between gap-2.5">
        <div className="hidden lg:block">
          <h1 className="text-xl sm:text-2xl font-bold text-surface-50 tracking-tight">Expenses & Bills</h1>
          <p className="text-surface-400 mt-0.5 text-xs sm:text-sm">
            Pagsubaybay sa mga gastusin, supplies, at mga bayarin
          </p>
        </div>

        {/* Date Filter Range Controls - Clean, non-overlapping layout */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2 w-full lg:w-auto shrink-0">
          <div className="flex items-center gap-1.5 w-full sm:w-auto">
            {/* From Date */}
            <div className="flex-1 sm:w-40 flex items-center gap-1.5 bg-surface-900 px-2.5 py-1.5 rounded-xl border border-surface-700 shadow-xs">
              <span className="text-[10px] text-surface-400 font-bold shrink-0">Mula:</span>
              <input
                type="date"
                value={filters.date_from}
                min={SYSTEM_START_DATE}
                onChange={e => {
                  const rawVal = e.target.value;
                  const val = rawVal && rawVal < SYSTEM_START_DATE ? SYSTEM_START_DATE : rawVal;
                  setFilters(f => ({
                    ...f,
                    page: 1,
                    date_from: val,
                    date_to: f.date_to && f.date_to >= val ? f.date_to : val,
                  }));
                }}
                className="w-full bg-transparent text-xs text-surface-100 font-bold focus:outline-none cursor-pointer"
              />
            </div>

            {/* To Date */}
            <div className="flex-1 sm:w-40 flex items-center gap-1.5 bg-surface-900 px-2.5 py-1.5 rounded-xl border border-surface-700 shadow-xs">
              <span className="text-[10px] text-surface-400 font-bold shrink-0">Hanggang:</span>
              <input
                type="date"
                value={filters.date_to}
                min={SYSTEM_START_DATE}
                onChange={e => {
                  const rawVal = e.target.value;
                  const val = rawVal && rawVal < SYSTEM_START_DATE ? SYSTEM_START_DATE : rawVal;
                  setFilters(f => ({ ...f, page: 1, date_to: val }));
                }}
                className="w-full bg-transparent text-xs text-surface-100 font-bold focus:outline-none cursor-pointer"
              />
            </div>
          </div>

          {/* Preset Buttons */}
          <div className="flex items-center gap-1.5 justify-end shrink-0">
            <button
              type="button"
              onClick={() => {
                const today = getTodayStr();
                setFilters(f => ({ ...f, page: 1, date_from: today, date_to: today }));
              }}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs whitespace-nowrap border ${
                filters.date_from === getTodayStr() && filters.date_to === getTodayStr()
                  ? 'bg-primary-600 border-primary-500 text-white'
                  : 'bg-surface-800 hover:bg-surface-700 border-surface-700 text-surface-300'
              }`}
            >
              ⚡ Ngayong Araw
            </button>
            {(filters.date_from || filters.date_to) && (
              <button
                type="button"
                onClick={() => setFilters(f => ({ ...f, page: 1, date_from: '', date_to: '' }))}
                className="px-2.5 py-1.5 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-400 hover:text-white text-xs font-bold border border-surface-700 transition-all cursor-pointer shadow-xs whitespace-nowrap"
                title="Ipakita ang Lahat ng Gastos"
              >
                ✕ Lahat
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Compact Summary Metric Cards */}
      <div className="flex-shrink-0 grid grid-cols-2 sm:grid-cols-3 gap-2">
        <div className="p-2 sm:p-2.5 rounded-xl bg-surface-800/90 border border-surface-700/60 shadow-xs flex flex-col justify-between">
          <span className="text-[10px] font-bold text-surface-400 uppercase tracking-wider">Total Expenses</span>
          <div className="flex items-baseline justify-between mt-0.5">
            <span className="text-sm sm:text-base font-extrabold text-rose-400">
              {formatCurrency(totalAmount)}
            </span>
            <span className="text-[10px] text-surface-500 font-medium">
              {pagination.total} records
            </span>
          </div>
        </div>

        <div className="p-2 sm:p-2.5 rounded-xl bg-surface-800/90 border border-surface-700/60 shadow-xs flex flex-col justify-between">
          <span className="text-[10px] font-bold text-surface-400 uppercase tracking-wider">Ngayong Araw (Today)</span>
          <div className="flex items-baseline justify-between mt-0.5">
            <span className="text-sm sm:text-base font-extrabold text-amber-300">
              {formatCurrency(todayTotal)}
            </span>
            <span className="text-[10px] text-surface-500 font-medium">
              {todayExpenses.length} items
            </span>
          </div>
        </div>

        <div className="col-span-2 sm:col-span-1 p-2 sm:p-2.5 rounded-xl bg-surface-800/90 border border-surface-700/60 shadow-xs flex flex-col justify-between">
          <span className="text-[10px] font-bold text-surface-400 uppercase tracking-wider">Top Category</span>
          <div className="flex items-baseline justify-between mt-0.5">
            <span className="text-xs sm:text-sm font-bold text-surface-200 truncate">
              {topCategory.category}
            </span>
            <span className="text-[10px] text-surface-400 font-semibold">
              {topCategory.amount > 0 ? formatCurrency(topCategory.amount) : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Action Toolbar Below Summary Cards */}
      <div className="flex-shrink-0 flex items-center justify-between gap-1.5 sm:gap-2">
        {/* Quick-Add Pills Toggle Button */}
        <button
          onClick={() => setShowQuickPills(p => !p)}
          className="text-xs text-surface-400 hover:text-primary-400 flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
        >
          <span>⚡ Quick-add pills</span>
          <span className="text-primary-400 font-semibold">{showQuickPills ? '▲' : '▼ (8)'}</span>
        </button>

        {/* Action Controls: Quick-Add Template & Add Expense Button */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-nowrap shrink-0 ml-auto">
          <select
            onChange={e => {
              const tpl = quickTemplates.find(t => t.desc === e.target.value);
              if (tpl) handleQuickAdd(tpl);
              e.target.value = '';
            }}
            defaultValue=""
            className="w-36 sm:w-48 text-xs py-1.5 px-2 rounded-xl bg-surface-850 border border-surface-700 text-surface-200 shrink-0 cursor-pointer shadow-xs focus:outline-none focus:border-primary-500"
          >
            <option value="" disabled>⚡ Quick Template...</option>
            {quickTemplates.map(tpl => (
              <option key={tpl.desc} value={tpl.desc}>
                {tpl.label} ({formatCurrency(tpl.amount)})
              </option>
            ))}
          </select>

          <button
            onClick={() => { setEditing(null); setShowForm(true); }}
            className="px-2.5 sm:px-3.5 py-1.5 rounded-xl bg-primary-600 text-white text-xs sm:text-sm font-semibold hover:bg-primary-500 transition-colors shadow-xs shadow-primary-600/20 flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>+ Add Expense</span>
          </button>
        </div>
      </div>

      {/* Collapsible Quick-Add Template Pills */}
      {showQuickPills && (
        <div className="flex-shrink-0 p-2 rounded-xl bg-surface-900/60 border border-surface-700/50 flex flex-wrap gap-1.5 animate-fade-in">
          {quickTemplates.map(tpl => (
            <button
              key={tpl.label}
              onClick={() => handleQuickAdd(tpl)}
              className="px-2 py-1 rounded-lg bg-surface-800 hover:bg-surface-700 border border-surface-700/60 hover:border-primary-500/40 text-surface-200 text-[11px] font-medium transition-all shadow-xs flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
            >
              <span>{tpl.label}</span>
              <span className="text-emerald-400 font-bold">({formatCurrency(tpl.amount)})</span>
            </button>
          ))}
        </div>
      )}

      {noticeMsg && (
        <div className="flex-shrink-0 bg-primary-500/10 border border-primary-500/30 rounded-xl p-2.5 flex items-center justify-between text-xs text-primary-300 font-medium">
          <span>💾 {noticeMsg}</span>
          <button onClick={() => setNoticeMsg(null)} className="text-surface-400 hover:text-white ml-2 cursor-pointer">✕</button>
        </div>
      )}

      {error && (
        <div className="flex-shrink-0 bg-danger-500/10 border border-danger-500/30 rounded-xl p-3">
          <p className="text-danger-500 text-xs">⚠️ {error}</p>
        </div>
      )}

      {/* Main Expenses Container with View Switcher */}
      <div className="flex-1 min-h-0 bg-surface-800/50 rounded-xl border border-surface-700/50 flex flex-col overflow-hidden shadow-sm">
        {/* Table/Card Header Bar */}
        <div className="px-3 py-2 sm:px-4 sm:py-2.5 bg-surface-900/70 border-b border-surface-700/50 flex items-center justify-between gap-2 flex-nowrap shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-xs sm:text-sm font-bold text-surface-100 flex items-center gap-1.5 truncate">
              <span>📋</span> <span>Talaan ng Gastos (Expenses List)</span>
            </h3>
            <span className="text-[10px] sm:text-xs text-surface-400 hidden sm:inline whitespace-nowrap">
              ({pagination.total} records)
            </span>
          </div>

          {/* View Switcher: [ 📱 Cards | 📋 Table ] */}
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

        {loading ? (
          <div className="flex-1 min-h-0 flex items-center justify-center py-16">
            <div className="flex flex-col items-center gap-2">
              <div className="w-8 h-8 border-3 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
              <p className="text-xs text-surface-400">Kinukuha ang talaan ng mga gastos...</p>
            </div>
          </div>
        ) : expenses.length === 0 ? (
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center py-12 text-center">
            <span className="text-3xl mb-2 block">💸</span>
            <p className="text-surface-300 font-medium text-xs sm:text-sm">Walang naitalang gastos</p>
            <p className="text-surface-500 text-[11px] sm:text-xs mt-0.5">Mag-add ng expense gamit ang "+ Add Expense" o Quick-Add sa itaas</p>
          </div>
        ) : (
          <>
            {/* Scrollable Container for Table or Cards */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {viewMode === 'cards' ? (
                /* Cards View */
                <div className="p-2 sm:p-2.5 divide-y divide-surface-700/30 space-y-1">
                  {expenses.map(exp => (
                    <div
                      key={exp.id}
                      className="p-2.5 rounded-xl hover:bg-surface-700/20 transition-colors bg-surface-900/40 border border-surface-800/60"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-surface-100 font-semibold text-xs sm:text-sm truncate">
                            {exp.description}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className="px-1.5 py-0.2 rounded bg-surface-800 border border-surface-700/60 text-surface-300 text-[10px] font-medium">
                              {exp.category}
                            </span>
                            <span className="text-surface-500 text-[10px]">
                              {formatDate(exp.expense_date)}
                            </span>
                            {(exp.is_pending || exp.id < 0) && (
                              <span className="px-1.5 py-0.2 rounded bg-warning-500/20 text-warning-400 text-[10px] font-semibold flex items-center gap-0.5">
                                ⏳ Pending Sync
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-rose-400 font-bold text-xs sm:text-sm whitespace-nowrap">
                            -{formatCurrency(exp.amount)}
                          </span>
                          <div className="flex items-center gap-1 ml-1">
                            <button
                              onClick={() => { setEditing(exp); setShowForm(true); }}
                              className="p-1 rounded-lg text-surface-300 hover:text-primary-400 bg-surface-800 hover:bg-surface-700 border border-surface-700/60 transition-colors cursor-pointer"
                              title="Edit Expense"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(exp)}
                              className="p-1 rounded-lg text-surface-300 hover:text-danger-500 bg-surface-800 hover:bg-surface-700 border border-surface-700/60 transition-colors cursor-pointer"
                              title="Delete Expense"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                /* Responsive Table View - Zero Horizontal Scrollbar */
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-surface-900 border-b border-surface-700/60 z-10 shadow-xs">
                    <tr>
                      <th className="px-2.5 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase whitespace-nowrap">
                        Date
                      </th>
                      <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase">
                        Description
                      </th>
                      <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase whitespace-nowrap hidden sm:table-cell">
                        Category
                      </th>
                      <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-right whitespace-nowrap">
                        Amount
                      </th>
                      <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-right whitespace-nowrap">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-700/30">
                    {expenses.map(exp => (
                      <tr key={exp.id} className="hover:bg-surface-700/20 transition-colors">
                        <td className="px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs font-semibold text-surface-300 whitespace-nowrap">
                          {formatDate(exp.expense_date)}
                        </td>
                        <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-xs text-surface-100 font-medium">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate">{exp.description}</span>
                            {(exp.is_pending || exp.id < 0) && (
                              <span className="px-1 py-0.2 rounded bg-warning-500/20 text-warning-400 text-[9px] font-semibold whitespace-nowrap">
                                ⏳ Pending
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-xs whitespace-nowrap hidden sm:table-cell">
                          <span className="px-2 py-0.5 rounded-full bg-surface-700/60 text-surface-300 text-[10px] font-medium border border-surface-600/40">
                            {exp.category}
                          </span>
                        </td>
                        <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-right text-xs font-bold text-rose-400 whitespace-nowrap">
                          -{formatCurrency(exp.amount)}
                        </td>
                        <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => { setEditing(exp); setShowForm(true); }}
                              className="p-1 rounded text-surface-400 hover:text-primary-400 hover:bg-surface-700 transition-colors cursor-pointer"
                              title="Edit Expense"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(exp)}
                              className="p-1 rounded text-surface-400 hover:text-danger-500 hover:bg-surface-700 transition-colors cursor-pointer"
                              title="Delete Expense"
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
              )}
            </div>

            {/* Pinned Card Footer: Strictly Single-Line Non-Wrapping Pagination */}
            <div className="flex-shrink-0 px-2.5 sm:px-3 py-1.5 sm:py-2 bg-surface-900/90 border-t border-surface-700/60 flex items-center justify-between flex-nowrap text-xs gap-2 shrink-0">
              <span className="text-[10px] sm:text-xs text-surface-400 font-medium whitespace-nowrap shrink-0">
                {pagination.total === 0
                  ? '0 of 0'
                  : `${(pagination.page - 1) * filters.per_page + 1}-${Math.min(
                      pagination.page * filters.per_page,
                      pagination.total
                    )} of ${pagination.total}`}
              </span>

              <div className="flex items-center gap-1 sm:gap-1.5 whitespace-nowrap shrink-0">
                <select
                  value={filters.per_page}
                  onChange={e => setFilters(f => ({ ...f, page: 1, per_page: Number(e.target.value) }))}
                  className="bg-surface-800 border border-surface-700/60 rounded px-1 py-0.5 text-[10px] sm:text-[11px] text-surface-300 cursor-pointer"
                >
                  <option value={10}>10/page</option>
                  <option value={15}>15/page</option>
                  <option value={25}>25/page</option>
                  <option value={50}>50/page</option>
                </select>
                <button
                  onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}
                  disabled={pagination.page <= 1}
                  className="px-1.5 sm:px-2 py-0.5 rounded bg-surface-800 hover:bg-surface-700 disabled:opacity-40 disabled:cursor-not-allowed text-[10px] sm:text-[11px] border border-surface-700/60 text-surface-200 cursor-pointer whitespace-nowrap"
                >
                  ← Prev
                </button>
                <span className="text-[10px] sm:text-[11px] text-surface-400 font-medium px-0.5">
                  {pagination.page}/{pagination.total_pages || 1}
                </span>
                <button
                  onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}
                  disabled={pagination.page >= pagination.total_pages}
                  className="px-1.5 sm:px-2 py-0.5 rounded bg-surface-800 hover:bg-surface-700 disabled:opacity-40 disabled:cursor-not-allowed text-[10px] sm:text-[11px] border border-surface-700/60 text-surface-200 cursor-pointer whitespace-nowrap"
                >
                  Next →
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Form modal */}
      {showForm && (
        <ExpenseFormModal expense={editing} onSave={handleSave} onClose={() => { setShowForm(false); setEditing(null); }} />
      )}

      {/* Delete confirm */}
      {deleteConfirm && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-surface-800 rounded-2xl p-5 sm:p-6 max-w-sm w-full border border-surface-700 shadow-2xl animate-fade-in max-h-[90dvh] overflow-y-auto">
            <h3 className="text-lg font-bold text-surface-100 mb-2">Delete Expense?</h3>
            <p className="text-surface-400 text-sm mb-6">Delete "{deleteConfirm.description}" ({formatCurrency(deleteConfirm.amount)})?</p>
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

function ExpenseFormModal({ expense, onSave, onClose }: {
  expense: Expense | null;
  onSave: (data: { category: string; description: string; amount: number; expense_date: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [category, setCategory] = useState(expense?.category ?? 'Supplies');
  const [description, setDescription] = useState(expense?.description ?? '');
  const [amount, setAmount] = useState(expense?.amount ?? 0);
  const [expenseDate, setExpenseDate] = useState(() => {
    const d = expense?.expense_date ?? getTodayStr();
    return d < SYSTEM_START_DATE ? SYSTEM_START_DATE : d;
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const expenseCategories = ['Supplies', 'Utilities', 'Rent', 'Salary', 'Equipment', 'Marketing', 'Transportation', 'Food', 'Maintenance', 'Other'];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim() || amount <= 0) { setFormError('Description and amount are required'); return; }
    setSaving(true);
    setFormError('');
    try {
      await onSave({ category, description: description.trim(), amount, expense_date: expenseDate });
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
          <h3 className="text-lg font-bold text-surface-100">{expense ? 'Edit Expense' : 'New Expense'}</h3>
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-surface-400 hover:text-surface-200 hover:bg-surface-700">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        {formError && <div className="mb-4 p-3 rounded-lg bg-danger-500/10 border border-danger-500/30 text-danger-500 text-sm">{formError}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1.5">Category</label>
            <select value={category} onChange={e => setCategory(e.target.value)} className="form-input">
              {expenseCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1.5">Description *</label>
            <input type="text" value={description} onChange={e => setDescription(e.target.value)} className="form-input" placeholder="What was the expense for?" required />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">Amount (₱) *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amount || ''}
                placeholder="0.00"
                onFocus={e => e.target.select()}
                onClick={e => (e.target as HTMLInputElement).select()}
                onChange={e => setAmount(parseFloat(e.target.value) || 0)}
                className="form-input"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">Date</label>
              <input
                type="date"
                value={expenseDate}
                min={SYSTEM_START_DATE}
                onChange={e => {
                  const val = e.target.value;
                  setExpenseDate(val < SYSTEM_START_DATE ? SYSTEM_START_DATE : val);
                }}
                className="form-input"
              />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl bg-surface-700 text-surface-200 text-sm font-medium hover:bg-surface-600 transition-colors">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 px-4 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-500 disabled:opacity-50 transition-colors">
              {saving ? 'Saving...' : expense ? 'Update' : 'Add Expense'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
