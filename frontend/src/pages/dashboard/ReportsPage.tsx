import { useState, useEffect, useMemo, useCallback } from 'react';
import { formatCurrency } from '../../utils/currency';
import { fetchProfitReport, fetchExpenses } from '../../api/endpoints';
import { getAllDailyClosings } from '../../db/closingRepository';
import { getAllExpenses } from '../../db/expenseRepository';
import type { Expense } from '../../types/inventory';
import type { DailyClosing } from '../../types/closing';

export function ReportsPage() {
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [loading, setLoading] = useState(true);
  const [closings, setClosings] = useState<DailyClosing[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [serverProfit, setServerProfit] = useState<{ total_revenue: number; total_cost: number; gross_profit: number } | null>(null);

  // Responsive & Pagination States
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('table');
  const [mobileTab, setMobileTab] = useState<'daily' | 'expenses'>('daily');
  const [pageSize, setPageSize] = useState<number>(7);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [filterActiveOnly, setFilterActiveOnly] = useState<boolean>(false);

  const loadReportData = useCallback(async (monthStr: string) => {
    setLoading(true);
    try {
      const startDate = `${monthStr}-01`;
      // calculate last day of month
      const [year, month] = monthStr.split('-').map(Number);
      const lastDay = new Date(year, month, 0).getDate();
      const endDate = `${monthStr}-${String(lastDay).padStart(2, '0')}`;

      // 1. Fetch server profit report if available
      try {
        const profitRes = await fetchProfitReport(startDate, endDate);
        setServerProfit(profitRes.data);
      } catch {
        setServerProfit(null);
      }

      // 2. Fetch expenses for this month (server + offline IndexedDB)
      try {
        const expRes = await fetchExpenses({ date_from: startDate, date_to: endDate, per_page: 500 });
        setExpenses(expRes.data);
      } catch {
        const localExp = await getAllExpenses();
        const filtered = localExp.filter(e => e.expense_date.startsWith(monthStr));
        setExpenses(filtered);
      }

      // 3. Load daily closings from IndexedDB
      const allClosings = await getAllDailyClosings();
      const monthClosings = allClosings.filter(c => c.date.startsWith(monthStr));
      setClosings(monthClosings);
    } catch (err) {
      console.error('Failed to load reports data', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReportData(selectedMonth);
    setCurrentPage(1);
  }, [selectedMonth, loadReportData]);

  // Aggregate daily calendar data for all days of the month (1 to 31)
  const calendarDays = useMemo(() => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const totalDaysInMonth = new Date(year, month, 0).getDate();
    const days = [];

    // Map closings and expenses by date
    const closingsByDate = new Map<string, DailyClosing>();
    closings.forEach(c => closingsByDate.set(c.date, c));

    const expensesByDate = new Map<string, number>();
    expenses.forEach(e => {
      expensesByDate.set(e.expense_date, (expensesByDate.get(e.expense_date) || 0) + Number(e.amount));
    });

    for (let d = 1; d <= totalDaysInMonth; d++) {
      const dateStr = `${selectedMonth}-${String(d).padStart(2, '0')}`;
      const closing = closingsByDate.get(dateStr);
      const dayOpex = expensesByDate.get(dateStr) || 0;

      const sales = closing ? closing.total_revenue : 0;
      const cogs = closing ? closing.total_cogs : 0;
      const grossProfit = closing ? closing.total_gross_profit : 0;
      const spoilageLoss = closing ? closing.total_spoilage_loss : 0;
      const netIncome = grossProfit - (dayOpex + spoilageLoss);
      const cashOnHand = closing ? (closing.actual_cash_on_hand ?? closing.expected_cash_on_hand ?? 0) : 0;

      days.push({
        dayNumber: d,
        date: dateStr,
        sales,
        cogs,
        grossProfit,
        opex: dayOpex,
        spoilageLoss,
        netIncome,
        cashOnHand,
        hasActivity: sales > 0 || dayOpex > 0 || spoilageLoss > 0 || cashOnHand > 0,
      });
    }

    return days;
  }, [selectedMonth, closings, expenses]);

  // Grand totals for the month
  const monthSummary = useMemo(() => {
    let totalSales = calendarDays.reduce((s, d) => s + d.sales, 0);
    let totalCogs = calendarDays.reduce((s, d) => s + d.cogs, 0);
    let totalGrossProfit = totalSales - totalCogs;

    // Fallback to server profit report if no local closings recorded yet for this month
    if (totalSales === 0 && serverProfit && serverProfit.total_revenue > 0) {
      totalSales = serverProfit.total_revenue;
      totalCogs = serverProfit.total_cost;
      totalGrossProfit = serverProfit.gross_profit;
    }

    const totalOpex = calendarDays.reduce((s, d) => s + d.opex, 0);
    const totalSpoilage = calendarDays.reduce((s, d) => s + d.spoilageLoss, 0);
    const totalNetIncome = totalGrossProfit - (totalOpex + totalSpoilage);
    const margin = totalSales > 0 ? (totalNetIncome / totalSales) * 100 : 0;

    return {
      totalSales,
      totalCogs,
      totalGrossProfit,
      totalOpex,
      totalSpoilage,
      totalNetIncome,
      margin: margin.toFixed(1),
    };
  }, [calendarDays, serverProfit]);

  // Filtered & Paginated Days
  const displayedDays = useMemo(() => {
    return filterActiveOnly ? calendarDays.filter(d => d.hasActivity) : calendarDays;
  }, [calendarDays, filterActiveOnly]);

  const totalPages = Math.ceil(displayedDays.length / pageSize) || 1;
  const paginatedDays = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return displayedDays.slice(start, start + pageSize);
  }, [displayedDays, currentPage, pageSize]);

  // Group expenses by category
  const expensesByCategory = useMemo(() => {
    const map = new Map<string, number>();
    expenses.forEach(e => {
      map.set(e.category, (map.get(e.category) || 0) + Number(e.amount));
    });
    return Array.from(map.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [expenses]);

  const handlePrint = () => {
    window.print();
  };

  const handleExportCSV = () => {
    const headers = ['Day', 'Date', 'Sales Revenue', 'COGS', 'Gross Profit', 'OPEX', 'Spoilage Loss', 'Net Income', 'Cash On-Hand'];
    const rows = calendarDays.map(d => [
      d.dayNumber,
      d.date,
      d.sales.toFixed(2),
      d.cogs.toFixed(2),
      d.grossProfit.toFixed(2),
      d.opex.toFixed(2),
      d.spoilageLoss.toFixed(2),
      d.netIncome.toFixed(2),
      d.cashOnHand.toFixed(2),
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Monthly_P&L_Report_${selectedMonth}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-2.5 sm:space-y-3.5 animate-fade-in pb-16 lg:pb-0">
      {/* Header Bar */}
      <div className="flex-shrink-0 flex items-center justify-between gap-2.5">
        <div className="hidden lg:block">
          <h1 className="text-xl sm:text-2xl font-bold text-surface-50">Financial Reports & P&L</h1>
          <p className="text-surface-400 mt-0.5 text-xs sm:text-sm">
            Buwanang Income Statement, Cost of Goods Sold, at Malinis na Kita (Net Profit)
          </p>
        </div>

        {/* Month Selector - Clean full width on mobile without button clutter */}
        <div className="flex items-center justify-between w-full lg:w-auto gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-surface-300">📅 Buwan:</span>
            <span className="text-[10px] text-surface-400 hidden sm:inline">(Month)</span>
          </div>
          <input
            type="month"
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            className="text-xs sm:text-sm py-1.5 px-3 rounded-xl bg-surface-900 border border-surface-700 text-surface-100 font-semibold cursor-pointer focus:outline-none focus:border-primary-500 shadow-xs w-44 shrink-0"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex-1 min-h-0 flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="w-9 h-9 border-3 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
            <p className="text-surface-400 text-xs">Kinakalkula ang ulat sa pananalapi...</p>
          </div>
        </div>
      ) : (
        <>
          {/* Summary KPI Cards - Mobile Compact View (sm:hidden) */}
          <div className="sm:hidden flex-shrink-0 flex flex-col gap-1.5">
            {/* Row 1: Hero Cards */}
            <div className="grid grid-cols-2 gap-1.5">
              <div className="p-2.5 rounded-xl bg-surface-800/90 border border-surface-700/70 shadow-sm flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-surface-400 uppercase tracking-wider">Gross Sales</span>
                  <span className="text-[9px] text-surface-500 font-medium">Benta</span>
                </div>
                <p className="text-base font-extrabold text-surface-100 mt-1">
                  {formatCurrency(monthSummary.totalSales)}
                </p>
              </div>

              <div className="p-2.5 rounded-xl bg-primary-950/60 border border-primary-500/40 shadow-sm flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-primary-300 uppercase tracking-wider">Net Income</span>
                  <span className="text-[9px] font-bold text-primary-300 bg-primary-900/60 px-1 py-0.2 rounded border border-primary-600/30">
                    {monthSummary.margin}%
                  </span>
                </div>
                <p className="text-base font-black text-primary-400 mt-1">
                  {formatCurrency(monthSummary.totalNetIncome)}
                </p>
              </div>
            </div>

            {/* Row 2: 4 Micro Metric Cards */}
            <div className="grid grid-cols-4 gap-1.5">
              <div className="p-1.5 rounded-lg bg-surface-800/80 border border-surface-700/50 text-center">
                <span className="text-[9px] font-medium text-amber-400/90 uppercase block truncate">COGS</span>
                <p className="text-xs font-bold text-amber-300 mt-0.5 truncate">{formatCurrency(monthSummary.totalCogs)}</p>
              </div>
              <div className="p-1.5 rounded-lg bg-surface-800/80 border border-surface-700/50 text-center">
                <span className="text-[9px] font-medium text-emerald-400/90 uppercase block truncate">Gross Prof.</span>
                <p className="text-xs font-bold text-emerald-300 mt-0.5 truncate">{formatCurrency(monthSummary.totalGrossProfit)}</p>
              </div>
              <div className="p-1.5 rounded-lg bg-surface-800/80 border border-surface-700/50 text-center">
                <span className="text-[9px] font-medium text-rose-400/90 uppercase block truncate">OPEX</span>
                <p className="text-xs font-bold text-rose-300 mt-0.5 truncate">{formatCurrency(monthSummary.totalOpex)}</p>
              </div>
              <div className="p-1.5 rounded-lg bg-surface-800/80 border border-surface-700/50 text-center">
                <span className="text-[9px] font-medium text-danger-400/90 uppercase block truncate">Spoilage</span>
                <p className="text-xs font-bold text-danger-300 mt-0.5 truncate">{formatCurrency(monthSummary.totalSpoilage)}</p>
              </div>
            </div>
          </div>

          {/* Summary KPI Cards - Tablet & Desktop View (hidden sm:grid) */}
          <div className="hidden sm:grid sm:grid-cols-3 lg:grid-cols-6 gap-2.5 flex-shrink-0">
            <div className="p-3 rounded-xl bg-surface-800/80 border border-surface-700/60 shadow-sm flex flex-col justify-between">
              <div>
                <p className="text-xs text-surface-400 font-medium">Sales Revenue</p>
                <p className="text-lg font-extrabold text-surface-100 mt-0.5">
                  {formatCurrency(monthSummary.totalSales)}
                </p>
              </div>
              <p className="text-[11px] text-surface-500 mt-1 truncate">Kabuuang Gross Benta</p>
            </div>

            <div className="p-3 rounded-xl bg-surface-800/80 border border-surface-700/60 shadow-sm flex flex-col justify-between">
              <div>
                <p className="text-xs text-surface-400 font-medium">Cost of Goods (COGS)</p>
                <p className="text-lg font-extrabold text-amber-400 mt-0.5">
                  {formatCurrency(monthSummary.totalCogs)}
                </p>
              </div>
              <p className="text-[11px] text-surface-500 mt-1 truncate">Puhunan ng mga naibenta</p>
            </div>

            <div className="p-3 rounded-xl bg-surface-800/80 border border-surface-700/60 shadow-sm flex flex-col justify-between">
              <div>
                <p className="text-xs text-surface-400 font-medium">Gross Profit</p>
                <p className="text-lg font-extrabold text-emerald-400 mt-0.5">
                  {formatCurrency(monthSummary.totalGrossProfit)}
                </p>
              </div>
              <p className="text-[11px] text-surface-500 mt-1 truncate">Sales minus COGS</p>
            </div>

            <div className="p-3 rounded-xl bg-surface-800/80 border border-surface-700/60 shadow-sm flex flex-col justify-between">
              <div>
                <p className="text-xs text-surface-400 font-medium">Operating Expenses</p>
                <p className="text-lg font-extrabold text-rose-400 mt-0.5">
                  {formatCurrency(monthSummary.totalOpex)}
                </p>
              </div>
              <p className="text-[11px] text-surface-500 mt-1 truncate">Uling, mantika, bills</p>
            </div>

            <div className="p-3 rounded-xl bg-surface-800/80 border border-surface-700/60 shadow-sm flex flex-col justify-between">
              <div>
                <p className="text-xs text-surface-400 font-medium">Spoilage Losses</p>
                <p className="text-lg font-extrabold text-danger-400 mt-0.5">
                  {formatCurrency(monthSummary.totalSpoilage)}
                </p>
              </div>
              <p className="text-[11px] text-surface-500 mt-1 truncate">Nasunog / nasayang</p>
            </div>

            <div className="p-3 rounded-xl bg-primary-950/40 border border-primary-500/30 shadow-sm flex flex-col justify-between">
              <div>
                <p className="text-xs text-primary-300 font-medium">NET INCOME</p>
                <p className="text-lg font-black text-primary-400 mt-0.5">
                  {formatCurrency(monthSummary.totalNetIncome)}
                </p>
              </div>
              <p className="text-[11px] text-primary-400/90 mt-1 truncate">{monthSummary.margin}% net profit margin</p>
            </div>
          </div>

          {/* Action Toolbar Below Summary Cards */}
          <div className="flex items-center justify-between gap-2 flex-shrink-0">
            {/* Mobile/Tablet Section Tab Switcher (lg:hidden) */}
            <div className="lg:hidden flex items-center bg-surface-900/80 p-0.5 rounded-xl border border-surface-700/60 shrink-0">
              <button
                onClick={() => setMobileTab('daily')}
                className={`px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer text-center whitespace-nowrap ${
                  mobileTab === 'daily'
                    ? 'bg-primary-600 text-white shadow-xs'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                📅 Daily (1-31)
              </button>
              <button
                onClick={() => setMobileTab('expenses')}
                className={`px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer text-center whitespace-nowrap ${
                  mobileTab === 'expenses'
                    ? 'bg-primary-600 text-white shadow-xs'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                💸 Gastos ({expensesByCategory.length})
              </button>
            </div>

            {/* Desktop Section Header (hidden on mobile, visible on lg) */}
            <div className="hidden lg:flex items-center gap-2">
              <span className="text-sm font-bold text-surface-200">
                Detailed Statement & Analysis
              </span>
              <span className="text-xs text-surface-400">
                ({selectedMonth})
              </span>
            </div>

            {/* Export & Print Buttons */}
            <div className="flex items-center gap-1.5 sm:gap-2 flex-nowrap shrink-0 ml-auto">
              <button
                onClick={handleExportCSV}
                className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-200 border border-surface-700/80 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 shadow-xs"
                title="Export monthly CSV"
              >
                <span>📥</span> <span className="hidden xs:inline">Export</span> <span>CSV</span>
              </button>
              <button
                onClick={handlePrint}
                className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-semibold shadow-xs shadow-primary-600/20 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                title="Print report"
              >
                <span>🖨️</span> <span>Print</span>
              </button>
            </div>
          </div>

          {/* Main Layout: Daily Statement & Category Breakdown */}
          <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-4 gap-3 sm:gap-4">
            {/* Daily P&L Statement (Always visible on desktop; on mobile visible if mobileTab === 'daily') */}
            <div className={`lg:col-span-3 bg-surface-800/50 rounded-xl border border-surface-700/50 flex flex-col overflow-hidden shadow-sm ${mobileTab === 'daily' ? 'flex' : 'hidden lg:flex'}`}>
              {/* Table Header Bar with View Switcher */}
              <div className="px-3 py-2 sm:px-4 sm:py-2.5 bg-surface-900/70 border-b border-surface-700/50 flex items-center justify-between gap-2 flex-nowrap shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <h3 className="text-xs sm:text-sm font-bold text-surface-100 flex items-center gap-1.5 truncate">
                    <span>📅</span> <span>Araw-Araw na Kita at Gastos</span>
                  </h3>
                  <span className="text-[10px] sm:text-xs text-surface-400 hidden sm:inline whitespace-nowrap">
                    Month of {selectedMonth}
                  </span>
                </div>

                {/* View switcher: Cards vs Table */}
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

              {/* Table or Cards Content */}
              <div className="flex-1 min-h-0 overflow-y-auto">
                {viewMode === 'cards' ? (
                  /* Cards View - 100% Mobile Friendly */
                  <div className="p-2 sm:p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {paginatedDays.length === 0 ? (
                      <div className="col-span-full py-8 text-center text-xs text-surface-400">
                        Walang datos sa piniling filter
                      </div>
                    ) : (
                      paginatedDays.map(day => (
                        <div
                          key={day.dayNumber}
                          className={`p-2.5 rounded-xl border transition-colors ${
                            day.hasActivity
                              ? 'bg-surface-850 border-surface-700/70 shadow-xs'
                              : 'bg-surface-900/40 border-surface-800/50 opacity-60'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-xs font-bold text-surface-200 whitespace-nowrap">
                                Day {day.dayNumber}
                              </span>
                              <span className="text-[10px] text-surface-500 whitespace-nowrap">
                                ({day.date.slice(5)})
                              </span>
                              {day.hasActivity && (
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                              )}
                            </div>
                            <div className="text-right whitespace-nowrap shrink-0">
                              <span className="text-[10px] text-surface-400 uppercase mr-1">Net:</span>
                              <span
                                className={`text-xs font-bold ${
                                  day.hasActivity
                                    ? day.netIncome >= 0
                                      ? 'text-primary-400 font-black'
                                      : 'text-danger-400 font-black'
                                    : 'text-surface-500'
                                }`}
                              >
                                {day.hasActivity ? formatCurrency(day.netIncome) : '—'}
                              </span>
                            </div>
                          </div>

                          {day.hasActivity ? (
                            <>
                              <div className="grid grid-cols-4 gap-1 pt-2 mt-1.5 border-t border-surface-800/90 text-[10px]">
                                <div>
                                  <span className="text-surface-500 block truncate">Sales</span>
                                  <span className="font-semibold text-surface-100 block truncate">{formatCurrency(day.sales)}</span>
                                </div>
                                <div>
                                  <span className="text-amber-400/90 block truncate">COGS</span>
                                  <span className="font-semibold text-amber-300 block truncate">{formatCurrency(day.cogs)}</span>
                                </div>
                                <div>
                                  <span className="text-rose-400/90 block truncate">OPEX</span>
                                  <span className="font-semibold text-rose-300 block truncate">{formatCurrency(day.opex)}</span>
                                </div>
                                <div>
                                  <span className="text-emerald-400/90 block truncate">GP</span>
                                  <span className="font-semibold text-emerald-300 block truncate">{formatCurrency(day.grossProfit)}</span>
                                </div>
                              </div>
                              {day.cashOnHand > 0 && (
                                <div className="mt-1.5 pt-1.5 border-t border-surface-800/60 flex items-center justify-between text-[10px]">
                                  <span className="text-surface-400 flex items-center gap-1"><span>💵</span> Cash On-Hand:</span>
                                  <span className="font-bold text-sky-400">{formatCurrency(day.cashOnHand)}</span>
                                </div>
                              )}
                            </>
                          ) : (
                            <p className="text-[10px] text-surface-500 mt-1 italic">Walang transaksyon o gastos</p>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                ) : (
                  /* Responsive Table View - Zero Horizontal Overflow */
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-surface-900 border-b border-surface-700/60 z-10 shadow-xs">
                      <tr>
                        <th className="px-2.5 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase whitespace-nowrap">
                          Day
                        </th>
                        <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-right whitespace-nowrap">
                          Sales
                        </th>
                        <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-right whitespace-nowrap hidden sm:table-cell">
                          COGS
                        </th>
                        <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-right whitespace-nowrap hidden md:table-cell">
                          Gross Profit
                        </th>
                        <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-right whitespace-nowrap hidden sm:table-cell">
                          OPEX
                        </th>
                        <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-right whitespace-nowrap hidden xl:table-cell">
                          Spoilage
                        </th>
                        <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-sky-400 uppercase text-right whitespace-nowrap hidden lg:table-cell">
                          Cash On-Hand
                        </th>
                        <th className="px-2.5 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-right whitespace-nowrap">
                          Net Income
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-700/30">
                      {paginatedDays.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="text-center py-8 text-xs text-surface-400">
                            Walang datos sa piniling filter
                          </td>
                        </tr>
                      ) : (
                        paginatedDays.map(day => (
                          <tr
                            key={day.dayNumber}
                            className={`hover:bg-surface-700/20 transition-colors ${
                              day.hasActivity ? 'bg-surface-800/15' : 'opacity-55'
                            }`}
                          >
                            <td className="px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs font-semibold text-surface-300 whitespace-nowrap">
                              Day {day.dayNumber}{' '}
                              <span className="text-[10px] text-surface-500 font-normal">
                                ({day.date.slice(5)})
                              </span>
                            </td>
                            <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-right text-xs text-surface-100 font-medium whitespace-nowrap">
                              {day.sales > 0 ? formatCurrency(day.sales) : '—'}
                            </td>
                            <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-right text-xs text-amber-400 whitespace-nowrap hidden sm:table-cell">
                              {day.cogs > 0 ? formatCurrency(day.cogs) : '—'}
                            </td>
                            <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-right text-xs text-emerald-400 font-semibold whitespace-nowrap hidden md:table-cell">
                              {day.grossProfit > 0 ? formatCurrency(day.grossProfit) : '—'}
                            </td>
                            <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-right text-xs text-rose-400 whitespace-nowrap hidden sm:table-cell">
                              {day.opex > 0 ? formatCurrency(day.opex) : '—'}
                            </td>
                            <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-right text-xs text-danger-400 whitespace-nowrap hidden xl:table-cell">
                              {day.spoilageLoss > 0 ? formatCurrency(day.spoilageLoss) : '—'}
                            </td>
                            <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-right text-xs font-semibold text-sky-400 whitespace-nowrap hidden lg:table-cell">
                              {day.cashOnHand > 0 ? formatCurrency(day.cashOnHand) : '—'}
                            </td>
                            <td className="px-2.5 sm:px-3 py-1.5 sm:py-2 text-right text-xs font-bold whitespace-nowrap">
                              {day.hasActivity ? (
                                <span
                                  className={
                                    day.netIncome >= 0 ? 'text-primary-400 font-black' : 'text-danger-400 font-black'
                                  }
                                >
                                  {formatCurrency(day.netIncome)}
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Single-Line Non-Wrapping Pagination Footer */}
              <div className="flex items-center justify-between px-2.5 sm:px-3 py-1.5 sm:py-2 bg-surface-900/90 border-t border-surface-700/60 text-xs text-surface-300 flex-nowrap shrink-0">
                {/* Left: Range and Active Filter Toggle */}
                <div className="flex items-center gap-1.5 whitespace-nowrap shrink-0">
                  <span className="text-[10px] sm:text-xs text-surface-400 font-medium">
                    {displayedDays.length === 0
                      ? '0 of 0'
                      : `${(currentPage - 1) * pageSize + 1}-${Math.min(
                          currentPage * pageSize,
                          displayedDays.length
                        )} of ${displayedDays.length}`}
                  </span>
                  <button
                    onClick={() => {
                      setFilterActiveOnly(prev => !prev);
                      setCurrentPage(1);
                    }}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium border transition-colors cursor-pointer whitespace-nowrap ${
                      filterActiveOnly
                        ? 'bg-primary-950/70 border-primary-500/50 text-primary-300'
                        : 'bg-surface-800/80 border-surface-700/60 text-surface-400 hover:text-surface-200'
                    }`}
                  >
                    {filterActiveOnly ? 'Active Only' : 'All Days'}
                  </button>
                </div>

                {/* Right: Page Size & Pagination Controls */}
                <div className="flex items-center gap-1 sm:gap-1.5 whitespace-nowrap shrink-0">
                  <select
                    value={pageSize}
                    onChange={e => {
                      setPageSize(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    className="bg-surface-800 border border-surface-700/60 rounded px-1 py-0.5 text-[10px] sm:text-[11px] text-surface-300 cursor-pointer"
                  >
                    <option value={7}>7/page</option>
                    <option value={10}>10/page</option>
                    <option value={15}>15/page</option>
                    <option value={31}>All</option>
                  </select>
                  <button
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    className="px-1.5 sm:px-2 py-0.5 rounded bg-surface-800 hover:bg-surface-700 disabled:opacity-40 disabled:cursor-not-allowed text-[10px] sm:text-[11px] border border-surface-700/60 text-surface-200 cursor-pointer whitespace-nowrap"
                  >
                    ← Prev
                  </button>
                  <span className="text-[10px] sm:text-[11px] text-surface-400 font-medium px-0.5">
                    {currentPage}/{totalPages}
                  </span>
                  <button
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    className="px-1.5 sm:px-2 py-0.5 rounded bg-surface-800 hover:bg-surface-700 disabled:opacity-40 disabled:cursor-not-allowed text-[10px] sm:text-[11px] border border-surface-700/60 text-surface-200 cursor-pointer whitespace-nowrap"
                  >
                    Next →
                  </button>
                </div>
              </div>
            </div>

            {/* Expense Breakdown By Category (Always visible on desktop; on mobile visible if mobileTab === 'expenses') */}
            <div className={`bg-surface-800/50 rounded-xl border border-surface-700/50 flex flex-col overflow-hidden shadow-sm ${mobileTab === 'expenses' ? 'flex' : 'hidden lg:flex'}`}>
              <div className="px-3 py-2 sm:px-4 sm:py-2.5 bg-surface-900/70 border-b border-surface-700/50">
                <h3 className="text-xs sm:text-sm font-bold text-surface-100 flex items-center gap-1.5">
                  <span>💸</span> Gastos Ayon sa Kategorya
                </h3>
                <p className="text-[11px] text-surface-400 mt-0.5">Breakdown ng lahat ng supplies at bills</p>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
                {expensesByCategory.length === 0 ? (
                  <div className="text-center py-8 text-surface-400 text-xs">
                    Walang naitalang gastos ngayong buwan
                  </div>
                ) : (
                  expensesByCategory.map(item => {
                    const pct = monthSummary.totalOpex > 0 ? ((item.amount / monthSummary.totalOpex) * 100).toFixed(1) : 0;
                    return (
                      <div key={item.category} className="p-2.5 rounded-xl bg-surface-900/50 border border-surface-700/40">
                        <div className="flex items-center justify-between text-xs font-medium">
                          <span className="text-surface-200 truncate pr-2">{item.category}</span>
                          <span className="font-bold text-surface-100 whitespace-nowrap">{formatCurrency(item.amount)}</span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-surface-700/60 mt-1.5 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-surface-400 mt-1 block text-right">{pct}% of OPEX</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
