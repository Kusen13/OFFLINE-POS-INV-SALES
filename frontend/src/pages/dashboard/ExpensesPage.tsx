/**
 * Expenses Page - Expense tracking with CRUD
 */

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { fetchExpenses, createExpense, updateExpense, deleteExpense } from '../../api/endpoints';
import { replaceAllExpenses, getAllExpenses, saveLocalExpense, deleteLocalExpense } from '../../db/expenseRepository';
import { addPendingMutation, removeMutationByTempId } from '../../db/mutationRepository';
import { useSyncStore } from '../../features/sync/syncStore';
import { formatCurrency } from '../../utils/currency';
import { formatDate, getTodayStr } from '../../utils/date';
import type { Expense } from '../../types/inventory';

export function ExpensesPage() {
  const [expenses, setExpenses] = useState<(Expense & { is_pending?: boolean })[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, per_page: 15, total_pages: 0 });
  const [filters, setFilters] = useState({ page: 1, per_page: 15, date_from: '', date_to: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Expense | null>(null);

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

  const totalAmount = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-4 animate-fade-in">
      <div className="flex-shrink-0 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-surface-50">Expenses</h1>
            <p className="text-surface-400 mt-0.5 text-sm">{pagination.total} records • Total: {formatCurrency(totalAmount)}</p>
          </div>
          <button
            onClick={() => { setEditing(null); setShowForm(true); }}
            className="px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-500 transition-colors shadow-lg shadow-primary-600/20 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Add Expense
          </button>
        </div>

        {/* Date filters */}
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="flex items-center gap-2 flex-1">
            <label className="text-surface-400 text-sm whitespace-nowrap">From:</label>
            <input type="date" value={filters.date_from} onChange={e => setFilters(f => ({ ...f, page: 1, date_from: e.target.value }))} className="form-input flex-1" />
          </div>
          <div className="flex items-center gap-2 flex-1">
            <label className="text-surface-400 text-sm whitespace-nowrap">To:</label>
            <input type="date" value={filters.date_to} onChange={e => setFilters(f => ({ ...f, page: 1, date_to: e.target.value }))} className="form-input flex-1" />
          </div>
          <button onClick={() => setFilters(f => ({ ...f, page: 1, date_from: '', date_to: '' }))} className="px-3 py-2 rounded-xl bg-surface-700 text-surface-200 text-sm hover:bg-surface-600 transition-colors">
            Clear
          </button>
        </div>
      </div>

      {noticeMsg && (
        <div className="flex-shrink-0 bg-primary-500/10 border border-primary-500/30 rounded-xl p-3 flex items-center justify-between text-xs text-primary-300 font-medium">
          <span>💾 {noticeMsg}</span>
          <button onClick={() => setNoticeMsg(null)} className="text-surface-400 hover:text-white ml-2">✕</button>
        </div>
      )}

      {error && (
        <div className="flex-shrink-0 bg-danger-500/10 border border-danger-500/30 rounded-xl p-4"><p className="text-danger-500 text-sm">⚠️ {error}</p></div>
      )}

      {/* Main Table Card */}
      <div className="flex-1 min-h-0 bg-surface-800/50 rounded-xl border border-surface-700/50 flex flex-col overflow-hidden shadow-sm">
        {loading ? (
          <div className="flex justify-center py-12"><div className="w-8 h-8 border-3 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" /></div>
        ) : expenses.length === 0 ? (
          <div className="text-center py-12">
            <span className="text-4xl mb-3 block">💸</span>
            <p className="text-surface-300 font-medium">No expenses recorded</p>
            <p className="text-surface-500 text-sm mt-1">Add your first expense to start tracking</p>
          </div>
        ) : (
          <>
            {/* Scrollable expenses rows container */}
            <div className="flex-1 min-h-0 overflow-auto divide-y divide-surface-700/30">
              {expenses.map(exp => (
                <div key={exp.id} className="p-4 hover:bg-surface-700/20 transition-colors group">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-surface-100 font-medium text-sm">{exp.description}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="px-2 py-0.5 rounded-full bg-surface-700 text-surface-300 text-xs">{exp.category}</span>
                        <span className="text-surface-500 text-xs">{formatDate(exp.expense_date)}</span>
                        {(exp.is_pending || exp.id < 0) && (
                          <span className="px-2 py-0.5 rounded-full bg-warning-500/20 text-warning-400 text-xs font-semibold flex items-center gap-1">
                            ⏳ Pending Sync
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 ml-2 shrink-0">
                      <span className="text-danger-500 font-bold text-sm whitespace-nowrap">-{formatCurrency(exp.amount)}</span>
                      <div className="flex items-center gap-1 ml-1">
                        <button
                          onClick={() => { setEditing(exp); setShowForm(true); }}
                          className="p-1.5 sm:p-2 rounded-lg text-surface-300 hover:text-primary-400 bg-surface-800 hover:bg-surface-700 border border-surface-700/60 transition-colors"
                          title="Edit Expense"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(exp)}
                          className="p-1.5 sm:p-2 rounded-lg text-surface-300 hover:text-danger-500 bg-surface-800 hover:bg-surface-700 border border-surface-700/60 transition-colors"
                          title="Delete Expense"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Pinned Card Footer: Pagination */}
            <div className="flex-shrink-0 px-4 py-3 bg-surface-900/60 border-t border-surface-700/50 flex items-center justify-between">
              <p className="text-surface-400 text-xs sm:text-sm">
                Page {pagination.page} of {pagination.total_pages || 1} <span className="hidden sm:inline">({pagination.total} records)</span>
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
  const [expenseDate, setExpenseDate] = useState(expense?.expense_date ?? getTodayStr());
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
              <input type="number" step="0.01" min="0.01" value={amount || ''} onChange={e => setAmount(parseFloat(e.target.value) || 0)} className="form-input" required />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">Date</label>
              <input type="date" value={expenseDate} onChange={e => setExpenseDate(e.target.value)} className="form-input" />
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
