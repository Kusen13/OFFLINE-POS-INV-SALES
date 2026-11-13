import { useState, useEffect, useMemo, useCallback } from 'react';
import { formatCurrency } from '../../utils/currency';
import { fetchProfitReport, fetchExpenses } from '../../api/endpoints';
import { getAllDailyClosings } from '../../db/closingRepository';
import { getAllExpenses } from '../../db/expenseRepository';
import { getAllReorderSheets } from '../../db/reorderRepository';
import { getAllProducts, getAllCategories } from '../../db/productRepository';
import { getAllSales } from '../../db/salesRepository';
import { getCategoryIcon, type BusinessType, type BusinessDepartment } from '../../types/product';
import { getAllBusinessDepartments } from '../../utils/businessStorage';
import type { Expense } from '../../types/inventory';
import type { DailyClosing } from '../../types/closing';
import type { ReorderSheet } from '../../types/reorder';
import type { Product, Category } from '../../types/product';
import type { PendingSale } from '../../types/sale';

export function ReportsPage() {
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const yesterdayStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }, []);

  // Filter state: 'month' (whole month) or 'day' (specific date)
  const [filterType, setFilterType] = useState<'month' | 'day'>('month');
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [selectedDate, setSelectedDate] = useState<string>(todayStr); // YYYY-MM-DD

  const [loading, setLoading] = useState(true);
  const [closings, setClosings] = useState<DailyClosing[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [reorders, setReorders] = useState<ReorderSheet[]>([]);
  const [allProductsList, setAllProductsList] = useState<Product[]>([]);
  const [allCategoriesList, setAllCategoriesList] = useState<Category[]>([]);
  const [localSalesList, setLocalSalesList] = useState<PendingSale[]>([]);
  const [serverProfit, setServerProfit] = useState<{ total_revenue: number; total_cost: number; gross_profit: number } | null>(null);

  // Responsive & View States
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [activeTab, setActiveTab] = useState<'daily' | 'categories' | 'expenses'>('daily');
  const [daySubView, setDaySubView] = useState<'products' | 'calendar'>('products');
  const [pageSize, setPageSize] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [filterActiveOnly, setFilterActiveOnly] = useState<boolean>(false);

  // Business Department & Category Filter State
  const [departments, setDepartments] = useState<BusinessDepartment[]>(() => getAllBusinessDepartments());
  const [selectedDept, setSelectedDept] = useState<BusinessType>('barbeque');
  const [selectedCategory, setSelectedCategory] = useState<number | 'all'>('all');

  useEffect(() => {
    const handleDeptUpdated = () => setDepartments(getAllBusinessDepartments());
    window.addEventListener('pos_departments_updated', handleDeptUpdated);
    return () => window.removeEventListener('pos_departments_updated', handleDeptUpdated);
  }, []);

  const loadReportData = useCallback(async (monthStr: string) => {
    setLoading(true);
    try {
      const startDate = `${monthStr}-01`;
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

      // 4. Load reorder sheets for delivered/in-order cost
      const allReorders = await getAllReorderSheets();
      const monthReorders = allReorders.filter(r => r.order_date.startsWith(monthStr));
      setReorders(monthReorders);

      // 5. Load products, categories, and local sales for category analytics
      try {
        const [prods, cats, sales] = await Promise.all([
          getAllProducts(),
          getAllCategories(),
          getAllSales(),
        ]);
        setAllProductsList(prods);
        setAllCategoriesList(cats);
        setLocalSalesList(sales);
      } catch (localErr) {
        console.error('Failed to load local offline sales/products', localErr);
      }
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

  // Handle date change from Day input
  const handleDayChange = (newDate: string) => {
    setSelectedDate(newDate);
    setFilterType('day');
    const newMonth = newDate.slice(0, 7);
    if (newMonth !== selectedMonth) {
      setSelectedMonth(newMonth);
    }
  };

  const handleSelectToday = () => {
    handleDayChange(todayStr);
  };

  const handleSelectYesterday = () => {
    handleDayChange(yesterdayStr);
  };

  const handleSelectMonthMode = () => {
    setFilterType('month');
  };

  // Aggregate daily calendar data for all days of the month (1 to 31)
  const calendarDays = useMemo(() => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const totalDaysInMonth = new Date(year, month, 0).getDate();
    const days = [];

    const closingsByDate = new Map<string, DailyClosing>();
    closings.forEach(c => closingsByDate.set(c.date, c));

    const reordersByDate = new Map<string, ReorderSheet>();
    reorders.forEach(r => reordersByDate.set(r.order_date, r));

    const expensesByDate = new Map<string, number>();
    expenses.forEach(e => {
      expensesByDate.set(e.expense_date, (expensesByDate.get(e.expense_date) || 0) + Number(e.amount));
    });

    const salesByDate = new Map<string, number>();
    localSalesList.forEach(s => {
      const d = s.sold_at?.slice(0, 10);
      if (d) {
        salesByDate.set(d, (salesByDate.get(d) || 0) + Number(s.total_amount || 0));
      }
    });

    for (let d = 1; d <= totalDaysInMonth; d++) {
      const dateStr = `${selectedMonth}-${String(d).padStart(2, '0')}`;
      const closing = closingsByDate.get(dateStr);
      const reorder = reordersByDate.get(dateStr);
      const dayOpex = expensesByDate.get(dateStr) || 0;

      let inOrderCost = 0;
      let unsoldCostValue = 0;
      let unsoldQty = 0;
      let unsoldRetailValue = 0;

      if (closing && closing.items && closing.items.length > 0) {
        inOrderCost = closing.items.reduce((sum, it) => sum + (Number(it.received_qty || 0) * Number(it.unit_cost || 0)), 0);
        unsoldCostValue = closing.items.reduce((sum, it) => sum + (Number(it.unsold_qty || 0) * Number(it.unit_cost || 0)), 0);
        unsoldQty = closing.items.reduce((sum, it) => sum + Number(it.unsold_qty || 0), 0);
        unsoldRetailValue = closing.items.reduce((sum, it) => sum + (Number(it.unsold_qty || 0) * Number(it.selling_price || 0)), 0);
      }

      // Fallback for inOrderCost if not detailed in closing items but reorder exists
      if (inOrderCost === 0 && reorder && reorder.total_cost > 0) {
        inOrderCost = reorder.total_cost;
      }

      const fallbackSales = salesByDate.get(dateStr) || 0;
      const sales = closing ? closing.total_revenue : fallbackSales;
      const cogs = closing ? closing.total_cogs : 0;
      const grossProfit = closing ? closing.total_gross_profit : sales;
      const spoilageLoss = closing ? closing.total_spoilage_loss : 0;
      const netIncome = grossProfit - (dayOpex + spoilageLoss);
      const cashOnHand = closing ? (closing.actual_cash_on_hand ?? closing.expected_cash_on_hand ?? 0) : 0;

      days.push({
        dayNumber: d,
        date: dateStr,
        sales,
        inOrderCost,
        cogs,
        unsoldCostValue,
        unsoldQty,
        unsoldRetailValue,
        grossProfit,
        opex: dayOpex,
        spoilageLoss,
        netIncome,
        cashOnHand,
        hasActivity: sales > 0 || inOrderCost > 0 || unsoldCostValue > 0 || dayOpex > 0 || spoilageLoss > 0 || cashOnHand > 0,
      });
    }

    return days;
  }, [selectedMonth, closings, reorders, expenses, localSalesList]);

  // Grand totals for the month
  const monthSummary = useMemo(() => {
    let totalSales = calendarDays.reduce((s, d) => s + d.sales, 0);
    let totalCogs = calendarDays.reduce((s, d) => s + d.cogs, 0);
    let totalGrossProfit = totalSales - totalCogs;

    if (totalSales === 0 && serverProfit && serverProfit.total_revenue > 0) {
      totalSales = serverProfit.total_revenue;
      totalCogs = serverProfit.total_cost;
      totalGrossProfit = serverProfit.gross_profit;
    }

    const totalInOrder = calendarDays.reduce((s, d) => s + d.inOrderCost, 0);
    const totalUnsoldCost = calendarDays.reduce((s, d) => s + d.unsoldCostValue, 0);
    const totalUnsoldQty = calendarDays.reduce((s, d) => s + d.unsoldQty, 0);
    const totalOpex = calendarDays.reduce((s, d) => s + d.opex, 0);
    const totalSpoilage = calendarDays.reduce((s, d) => s + d.spoilageLoss, 0);
    const totalNetIncome = totalGrossProfit - (totalOpex + totalSpoilage);
    const margin = totalSales > 0 ? (totalNetIncome / totalSales) * 100 : 0;

    return {
      totalSales,
      totalInOrder,
      totalCogs,
      totalUnsoldCost,
      totalUnsoldQty,
      totalGrossProfit,
      totalOpex,
      totalSpoilage,
      totalNetIncome,
      margin: margin.toFixed(1),
    };
  }, [calendarDays, serverProfit]);

  // Selected Day specific metrics
  const selectedDayMetrics = useMemo(() => {
    return calendarDays.find(d => d.date === selectedDate) || null;
  }, [calendarDays, selectedDate]);

  // Selected Day specific closing with items breakdown
  const selectedDayClosing = useMemo(() => {
    return closings.find(c => c.date === selectedDate) || null;
  }, [closings, selectedDate]);

  // Department-aware available categories
  const displayCategories = useMemo(() => {
    return allCategoriesList.filter(c => (c.business_type || 'groceries') === selectedDept);
  }, [allCategoriesList, selectedDept]);

  // Product metadata map (business_type, category_id)
  const prodInfoMap = useMemo(() => {
    const map = new Map<number, { business_type: BusinessType; category_id?: number }>();
    allProductsList.forEach(p => {
      const cat = allCategoriesList.find(c => c.id === p.category_id);
      map.set(p.id, {
        business_type: p.business_type || cat?.business_type || 'groceries',
        category_id: p.category_id,
      });
    });
    return map;
  }, [allProductsList]);

  // Department and Category filtered closing items for Day view
  const displayedDayClosingItems = useMemo(() => {
    if (!selectedDayClosing?.items) return [];
    return selectedDayClosing.items.filter(it => {
      const info = prodInfoMap.get(it.product_id);
      const bType = info?.business_type || 'groceries';
      if (bType !== selectedDept) return false;
      if (selectedCategory !== 'all' && info?.category_id !== selectedCategory) return false;
      return true;
    });
  }, [selectedDayClosing, prodInfoMap, selectedDept, selectedCategory]);

  // Active Summary: Displays either Day totals or Month totals based on filterType
  const activeSummary = useMemo(() => {
    if (filterType === 'day') {
      if (!selectedDayMetrics) {
        return {
          totalSales: 0,
          totalInOrder: 0,
          totalCogs: 0,
          totalUnsoldCost: 0,
          totalUnsoldQty: 0,
          totalGrossProfit: 0,
          totalOpex: 0,
          totalSpoilage: 0,
          totalNetIncome: 0,
          margin: '0.0',
        };
      }
      const sales = displayedDayClosingItems.reduce((s, it) => s + it.actual_revenue, 0);
      const inOrder = displayedDayClosingItems.reduce((s, it) => s + (it.received_qty * it.unit_cost), 0);
      const cogs = displayedDayClosingItems.reduce((s, it) => s + it.cogs, 0);
      const unsoldCost = displayedDayClosingItems.reduce((s, it) => s + (it.unsold_qty * it.unit_cost), 0);
      const unsoldQty = displayedDayClosingItems.reduce((s, it) => s + it.unsold_qty, 0);
      const gross = displayedDayClosingItems.reduce((s, it) => s + it.gross_profit, 0);
      const spoilage = displayedDayClosingItems.reduce((s, it) => s + it.spoilage_loss, 0);
      const net = gross - spoilage;
      const margin = sales > 0 ? (net / sales) * 100 : 0;
      return {
        totalSales: sales,
        totalInOrder: inOrder,
        totalCogs: cogs,
        totalUnsoldCost: unsoldCost,
        totalUnsoldQty: unsoldQty,
        totalGrossProfit: gross,
        totalOpex: 0,
        totalSpoilage: spoilage,
        totalNetIncome: net,
        margin: margin.toFixed(1),
      };
    }
    return monthSummary;
  }, [filterType, selectedDayMetrics, monthSummary, selectedDept, selectedCategory, displayedDayClosingItems]);

  // Filtered & Paginated Days for monthly view
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
    const activeExpenses = filterType === 'day'
      ? expenses.filter(e => e.expense_date === selectedDate)
      : expenses;

    activeExpenses.forEach(e => {
      map.set(e.category, (map.get(e.category) || 0) + Number(e.amount));
    });
    return Array.from(map.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [expenses, filterType, selectedDate]);

  // Group sales by product category
  const salesByCategory = useMemo(() => {
    const targetSales = localSalesList.filter(s => {
      const d = s.sold_at?.slice(0, 10) || '';
      return filterType === 'day' ? d === selectedDate : d.startsWith(selectedMonth);
    });

    const catNameMap = new Map(allCategoriesList.map(c => [c.id, c.name]));
    const prodCatMap = new Map<number, string>();
    allProductsList.forEach(p => {
      const name = (p.category_id && catNameMap.get(p.category_id)) || p.category_name || 'Iba pa';
      prodCatMap.set(p.id, name);
    });

    const map = new Map<string, {
      category: string;
      revenue: number;
      cost: number;
      itemsCount: number;
    }>();

    targetSales.forEach(s => {
      s.items?.forEach(it => {
        const prod = prodInfoMap.get(it.product_id);
        const bType = prod?.business_type || 'groceries';
        if (bType !== selectedDept) return;
        if (selectedCategory !== 'all' && prod?.category_id !== selectedCategory) return;

        const cat = prodCatMap.get(it.product_id) || 'Iba pa';
        const lineRev = Number(it.line_total || 0);
        const lineCost = Number(it.unit_cost || 0) * Number(it.quantity || 0);
        const qty = Number(it.quantity || 0);

        const curr = map.get(cat) || { category: cat, revenue: 0, cost: 0, itemsCount: 0 };
        curr.revenue += lineRev;
        curr.cost += lineCost;
        curr.itemsCount += qty;
        map.set(cat, curr);
      });
    });

    const totalRev = Array.from(map.values()).reduce((sum, c) => sum + c.revenue, 0);

    return Array.from(map.values())
      .map(c => {
        const grossProfit = c.revenue - c.cost;
        const marginPct = c.revenue > 0 ? (grossProfit / c.revenue) * 100 : 0;
        const revPct = totalRev > 0 ? (c.revenue / totalRev) * 100 : 0;
        return {
          ...c,
          grossProfit,
          marginPct: marginPct.toFixed(1),
          revPct: revPct.toFixed(1),
        };
      })
      .sort((a, b) => b.revenue - a.revenue);
  }, [localSalesList, filterType, selectedDate, selectedMonth, allProductsList, allCategoriesList, prodInfoMap, selectedDept, selectedCategory]);

  const handlePrint = () => {
    window.print();
  };

  const handleExportCSV = () => {
    if (filterType === 'day' && selectedDayClosing && selectedDayClosing.items && selectedDayClosing.items.length > 0) {
      // Export detailed item breakdown for this day
      const headers = [
        'Product Name',
        'SKU',
        'In-Order / Received Qty',
        'Unit Cost',
        'Sold Qty',
        'Unsold Qty',
        'Selling Price',
        'Unsold Cost Value',
        'Sales Revenue',
        'COGS',
        'Gross Profit',
        'Spoilage Qty',
        'Spoilage Loss',
      ];
      const rows = selectedDayClosing.items.map(it => [
        `"${it.product_name}"`,
        it.sku,
        it.received_qty,
        it.unit_cost.toFixed(2),
        it.sold_qty,
        it.unsold_qty,
        it.selling_price.toFixed(2),
        (it.unsold_qty * it.unit_cost).toFixed(2),
        it.actual_revenue.toFixed(2),
        it.cogs.toFixed(2),
        it.gross_profit.toFixed(2),
        it.spoilage_qty,
        it.spoilage_loss.toFixed(2),
      ]);

      const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Daily_PL_Report_${selectedDate}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    // Export monthly statement
    const headers = [
      'Day',
      'Date',
      'Sales Revenue',
      'In-Order Cost',
      'COGS (Sold Cost)',
      'Unsold Stock Value (Cost)',
      'Unsold Qty',
      'Gross Profit',
      'OPEX',
      'Spoilage Loss',
      'Cash On-Hand',
      'Net Income',
    ];
    const rows = calendarDays.map(d => [
      d.dayNumber,
      d.date,
      d.sales.toFixed(2),
      d.inOrderCost.toFixed(2),
      d.cogs.toFixed(2),
      d.unsoldCostValue.toFixed(2),
      d.unsoldQty,
      d.grossProfit.toFixed(2),
      d.opex.toFixed(2),
      d.spoilageLoss.toFixed(2),
      d.cashOnHand.toFixed(2),
      d.netIncome.toFixed(2),
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
    <div className="flex-1 min-h-0 flex flex-col space-y-2 sm:space-y-2.5 animate-fade-in pb-16 lg:pb-0 w-full overflow-hidden">

      {/* FIX #4: Offline disclaimer — warns user that data may be incomplete when server is unreachable */}
      {!serverProfit && !loading && (
        <div className="flex items-center gap-2 p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex-shrink-0">
          <span className="shrink-0">⚠️</span>
          <span>
            <strong>Offline Mode:</strong> Ang datos ay batay sa lokal na talaan lamang. Maaaring hindi kumpleto ang monthly summary — i-sync muna para makita ang pinakabagong ulat.
          </span>
        </div>
      )}

      {/* Header Bar with Date Selection Tools */}
      <div className="flex-shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-surface-50 flex items-center gap-1.5">
            <span>📊</span> Financial Reports & P&L Statement
          </h1>
          <p className="text-surface-400 text-[11px] sm:text-xs">
            {filterType === 'day' ? (
              <span>
                Ulat sa Pananalapi para sa petsang{' '}
                <strong className="text-primary-300 font-mono">{selectedDate}</strong>
              </span>
            ) : (
              <span>
                Buwanang Ulat sa Pananalapi para sa{' '}
                <strong className="text-primary-300 font-mono">{selectedMonth}</strong>
              </span>
            )}
          </p>
        </div>

        {/* Date Filter Selection Controls */}
        <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap shrink-0">
          {/* Quick Date Pills: Today, Yesterday, Monthly */}
          <div className="flex items-center bg-surface-900/90 p-0.5 rounded-lg border border-surface-700/60 shadow-xs">
            <button
              type="button"
              onClick={handleSelectToday}
              className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                filterType === 'day' && selectedDate === todayStr
                  ? 'bg-primary-600 text-white shadow-xs'
                  : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              Today
            </button>
            <button
              type="button"
              onClick={handleSelectYesterday}
              className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                filterType === 'day' && selectedDate === yesterdayStr
                  ? 'bg-primary-600 text-white shadow-xs'
                  : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              Yesterday
            </button>
            <button
              type="button"
              onClick={handleSelectMonthMode}
              className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                filterType === 'month'
                  ? 'bg-primary-600 text-white shadow-xs'
                  : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              Full Month
            </button>
          </div>

          {/* Mode Switcher & Specific Pickers */}
          <div className="flex items-center gap-1">
            {filterType === 'day' ? (
              <div className="flex items-center gap-1">
                <input
                  type="date"
                  value={selectedDate}
                  onChange={e => handleDayChange(e.target.value)}
                  className="text-xs py-1 px-2 rounded-lg bg-surface-900 border border-primary-500/60 text-surface-100 font-semibold cursor-pointer focus:outline-none focus:border-primary-500 shadow-xs w-32 sm:w-36 font-mono"
                />
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={e => setSelectedMonth(e.target.value)}
                  className="text-xs py-1 px-2 rounded-lg bg-surface-900 border border-surface-700 text-surface-100 font-semibold cursor-pointer focus:outline-none focus:border-primary-500 shadow-xs w-32 sm:w-36 font-mono"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 min-h-0 flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
            <p className="text-surface-400 text-xs">Kinakalkula ang ulat sa pananalapi at imbentaryo...</p>
          </div>
        </div>
      ) : (
        <>
          {/* Business Department Filter Ribbon & Category Selector */}
          <div className="flex-shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 p-1.5 rounded-xl bg-surface-900 border border-surface-700/60 shadow-xs">
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-0.5 sm:pb-0">
              {departments.map(dept => {
                const isSelected = selectedDept === dept.id;
                return (
                  <button
                    key={dept.id}
                    type="button"
                    onClick={() => {
                      setSelectedDept(dept.id);
                      setSelectedCategory('all');
                    }}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-bold text-xs whitespace-nowrap transition-all cursor-pointer shadow-xs ${
                      isSelected
                        ? 'bg-primary-600 text-white shadow-primary-600/30 ring-1 ring-primary-500 scale-[1.02]'
                        : 'bg-surface-800 hover:bg-surface-700 text-surface-300 hover:text-surface-100 border border-surface-700/60'
                    }`}
                  >
                    <span>{dept.icon}</span>
                    <span>{dept.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Category Dropdown Filter */}
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-[11px] text-surface-400 font-semibold hidden md:inline">Kategorya:</span>
              <select
                value={selectedCategory}
                onChange={e => setSelectedCategory(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                className="px-2 py-1 rounded-lg bg-surface-800 border border-surface-700/70 text-surface-200 text-xs font-semibold focus:outline-none focus:border-primary-500 cursor-pointer shadow-xs max-w-[170px] sm:max-w-[200px] truncate"
              >
                {displayCategories.length > 1 && <option value="all">🏷️ Lahat ng {departments.find(d => d.id === selectedDept)?.label || ''} Kategorya</option>}
                {displayCategories.map(cat => (
                  <option key={cat.id} value={cat.id}>
                    {getCategoryIcon(cat.name)} {cat.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Summary KPI Cards - High Information Density (Mobile & Desktop) */}
          <div className="flex-shrink-0">
            {/* Mobile View: 2 Hero Cards + 6 Compact Badges */}
            <div className="sm:hidden flex flex-col gap-1.5">
              <div className="grid grid-cols-2 gap-1.5">
                <div className="p-2 rounded-lg bg-surface-850 border border-surface-700/70 shadow-xs">
                  <div className="flex items-center justify-between text-[10px] text-surface-400">
                    <span className="font-bold uppercase tracking-wider">Gross Sales</span>
                    <span className="text-[9px] text-surface-500">
                      {filterType === 'day' ? 'Benta' : 'Buwan'}
                    </span>
                  </div>
                  <p className="text-sm font-extrabold text-surface-100 mt-0.5 font-mono">
                    {formatCurrency(activeSummary.totalSales)}
                  </p>
                </div>
                <div className="p-2 rounded-lg bg-primary-950/60 border border-primary-500/40 shadow-xs">
                  <div className="flex items-center justify-between text-[10px] text-primary-300">
                    <span className="font-bold uppercase tracking-wider">Net Profit</span>
                    <span className="text-[9px] font-bold bg-primary-900/60 px-1 rounded border border-primary-600/30">
                      {activeSummary.margin}%
                    </span>
                  </div>
                  <p className="text-sm font-black text-primary-400 mt-0.5 font-mono">
                    {formatCurrency(activeSummary.totalNetIncome)}
                  </p>
                </div>
              </div>

              {/* 6 Micro Metrics in 2 rows of 3 */}
              <div className="grid grid-cols-3 gap-1">
                <div className="p-1 rounded bg-surface-850/90 border border-surface-700/50 text-center">
                  <span className="text-[8.5px] font-semibold text-indigo-400 block truncate">📦 Purchases</span>
                  <p className="text-[11px] font-bold text-indigo-300 font-mono mt-0.5 truncate">{formatCurrency(activeSummary.totalInOrder)}</p>
                </div>
                <div className="p-1 rounded bg-surface-850/90 border border-surface-700/50 text-center">
                  <span className="text-[8.5px] font-semibold text-amber-400 block truncate">🏷️ COGS</span>
                  <p className="text-[11px] font-bold text-amber-300 font-mono mt-0.5 truncate">{formatCurrency(activeSummary.totalCogs)}</p>
                </div>
                <div className="p-1 rounded bg-surface-850/90 border border-surface-700/50 text-center">
                  <span className="text-[8.5px] font-semibold text-sky-400 block truncate">🧊 Ending Stock</span>
                  <p className="text-[11px] font-bold text-sky-300 font-mono mt-0.5 truncate">{formatCurrency(activeSummary.totalUnsoldCost)}</p>
                </div>
                <div className="p-1 rounded bg-surface-850/90 border border-surface-700/50 text-center">
                  <span className="text-[8.5px] font-semibold text-emerald-400 block truncate">✨ Gross Profit</span>
                  <p className="text-[11px] font-bold text-emerald-300 font-mono mt-0.5 truncate">{formatCurrency(activeSummary.totalGrossProfit)}</p>
                </div>
                <div className="p-1 rounded bg-surface-850/90 border border-surface-700/50 text-center">
                  <span className="text-[8.5px] font-semibold text-rose-400 block truncate">💸 OPEX Gastos</span>
                  <p className="text-[11px] font-bold text-rose-300 font-mono mt-0.5 truncate">{formatCurrency(activeSummary.totalOpex)}</p>
                </div>
                <div className="p-1 rounded bg-surface-850/90 border border-surface-700/50 text-center">
                  <span className="text-[8.5px] font-semibold text-danger-400 block truncate">🔥 Spoilage</span>
                  <p className="text-[11px] font-bold text-danger-300 font-mono mt-0.5 truncate">{formatCurrency(activeSummary.totalSpoilage)}</p>
                </div>
              </div>
            </div>

            {/* Desktop / Tablet View: 8 Sleek High-Density Metric Cards */}
            <div className="hidden sm:grid sm:grid-cols-4 lg:grid-cols-8 gap-1.5 lg:gap-2">
              {/* 1. Gross Sales */}
              <div className="p-2 rounded-xl bg-surface-850 border border-surface-700/60 shadow-xs flex flex-col justify-between">
                <div>
                  <span className="text-[10px] font-bold text-surface-400 uppercase tracking-tight block">Gross Sales</span>
                  <span className="text-[9px] text-surface-500 font-medium block -mt-0.5">Benta</span>
                </div>
                <p className="text-sm lg:text-base font-extrabold text-surface-100 font-mono mt-0.5">
                  {formatCurrency(activeSummary.totalSales)}
                </p>
                <span className="text-[9.5px] text-surface-500 truncate">
                  {filterType === 'day' ? `Petsa: ${selectedDate.slice(5)}` : 'Kabuuang benta'}
                </span>
              </div>

              {/* 2. Total In-Order / Purchases */}
              <div className="p-2 rounded-xl bg-indigo-950/30 border border-indigo-500/30 shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-tight block">Purchases</span>
                    <span className="text-[9px] text-indigo-400/80 font-medium block -mt-0.5">In-Order Bili</span>
                  </div>
                  <span className="text-[9px] text-indigo-400">📦</span>
                </div>
                <p className="text-sm lg:text-base font-extrabold text-indigo-300 font-mono mt-0.5">
                  {formatCurrency(activeSummary.totalInOrder)}
                </p>
                <span className="text-[9.5px] text-indigo-400/80 truncate">Halaga ng inorder</span>
              </div>

              {/* 3. COGS */}
              <div className="p-2 rounded-xl bg-surface-850 border border-surface-700/60 shadow-xs flex flex-col justify-between">
                <div>
                  <span className="text-[10px] font-bold text-amber-400 uppercase tracking-tight block">COGS</span>
                  <span className="text-[9px] text-surface-500 font-medium block -mt-0.5">Puhunan sa Nabenta</span>
                </div>
                <p className="text-sm lg:text-base font-extrabold text-amber-300 font-mono mt-0.5">
                  {formatCurrency(activeSummary.totalCogs)}
                </p>
                <span className="text-[9.5px] text-surface-500 truncate">Cost ng nabenta</span>
              </div>

              {/* 4. Unsold Value */}
              <div className="p-2 rounded-xl bg-sky-950/30 border border-sky-500/30 shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold text-sky-300 uppercase tracking-tight block">Ending Stock</span>
                    <span className="text-[9px] text-sky-400/80 font-medium block -mt-0.5">Natirang Paninda</span>
                  </div>
                  <span className="text-[9px] text-sky-400 font-bold bg-sky-900/40 px-1 rounded">{activeSummary.totalUnsoldQty} pcs</span>
                </div>
                <p className="text-sm lg:text-base font-extrabold text-sky-300 font-mono mt-0.5">
                  {formatCurrency(activeSummary.totalUnsoldCost)}
                </p>
                <span className="text-[9.5px] text-sky-400/80 truncate">Puhunan sa freezer</span>
              </div>

              {/* 5. Gross Profit */}
              <div className="p-2 rounded-xl bg-surface-850 border border-surface-700/60 shadow-xs flex flex-col justify-between">
                <div>
                  <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-tight block">Gross Profit</span>
                  <span className="text-[9px] text-surface-500 font-medium block -mt-0.5">Kabuuang Tubo</span>
                </div>
                <p className="text-sm lg:text-base font-extrabold text-emerald-300 font-mono mt-0.5">
                  {formatCurrency(activeSummary.totalGrossProfit)}
                </p>
                <span className="text-[9.5px] text-surface-500 truncate">Benta minus COGS</span>
              </div>

              {/* 6. OPEX */}
              <div className="p-2 rounded-xl bg-surface-850 border border-surface-700/60 shadow-xs flex flex-col justify-between">
                <div>
                  <span className="text-[10px] font-bold text-rose-400 uppercase tracking-tight block">Operating Exp.</span>
                  <span className="text-[9px] text-surface-500 font-medium block -mt-0.5">OPEX Gastos</span>
                </div>
                <p className="text-sm lg:text-base font-extrabold text-rose-300 font-mono mt-0.5">
                  {formatCurrency(activeSummary.totalOpex)}
                </p>
                <span className="text-[9.5px] text-surface-500 truncate">Uling, bills, gas</span>
              </div>

              {/* 7. Spoilage */}
              <div className="p-2 rounded-xl bg-surface-850 border border-surface-700/60 shadow-xs flex flex-col justify-between">
                <div>
                  <span className="text-[10px] font-bold text-danger-400 uppercase tracking-tight block">Spoilage & Loss</span>
                  <span className="text-[9px] text-surface-500 font-medium block -mt-0.5">Tapon at Lugi</span>
                </div>
                <p className="text-sm lg:text-base font-extrabold text-danger-300 font-mono mt-0.5">
                  {formatCurrency(activeSummary.totalSpoilage)}
                </p>
                <span className="text-[9.5px] text-surface-500 truncate">Nasunog / tapon</span>
              </div>

              {/* 8. Net Income */}
              <div className="p-2 rounded-xl bg-primary-950/50 border border-primary-500/40 shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold text-primary-300 uppercase tracking-tight block">Net Profit</span>
                    <span className="text-[9px] text-primary-400/80 font-medium block -mt-0.5">Malinis na Kita</span>
                  </div>
                  <span className="text-[9px] font-bold bg-primary-900/60 text-primary-300 px-1 rounded border border-primary-600/30">
                    {activeSummary.margin}%
                  </span>
                </div>
                <p className="text-sm lg:text-base font-black text-primary-400 font-mono mt-0.5">
                  {formatCurrency(activeSummary.totalNetIncome)}
                </p>
                <span className="text-[9.5px] text-primary-400/90 truncate">Malinis na kita</span>
              </div>
            </div>
          </div>

          {/* Action Toolbar & Section Navigation */}
          <div className="flex items-center justify-between gap-1.5 flex-shrink-0">
            {/* Tab switchers: Daily P&L Table vs Expenses Breakdown */}
            <div className="flex items-center bg-surface-900/80 p-0.5 rounded-lg border border-surface-700/60 shrink-0">
              <button
                onClick={() => setActiveTab('daily')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'daily'
                    ? 'bg-primary-600 text-white shadow-xs'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                <span>📅</span>{' '}
                <span>
                  {filterType === 'day' ? `Ulat ng Araw (${selectedDate.slice(5)})` : 'Araw-Araw (P&L)'}
                </span>
              </button>
              <button
                onClick={() => setActiveTab('categories')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'categories'
                    ? 'bg-primary-600 text-white shadow-xs'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                <span>🏷️</span>{' '}
                <span>
                  Kada Kategorya ({salesByCategory.length})
                </span>
              </button>
              <button
                onClick={() => setActiveTab('expenses')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'expenses'
                    ? 'bg-primary-600 text-white shadow-xs'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                <span>💸</span>{' '}
                <span>
                  Gastos Ayon sa Kategorya ({expensesByCategory.length})
                </span>
              </button>
            </div>

            {/* Right Tools: View Mode (Cards/Table), CSV, Print */}
            <div className="flex items-center gap-1.5 shrink-0">
              {activeTab === 'daily' && (
                <div className="flex items-center bg-surface-900/80 p-0.5 rounded-lg border border-surface-700/60 shrink-0">
                  <button
                    onClick={() => setViewMode('table')}
                    className={`px-2 py-0.5 text-xs font-medium rounded transition-colors cursor-pointer flex items-center gap-1 ${
                      viewMode === 'table'
                        ? 'bg-surface-700 text-surface-100 font-semibold shadow-xs'
                        : 'text-surface-400 hover:text-surface-200'
                    }`}
                    title="Table View (Full Width)"
                  >
                    <span>📋</span> <span className="hidden sm:inline">Table</span>
                  </button>
                  <button
                    onClick={() => setViewMode('cards')}
                    className={`px-2 py-0.5 text-xs font-medium rounded transition-colors cursor-pointer flex items-center gap-1 ${
                      viewMode === 'cards'
                        ? 'bg-surface-700 text-surface-100 font-semibold shadow-xs'
                        : 'text-surface-400 hover:text-surface-200'
                    }`}
                    title="Cards View"
                  >
                    <span>📱</span> <span className="hidden sm:inline">Cards</span>
                  </button>
                </div>
              )}

              <button
                onClick={handleExportCSV}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface-800 hover:bg-surface-700 text-surface-200 border border-surface-700/80 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shadow-xs"
                title="Export complete CSV"
              >
                <span>📥</span> <span className="hidden xs:inline">CSV</span>
              </button>
              <button
                onClick={handlePrint}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary-600 hover:bg-primary-500 text-white text-xs font-semibold shadow-xs shadow-primary-600/20 transition-colors cursor-pointer whitespace-nowrap"
                title="Print report"
              >
                <span>🖨️</span> <span className="hidden xs:inline">Print</span>
              </button>
            </div>
          </div>

          {/* Main Content Area: 100% Full-Width (Zero Horizontal Overflow, Maximum Space Usage) */}
          {activeTab === 'daily' ? (
            <div className="flex-1 min-h-0 bg-surface-850 rounded-xl border border-surface-700/60 flex flex-col overflow-hidden shadow-xs">
              {/* Day Filter Active Banner with Subview switchers */}
              {filterType === 'day' && (
                <div className="px-3 py-1.5 bg-surface-900 border-b border-surface-700/60 flex items-center justify-between gap-2 flex-wrap text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-primary-300 flex items-center gap-1">
                      <span>📆</span> Petsa: {selectedDate}
                    </span>
                    {selectedDayMetrics?.hasActivity ? (
                      <span className="text-[10px] text-emerald-400 bg-emerald-950/60 px-1.5 py-0.2 rounded border border-emerald-600/30">
                        May Naitalang Benta
                      </span>
                    ) : (
                      <span className="text-[10px] text-surface-400 bg-surface-800 px-1.5 py-0.2 rounded">
                        Walang Aktibidad
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    {selectedDayClosing?.items && selectedDayClosing.items.length > 0 && (
                      <div className="flex items-center bg-surface-800 p-0.5 rounded border border-surface-700/60">
                        <button
                          onClick={() => setDaySubView('products')}
                          className={`px-2 py-0.5 text-[10.5px] font-medium rounded transition-colors ${
                            daySubView === 'products'
                              ? 'bg-primary-600 text-white font-bold'
                              : 'text-surface-400 hover:text-surface-200'
                          }`}
                        >
                          🥩 Bawat Produkto ({displayedDayClosingItems.length})
                        </button>
                        <button
                          onClick={() => setDaySubView('calendar')}
                          className={`px-2 py-0.5 text-[10.5px] font-medium rounded transition-colors ${
                            daySubView === 'calendar'
                              ? 'bg-primary-600 text-white font-bold'
                              : 'text-surface-400 hover:text-surface-200'
                          }`}
                        >
                          📅 Buwanang Talaan (1-31)
                        </button>
                      </div>
                    )}
                    <button
                      onClick={() => setFilterType('month')}
                      className="text-[10px] text-surface-400 hover:text-surface-200 underline ml-1 cursor-pointer"
                    >
                      Bumalik sa Buwanan
                    </button>
                  </div>
                </div>
              )}

              {/* View 1: Day Detailed Product Breakdown (If Day Filter is active & subview is 'products') */}
              {filterType === 'day' && daySubView === 'products' && selectedDayClosing?.items && displayedDayClosingItems.length > 0 ? (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
                    {viewMode === 'cards' ? (
                      /* Mobile Cards for Day Product Breakdown */
                      <div className="p-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                        {displayedDayClosingItems.map(it => (
                          <div
                            key={it.product_id}
                            className="p-2.5 rounded-xl border border-surface-700/60 bg-surface-900/80 shadow-xs flex flex-col justify-between"
                          >
                            <div className="flex items-center justify-between pb-1.5 border-b border-surface-800/80">
                              <div>
                                <h4 className="text-xs font-bold text-surface-100">{it.product_name}</h4>
                                <span className="text-[10px] text-surface-400 font-mono">{it.sku}</span>
                              </div>
                              <div className="text-right">
                                <span className="text-[9px] text-emerald-400 uppercase mr-1">Tubo:</span>
                                <span className="text-xs font-bold text-emerald-300 font-mono">
                                  {formatCurrency(it.gross_profit)}
                                </span>
                              </div>
                            </div>

                            <div className="pt-2 grid grid-cols-2 gap-1.5 text-[10.5px]">
                              <div className="p-1 rounded bg-surface-800/50">
                                <span className="text-[9px] text-indigo-300 block truncate">📦 In-Order (Bili)</span>
                                <span className="font-bold text-indigo-200 font-mono">
                                  {it.received_qty} pcs ({formatCurrency(it.received_qty * it.unit_cost)})
                                </span>
                              </div>
                              <div className="p-1 rounded bg-surface-800/50">
                                <span className="text-[9px] text-sky-300 block truncate">🧊 Natira (Unsold)</span>
                                <span className="font-bold text-sky-200 font-mono">
                                  {it.unsold_qty} pcs ({formatCurrency(it.unsold_qty * it.unit_cost)})
                                </span>
                              </div>
                              <div className="p-1 rounded bg-surface-800/50">
                                <span className="text-[9px] text-surface-400 block truncate">Nabenta ({it.sold_qty} pcs)</span>
                                <span className="font-bold text-surface-100 font-mono">{formatCurrency(it.actual_revenue)}</span>
                              </div>
                              <div className="p-1 rounded bg-surface-800/50">
                                <span className="text-[9px] text-amber-400 block truncate">COGS Puhunan</span>
                                <span className="font-bold text-amber-300 font-mono">{formatCurrency(it.cogs)}</span>
                              </div>
                            </div>

                            {it.spoilage_qty > 0 && (
                              <div className="mt-1.5 pt-1 border-t border-surface-800/60 flex items-center justify-between text-[10px] text-danger-400">
                                <span>🔥 Spoilage: {it.spoilage_qty} pcs</span>
                                <span className="font-mono font-bold">-{formatCurrency(it.spoilage_loss)}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      /* Table for Day Product Breakdown - Fixed widths, ZERO horizontal overflow */
                      <table className="w-full text-left min-w-[720px] border-collapse whitespace-nowrap">
                        <thead className="sticky top-0 bg-surface-900 border-b border-surface-700/70 z-10 shadow-xs">
                          <tr>
                            <th className="px-3 py-2 text-xs font-bold text-surface-400 uppercase tracking-tight">
                              Product Name
                            </th>
                            <th className="px-2 py-2 text-xs font-bold text-indigo-300 uppercase tracking-tight text-right">
                              Ordered
                            </th>
                            <th className="px-2 py-2 text-xs font-bold text-surface-300 uppercase tracking-tight text-right">
                              Sold
                            </th>
                            <th className="px-2 py-2 text-xs font-bold text-sky-300 uppercase tracking-tight text-right">
                              Unsold
                            </th>
                            <th className="px-2 py-2 text-xs font-bold text-surface-100 uppercase tracking-tight text-right">
                              Sales
                            </th>
                            <th className="px-2 py-2 text-xs font-bold text-amber-400 uppercase tracking-tight text-right">
                              COGS
                            </th>
                            <th className="px-2 py-2 text-xs font-bold text-emerald-400 uppercase tracking-tight text-right">
                              Gross Profit
                            </th>
                            <th className="px-2 py-2 text-xs font-bold text-danger-400 uppercase tracking-tight text-right hidden sm:table-cell">
                              Spoilage
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-surface-700/30 font-mono text-[11px] sm:text-xs">
                          {displayedDayClosingItems.map(it => (
                            <tr key={it.product_id} className="hover:bg-surface-700/20 transition-colors">
                              <td className="px-2 py-1.5 font-sans font-medium text-surface-100 truncate">
                                <span>{it.product_name}</span>{' '}
                                <span className="text-[10px] text-surface-400 font-mono">({it.sku})</span>
                              </td>
                              <td className="px-1.5 py-1.5 text-right text-indigo-300 font-medium truncate">
                                {it.received_qty > 0 ? (
                                  <span>
                                    {it.received_qty} <span className="text-[9.5px] text-indigo-400/80 font-sans">({formatCurrency(it.received_qty * it.unit_cost)})</span>
                                  </span>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td className="px-1.5 py-1.5 text-right text-surface-200 truncate">
                                {it.sold_qty > 0 ? `${it.sold_qty} pcs` : '—'}
                              </td>
                              <td className="px-1.5 py-1.5 text-right text-sky-300 font-medium truncate">
                                {it.unsold_qty > 0 ? (
                                  <span>
                                    {it.unsold_qty} <span className="text-[9.5px] text-sky-400/80 font-sans">({formatCurrency(it.unsold_qty * it.unit_cost)})</span>
                                  </span>
                                ) : (
                                  '0'
                                )}
                              </td>
                              <td className="px-1.5 py-1.5 text-right text-surface-100 font-bold truncate">
                                {it.actual_revenue > 0 ? formatCurrency(it.actual_revenue) : '—'}
                              </td>
                              <td className="px-1.5 py-1.5 text-right text-amber-300/90 truncate">
                                {it.cogs > 0 ? formatCurrency(it.cogs) : '—'}
                              </td>
                              <td className="px-1.5 py-1.5 text-right text-emerald-300 font-bold truncate">
                                {it.gross_profit > 0 ? formatCurrency(it.gross_profit) : '—'}
                              </td>
                              <td className="px-2 py-1.5 text-right text-danger-300 truncate hidden sm:table-cell">
                                {it.spoilage_loss > 0 ? formatCurrency(it.spoilage_loss) : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* Cash Drawer Reconciliation Summary at bottom */}
                  {selectedDayClosing.actual_cash_on_hand !== undefined && (
                    <div className="px-3 py-2 bg-surface-900 border-t border-surface-700/70 flex items-center justify-between gap-3 text-xs flex-wrap font-mono">
                      <div className="flex items-center gap-3">
                        <span className="text-surface-400 font-sans">💵 Kaha Reconciliation:</span>
                        <span>
                          Expected: <strong className="text-surface-200">{formatCurrency(selectedDayClosing.expected_cash_on_hand || 0)}</strong>
                        </span>
                        <span>
                          Actual Kaha: <strong className="text-sky-300">{formatCurrency(selectedDayClosing.actual_cash_on_hand || 0)}</strong>
                        </span>
                      </div>
                      <div>
                        {selectedDayClosing.cash_discrepancy !== undefined && selectedDayClosing.cash_discrepancy !== 0 ? (
                          <span className={selectedDayClosing.cash_discrepancy > 0 ? 'text-emerald-400 font-bold' : 'text-danger-400 font-bold'}>
                            {selectedDayClosing.cash_discrepancy > 0 ? 'Sobra: +' : 'Kulang: '}
                            {formatCurrency(selectedDayClosing.cash_discrepancy)}
                          </span>
                        ) : (
                          <span className="text-emerald-400 font-bold">✓ Balanse ang Kaha</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* View 2: Monthly Calendar Statement (1 to 31) - Full Width */
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
                    {viewMode === 'cards' ? (
                      /* Cards View - Zero Horizontal Scroll, 100% Space Efficient on Mobile/Tablet/Desktop */
                      <div className="p-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                        {paginatedDays.length === 0 ? (
                          <div className="col-span-full py-8 text-center text-xs text-surface-400">
                            Walang datos sa piniling filter
                          </div>
                        ) : (
                          paginatedDays.map(day => (
                            <div
                              key={day.dayNumber}
                              onClick={() => {
                                setSelectedDate(day.date);
                                setFilterType('day');
                              }}
                              className={`p-2.5 rounded-xl border transition-all cursor-pointer hover:border-primary-500/50 ${
                                day.date === selectedDate && filterType === 'day'
                                  ? 'bg-primary-950/30 border-primary-500/80 ring-1 ring-primary-500/30'
                                  : day.hasActivity
                                  ? 'bg-surface-900/90 border-surface-700/70 shadow-xs'
                                  : 'bg-surface-900/30 border-surface-800/40 opacity-55'
                              }`}
                            >
                              {/* Card Header: Day + Net Profit */}
                              <div className="flex items-center justify-between pb-1.5 border-b border-surface-800/80">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-bold text-surface-200">
                                    Day {day.dayNumber}
                                  </span>
                                  <span className="text-[10px] text-surface-400 font-mono">
                                    ({day.date.slice(5)})
                                  </span>
                                  {day.hasActivity && (
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                                  )}
                                </div>
                                <div className="text-right">
                                  <span className="text-[9.5px] text-surface-400 uppercase mr-1">Net:</span>
                                  <span
                                    className={`text-xs font-bold font-mono ${
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
                                <div className="pt-1.5 space-y-1.5 text-[10.5px]">
                                  {/* Row 1: Sales & In-Order */}
                                  <div className="grid grid-cols-2 gap-1.5">
                                    <div className="p-1 rounded bg-surface-800/50">
                                      <span className="text-[9px] text-surface-400 block truncate">Sales Benta</span>
                                      <span className="font-bold text-surface-100 font-mono block truncate">{formatCurrency(day.sales)}</span>
                                    </div>
                                    <div className="p-1 rounded bg-indigo-950/20 border border-indigo-500/20">
                                      <span className="text-[9px] text-indigo-300 block truncate">📦 In-Order (Bili)</span>
                                      <span className="font-bold text-indigo-300 font-mono block truncate">{formatCurrency(day.inOrderCost)}</span>
                                    </div>
                                  </div>

                                  {/* Row 2: COGS & Unsold Value */}
                                  <div className="grid grid-cols-2 gap-1.5">
                                    <div className="p-1 rounded bg-surface-800/50">
                                      <span className="text-[9px] text-amber-400/90 block truncate">COGS (Puhunan)</span>
                                      <span className="font-bold text-amber-300 font-mono block truncate">{formatCurrency(day.cogs)}</span>
                                    </div>
                                    <div className="p-1 rounded bg-sky-950/20 border border-sky-500/20">
                                      <div className="flex items-center justify-between">
                                        <span className="text-[9px] text-sky-300 block truncate">🧊 Natira (Asset)</span>
                                        {day.unsoldQty > 0 && <span className="text-[8.5px] text-sky-400 font-semibold">{day.unsoldQty} pcs</span>}
                                      </div>
                                      <span className="font-bold text-sky-300 font-mono block truncate">{formatCurrency(day.unsoldCostValue)}</span>
                                    </div>
                                  </div>

                                  {/* Row 3: GP, OPEX, Spoilage */}
                                  <div className="grid grid-cols-3 gap-1 text-[10px]">
                                    <div>
                                      <span className="text-emerald-400/90 block text-[9px] truncate">Gross Prof.</span>
                                      <span className="font-semibold text-emerald-300 font-mono block truncate">{formatCurrency(day.grossProfit)}</span>
                                    </div>
                                    <div>
                                      <span className="text-rose-400/90 block text-[9px] truncate">OPEX Gastos</span>
                                      <span className="font-semibold text-rose-300 font-mono block truncate">{formatCurrency(day.opex)}</span>
                                    </div>
                                    <div>
                                      <span className="text-danger-400/90 block text-[9px] truncate">Spoilage</span>
                                      <span className="font-semibold text-danger-300 font-mono block truncate">{formatCurrency(day.spoilageLoss)}</span>
                                    </div>
                                  </div>

                                  {/* Cash On-Hand reconciliation footer */}
                                  {day.cashOnHand > 0 && (
                                    <div className="pt-1 border-t border-surface-800/70 flex items-center justify-between text-[10px]">
                                      <span className="text-surface-400 flex items-center gap-1"><span>💵</span> Kaha On-Hand:</span>
                                      <span className="font-bold text-sky-400 font-mono">{formatCurrency(day.cashOnHand)}</span>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <p className="text-[10px] text-surface-500 mt-2 italic text-center">Walang transaksyon o aktibidad</p>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    ) : (
                      /* High-Density Full-Width Table - ZERO Horizontal Scrollbar */
                      <table className="w-full text-left min-w-[760px] border-collapse whitespace-nowrap">
                        <thead className="sticky top-0 bg-surface-900 border-b border-surface-700/70 z-10 shadow-xs">
                          <tr>
                            <th className="px-2.5 py-2 text-xs font-bold text-surface-400 uppercase tracking-tight">
                              Date
                            </th>
                            <th className="px-2 py-2 text-xs font-bold text-surface-300 uppercase tracking-tight text-right">
                              Sales
                            </th>
                            <th className="px-2 py-2 text-xs font-bold text-indigo-300 uppercase tracking-tight text-right">
                              Orders
                            </th>
                            <th className="px-2 py-2 text-xs font-bold text-amber-400 uppercase tracking-tight text-right">
                              COGS
                            </th>
                            <th className="px-2 py-2 text-xs font-bold text-sky-300 uppercase tracking-tight text-right">
                              Unsold
                            </th>
                            <th className="px-2 py-2 text-xs font-bold text-emerald-400 uppercase tracking-tight text-right">
                              Gross Profit
                            </th>
                            <th className="px-2 py-2 text-xs font-bold text-rose-400 uppercase tracking-tight text-right">
                              Expenses
                            </th>
                            <th className="px-2 py-2 text-xs font-bold text-danger-400 uppercase tracking-tight text-right hidden sm:table-cell">
                              Spoilage
                            </th>
                            <th className="px-2 py-2 text-xs font-bold text-sky-400 uppercase tracking-tight text-right hidden md:table-cell">
                              Cash Drawer
                            </th>
                            <th className="px-2.5 py-2 text-xs font-bold text-surface-200 uppercase tracking-tight text-right">
                              Net Income
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-surface-700/30 font-mono text-[11px] sm:text-xs">
                          {paginatedDays.length === 0 ? (
                            <tr>
                              <td colSpan={10} className="text-center py-8 text-xs text-surface-400">
                                Walang datos sa piniling filter
                              </td>
                            </tr>
                          ) : (
                            paginatedDays.map(day => (
                              <tr
                                key={day.dayNumber}
                                onClick={() => {
                                  setSelectedDate(day.date);
                                  setFilterType('day');
                                }}
                                className={`hover:bg-surface-700/20 transition-colors cursor-pointer ${
                                  day.date === selectedDate && filterType === 'day'
                                    ? 'bg-primary-950/40 text-primary-200'
                                    : day.hasActivity
                                    ? 'bg-surface-850/80'
                                    : 'opacity-40'
                                }`}
                              >
                                {/* Day Column */}
                                <td className="px-2 py-1.5 font-sans font-semibold text-surface-200 whitespace-nowrap truncate">
                                  D{day.dayNumber}{' '}
                                  <span className="text-[10px] text-surface-400 font-normal">
                                    ({day.date.slice(5)})
                                  </span>
                                </td>

                                {/* Sales */}
                                <td className="px-1.5 py-1.5 text-right text-surface-100 font-semibold truncate">
                                  {day.sales > 0 ? formatCurrency(day.sales) : '—'}
                                </td>

                                {/* In-Order Cost */}
                                <td className="px-1.5 py-1.5 text-right text-indigo-300 font-medium truncate">
                                  {day.inOrderCost > 0 ? formatCurrency(day.inOrderCost) : '—'}
                                </td>

                                {/* COGS */}
                                <td className="px-1.5 py-1.5 text-right text-amber-300/90 truncate">
                                  {day.cogs > 0 ? formatCurrency(day.cogs) : '—'}
                                </td>

                                {/* Unsold Inventory Value */}
                                <td className="px-1.5 py-1.5 text-right text-sky-300 font-medium truncate">
                                  {day.unsoldCostValue > 0 ? (
                                    <span title={`${day.unsoldQty} pcs natira (Retail: ${formatCurrency(day.unsoldRetailValue)})`}>
                                      {formatCurrency(day.unsoldCostValue)}
                                      {day.unsoldQty > 0 && (
                                        <span className="text-[9px] font-sans text-sky-400/80 ml-1">
                                          ({day.unsoldQty})
                                        </span>
                                      )}
                                    </span>
                                  ) : (
                                    '—'
                                  )}
                                </td>

                                {/* Gross Profit */}
                                <td className="px-1.5 py-1.5 text-right text-emerald-300 font-medium truncate">
                                  {day.grossProfit > 0 ? formatCurrency(day.grossProfit) : '—'}
                                </td>

                                {/* OPEX */}
                                <td className="px-1.5 py-1.5 text-right text-rose-300/90 truncate">
                                  {day.opex > 0 ? formatCurrency(day.opex) : '—'}
                                </td>

                                {/* Spoilage Loss */}
                                <td className="px-1.5 py-1.5 text-right text-danger-300/90 truncate hidden sm:table-cell">
                                  {day.spoilageLoss > 0 ? formatCurrency(day.spoilageLoss) : '—'}
                                </td>

                                {/* Cash On Hand */}
                                <td className="px-1.5 py-1.5 text-right text-sky-400/90 truncate hidden md:table-cell">
                                  {day.cashOnHand > 0 ? formatCurrency(day.cashOnHand) : '—'}
                                </td>

                                {/* Net Income */}
                                <td className="px-2 py-1.5 text-right font-bold truncate">
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
                  <div className="flex items-center justify-between px-2.5 py-1.5 bg-surface-900 border-t border-surface-700/70 text-xs text-surface-300 flex-nowrap shrink-0">
                    {/* Left: Range and Active Filter Toggle */}
                    <div className="flex items-center gap-1.5 whitespace-nowrap shrink-0">
                      <span className="text-[10.5px] text-surface-400 font-medium">
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
                            ? 'bg-primary-950/70 border-primary-500/50 text-primary-300 font-bold'
                            : 'bg-surface-800/80 border-surface-700/60 text-surface-400 hover:text-surface-200'
                        }`}
                      >
                        {filterActiveOnly ? '✓ Active Days Only' : 'Lahat ng Araw (1-31)'}
                      </button>
                    </div>

                    {/* Right: Page Size & Navigation */}
                    <div className="flex items-center gap-1 sm:gap-1.5 whitespace-nowrap shrink-0">
                      <select
                        value={pageSize}
                        onChange={e => {
                          setPageSize(Number(e.target.value));
                          setCurrentPage(1);
                        }}
                        className="bg-surface-800 border border-surface-700/60 rounded px-1.5 py-0.5 text-[10.5px] text-surface-300 cursor-pointer"
                      >
                        <option value={7}>7 araw</option>
                        <option value={10}>10 araw</option>
                        <option value={15}>15 araw</option>
                        <option value={31}>Lahat (Buong Buwan)</option>
                      </select>
                      <button
                        disabled={currentPage <= 1}
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        className="px-2 py-0.5 rounded bg-surface-800 hover:bg-surface-700 disabled:opacity-40 disabled:cursor-not-allowed text-[10.5px] border border-surface-700/60 text-surface-200 cursor-pointer"
                      >
                        ← Prev
                      </button>
                      <span className="text-[10.5px] text-surface-400 font-medium px-0.5">
                        {currentPage}/{totalPages}
                      </span>
                      <button
                        disabled={currentPage >= totalPages}
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        className="px-2 py-0.5 rounded bg-surface-800 hover:bg-surface-700 disabled:opacity-40 disabled:cursor-not-allowed text-[10.5px] border border-surface-700/60 text-surface-200 cursor-pointer"
                      >
                        Next →
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === 'categories' ? (
            /* Benta at Tubo Ayon sa Kategorya Breakdown (100% Full-Width) */
            <div className="flex-1 min-h-0 bg-surface-850 rounded-xl border border-surface-700/60 flex flex-col overflow-hidden shadow-xs p-3 sm:p-4">
              <div className="flex items-center justify-between pb-2 border-b border-surface-700/60">
                <div>
                  <h3 className="text-sm font-bold text-surface-100 flex items-center gap-1.5">
                    <span>🏷️</span> Benta at Tubo Ayon sa Kategorya
                  </h3>
                  <p className="text-xs text-surface-400 mt-0.5">
                    {filterType === 'day' ? `Porsyento at kita kada kategorya para sa petsang ${selectedDate}` : `Porsyento at kita kada kategorya ngayong buwan (${selectedMonth})`}
                  </p>
                </div>
                <span className="text-xs font-mono font-bold text-primary-400">
                  {formatCurrency(activeSummary.totalSales)} kabuuang benta
                </span>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto pt-3">
                {salesByCategory.length === 0 ? (
                  <div className="text-center py-12 text-surface-400 text-xs">
                    Walang naitalang benta sa mga kategorya para sa panahong ito
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {salesByCategory.map(item => {
                      const icon = getCategoryIcon(item.category);
                      return (
                        <div key={item.category} className="p-3 rounded-xl bg-surface-900/70 border border-surface-700/50 flex flex-col justify-between hover:border-primary-500/40 transition-colors">
                          <div>
                            <div className="flex items-center justify-between text-xs font-medium">
                              <span className="text-surface-100 font-bold truncate flex items-center gap-1.5">
                                <span>{icon}</span> <span>{item.category}</span>
                              </span>
                              <span className="font-extrabold text-primary-400 font-mono whitespace-nowrap">
                                {formatCurrency(item.revenue)}
                              </span>
                            </div>
                            
                            <div className="w-full h-1.5 rounded-full bg-surface-700/60 mt-2 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                                style={{ width: `${item.revPct}%` }}
                              />
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-surface-400 mt-1 font-mono">
                              <span>{item.itemsCount} nabenta</span>
                              <span>{item.revPct}% ng kabuuan</span>
                            </div>
                          </div>

                          <div className="mt-3 pt-2 border-t border-surface-800/80 flex items-center justify-between text-[11px]">
                            <span className="text-surface-400">Est. Tubo:</span>
                            <div className="flex items-baseline gap-1.5 font-mono">
                              <span className="font-bold text-emerald-400">{formatCurrency(item.grossProfit)}</span>
                              <span className="text-[10px] text-surface-500 font-medium">({item.marginPct}%)</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Gastos Ayon sa Kategorya Breakdown (100% Full-Width) */
            <div className="flex-1 min-h-0 bg-surface-850 rounded-xl border border-surface-700/60 flex flex-col overflow-hidden shadow-xs p-3 sm:p-4">
              <div className="flex items-center justify-between pb-2 border-b border-surface-700/60">
                <div>
                  <h3 className="text-sm font-bold text-surface-100 flex items-center gap-1.5">
                    <span>💸</span> Gastos Ayon sa Kategorya (OPEX Breakdown)
                  </h3>
                  <p className="text-xs text-surface-400 mt-0.5">
                    {filterType === 'day' ? `Gastos para sa petsang ${selectedDate}: ` : `Kabuuang nagastos ngayong buwan (${selectedMonth}): `}
                    <span className="font-bold text-rose-300 font-mono">{formatCurrency(activeSummary.totalOpex)}</span>
                  </p>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto pt-3">
                {expensesByCategory.length === 0 ? (
                  <div className="text-center py-12 text-surface-400 text-xs">
                    Walang naitalang operating expenses para sa panahong ito
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {expensesByCategory.map(item => {
                      const pct = activeSummary.totalOpex > 0 ? ((item.amount / activeSummary.totalOpex) * 100).toFixed(1) : '0';
                      return (
                        <div key={item.category} className="p-3 rounded-xl bg-surface-900/70 border border-surface-700/50 flex flex-col justify-between">
                          <div className="flex items-center justify-between text-xs font-medium">
                            <span className="text-surface-200 font-semibold truncate pr-2">{item.category}</span>
                            <span className="font-bold text-surface-100 font-mono whitespace-nowrap">{formatCurrency(item.amount)}</span>
                          </div>
                          <div className="w-full h-1.5 rounded-full bg-surface-700/60 mt-2 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary-500 transition-all duration-300"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-surface-400 mt-1.5 block text-right font-mono">{pct}% of OPEX</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
