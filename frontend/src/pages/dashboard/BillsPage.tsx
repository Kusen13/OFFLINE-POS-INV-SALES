/**
 * BillsPage - Monthly Bills & ROI Tracker
 * 
 * Features:
 * 1. Sinking Fund (Daily Hulugan) for Rent, Electricity, Water, WiFi, etc.
 * 2. Day-by-Day (1-31) Allocation Matrix matching the user's spreadsheet.
 * 3. Initial Capital & Real-Time Return on Investment (ROI) progress tracking.
 * 4. Zero horizontal scrollbar, responsive layout, enterprise-grade aesthetics.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { formatCurrency } from '../../utils/currency';
import { SYSTEM_START_DATE } from '../../utils/date';
import {
  getBillsByMonth,
  saveMonthlyBill,
  deleteMonthlyBill,
  updateDailyAllocation,
  autoAllocateDay,
  getInitialCapitalConfig,
  saveInitialCapitalConfig,
  calculateROIData,
} from '../../db/billsRepository';
import type { MonthlyBill, InitialCapitalConfig, CapitalItem } from '../../types/bills';

export function BillsPage() {
  const [activeTab, setActiveTab] = useState<'bills' | 'roi'>('bills');
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [bills, setBills] = useState<MonthlyBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [roiData, setRoiData] = useState<any>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Modal states
  const [billModalOpen, setBillModalOpen] = useState(false);
  const [editingBill, setEditingBill] = useState<MonthlyBill | null>(null);
  const [billForm, setBillForm] = useState({
    name: '',
    daily_obligation: '',
    total_target_amount: '',
    due_date: '',
    notes: '',
  });

  const [capitalModalOpen, setCapitalModalOpen] = useState(false);
  const [capitalForm, setCapitalForm] = useState({
    total_capital: '',
    business_start_date: '',
    notes: '',
  });

  const [capitalItemModalOpen, setCapitalItemModalOpen] = useState(false);
  const [itemForm, setItemForm] = useState(() => {
    const today = new Date().toISOString().slice(0, 10);
    return {
      item_name: '',
      amount: '',
      category: 'Equipment',
      date_invested: today < SYSTEM_START_DATE ? SYSTEM_START_DATE : today,
      notes: '',
    };
  });

  // Allocation quick-entry modal
  const [quickAllocModal, setQuickAllocModal] = useState<{
    bill: MonthlyBill;
    day: number;
    currentAmount: number;
  } | null>(null);
  const [quickAllocAmount, setQuickAllocAmount] = useState('');
  const [isMatrixOpen, setIsMatrixOpen] = useState(false);

  // Number of days in selected month
  const daysInMonth = useMemo(() => {
    const [year, month] = selectedMonth.split('-').map(Number);
    return new Date(year, month, 0).getDate();
  }, [selectedMonth]);

  // Load Bills and ROI data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const loadedBills = await getBillsByMonth(selectedMonth);
      setBills(loadedBills);

      const calculatedRoi = await calculateROIData();
      setRoiData(calculatedRoi);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load bills data');
    } finally {
      setLoading(false);
    }
  }, [selectedMonth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Aggregate KPI metrics for bills
  const billsSummary = useMemo(() => {
    const totalTarget = bills.reduce((sum, b) => sum + b.total_target_amount, 0);
    const dailyTargetTotal = bills.reduce((sum, b) => sum + b.daily_obligation, 0);

    let totalCollected = 0;
    bills.forEach(b => {
      const coll = Object.values(b.daily_allocations || {}).reduce((s, a) => s + (Number(a) || 0), 0);
      totalCollected += coll;
    });

    const remaining = Math.max(0, totalTarget - totalCollected);
    const progressPercent = totalTarget > 0 ? Math.min(100, Math.round((totalCollected / totalTarget) * 100)) : 0;

    return {
      totalTarget,
      totalCollected,
      remaining,
      dailyTargetTotal,
      progressPercent,
    };
  }, [bills]);

  // Open Bill create/edit modal
  const handleOpenBillModal = (bill?: MonthlyBill) => {
    if (bill) {
      setEditingBill(bill);
      setBillForm({
        name: bill.name,
        daily_obligation: String(bill.daily_obligation),
        total_target_amount: String(bill.total_target_amount),
        due_date: bill.due_date || '',
        notes: bill.notes || '',
      });
    } else {
      setEditingBill(null);
      setBillForm({
        name: '',
        daily_obligation: '',
        total_target_amount: '',
        due_date: '',
        notes: '',
      });
    }
    setBillModalOpen(true);
  };

  // Save Bill
  const handleSaveBill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!billForm.name.trim()) return;

    try {
      const dailyObligation = Math.max(0, Number(billForm.daily_obligation) || 0);
      const totalTarget = Math.max(0, Number(billForm.total_target_amount) || 0);

      const billToSave: MonthlyBill = {
        id: editingBill ? editingBill.id : `bill-${billForm.name.toLowerCase().replace(/\s+/g, '-')}-${selectedMonth}`,
        month: selectedMonth,
        name: billForm.name.trim(),
        daily_obligation: dailyObligation,
        total_target_amount: totalTarget,
        due_date: billForm.due_date || undefined,
        notes: billForm.notes.trim() || undefined,
        daily_allocations: editingBill ? editingBill.daily_allocations : {},
        status: editingBill ? editingBill.status : 'PENDING',
        created_at: editingBill ? editingBill.created_at : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await saveMonthlyBill(billToSave);
      setBillModalOpen(false);
      setSuccessMsg(`✓ Matagumpay na nai-save ang bill na "${billToSave.name}"!`);
      await loadData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save bill');
    }
  };

  // Delete Bill
  const handleDeleteBill = async (id: string, name: string) => {
    if (!window.confirm(`Sigurado ka bang nais mong tanggalin ang bill na "${name}"?`)) return;
    try {
      await deleteMonthlyBill(id);
      setSuccessMsg(`✓ Natanggal ang "${name}".`);
      await loadData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to delete bill');
    }
  };

  // Quick Allocate today's goals
  const handleAutoAllocateToday = async () => {
    const today = new Date();
    const todayMonth = today.toISOString().slice(0, 7);
    const todayDay = today.getDate();

    if (selectedMonth !== todayMonth) {
      if (!window.confirm(`Ang napiling buwan (${selectedMonth}) ay hindi ngayong buwan. Nais mo bang hulugan ang Day ${todayDay}?`)) {
        return;
      }
    }

    try {
      await autoAllocateDay(selectedMonth, todayDay);
      setSuccessMsg(`✓ Nai-record na ang Daily Hulog para sa Day ${todayDay}!`);
      await loadData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to auto-allocate');
    }
  };

  // Toggle quick allocation modal for specific day
  const handleOpenQuickAlloc = (bill: MonthlyBill, day: number) => {
    const curr = bill.daily_allocations[day] || 0;
    setQuickAllocModal({ bill, day, currentAmount: curr });
    setQuickAllocAmount(curr === 0 ? String(bill.daily_obligation) : String(curr));
  };

  const handleSaveQuickAlloc = async () => {
    if (!quickAllocModal) return;
    try {
      const amt = Number(quickAllocAmount) || 0;
      await updateDailyAllocation(quickAllocModal.bill.id, quickAllocModal.day, amt);
      setQuickAllocModal(null);
      await loadData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update allocation');
    }
  };

  // Mark bill as PAID
  const handleTogglePaid = async (bill: MonthlyBill) => {
    try {
      const newStatus = bill.status === 'PAID' ? 'PARTIALLY_FUNDED' : 'PAID';
      await saveMonthlyBill({
        ...bill,
        status: newStatus,
        paid_at: newStatus === 'PAID' ? new Date().toISOString() : undefined,
      });
      setSuccessMsg(newStatus === 'PAID' ? `✓ Minarkahan ang "${bill.name}" bilang PAID!` : `✓ Na-unmark ang "${bill.name}".`);
      await loadData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update bill status');
    }
  };

  // Capital Config Modal
  const handleOpenCapitalModal = async () => {
    const config = await getInitialCapitalConfig();
    setCapitalForm({
      total_capital: String(config.total_capital),
      business_start_date: config.business_start_date,
      notes: config.notes || '',
    });
    setCapitalModalOpen(true);
  };

  const handleSaveCapitalConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const current = await getInitialCapitalConfig();
      const updated: InitialCapitalConfig = {
        ...current,
        total_capital: Math.max(0, Number(capitalForm.total_capital) || 0),
        business_start_date: capitalForm.business_start_date || current.business_start_date,
        notes: capitalForm.notes.trim() || undefined,
      };
      await saveInitialCapitalConfig(updated);
      setCapitalModalOpen(false);
      setSuccessMsg('✓ Matagumpay na na-update ang Initial Capital configuration!');
      await loadData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update capital');
    }
  };

  // Capital item save
  const handleSaveCapitalItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemForm.item_name.trim()) return;

    try {
      const current = await getInitialCapitalConfig();
      const newItem: CapitalItem = {
        id: `cap-${Date.now()}`,
        item_name: itemForm.item_name.trim(),
        amount: Math.max(0, Number(itemForm.amount) || 0),
        category: itemForm.category,
        date_invested: itemForm.date_invested,
        notes: itemForm.notes.trim() || undefined,
      };

      const updatedItems = [...(current.items || []), newItem];
      // Automatically adjust total capital if user wants items sum to govern
      const totalFromItems = updatedItems.reduce((s, i) => s + i.amount, 0);

      const updated: InitialCapitalConfig = {
        ...current,
        total_capital: Math.max(current.total_capital, totalFromItems),
        items: updatedItems,
      };

      await saveInitialCapitalConfig(updated);
      setCapitalItemModalOpen(false);
      setItemForm({
        item_name: '',
        amount: '',
        category: 'Equipment',
        date_invested: new Date().toISOString().slice(0, 10),
        notes: '',
      });
      setSuccessMsg(`✓ Naidagdag ang "${newItem.item_name}" sa Capital breakdown!`);
      await loadData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to add capital item');
    }
  };

  const handleDeleteCapitalItem = async (itemId: string) => {
    if (!window.confirm('Sigurado ka bang nais mong tanggalin ang capital item na ito?')) return;
    try {
      const current = await getInitialCapitalConfig();
      const updatedItems = (current.items || []).filter(i => i.id !== itemId);
      await saveInitialCapitalConfig({
        ...current,
        items: updatedItems,
      });
      setSuccessMsg('✓ Natanggal ang capital item.');
      await loadData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to delete item');
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-2.5 sm:space-y-3.5 animate-fade-in pb-16 lg:pb-0">
      {/* Top Header Bar */}
      <div className="flex-shrink-0 flex items-center justify-between gap-2">
        <div className="hidden lg:block">
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold text-surface-50 tracking-tight">Monthly Bills & ROI Tracker</h1>
            {loading && <span className="text-xs text-primary-400 animate-pulse">Naglo-load...</span>}
            <span className="px-2 py-0.5 rounded-full bg-primary-500/20 text-primary-400 text-xs font-bold border border-primary-500/30 whitespace-nowrap">
              TARGET GOALS
            </span>
          </div>
          <p className="text-surface-400 mt-0.5 text-xs">
            Sinking Fund (araw-araw na hulog para sa bills), fixed obligations, at pagbawi ng Initial Capital (ROI)
          </p>
        </div>

        {/* Tab Switcher & Month Selector - Full width on mobile without title clutter */}
        <div className="flex items-center gap-2 flex-nowrap shrink-0 w-full lg:w-auto justify-between lg:justify-end">
          {/* Navigation Pill Switcher */}
          <div className="flex items-center bg-surface-900 p-0.5 rounded-xl border border-surface-700/80 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('bills')}
              className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                activeTab === 'bills'
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              <span>🏦</span>
              <span>Bills</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('roi')}
              className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                activeTab === 'roi'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              <span>🎯</span>
              <span>ROI</span>
              <span className="hidden sm:inline">& Capital</span>
            </button>
          </div>

          {/* Month Input with ample width so October 2026 is never truncated */}
          {activeTab === 'bills' && (
            <input
              type="month"
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              className="text-xs sm:text-sm py-1.5 px-2.5 sm:px-3 rounded-xl bg-surface-900 border border-surface-700 text-surface-100 font-semibold cursor-pointer focus:outline-none focus:border-primary-500 w-[145px] sm:w-44 shrink-0 shadow-xs"
            />
          )}
        </div>
      </div>

      {/* Alert notifications */}
      {successMsg && (
        <div className="p-2.5 sm:p-3 rounded-xl bg-success-500/10 border border-success-500/30 text-success-400 text-xs sm:text-sm flex items-center justify-between shrink-0">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="text-success-400 hover:text-success-200 ml-2">✕</button>
        </div>
      )}

      {errorMsg && (
        <div className="p-2.5 sm:p-3 rounded-xl bg-danger-500/10 border border-danger-500/30 text-danger-400 text-xs sm:text-sm flex items-center justify-between shrink-0">
          <span>⚠️ {errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-danger-400 hover:text-danger-200 ml-2">✕</button>
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 1: MONTHLY BILLS & SINKING FUND MATRIX */}
      {/* ============================================================== */}
      {activeTab === 'bills' && (
        <>
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5 sm:gap-2.5 flex-shrink-0">
            <div className="p-2 sm:p-3 rounded-xl bg-surface-900/90 border border-surface-700/60 shadow-sm min-w-0 flex flex-col justify-between">
              <span className="text-[9px] sm:text-xs text-surface-400 font-semibold uppercase tracking-wider truncate">Monthly Target</span>
              <p className="text-xs sm:text-lg font-extrabold text-surface-100 mt-0.5 truncate">
                {formatCurrency(billsSummary.totalTarget)}
              </p>
              <span className="text-[9px] sm:text-[11px] text-surface-500 mt-0.5 truncate">{bills.length} active bills</span>
            </div>

            <div className="p-2 sm:p-3 rounded-xl bg-surface-900/90 border border-surface-700/60 shadow-sm min-w-0 flex flex-col justify-between">
              <span className="text-[9px] sm:text-xs text-surface-400 font-semibold uppercase tracking-wider truncate">Total Naipon</span>
              <div className="flex items-baseline justify-between mt-0.5">
                <span className="text-xs sm:text-lg font-extrabold text-emerald-400 truncate">
                  {formatCurrency(billsSummary.totalCollected)}
                </span>
                <span className="text-[9px] sm:text-[10px] text-emerald-400 font-bold ml-1">{billsSummary.progressPercent}%</span>
              </div>
              <div className="bg-surface-800 rounded-full h-1 overflow-hidden mt-1">
                <div
                  className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                  style={{ width: `${billsSummary.progressPercent}%` }}
                />
              </div>
            </div>

            <div className="p-2 sm:p-3 rounded-xl bg-surface-900/90 border border-surface-700/60 shadow-sm min-w-0 flex flex-col justify-between">
              <span className="text-[9px] sm:text-xs text-surface-400 font-semibold uppercase tracking-wider truncate">Kulang Pa</span>
              <p className="text-xs sm:text-lg font-extrabold text-amber-400 mt-0.5 truncate">
                {formatCurrency(billsSummary.remaining)}
              </p>
              <span className="text-[9px] sm:text-[11px] text-surface-500 mt-0.5 truncate">Naiwan bago mag-due</span>
            </div>

            <div className="p-2 sm:p-3 rounded-xl bg-primary-950/40 border border-primary-500/30 shadow-sm min-w-0 flex flex-col justify-between">
              <span className="text-[9px] sm:text-xs text-primary-300 font-semibold uppercase tracking-wider truncate">Daily Sinking</span>
              <p className="text-xs sm:text-lg font-black text-primary-400 mt-0.5 truncate">
                {formatCurrency(billsSummary.dailyTargetTotal)}
                <span className="text-[10px] sm:text-xs font-normal text-primary-300/80"> /araw</span>
              </p>
              <span className="text-[9px] sm:text-[11px] text-primary-400/70 mt-0.5 truncate">Itatabi araw-araw</span>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center justify-between gap-2 flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-surface-200">
                Monthly Bills for {selectedMonth}
              </span>
              <span className="text-[11px] text-surface-500 hidden sm:inline">
                • I-click ang cell sa calendar o mag-quick hulog araw-araw
              </span>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 flex-nowrap shrink-0">
              <button
                type="button"
                onClick={handleAutoAllocateToday}
                className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap shadow-xs"
                title="Itabi ang standard daily obligation ngayong araw"
              >
                <span>⚡</span>
                <span className="hidden xs:inline">Auto-hulog</span> <span>Today</span>
              </button>

              <button
                type="button"
                onClick={() => handleOpenBillModal()}
                className="flex items-center gap-1 px-3 sm:px-3.5 py-1.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs sm:text-sm font-bold transition-colors cursor-pointer whitespace-nowrap shadow-xs"
              >
                <span>+</span>
                <span>Add Bill</span>
              </button>
            </div>
          </div>

          {/* Bills Card Container with Interactive Matrix */}
          <div className="flex-1 min-h-0 bg-surface-900/60 rounded-xl border border-surface-700/60 flex flex-col overflow-hidden shadow-sm">
            {bills.length === 0 ? (
              <div className="p-8 text-center text-surface-400 flex flex-col items-center justify-center flex-1">
                <span className="text-3xl mb-2">🏦</span>
                <p className="text-sm font-semibold text-surface-200">Walang naka-set na monthly bills para sa buwan na ito.</p>
                <p className="text-xs text-surface-500 mt-1 max-w-sm">
                  I-click ang <strong>"+ Add Bill"</strong> upang maglagay ng Rent, Kuryente, Tubig, o WiFi.
                </p>
                <button
                  type="button"
                  onClick={() => handleOpenBillModal()}
                  className="mt-4 px-3.5 py-1.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold cursor-pointer"
                >
                  + Add First Bill
                </button>
              </div>
            ) : (
              <>
                {/* 1. Mobile Cards View (< md) - 100% Touch-Friendly and Zero Cutoff */}
                <div className="md:hidden flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
                  {bills.map(bill => {
                    const totalCollected = Object.values(bill.daily_allocations || {}).reduce((s, a) => s + (Number(a) || 0), 0);
                    const remaining = Math.max(0, bill.total_target_amount - totalCollected);
                    const percent = bill.total_target_amount > 0 ? Math.min(100, Math.round((totalCollected / bill.total_target_amount) * 100)) : 0;

                    return (
                      <div key={bill.id} className="p-2.5 rounded-xl bg-surface-900/90 border border-surface-700/60 shadow-xs space-y-2">
                        {/* Header: Name, Daily obligation, Status */}
                        <div className="flex items-start justify-between gap-1.5">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <h4 className="font-bold text-surface-100 text-sm">{bill.name}</h4>
                              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-primary-950/40 border border-primary-500/30 text-primary-300 font-bold whitespace-nowrap">
                                {formatCurrency(bill.daily_obligation)}/araw
                              </span>
                            </div>
                            {bill.notes && <p className="text-[10px] text-surface-400 mt-0.5 truncate">{bill.notes}</p>}
                          </div>
                          
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold whitespace-nowrap shrink-0 border ${
                            bill.status === 'PAID'
                              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                              : bill.status === 'FULLY_FUNDED'
                              ? 'bg-primary-500/20 text-primary-400 border-primary-500/30'
                              : 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                          }`}>
                            {bill.status === 'PAID' ? '✓ PAID' : bill.status === 'FULLY_FUNDED' ? '🎯 FUNDED' : 'IN PROGRESS'}
                          </span>
                        </div>

                        {/* Progress Bar & Amounts */}
                        <div>
                          <div className="flex items-baseline justify-between text-[11px] mb-1">
                            <span className="text-surface-400">
                              Naipon: <strong className="text-emerald-400 font-bold">{formatCurrency(totalCollected)}</strong>
                            </span>
                            <span className="text-surface-400">
                              Target: <strong className="text-surface-200 font-semibold">{formatCurrency(bill.total_target_amount)}</strong>
                            </span>
                          </div>
                          <div className="bg-surface-800 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-[10px] mt-1 text-surface-400">
                            <span>{percent}% funded</span>
                            <span className="text-amber-400 font-semibold">{remaining > 0 ? `₱${remaining.toLocaleString()} kulang` : 'Kumpleto na!'}</span>
                          </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center justify-between pt-1.5 border-t border-surface-800/80 gap-1.5">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleOpenQuickAlloc(bill, new Date().getDate())}
                              className="px-2.5 py-1 rounded-lg bg-primary-600 hover:bg-primary-500 text-white text-[11px] font-bold cursor-pointer transition-colors shadow-xs"
                            >
                              + Hulog Ngayon
                            </button>
                            <button
                              type="button"
                              onClick={() => handleTogglePaid(bill)}
                              className={`px-2 py-1 rounded-lg text-[11px] font-semibold cursor-pointer transition-colors border ${
                                bill.status === 'PAID'
                                  ? 'bg-surface-800 text-surface-300 border-surface-700'
                                  : 'bg-emerald-950/40 text-emerald-300 border-emerald-500/40'
                              }`}
                            >
                              {bill.status === 'PAID' ? 'Re-open' : '✓ Pay'}
                            </button>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleOpenBillModal(bill)}
                              className="p-1 rounded-lg text-surface-400 hover:text-surface-200 bg-surface-800 border border-surface-700/60 cursor-pointer text-xs"
                              title="Edit Bill"
                            >
                              ✏️
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteBill(bill.id, bill.name)}
                              className="p-1 rounded-lg text-danger-400 hover:text-danger-300 bg-surface-800 border border-surface-700/60 cursor-pointer text-xs"
                              title="Delete Bill"
                            >
                              🗑️
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 2. Desktop Table View (>= md) */}
                <div className="hidden md:block flex-1 min-h-0 overflow-y-auto overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[700px]">
                    <thead className="sticky top-0 bg-surface-900 border-b border-surface-700/80 z-20 shadow-sm text-surface-300 text-xs">
                      <tr>
                        <th className="px-3 py-2.5 font-bold uppercase tracking-wider w-40">Bill Name</th>
                        <th className="px-2 py-2.5 font-bold uppercase tracking-wider text-right w-24">Daily Goal</th>
                        <th className="px-2 py-2.5 font-bold uppercase tracking-wider text-right w-28">Total Target</th>
                        <th className="px-2 py-2.5 font-bold uppercase tracking-wider text-right w-28">Collected</th>
                        <th className="px-2 py-2.5 font-bold uppercase tracking-wider text-right w-28">Remaining</th>
                        <th className="px-2 py-2.5 font-bold uppercase tracking-wider text-center w-28">Status</th>
                        <th className="px-2 py-2.5 font-bold uppercase tracking-wider text-center w-36">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-700/40 text-xs">
                      {bills.map(bill => {
                        const totalCollected = Object.values(bill.daily_allocations || {}).reduce((s, a) => s + (Number(a) || 0), 0);
                        const remaining = Math.max(0, bill.total_target_amount - totalCollected);
                        const percent = bill.total_target_amount > 0 ? Math.min(100, Math.round((totalCollected / bill.total_target_amount) * 100)) : 0;

                        return (
                          <tr key={bill.id} className="hover:bg-surface-800/40 transition-colors">
                            <td className="px-3 py-2.5">
                              <p className="text-surface-100 font-bold text-sm">{bill.name}</p>
                              {bill.notes && <p className="text-[10px] text-surface-400 mt-0.5">{bill.notes}</p>}
                            </td>
                            <td className="px-2 py-2.5 text-right font-semibold text-primary-300 whitespace-nowrap">
                              {formatCurrency(bill.daily_obligation)}
                              <span className="text-[10px] text-surface-500 block">/day</span>
                            </td>
                            <td className="px-2 py-2.5 text-right font-bold text-surface-100 whitespace-nowrap">
                              {formatCurrency(bill.total_target_amount)}
                            </td>
                            <td className="px-2 py-2.5 text-right whitespace-nowrap">
                              <span className="font-bold text-emerald-400">{formatCurrency(totalCollected)}</span>
                              <div className="flex items-center gap-1 justify-end mt-0.5">
                                <span className="text-[10px] text-surface-400">{percent}%</span>
                              </div>
                            </td>
                            <td className="px-2 py-2.5 text-right whitespace-nowrap font-bold text-amber-400">
                              {formatCurrency(remaining)}
                            </td>
                            <td className="px-2 py-2.5 text-center whitespace-nowrap">
                              {bill.status === 'PAID' ? (
                                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-extrabold border border-emerald-500/30">
                                  ✓ PAID
                                </span>
                              ) : bill.status === 'FULLY_FUNDED' ? (
                                <span className="px-2 py-0.5 rounded-full bg-primary-500/20 text-primary-400 text-[10px] font-extrabold border border-primary-500/30">
                                  🎯 FUNDED
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-extrabold border border-amber-500/30">
                                  IN PROGRESS
                                </span>
                              )}
                            </td>
                            <td className="px-2 py-2.5 text-center whitespace-nowrap">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleOpenQuickAlloc(bill, new Date().getDate())}
                                  className="px-2 py-1 rounded-lg bg-surface-800 hover:bg-surface-700 text-surface-200 border border-surface-700/70 text-[11px] font-semibold cursor-pointer transition-colors"
                                  title="Maghulog para sa araw na ito"
                                >
                                  + Hulog
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleTogglePaid(bill)}
                                  className={`px-2 py-1 rounded-lg text-[11px] font-semibold cursor-pointer transition-colors ${
                                    bill.status === 'PAID'
                                      ? 'bg-surface-800 hover:bg-surface-700 text-surface-300'
                                      : 'bg-emerald-600/80 hover:bg-emerald-500 text-white'
                                  }`}
                                  title={bill.status === 'PAID' ? 'Ibalik sa Unpaid' : 'Markahan bilang Nabayaran na'}
                                >
                                  {bill.status === 'PAID' ? 'Re-open' : 'Pay'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleOpenBillModal(bill)}
                                  className="p-1 rounded-lg text-surface-400 hover:text-surface-200 hover:bg-surface-800 cursor-pointer"
                                  title="I-edit ang Bill"
                                >
                                  ✏️
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteBill(bill.id, bill.name)}
                                  className="p-1 rounded-lg text-danger-400 hover:text-danger-300 hover:bg-danger-500/10 cursor-pointer"
                                  title="Tanggalin ang Bill"
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
              </>
            )}

            {/* Collapsible Daily Sinking Matrix (Days 1 to 31) */}
            <div className="border-t border-surface-700/70 bg-surface-900/90 p-2 sm:p-2.5 flex-shrink-0">
              <button
                type="button"
                onClick={() => setIsMatrixOpen(prev => !prev)}
                className="w-full flex items-center justify-between text-xs font-bold text-surface-200 hover:text-primary-400 transition-colors cursor-pointer py-0.5"
              >
                <div className="flex items-center gap-1.5">
                  <span>📅</span>
                  <span>31-Day Sinking Matrix (Days 1–{daysInMonth})</span>
                  <span className="text-[10px] text-surface-500 font-normal hidden sm:inline">• I-click ang kahit anong araw para i-adjust ang hulog</span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-surface-800 border border-surface-700 text-surface-300 font-medium shrink-0 ml-1">
                  {isMatrixOpen ? 'Itago ▲' : 'Buksan Calendar ▼'}
                </span>
              </button>

              {isMatrixOpen && (
                <div className="overflow-x-auto no-scrollbar pt-2 pb-1 mt-1 border-t border-surface-800/80 animate-fade-in">
                  <div className="inline-flex flex-col gap-1.5 min-w-full">
                    {bills.map(bill => (
                      <div key={bill.id} className="flex items-center gap-1.5 text-xs">
                        <span className="w-24 truncate font-semibold text-surface-300 shrink-0 text-[11px]" title={bill.name}>
                          {bill.name}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
                            const val = bill.daily_allocations[day] || 0;
                            const isToday = new Date().getDate() === day && new Date().toISOString().slice(0, 7) === selectedMonth;

                            return (
                              <button
                                key={day}
                                type="button"
                                onClick={() => handleOpenQuickAlloc(bill, day)}
                                className={`w-7 h-7 rounded flex flex-col items-center justify-center text-[9px] font-bold transition-all cursor-pointer border ${
                                  val > 0
                                    ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30'
                                    : isToday
                                    ? 'bg-primary-950/40 border-primary-500/50 text-primary-300 hover:bg-primary-900/40'
                                    : 'bg-surface-800/80 border-surface-700/50 text-surface-400 hover:bg-surface-700/60 hover:text-surface-200'
                                }`}
                                title={`Day ${day}: ${val > 0 ? formatCurrency(val) : '₱0'}`}
                              >
                                <span>{day}</span>
                                {val > 0 && <span className="text-[7px] leading-none text-emerald-400">✓</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Pinned Card Footer */}
            <div className="flex-shrink-0 px-3 py-2 bg-surface-900 border-t border-surface-700/70 flex items-center justify-between text-xs flex-nowrap gap-2">
              <span className="text-surface-400 text-[11px]">
                Bills: <strong className="text-surface-100">{bills.length}</strong> • Daily Sinking Goal:{' '}
                <strong className="text-primary-400 font-bold">{formatCurrency(billsSummary.dailyTargetTotal)}</strong>
              </span>
              <span className="text-surface-400 text-[11px]">
                Total Remaining:{' '}
                <strong className="text-amber-400 font-bold">{formatCurrency(billsSummary.remaining)}</strong>
              </span>
            </div>
          </div>
        </>
      )}

      {/* ============================================================== */}
      {/* TAB 2: INITIAL CAPITAL & RETURN ON INVESTMENT (ROI) */}
      {/* ============================================================== */}
      {activeTab === 'roi' && (
        <>
          {/* Hero ROI Overview Banner */}
          <div className="p-3.5 sm:p-5 rounded-xl bg-gradient-to-br from-surface-900 via-surface-900 to-surface-850 border border-surface-700/70 shadow-lg flex-shrink-0">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 sm:gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl sm:text-2xl">🎯</span>
                  <h2 className="text-base sm:text-xl font-black text-surface-50 tracking-tight">
                    Initial Capital & ROI Break-Even Tracker
                  </h2>
                </div>
                <p className="text-xs text-surface-400 mt-1 max-w-xl">
                  Sinusubaybayan dito kung magkano na sa inyong paunang puhunan ang nabawi mula sa pinagsama-samang Net Profit ng benta.
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleOpenCapitalModal}
                  className="px-3 py-1.5 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-200 border border-surface-700/80 text-xs font-bold transition-colors cursor-pointer whitespace-nowrap shadow-xs"
                >
                  ⚙️ Configure Capital
                </button>
              </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 sm:gap-3 mt-3">
              <div className="p-2 sm:p-3 rounded-xl bg-surface-800/80 border border-surface-700/60 min-w-0 flex flex-col justify-between">
                <span className="text-[9px] sm:text-[11px] text-surface-400 font-semibold uppercase truncate">Initial Capital</span>
                <p className="text-xs sm:text-xl font-black text-surface-100 mt-0.5 truncate">
                  {formatCurrency(roiData?.initialCapital || 0)}
                </p>
                <span className="text-[8px] sm:text-[10px] text-surface-500 mt-0.5 truncate">Puhunan sa pagtayo</span>
              </div>

              <div className="p-2 sm:p-3 rounded-xl bg-surface-800/80 border border-surface-700/60 min-w-0 flex flex-col justify-between">
                <span className="text-[9px] sm:text-[11px] text-surface-400 font-semibold uppercase truncate">Net Recovered</span>
                <p className="text-xs sm:text-xl font-black text-emerald-400 mt-0.5 truncate">
                  {formatCurrency(roiData?.totalNetProfit || 0)}
                </p>
                <span className="text-[8px] sm:text-[10px] text-emerald-400/80 mt-0.5 truncate">
                  {roiData?.roiPercent || 0}% of Capital
                </span>
              </div>

              <div className="p-2 sm:p-3 rounded-xl bg-surface-800/80 border border-surface-700/60 min-w-0 flex flex-col justify-between">
                <span className="text-[9px] sm:text-[11px] text-surface-400 font-semibold uppercase truncate">Kulang sa ROI</span>
                <p className="text-xs sm:text-xl font-black text-amber-400 mt-0.5 truncate">
                  {formatCurrency(roiData?.remainingCapital || 0)}
                </p>
                <span className="text-[8px] sm:text-[10px] text-surface-500 mt-0.5 truncate">Natitirang babawiin</span>
              </div>

              <div className="p-2 sm:p-3 rounded-xl bg-primary-950/40 border border-primary-500/30 min-w-0 flex flex-col justify-between">
                <span className="text-[9px] sm:text-[11px] text-primary-300 font-semibold uppercase truncate">Days to 100% ROI</span>
                <p className="text-xs sm:text-xl font-black text-primary-400 mt-0.5 truncate">
                  {roiData?.estimatedDaysToBreakEven > 0 ? `${roiData.estimatedDaysToBreakEven} araw` : 'ROI Achieved! 🎉'}
                </p>
                <span className="text-[8px] sm:text-[10px] text-primary-400/70 mt-0.5 truncate">
                  ~{formatCurrency(roiData?.avgDailyProfit || 0)}/araw net
                </span>
              </div>
            </div>

            {/* Overall ROI Visual Progress Bar */}
            <div className="mt-3 pt-2.5 border-t border-surface-700/60">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-bold text-surface-200 text-[11px] sm:text-xs">ROI Progress</span>
                <span className="font-extrabold text-emerald-400 text-xs sm:text-sm">{roiData?.roiPercent || 0}%</span>
              </div>
              <div className="w-full bg-surface-800 rounded-full h-2.5 overflow-hidden border border-surface-700/50">
                <div
                  className="bg-gradient-to-r from-emerald-500 to-primary-500 h-full rounded-full transition-all duration-500"
                  style={{ width: `${roiData?.roiPercent || 0}%` }}
                />
              </div>
            </div>
          </div>

          {/* Itemized Capital Expense Breakdown Card */}
          <div className="flex-1 min-h-0 bg-surface-900/60 rounded-xl border border-surface-700/60 flex flex-col overflow-hidden shadow-sm">
            <div className="p-2.5 sm:p-3 bg-surface-900 border-b border-surface-700/60 flex items-center justify-between flex-shrink-0">
              <div>
                <span className="text-xs sm:text-sm font-bold text-surface-100">
                  Capital Breakdown ({roiData?.items?.length || 0} items)
                </span>
                <p className="text-[10px] sm:text-[11px] text-surface-500 hidden sm:block">
                  Kagamitan, freezer, ihawan, paunang stock, at security deposit
                </p>
              </div>

              <button
                type="button"
                onClick={() => setCapitalItemModalOpen(true)}
                className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold transition-colors cursor-pointer shrink-0 shadow-xs"
              >
                <span>+</span>
                <span>Add Item</span>
              </button>
            </div>

            {/* Mobile Cards for Capital Items (< md) */}
            <div className="md:hidden flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
              {(roiData?.items || []).map((item: CapitalItem) => (
                <div key={item.id} className="p-2 rounded-xl bg-surface-900/90 border border-surface-700/60 shadow-xs flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-surface-100 truncate">{item.item_name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[9px] text-surface-400">
                      <span className="px-1.5 py-0.2 rounded bg-surface-800 text-surface-300 border border-surface-700">{item.category}</span>
                      <span>•</span>
                      <span>{item.date_invested}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-extrabold text-surface-100">{formatCurrency(item.amount)}</span>
                    <button
                      type="button"
                      onClick={() => handleDeleteCapitalItem(item.id)}
                      className="p-1 rounded text-danger-400 hover:text-danger-300 bg-surface-800 cursor-pointer text-xs"
                      title="Tanggalin"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Table for Capital Items (>= md) */}
            <div className="hidden md:block flex-1 min-h-0 overflow-y-auto overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[550px]">
                <thead className="sticky top-0 bg-surface-900 border-b border-surface-700/70 z-10 text-xs text-surface-400 uppercase tracking-wider">
                  <tr>
                    <th className="px-3 py-2">Item Description</th>
                    <th className="px-2 py-2">Category</th>
                    <th className="px-2 py-2">Date Invested</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-2 py-2 text-center w-16">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-700/30 text-xs">
                  {(roiData?.items || []).map((item: CapitalItem) => (
                    <tr key={item.id} className="hover:bg-surface-800/40 transition-colors">
                      <td className="px-3 py-2.5 font-semibold text-surface-100">
                        {item.item_name}
                        {item.notes && <span className="block text-[10px] text-surface-500 font-normal">{item.notes}</span>}
                      </td>
                      <td className="px-2 py-2.5">
                        <span className="px-2 py-0.5 rounded-full bg-surface-800 text-surface-300 text-[10px] font-medium border border-surface-700">
                          {item.category}
                        </span>
                      </td>
                      <td className="px-2 py-2.5 text-surface-400 whitespace-nowrap">{item.date_invested}</td>
                      <td className="px-3 py-2.5 text-right font-bold text-surface-100 whitespace-nowrap">
                        {formatCurrency(item.amount)}
                      </td>
                      <td className="px-2 py-2.5 text-center">
                        <button
                          type="button"
                          onClick={() => handleDeleteCapitalItem(item.id)}
                          className="p-1 rounded text-danger-400 hover:text-danger-300 hover:bg-danger-500/10 cursor-pointer"
                          title="Tanggalin"
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Table Footer */}
            <div className="p-2.5 px-4 bg-surface-900 border-t border-surface-700/60 flex items-center justify-between text-xs flex-shrink-0">
              <span className="text-surface-400 text-[11px]">
                Items Sum:{' '}
                <strong className="text-surface-200">
                  {formatCurrency((roiData?.items || []).reduce((s: number, i: CapitalItem) => s + i.amount, 0))}
                </strong>
              </span>
              <span className="text-surface-400 text-[11px]">
                Initial Capital Setting:{' '}
                <strong className="text-emerald-400 font-bold">{formatCurrency(roiData?.initialCapital || 0)}</strong>
              </span>
            </div>
          </div>
        </>
      )}

      {/* ============================================================== */}
      {/* MODALS */}
      {/* ============================================================== */}

      {/* 1. Add / Edit Bill Modal */}
      {billModalOpen && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-surface-900 border border-surface-700 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-slide-up">
            <div className="p-3.5 sm:p-4 border-b border-surface-700 flex items-center justify-between">
              <h3 className="text-sm sm:text-base font-bold text-surface-50">
                {editingBill ? 'Edit Monthly Bill' : 'Magdagdag ng Monthly Bill'}
              </h3>
              <button
                type="button"
                onClick={() => setBillModalOpen(false)}
                className="text-surface-400 hover:text-surface-200 text-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveBill} className="p-3.5 sm:p-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-surface-300 mb-1">Pangalan ng Bill / Obligasyon *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rent, Kuryente, Tubig, WiFi, Gasul"
                  value={billForm.name}
                  onChange={e => setBillForm(f => ({ ...f, name: e.target.value }))}
                  className="form-input text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-surface-300 mb-1">Daily Hulog Goal (₱) *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    placeholder="e.g. 400"
                    onFocus={e => e.target.select()}
                    onClick={e => (e.target as HTMLInputElement).select()}
                    value={billForm.daily_obligation}
                    onChange={e => setBillForm(f => ({ ...f, daily_obligation: e.target.value }))}
                    className="form-input text-sm"
                  />
                  <span className="text-[10px] text-surface-500 mt-0.5 block">Target itabi araw-araw</span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-surface-300 mb-1">Total Target Amount (₱) *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    placeholder="e.g. 7000"
                    onFocus={e => e.target.select()}
                    onClick={e => (e.target as HTMLInputElement).select()}
                    value={billForm.total_target_amount}
                    onChange={e => setBillForm(f => ({ ...f, total_target_amount: e.target.value }))}
                    className="form-input text-sm"
                  />
                  <span className="text-[10px] text-surface-500 mt-0.5 block">Kabuuan ng babayaran</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-surface-300 mb-1">Due Date (Opsyonal)</label>
                <input
                  type="date"
                  value={billForm.due_date}
                  min={SYSTEM_START_DATE}
                  onChange={e => {
                    const rawVal = e.target.value;
                    setBillForm(f => ({ ...f, due_date: rawVal && rawVal < SYSTEM_START_DATE ? SYSTEM_START_DATE : rawVal }));
                  }}
                  className="form-input text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-surface-300 mb-1">Notes / Paalala (Opsyonal)</label>
                <input
                  type="text"
                  placeholder="e.g. Bayaran bago ang ika-30 ng buwan"
                  value={billForm.notes}
                  onChange={e => setBillForm(f => ({ ...f, notes: e.target.value }))}
                  className="form-input text-sm"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-surface-700/60">
                <button
                  type="button"
                  onClick={() => setBillModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-xl bg-surface-800 text-surface-300 hover:bg-surface-700 text-xs font-semibold cursor-pointer"
                >
                  Kanselahin
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold shadow-md cursor-pointer"
                >
                  I-save ang Bill
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* 2. Quick Allocation Modal for Single Day */}
      {quickAllocModal && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-surface-900 border border-surface-700 rounded-2xl w-full max-w-xs shadow-2xl p-4 animate-slide-up">
            <h3 className="text-sm font-bold text-surface-100">
              Hulog para sa {quickAllocModal.bill.name}
            </h3>
            <p className="text-xs text-surface-400 mt-0.5">
              Day {quickAllocModal.day} ng {selectedMonth} (Daily Target: {formatCurrency(quickAllocModal.bill.daily_obligation)})
            </p>

            <div className="my-3">
              <label className="block text-xs font-semibold text-surface-300 mb-1">Halaga ng Itinabi (₱)</label>
              <input
                type="number"
                min="0"
                autoFocus
                onFocus={e => e.target.select()}
                value={quickAllocAmount}
                onChange={e => setQuickAllocAmount(e.target.value)}
                placeholder="0"
                className="form-input text-base font-bold text-center"
              />
              <span className="text-[10px] text-surface-500 mt-1 block text-center">
                I-enter ang 0 upang i-reset o alisin ang hulog sa araw na ito.
              </span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-surface-700/60">
              <button
                type="button"
                onClick={() => setQuickAllocModal(null)}
                className="px-3 py-1.5 rounded-xl bg-surface-800 text-surface-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveQuickAlloc}
                className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
              >
                I-save
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 3. Initial Capital Config Modal */}
      {capitalModalOpen && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-surface-900 border border-surface-700 rounded-2xl w-full max-w-sm shadow-2xl p-4 animate-slide-up">
            <h3 className="text-sm sm:text-base font-bold text-surface-100">
              Configure Initial Capital (ROI Goal)
            </h3>
            <p className="text-xs text-surface-400 mt-0.5">
              I-set ang kabuuang puhunan na inilabas upang matukoy ang break-even date.
            </p>

            <form onSubmit={handleSaveCapitalConfig} className="space-y-3 mt-3">
              <div>
                <label className="block text-xs font-semibold text-surface-300 mb-1">Kabuuang Initial Capital (₱) *</label>
                <input
                  type="number"
                  min="0"
                  required
                  onFocus={e => e.target.select()}
                  onClick={e => (e.target as HTMLInputElement).select()}
                  value={capitalForm.total_capital}
                  onChange={e => setCapitalForm(f => ({ ...f, total_capital: e.target.value }))}
                  placeholder="e.g. 50000"
                  className="form-input text-sm font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-surface-300 mb-1">Petsa ng Simula ng Negosyo *</label>
                <input
                  type="date"
                  required
                  value={capitalForm.business_start_date}
                  min={SYSTEM_START_DATE}
                  onChange={e => {
                    const rawVal = e.target.value;
                    setCapitalForm(f => ({ ...f, business_start_date: rawVal && rawVal < SYSTEM_START_DATE ? SYSTEM_START_DATE : rawVal }));
                  }}
                  className="form-input text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-surface-300 mb-1">Notes / Description (Opsyonal)</label>
                <input
                  type="text"
                  value={capitalForm.notes}
                  onChange={e => setCapitalForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="e.g. Puhunan sa ihawan, freezer, at security deposit"
                  className="form-input text-sm"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-surface-700/60">
                <button
                  type="button"
                  onClick={() => setCapitalModalOpen(false)}
                  className="px-3 py-1.5 rounded-xl bg-surface-800 text-surface-300 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
                >
                  I-save ang Capital
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* 4. Add Capital Item Modal */}
      {capitalItemModalOpen && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-surface-900 border border-surface-700 rounded-2xl w-full max-w-sm shadow-2xl p-4 animate-slide-up">
            <h3 className="text-sm sm:text-base font-bold text-surface-100">Magdagdag ng Capital Item</h3>
            <p className="text-xs text-surface-400 mt-0.5">Talaan ng kagamitan, freezer, o deposit.</p>

            <form onSubmit={handleSaveCapitalItem} className="space-y-3 mt-3">
              <div>
                <label className="block text-xs font-semibold text-surface-300 mb-1">Item Description *</label>
                <input
                  type="text"
                  required
                  value={itemForm.item_name}
                  onChange={e => setItemForm(f => ({ ...f, item_name: e.target.value }))}
                  placeholder="e.g. Chest Freezer, BBQ Grill, Signboard"
                  className="form-input text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-surface-300 mb-1">Halaga (₱) *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    onFocus={e => e.target.select()}
                    onClick={e => (e.target as HTMLInputElement).select()}
                    value={itemForm.amount}
                    onChange={e => setItemForm(f => ({ ...f, amount: e.target.value }))}
                    placeholder="e.g. 15000"
                    className="form-input text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-surface-300 mb-1">Kategorya</label>
                  <select
                    value={itemForm.category}
                    onChange={e => setItemForm(f => ({ ...f, category: e.target.value }))}
                    className="form-input text-sm"
                  >
                    <option value="Equipment">Equipment</option>
                    <option value="Deposit">Deposit</option>
                    <option value="Stock">Stock</option>
                    <option value="Renovation">Renovation</option>
                    <option value="Permits">Permits</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-surface-300 mb-1">Petsa ng Pagbili</label>
                <input
                  type="date"
                  value={itemForm.date_invested}
                  min={SYSTEM_START_DATE}
                  onChange={e => {
                    const rawVal = e.target.value;
                    setItemForm(f => ({ ...f, date_invested: rawVal && rawVal < SYSTEM_START_DATE ? SYSTEM_START_DATE : rawVal }));
                  }}
                  className="form-input text-sm"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-surface-700/60">
                <button
                  type="button"
                  onClick={() => setCapitalItemModalOpen(false)}
                  className="px-3 py-1.5 rounded-xl bg-surface-800 text-surface-300 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold cursor-pointer"
                >
                  Idagdag
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
