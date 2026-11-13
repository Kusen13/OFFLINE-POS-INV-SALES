/**
 * Master Expense Report & Audit Ledger
 * Pangkalahatang talaan, pagsusuri, at audit trail ng lahat ng operational expenses,
 * pondo, at petty cash ng tindahan.
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
  const [allExpenses, setAllExpenses] = useState<(Expense & { is_pending?: boolean })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Expense | null>(null);

  // Filters
  const [dateFrom, setDateFrom] = useState(() => {
    const today = getTodayStr();
    return today < SYSTEM_START_DATE ? SYSTEM_START_DATE : today;
  });
  const [dateTo, setDateTo] = useState(() => {
    const today = getTodayStr();
    return today < SYSTEM_START_DATE ? SYSTEM_START_DATE : today;
  });
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedSource, setSelectedSource] = useState<'ALL' | 'DRAWER' | 'POCKET'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  // Quick-add pills toggle
  const [showQuickPills, setShowQuickPills] = useState(false);

  const loadExpenses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch comprehensive list from server (up to 1,000 for full reporting)
      const res = await fetchExpenses({
        page: 1,
        per_page: 1000,
      });
      if (res.data && res.data.length > 0) {
        await replaceAllExpenses(res.data);
      }
      const localAll = await getAllExpenses();
      setAllExpenses(localAll);
    } catch {
      // 2. Offline fallback: read from IndexedDB
      try {
        const localAll = await getAllExpenses();
        setAllExpenses(localAll);
      } catch (localErr) {
        setError(localErr instanceof Error ? localErr.message : 'Nabigong kunin ang mga tala ng gastos');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadExpenses();
  }, [loadExpenses]);

  // Date Preset Handlers
  const handleSetPreset = (preset: 'today' | 'yesterday' | 'this_week' | 'this_month' | 'all') => {
    const today = getTodayStr();
    setCurrentPage(1);

    if (preset === 'today') {
      const start = today < SYSTEM_START_DATE ? SYSTEM_START_DATE : today;
      setDateFrom(start);
      setDateTo(start);
    } else if (preset === 'yesterday') {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      const yStr = d.toISOString().split('T')[0];
      const start = yStr < SYSTEM_START_DATE ? SYSTEM_START_DATE : yStr;
      setDateFrom(start);
      setDateTo(start);
    } else if (preset === 'this_week') {
      const now = new Date();
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
      const monday = new Date(now.setDate(diff)).toISOString().split('T')[0];
      const start = monday < SYSTEM_START_DATE ? SYSTEM_START_DATE : monday;
      setDateFrom(start);
      setDateTo(today);
    } else if (preset === 'this_month') {
      const now = new Date();
      const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const start = firstOfMonth < SYSTEM_START_DATE ? SYSTEM_START_DATE : firstOfMonth;
      setDateFrom(start);
      setDateTo(today);
    } else if (preset === 'all') {
      setDateFrom('');
      setDateTo('');
    }
  };

  // Filtered expenses based on all criteria
  const filteredExpenses = useMemo(() => {
    return allExpenses.filter(exp => {
      // Date range filter
      if (dateFrom && exp.expense_date < dateFrom) return false;
      if (dateTo && exp.expense_date > dateTo) return false;

      // Category filter
      if (selectedCategory !== 'ALL' && exp.category !== selectedCategory) return false;

      // Source filter
      const isDrawer = exp.description.includes('[Petty Cash]');
      if (selectedSource === 'DRAWER' && !isDrawer) return false;
      if (selectedSource === 'POCKET' && isDrawer) return false;

      // Search keyword
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const desc = exp.description.toLowerCase();
        const cat = exp.category.toLowerCase();
        if (!desc.includes(query) && !cat.includes(query)) return false;
      }

      return true;
    });
  }, [allExpenses, dateFrom, dateTo, selectedCategory, selectedSource, searchQuery]);

  // Pagination slice
  const totalPages = Math.max(1, Math.ceil(filteredExpenses.length / itemsPerPage));
  const paginatedExpenses = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredExpenses.slice(start, start + itemsPerPage);
  }, [filteredExpenses, currentPage, itemsPerPage]);

  // KPI Calculations
  const todayStr = getTodayStr();
  const todayItems = useMemo(() => allExpenses.filter(e => e.expense_date === todayStr), [allExpenses, todayStr]);
  const todayTotal = useMemo(() => todayItems.reduce((s, e) => s + (Number(e.amount) || 0), 0), [todayItems]);

  const filteredTotal = useMemo(
    () => filteredExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0),
    [filteredExpenses]
  );
  const allTimeTotal = useMemo(
    () => allExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0),
    [allExpenses]
  );

  const topCategory = useMemo(() => {
    const map = new Map<string, number>();
    filteredExpenses.forEach(e => {
      map.set(e.category, (map.get(e.category) || 0) + (Number(e.amount) || 0));
    });
    let maxCat = 'Walang Data';
    let maxAmt = 0;
    map.forEach((amt, cat) => {
      if (amt > maxAmt) {
        maxAmt = amt;
        maxCat = cat;
      }
    });
    return { name: maxCat, amount: maxAmt };
  }, [filteredExpenses]);

  // Category badge colors
  const getCategoryColor = (cat: string) => {
    switch (cat.toLowerCase()) {
      case 'supplies':
        return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
      case 'meals':
      case 'food':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
      case 'transportation':
        return 'bg-teal-500/20 text-teal-300 border-teal-500/30';
      case 'utilities':
        return 'bg-purple-500/20 text-purple-300 border-purple-500/30';
      case 'rent':
        return 'bg-rose-500/20 text-rose-300 border-rose-500/30';
      case 'salary':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
      case 'maintenance':
        return 'bg-orange-500/20 text-orange-300 border-orange-500/30';
      default:
        return 'bg-surface-700/60 text-surface-300 border-surface-600/40';
    }
  };

  // Quick Templates
  const quickTemplates = [
    { label: '🧊 Yelo', category: 'Supplies', desc: 'Yelo (Ice)', amount: 30 },
    { label: '🛍️ Plastic Bags', category: 'Supplies', desc: 'Plastic Bags / Sando', amount: 25 },
    { label: '🥪 Merienda', category: 'Meals', desc: 'Staff Merienda', amount: 100 },
    { label: '🪵 Uling / Gas', category: 'Supplies', desc: 'Uling (Charcoal)', amount: 100 },
    { label: '🛵 Pamasahe', category: 'Transportation', desc: 'Pamasahe / Delivery', amount: 50 },
    { label: '📱 Paload', category: 'Utilities', desc: 'Mobile Load / Internet', amount: 50 },
    { label: '🏠 Upa sa Tindahan', category: 'Rent', desc: 'Arawang Upa / Rent', amount: 400 },
    { label: '💡 Kuryente', category: 'Utilities', desc: 'Kuryente / Electricity', amount: 300 },
  ];

  const handleQuickAdd = (tpl: typeof quickTemplates[0]) => {
    setEditing({
      id: 0,
      category: tpl.category,
      description: `[Petty Cash] ${tpl.desc}`,
      amount: tpl.amount,
      expense_date: getTodayStr(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    setShowForm(true);
  };

  // Export to CSV
  const handleExportCSV = () => {
    if (filteredExpenses.length === 0) {
      alert('Walang mga tala ng gastos na mai-export.');
      return;
    }

    const headers = ['#', 'Petsa', 'Kategorya', 'Deskripsyon', 'Pinagkunan', 'Halaga (PHP)'];
    const rows = filteredExpenses.map((exp, idx) => {
      const isDrawer = exp.description.includes('[Petty Cash]');
      const cleanDesc = exp.description.replace('[Petty Cash]', '').replace('[Bulsa]', '').trim();
      return [
        idx + 1,
        exp.expense_date,
        `"${exp.category.replace(/"/g, '""')}"`,
        `"${cleanDesc.replace(/"/g, '""')}"`,
        isDrawer ? 'Kaha / Pondo (Petty Cash)' : 'Sariling Bulsa / Bank',
        Number(exp.amount).toFixed(2),
      ];
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const fromStr = dateFrom || 'simula';
    const toStr = dateTo || 'ngayon';
    link.href = url;
    link.setAttribute('download', `Expense_Report_${fromStr}_hanggang_${toStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

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
            setNoticeMsg('Na-update offline! Awtomatikong magsi-sync kapag konektado sa laptop server.');
          }
        } else {
          await saveLocalExpense({ ...editing, ...data, is_pending: true });
          setNoticeMsg('Na-update offline! Awtomatikong magsi-sync kapag konektado sa laptop server.');
        }
      } else {
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
          setNoticeMsg('Nai-save offline! Awtomatikong magsi-sync kapag konektado sa laptop server.');
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
          setNoticeMsg('Na-delete offline! Awtomatikong magsi-sync kapag konektado sa laptop server.');
        }
      } else {
        await deleteLocalExpense(deleteConfirm.id);
        await removeMutationByTempId(deleteConfirm.id);
      }
      useSyncStore.getState().refreshCounts();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Nabigong burahin ang gastos');
    } finally {
      setDeleteConfirm(null);
      loadExpenses();
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2 p-1 sm:p-2 animate-fade-in">

      {/* ── HEADER & ACTIONS ── */}
      <div className="flex-shrink-0 flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">📊</span>
            <h1 className="text-base sm:text-lg font-black text-surface-100 tracking-tight">
              Expense Report & Audit Ledger
            </h1>
          </div>
          <p className="text-[11px] text-surface-400">
            Pangkalahatang talaan ng lahat ng operational expenses, pondo, at petty cash ng tindahan
          </p>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={handleExportCSV}
            className="h-8 px-2.5 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-200 hover:text-white border border-surface-700 text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95"
            title="I-download bilang CSV report"
          >
            <span>📥</span>
            <span>Export CSV</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
            className="h-8 px-3 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold transition-all shadow-md flex items-center gap-1.5 cursor-pointer active:scale-95"
          >
            <span>➕</span>
            <span>Magtala ng Gastos</span>
          </button>
        </div>
      </div>

      {/* ── KPI ANALYTICAL CARDS ── */}
      <div className="flex-shrink-0 grid grid-cols-2 lg:grid-cols-4 gap-2">
        {/* Card 1: Today's Expenses */}
        <div className="p-2 sm:p-2.5 rounded-xl bg-surface-900 border border-surface-700/60 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-surface-400 uppercase tracking-wider">
              Gastos Ngayong Araw
            </span>
            <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold">
              {todayItems.length} tala
            </span>
          </div>
          <p className="text-base sm:text-lg font-black text-amber-300 mt-1 truncate">
            {formatCurrency(todayTotal)}
          </p>
          <span className="text-[9px] text-surface-500 truncate">
            {formatDate(todayStr)}
          </span>
        </div>

        {/* Card 2: Filtered Period Total */}
        <div className="p-2 sm:p-2.5 rounded-xl bg-surface-900 border border-surface-700/60 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-surface-400 uppercase tracking-wider">
              Gastos sa Panahon
            </span>
            <span className="text-[9px] px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 font-bold">
              {filteredExpenses.length} tala
            </span>
          </div>
          <p className="text-base sm:text-lg font-black text-rose-400 mt-1 truncate">
            {formatCurrency(filteredTotal)}
          </p>
          <span className="text-[9px] text-surface-500 truncate">
            {dateFrom && dateTo ? `${formatDate(dateFrom)} hanggang ${formatDate(dateTo)}` : 'Lahat ng talaan'}
          </span>
        </div>

        {/* Card 3: Top Category */}
        <div className="p-2 sm:p-2.5 rounded-xl bg-surface-900 border border-surface-700/60 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-surface-400 uppercase tracking-wider">
              Pinakamalaking Kategorya
            </span>
            <span className="text-sm">🏷️</span>
          </div>
          <p className="text-sm sm:text-base font-extrabold text-surface-100 mt-1 truncate">
            {topCategory.name}
          </p>
          <span className="text-[9px] text-amber-400 font-bold truncate">
            {topCategory.amount > 0 ? formatCurrency(topCategory.amount) : '₱0.00'}
          </span>
        </div>

        {/* Card 4: All-Time Total */}
        <div className="p-2 sm:p-2.5 rounded-xl bg-surface-900 border border-surface-700/60 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-surface-400 uppercase tracking-wider">
              Kabuuang Gastos (System)
            </span>
            <span className="text-sm">🏦</span>
          </div>
          <p className="text-base sm:text-lg font-black text-surface-200 mt-1 truncate">
            {formatCurrency(allTimeTotal)}
          </p>
          <span className="text-[9px] text-surface-500 truncate">
            {allExpenses.length} pangkalahatang tala
          </span>
        </div>
      </div>

      {/* ── FILTER & SEARCH RIBBON ── */}
      <div className="flex-shrink-0 p-2 sm:p-2.5 rounded-xl bg-surface-900/90 border border-surface-700/60 shadow-xs space-y-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Quick Preset Buttons */}
          <div className="flex items-center gap-1 bg-surface-950 p-1 rounded-lg border border-surface-800">
            <button
              type="button"
              onClick={() => handleSetPreset('today')}
              className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-all ${
                dateFrom === todayStr && dateTo === todayStr
                  ? 'bg-primary-600 text-white shadow-xs'
                  : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              ⚡ Ngayon
            </button>
            <button
              type="button"
              onClick={() => handleSetPreset('yesterday')}
              className="px-2 py-0.5 rounded text-[10px] font-bold text-surface-400 hover:text-surface-200 cursor-pointer transition-all"
            >
              📅 Kahapon
            </button>
            <button
              type="button"
              onClick={() => handleSetPreset('this_week')}
              className="px-2 py-0.5 rounded text-[10px] font-bold text-surface-400 hover:text-surface-200 cursor-pointer transition-all"
            >
              📆 Linggo
            </button>
            <button
              type="button"
              onClick={() => handleSetPreset('this_month')}
              className="px-2 py-0.5 rounded text-[10px] font-bold text-surface-400 hover:text-surface-200 cursor-pointer transition-all"
            >
              🗓️ Buwan
            </button>
            <button
              type="button"
              onClick={() => handleSetPreset('all')}
              className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-all ${
                !dateFrom && !dateTo
                  ? 'bg-primary-600 text-white shadow-xs'
                  : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              🗂️ Lahat
            </button>
          </div>

          {/* Date Pickers */}
          <div className="flex items-center gap-1 bg-surface-950 px-2 py-1 rounded-lg border border-surface-800">
            <span className="text-[10px] text-surface-400 font-bold">Mula:</span>
            <input
              type="date"
              value={dateFrom}
              min={SYSTEM_START_DATE}
              onChange={e => {
                const val = e.target.value && e.target.value < SYSTEM_START_DATE ? SYSTEM_START_DATE : e.target.value;
                setDateFrom(val);
                setCurrentPage(1);
              }}
              className="bg-transparent text-[11px] text-surface-100 font-bold focus:outline-none cursor-pointer w-[110px]"
            />
          </div>

          <div className="flex items-center gap-1 bg-surface-950 px-2 py-1 rounded-lg border border-surface-800">
            <span className="text-[10px] text-surface-400 font-bold">Hanggang:</span>
            <input
              type="date"
              value={dateTo}
              min={SYSTEM_START_DATE}
              onChange={e => {
                const val = e.target.value && e.target.value < SYSTEM_START_DATE ? SYSTEM_START_DATE : e.target.value;
                setDateTo(val);
                setCurrentPage(1);
              }}
              className="bg-transparent text-[11px] text-surface-100 font-bold focus:outline-none cursor-pointer w-[110px]"
            />
          </div>

          {/* Category Dropdown */}
          <select
            value={selectedCategory}
            onChange={e => {
              setSelectedCategory(e.target.value);
              setCurrentPage(1);
            }}
            className="h-7 px-2 rounded-lg bg-surface-950 border border-surface-800 text-surface-200 text-xs font-semibold focus:outline-none cursor-pointer"
          >
            <option value="ALL">🏷️ Lahat ng Kategorya</option>
            <option value="Supplies">📦 Supplies</option>
            <option value="Meals">🥪 Meals / Food</option>
            <option value="Transportation">🛵 Transportation</option>
            <option value="Utilities">💡 Utilities</option>
            <option value="Rent">🏠 Rent</option>
            <option value="Maintenance">🔧 Maintenance</option>
            <option value="Salary">👥 Salary</option>
            <option value="Equipment">⚙️ Equipment</option>
            <option value="Other">Iba pa (Other)</option>
          </select>

          {/* Source Dropdown */}
          <select
            value={selectedSource}
            onChange={e => {
              setSelectedSource(e.target.value as any);
              setCurrentPage(1);
            }}
            className="h-7 px-2 rounded-lg bg-surface-950 border border-surface-800 text-surface-200 text-xs font-semibold focus:outline-none cursor-pointer"
          >
            <option value="ALL">💵 Lahat ng Pinagkunan</option>
            <option value="DRAWER">💵 Mula sa Kaha (Petty Cash)</option>
            <option value="POCKET">💼 Sariling Bulsa / Bank</option>
          </select>

          {/* Search Input */}
          <div className="flex-1 min-w-[140px] relative">
            <input
              type="text"
              value={searchQuery}
              placeholder="🔍 Maghanap ng gastos o kategorya..."
              onChange={e => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-7 pl-2 pr-6 rounded-lg bg-surface-950 border border-surface-800 text-surface-100 text-xs focus:outline-none focus:border-primary-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-surface-400 hover:text-white text-xs cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowQuickPills(p => !p)}
            className="h-7 px-2 rounded-lg bg-surface-950 border border-surface-800 text-[10px] text-surface-400 hover:text-primary-400 flex items-center gap-1 cursor-pointer shrink-0"
          >
            <span>⚡ Mabilisang Chips</span>
            <span>{showQuickPills ? '▲' : '▼'}</span>
          </button>
        </div>

        {/* Collapsible Quick-Add Template Pills */}
        {showQuickPills && (
          <div className="pt-2 border-t border-surface-800/80 flex flex-wrap gap-1.5 animate-fade-in">
            {quickTemplates.map(tpl => (
              <button
                key={tpl.desc}
                type="button"
                onClick={() => handleQuickAdd(tpl)}
                className="px-2 py-1 rounded-lg bg-surface-950 hover:bg-surface-800 border border-surface-800 hover:border-primary-500/50 text-surface-200 text-[11px] font-medium transition-all shadow-xs flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <span>{tpl.label}</span>
                <span className="text-emerald-400 font-bold">({formatCurrency(tpl.amount)})</span>
              </button>
            ))}
          </div>
        )}
      </div>

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

      {/* ── MAIN DATA TABLE (EXPENSE AUDIT LEDGER) ── */}
      <div className="flex-1 min-h-0 bg-surface-900 rounded-xl border border-surface-700/60 flex flex-col overflow-hidden shadow-sm">
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center py-16">
            <div className="w-8 h-8 border-3 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
            <p className="text-xs text-surface-400 mt-2">Kinukuha ang kumpletong audit ledger...</p>
          </div>
        ) : filteredExpenses.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-16 text-center">
            <span className="text-4xl mb-2">💸</span>
            <p className="text-surface-300 font-bold text-sm">Walang nakitang gastos</p>
            <p className="text-surface-500 text-xs mt-1">
              Subukang palitan ang petsa o magdagdag ng bagong gastos gamit ang "+ Magtala ng Gastos" sa itaas.
            </p>
          </div>
        ) : (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[650px] whitespace-nowrap">
                <thead className="sticky top-0 bg-surface-950 border-b border-surface-700/60 z-10 shadow-xs">
                  <tr>
                    <th className="px-3 py-2.5 text-[11px] font-bold text-surface-400 uppercase w-10">
                      #
                    </th>
                    <th className="px-3 py-2.5 text-[11px] font-bold text-surface-400 uppercase">
                      Petsa
                    </th>
                    <th className="px-3 py-2.5 text-[11px] font-bold text-surface-400 uppercase">
                      Kategorya
                    </th>
                    <th className="px-3 py-2.5 text-[11px] font-bold text-surface-400 uppercase">
                      Deskripsyon / Detalye
                    </th>
                    <th className="px-3 py-2.5 text-[11px] font-bold text-surface-400 uppercase">
                      Pinagkunan
                    </th>
                    <th className="px-3 py-2.5 text-[11px] font-bold text-surface-400 uppercase text-right">
                      Halaga
                    </th>
                    <th className="px-3 py-2.5 text-[11px] font-bold text-surface-400 uppercase text-right w-20">
                      Aksyon
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-800/60 text-xs">
                  {paginatedExpenses.map((exp, index) => {
                    const rowNumber = (currentPage - 1) * itemsPerPage + index + 1;
                    const isDrawer = exp.description.includes('[Petty Cash]');
                    const cleanDesc = exp.description.replace('[Petty Cash]', '').replace('[Bulsa]', '').trim();

                    return (
                      <tr key={exp.id} className="hover:bg-surface-800/40 transition-colors">
                        <td className="px-3 py-2 text-surface-500 font-mono text-[11px]">
                          {rowNumber}
                        </td>
                        <td className="px-3 py-2 font-semibold text-surface-200">
                          {formatDate(exp.expense_date)}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${getCategoryColor(
                              exp.category
                            )}`}
                          >
                            {exp.category}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-medium text-surface-100 max-w-[280px]">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="truncate">{cleanDesc}</span>
                            {(exp.is_pending || exp.id < 0) && (
                              <span className="px-1 py-0.2 rounded bg-warning-500/20 text-warning-400 text-[9px] font-bold">
                                ⏳ Pending Sync
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {isDrawer ? (
                            <span className="px-2 py-0.5 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px] font-bold inline-flex items-center gap-1">
                              <span>💵</span> Kaha / Pondo
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-lg bg-sky-500/15 text-sky-300 border border-sky-500/30 text-[10px] font-bold inline-flex items-center gap-1">
                              <span>💼</span> Bulsa / Bank
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-black text-rose-400 text-sm">
                          -{formatCurrency(exp.amount)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setEditing(exp);
                                setShowForm(true);
                              }}
                              className="p-1 rounded text-surface-400 hover:text-primary-400 hover:bg-surface-800 transition-colors cursor-pointer"
                              title="I-edit ang gastos"
                            >
                              ✏️
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirm(exp)}
                              className="p-1 rounded text-surface-400 hover:text-rose-400 hover:bg-surface-800 transition-colors cursor-pointer"
                              title="Burahin ang gastos"
                            >
                              🗑️
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── TABLE FOOTER: SUMMARY & PAGINATION ── */}
            <div className="flex-shrink-0 px-3 py-2 bg-surface-950 border-t border-surface-700/60 flex items-center justify-between flex-wrap gap-2 text-xs">
              <div className="flex items-center gap-2 text-surface-400">
                <span>
                  Ipinapakita ang <strong>{paginatedExpenses.length}</strong> sa <strong>{filteredExpenses.length}</strong> talaan
                </span>
                <span className="text-surface-600">•</span>
                <span>
                  Kabuuang halaga: <strong className="text-rose-400 font-extrabold">{formatCurrency(filteredTotal)}</strong>
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <select
                  value={itemsPerPage}
                  onChange={e => {
                    setItemsPerPage(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="bg-surface-900 border border-surface-700/60 rounded px-1.5 py-0.5 text-[11px] text-surface-300 cursor-pointer"
                >
                  <option value={15}>15 bawat pahina</option>
                  <option value={25}>25 bawat pahina</option>
                  <option value={50}>50 bawat pahina</option>
                  <option value={100}>100 bawat pahina</option>
                </select>

                <button
                  type="button"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="px-2 py-0.5 rounded bg-surface-900 hover:bg-surface-800 disabled:opacity-40 disabled:cursor-not-allowed border border-surface-700/60 text-surface-200 text-xs font-bold cursor-pointer"
                >
                  ← Bago
                </button>

                <span className="text-[11px] text-surface-300 font-bold px-1">
                  {currentPage} / {totalPages}
                </span>

                <button
                  type="button"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="px-2 py-0.5 rounded bg-surface-900 hover:bg-surface-800 disabled:opacity-40 disabled:cursor-not-allowed border border-surface-700/60 text-surface-200 text-xs font-bold cursor-pointer"
                >
                  Sunod →
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── MODAL: ADD / EDIT EXPENSE ── */}
      {showForm && (
        <ExpenseFormModal
          expense={editing}
          onSave={handleSave}
          onClose={() => {
            setShowForm(false);
            setEditing(null);
          }}
        />
      )}

      {/* ── MODAL: DELETE CONFIRMATION ── */}
      {deleteConfirm &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-xs animate-fade-in">
            <div className="bg-surface-900 rounded-2xl p-5 sm:p-6 max-w-sm w-full border border-surface-700 shadow-2xl animate-scale-up">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-2xl">⚠️</span>
                <h3 className="text-base font-bold text-surface-100">Tanggalin ang Gastos?</h3>
              </div>
              <p className="text-surface-300 text-xs mb-1">
                Sigurado ka bang nais mong tanggalin ang gastos na ito?
              </p>
              <div className="p-2.5 rounded-xl bg-surface-950 border border-surface-800 my-3 space-y-1">
                <p className="text-xs font-bold text-surface-200">
                  {deleteConfirm.description.replace('[Petty Cash]', '').replace('[Bulsa]', '').trim()}
                </p>
                <p className="text-xs font-black text-rose-400">
                  {formatCurrency(deleteConfirm.amount)} • {formatDate(deleteConfirm.expense_date)}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 px-3 py-2 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-300 text-xs font-bold cursor-pointer border border-surface-700 transition-colors"
                >
                  Kanselahin
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="flex-1 px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer transition-colors shadow-md active:scale-95"
                >
                  Oo, Tanggalin
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

function ExpenseFormModal({
  expense,
  onSave,
  onClose,
}: {
  expense: Expense | null;
  onSave: (data: { category: string; description: string; amount: number; expense_date: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [category, setCategory] = useState(expense?.category ?? 'Supplies');
  const [description, setDescription] = useState(
    expense?.description?.replace('[Petty Cash]', '').replace('[Bulsa]', '').trim() ?? ''
  );
  const [amount, setAmount] = useState(expense?.amount ?? 0);
  const [isFromDrawer, setIsFromDrawer] = useState(() => {
    return expense ? (expense.description?.includes('[Petty Cash]') ?? true) : true;
  });
  const [expenseDate, setExpenseDate] = useState(() => {
    const d = expense?.expense_date ?? getTodayStr();
    return d < SYSTEM_START_DATE ? SYSTEM_START_DATE : d;
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const expenseCategories = [
    'Supplies',
    'Meals',
    'Transportation',
    'Utilities',
    'Rent',
    'Salary',
    'Maintenance',
    'Equipment',
    'Marketing',
    'Other',
  ];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim() || amount <= 0) {
      setFormError('Kailangan ng wastong deskripsyon at halaga ng gastos.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const cleanDesc = description.replace('[Petty Cash]', '').replace('[Bulsa]', '').trim();
      const finalDesc = isFromDrawer ? `[Petty Cash] ${cleanDesc}` : cleanDesc;
      await onSave({ category, description: finalDesc, amount, expense_date: expenseDate });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Nabigong i-save ang gastos');
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-xs animate-fade-in">
      <div className="bg-surface-900 rounded-2xl p-5 sm:p-6 max-w-md w-full border border-surface-700 shadow-2xl animate-scale-up max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">💸</span>
            <h3 className="text-base font-bold text-surface-100">
              {expense ? 'I-edit ang Gastos' : 'Magtala ng Bagong Gastos'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-surface-800 hover:bg-surface-700 text-surface-400 hover:text-white flex items-center justify-center text-xs transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {formError && (
          <div className="mb-4 p-2.5 rounded-xl bg-danger-500/10 border border-danger-500/30 text-danger-400 text-xs">
            ⚠️ {formError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {/* Fund Source Toggle */}
          <div>
            <label className="block text-[11px] font-bold text-surface-400 uppercase tracking-wide mb-1">
              Pinagkunan ng Pera (Source of Funds)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setIsFromDrawer(true)}
                className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
                  isFromDrawer
                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/50 shadow-xs'
                    : 'bg-surface-950 text-surface-400 border-surface-800 hover:text-surface-200'
                }`}
              >
                <span className="flex items-center gap-1">💵 Kaha / Pondo</span>
                <span className="text-[9px] text-surface-500">Bawas sa pondo</span>
              </button>
              <button
                type="button"
                onClick={() => setIsFromDrawer(false)}
                className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
                  !isFromDrawer
                    ? 'bg-sky-500/15 text-sky-300 border-sky-500/50 shadow-xs'
                    : 'bg-surface-950 text-surface-400 border-surface-800 hover:text-surface-200'
                }`}
              >
                <span className="flex items-center gap-1">💼 Bulsa / Bank</span>
                <span className="text-[9px] text-surface-500">Hindi bawas sa kaha</span>
              </button>
            </div>
          </div>

          {/* Category */}
          <div>
            <label className="block text-[11px] font-bold text-surface-400 uppercase tracking-wide mb-1">
              Kategorya
            </label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-surface-950 border border-surface-700 text-surface-100 text-xs font-semibold focus:border-primary-500 focus:outline-none cursor-pointer"
            >
              {expenseCategories.map(c => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div>
            <label className="block text-[11px] font-bold text-surface-400 uppercase tracking-wide mb-1">
              Deskripsyon / Para Saan *
            </label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Hal. Yelo, plastic bag, gasolina, merienda..."
              className="w-full px-3 py-2 rounded-xl bg-surface-950 border border-surface-700 text-surface-100 text-xs font-medium focus:border-primary-500 focus:outline-none"
              required
            />
          </div>

          {/* Amount & Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-bold text-surface-400 uppercase tracking-wide mb-1">
                Halaga (₱) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amount || ''}
                placeholder="0.00"
                onFocus={e => e.target.select()}
                onClick={e => (e.target as HTMLInputElement).select()}
                onChange={e => setAmount(parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 rounded-xl bg-surface-950 border border-surface-700 text-surface-100 font-bold text-sm focus:border-primary-500 focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-surface-400 uppercase tracking-wide mb-1">
                Petsa
              </label>
              <input
                type="date"
                value={expenseDate}
                min={SYSTEM_START_DATE}
                onChange={e => {
                  const val = e.target.value;
                  setExpenseDate(val < SYSTEM_START_DATE ? SYSTEM_START_DATE : val);
                }}
                className="w-full px-3 py-2 rounded-xl bg-surface-950 border border-surface-700 text-surface-100 text-xs font-semibold focus:border-primary-500 focus:outline-none cursor-pointer"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-3 py-2 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-300 text-xs font-bold cursor-pointer border border-surface-700 transition-colors"
            >
              Kanselahin
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white text-xs font-bold cursor-pointer transition-colors shadow-md active:scale-95"
            >
              {saving ? 'Sine-save...' : expense ? 'I-update' : 'I-save ang Gastos'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
