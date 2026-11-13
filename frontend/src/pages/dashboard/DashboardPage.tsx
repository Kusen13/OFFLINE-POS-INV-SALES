/**
 * Dashboard Page - Business overview with metrics, charts, and quick actions
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { fetchDashboardSummary, fetchLowStockProducts, fetchDailyReport } from '../../api/endpoints';
import { formatCurrency } from '../../utils/currency';
import { useSyncStore } from '../../features/sync/syncStore';
import { getAllProducts } from '../../db/productRepository';
import { getAllSales } from '../../db/salesRepository';
import type { DashboardSummary, DailyReport } from '../../types/common';
import type { Product } from '../../types/product';
import { getAllCategories } from '../../db/productRepository';

export function DashboardPage() {
  const [summary, setSummary]     = useState<DashboardSummary | null>(null);
  const [dailyReport, setDailyReport] = useState<DailyReport | null>(null);
  const [lowStock, setLowStock]   = useState<Product[]>([]);
  const [catBreakdown, setCatBreakdown] = useState<{ name: string; revenue: number; orders: number }[]>([]);
  const [topSelling, setTopSelling] = useState<{ id: number; name: string; qty: number; revenue: number }[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const { pendingCount, failedCount } = useSyncStore();

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    setLoading(true);
    setError(null);
    let onlineDailyReport: DailyReport | null = null;

    try {
      const [summaryRes, lowStockRes, dailyRes] = await Promise.all([
        fetchDashboardSummary(),
        fetchLowStockProducts(),
        fetchDailyReport(),
      ]);
      setSummary(summaryRes.data);
      setLowStock(lowStockRes.data);
      // Fire push notification after server data is loaded
      sendLowStockNotification(lowStockRes.data);
      onlineDailyReport = dailyRes.data;
      setDailyReport(dailyRes.data);
    } catch {
      // Offline fallback: load directly from local IndexedDB
      try {
        const [localProds, localSales] = await Promise.all([
          getAllProducts(),
          getAllSales(),
        ]);
        const todayStr = new Date().toISOString().slice(0, 10);
        const todaySales = localSales.filter(s => s.sold_at?.startsWith(todayStr));
        const todayTotal = todaySales.reduce((sum, s) => sum + (Number(s.total_amount) || 0), 0);
        const physicalProds = localProds.filter(p => p.id !== 999 && p.item_type !== 'service');
        const lowStockItems = physicalProds.filter(
          p => p.is_active && (p.current_stock ?? 0) <= (p.low_stock_threshold || 10)
        );

        setSummary({
          today: { transactions: todaySales.length, sales: todayTotal },
          this_week: {
            transactions: localSales.length,
            sales: localSales.reduce((sum, s) => sum + (Number(s.total_amount) || 0), 0),
          },
          this_month: {
            transactions: localSales.length,
            sales: localSales.reduce((sum, s) => sum + (Number(s.total_amount) || 0), 0),
          },
          low_stock_count: lowStockItems.length,
          total_products: physicalProds.length,
          pending_sync_failures: 0,
        });
        setLowStock(lowStockItems);
        // Fire push notification if low stock found
        sendLowStockNotification(lowStockItems);
      } catch (localErr) {
        setError(localErr instanceof Error ? localErr.message : 'Failed to load dashboard');
      }
    }

    // Always compute local category breakdown, top sellers, and offline hourly/profit
    try {
      const [localProds, localSales, cats] = await Promise.all([
        getAllProducts(),
        getAllSales(),
        getAllCategories(),
      ]);
      const todayStr = new Date().toISOString().slice(0, 10);
      const todaySales = localSales.filter(s => s.sold_at?.startsWith(todayStr));
      const todayTotal = todaySales.reduce((sum, s) => sum + (Number(s.total_amount) || 0), 0);

      const prodById = new Map<number, Product>(localProds.map(p => [p.id, p]));
      const catMap: Record<number, { name: string; revenue: number; orders: number }> = {};
      cats.forEach(c => { catMap[c.id] = { name: c.name, revenue: 0, orders: 0 }; });

      const topProdMap: Record<number, { id: number; name: string; qty: number; revenue: number }> = {};
      let totalCost = 0;
      const hourlyMap: Record<number, { hour: number; sales: number; transactions: number }> = {};
      for (let h = 6; h <= 22; h++) {
        hourlyMap[h] = { hour: h, sales: 0, transactions: 0 };
      }

      todaySales.forEach(sale => {
        const saleHour = sale.sold_at ? new Date(sale.sold_at).getHours() : 0;
        if (!hourlyMap[saleHour]) {
          hourlyMap[saleHour] = { hour: saleHour, sales: 0, transactions: 0 };
        }
        hourlyMap[saleHour].sales += Number(sale.total_amount || 0);
        hourlyMap[saleHour].transactions += 1;

        (sale.items || []).forEach((item: any) => {
          const prod = prodById.get(item.product_id);
          const lineRev = Number(item.line_total || ((item.price || item.unit_price || 0) * (item.quantity || 0)));
          const qty = Number(item.quantity || 0);
          const unitCost = Number(item.unit_cost || prod?.cost_price || 0);

          totalCost += unitCost * qty;

          if (prod && prod.category_id && catMap[prod.category_id]) {
            catMap[prod.category_id].revenue += lineRev;
            catMap[prod.category_id].orders += 1;
          }

          if (item.product_id !== 999) {
            if (!topProdMap[item.product_id]) {
              topProdMap[item.product_id] = {
                id: item.product_id,
                name: item.product_name || prod?.name || 'Paninda',
                qty: 0,
                revenue: 0,
              };
            }
            topProdMap[item.product_id].qty += qty;
            topProdMap[item.product_id].revenue += lineRev;
          }
        });
      });

      const breakdown = Object.values(catMap)
        .filter(c => c.revenue > 0)
        .sort((a, b) => b.revenue - a.revenue);
      setCatBreakdown(breakdown);

      const top5 = Object.values(topProdMap)
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 5);
      setTopSelling(top5);

      const todayDiscounts = todaySales.reduce((sum, s) => sum + (Number(s.discount_amount) || 0), 0);

      // If server report is missing or offline, use computed offline report
      if (!onlineDailyReport) {
        setDailyReport({
          date: todayStr,
          total_sales: todayTotal,
          total_transactions: todaySales.length,
          avg_transaction: todaySales.length > 0 ? todayTotal / todaySales.length : 0,
          total_discounts: todayDiscounts,
          total_cost: totalCost,
          gross_profit: Math.max(0, todayTotal - totalCost),
          hourly: Object.values(hourlyMap).filter(h => h.sales > 0 || (h.hour >= 8 && h.hour <= 20)),
        });
      }
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }

  // ── Browser Push Notifications for Low Stock ────────────────────────────
  async function requestNotificationPermission(): Promise<boolean> {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const perm = await Notification.requestPermission();
    return perm === 'granted';
  }

  async function sendLowStockNotification(items: Product[]) {
    if (!items.length) return;
    // Only fire once per calendar day to avoid spamming
    const today = new Date().toISOString().slice(0, 10);
    const lastNotifDay = localStorage.getItem('pos_lowstock_notif_day');
    if (lastNotifDay === today) return;

    const granted = await requestNotificationPermission();
    if (!granted) return;

    const outOfStock = items.filter(p => (p.current_stock ?? 0) === 0);
    const critical   = items.filter(p => (p.current_stock ?? 0) > 0 && (p.current_stock ?? 0) <= 3);
    const low        = items.filter(p => (p.current_stock ?? 0) > 3);

    const lines: string[] = [];
    if (outOfStock.length) lines.push(`🚫 WALA NA: ${outOfStock.map(p => p.name).join(', ')}`);
    if (critical.length)   lines.push(`⚠️ KRITIKAL: ${critical.map(p => `${p.name} (${p.current_stock})`).join(', ')}`);
    if (low.length)        lines.push(`📦 MABABA: ${low.slice(0, 3).map(p => p.name).join(', ')}${low.length > 3 ? ` +${low.length - 3} pa` : ''}`);

    new Notification(`🏪 Low Stock Alert — ${items.length} item${items.length > 1 ? 's' : ''}`, {
      body: lines.join('\n'),
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: 'lowstock',
      requireInteraction: outOfStock.length > 0,
    });
    localStorage.setItem('pos_lowstock_notif_day', today);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-9 h-9 border-3 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
          <p className="text-surface-400 text-xs">Kinukuha ang pangkalahatang datos ng negosyo...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="bg-danger-500/10 border border-danger-500/30 rounded-xl p-5 text-center">
          <span className="text-3xl block mb-2">⚠️</span>
          <p className="text-danger-500 font-medium text-sm mb-1">{error}</p>
          <p className="text-surface-400 text-xs mb-3">Tiyaking tumatakbo ang server at nakakonekta sa parehong WiFi/network.</p>
          <button onClick={loadDashboard} className="px-3.5 py-1.5 rounded-lg bg-primary-600 text-white text-xs font-semibold hover:bg-primary-500 transition-colors cursor-pointer">
            Subukan Muli
          </button>
        </div>
      </div>
    );
  }

  const s = summary!;

  // Prepare hourly data for chart
  const hourlyData = dailyReport?.hourly?.map(h => ({
    hour: `${h.hour}:00`,
    sales: h.sales,
    transactions: h.transactions,
  })) ?? [];

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-2.5 sm:space-y-3.5 animate-fade-in pb-16 lg:pb-0">
      {/* Header Bar */}
      <div className="flex-shrink-0 flex items-center justify-between gap-2.5">
        <div className="hidden lg:block">
          <h1 className="text-xl sm:text-2xl font-bold text-surface-50 tracking-tight">Business Dashboard</h1>
          <p className="text-surface-400 mt-0.5 text-xs sm:text-sm">
            Operations & Revenue Overview
          </p>
        </div>
        {/* Live Date Indicator & Refresh Button */}
        <div className="w-full lg:w-auto flex items-center justify-between lg:justify-end gap-2">
          <div className="flex items-center gap-1.5 text-xs text-surface-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-semibold text-surface-300">Live POS Activity</span>
          </div>
          <button
            onClick={loadDashboard}
            className="px-2.5 py-1.5 rounded-xl text-surface-300 hover:bg-surface-800 hover:text-surface-100 border border-surface-700/60 transition-colors cursor-pointer shrink-0 flex items-center gap-1.5 text-xs font-semibold shadow-xs"
            title="Refresh Data"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Revenue & Key Metrics Cards - Compact 2x2 on Mobile, 4-col on Desktop */}
      <div className="flex-shrink-0 grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-2.5">
        <MetricCard
          label="Today's Sales"
          subLabel="Benta Ngayong Araw"
          value={formatCurrency(s.today.sales)}
          sub={`${s.today.transactions} order${s.today.transactions !== 1 ? 's' : ''}`}
          icon="💰"
          gradient="from-primary-500/20 to-primary-700/20"
          border="border-primary-500/30"
        />
        <MetricCard
          label="Gross Profit"
          subLabel="Tubo Ngayong Araw"
          value={formatCurrency(dailyReport?.gross_profit ?? 0)}
          sub={`Cost: ${formatCurrency(dailyReport?.total_cost ?? 0)}`}
          icon="📈"
          gradient="from-emerald-500/20 to-emerald-700/20"
          border="border-emerald-500/30"
        />
        <MetricCard
          label="This Month Sales"
          subLabel="Benta Ngayong Buwan"
          value={formatCurrency(s.this_month.sales)}
          sub={`${s.this_month.transactions} orders`}
          icon="📊"
          gradient="from-amber-500/20 to-amber-700/20"
          border="border-amber-500/30"
        />
        <MetricCard
          label="Total Products"
          subLabel="Kabuuang Paninda"
          value={String(s.total_products)}
          sub={`${s.low_stock_count} low stock`}
          icon="📦"
          gradient="from-violet-500/20 to-violet-700/20"
          border="border-violet-500/30"
        />
      </div>

      {/* Quick Action Navigation for Daily Closing & Financial Reports */}
      <div className="flex-shrink-0 grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-2.5">
        <div className="p-2.5 sm:p-3 rounded-xl bg-gradient-to-r from-primary-950/60 to-surface-850/80 border border-primary-500/30 flex items-center justify-between gap-2 shadow-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-2xl shrink-0">⚖️</span>
            <div className="min-w-0">
              <h4 className="text-xs sm:text-sm font-bold text-surface-100 truncate">Daily Closing & Balancing</h4>
              <p className="text-[11px] text-surface-400 truncate">Tray count, spoilage, at carry-over</p>
            </div>
          </div>
          <Link
            to="/closing"
            className="px-2.5 sm:px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold transition-colors shadow-xs whitespace-nowrap shrink-0"
          >
            Closing →
          </Link>
        </div>

        <div className="p-2.5 sm:p-3 rounded-xl bg-gradient-to-r from-emerald-950/60 to-surface-850/80 border border-emerald-500/30 flex items-center justify-between gap-2 shadow-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-2xl shrink-0">📊</span>
            <div className="min-w-0">
              <h4 className="text-xs sm:text-sm font-bold text-surface-100 truncate">Financial Reports & P&L</h4>
              <p className="text-[11px] text-surface-400 truncate">Buwanang benta (Day 1-31) at Net Profit</p>
            </div>
          </div>
          <Link
            to="/reports"
            className="px-2.5 sm:px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors shadow-xs whitespace-nowrap shrink-0"
          >
            Reports →
          </Link>
        </div>
      </div>

      {/* Sales chart */}
      {hourlyData.length > 0 && (
        <div className="flex-shrink-0 bg-surface-800/50 rounded-xl p-3 sm:p-4 border border-surface-700/50 shadow-sm">
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <h3 className="text-xs sm:text-sm font-bold text-surface-200 uppercase tracking-wider flex items-center gap-1.5">
              <span>📈</span> <span>Today's Sales by Hour</span>
            </h3>
          </div>
          <div className="h-[160px] sm:h-[210px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={hourlyData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.6} />
                <XAxis dataKey="hour" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={{ stroke: '#475569' }} tickLine={false} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={{ stroke: '#475569' }} tickLine={false} tickFormatter={(v: number) => `₱${v}`} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#e2e8f0', fontSize: '12px' }}
                  formatter={(value: unknown) => [formatCurrency(Number(value)), 'Sales']}
                  labelStyle={{ color: '#94a3b8' }}
                />
                <Area type="monotone" dataKey="sales" stroke="#3b82f6" strokeWidth={2} fill="url(#salesGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Quick status + low stock */}
      <div className="flex-shrink-0 grid grid-cols-1 lg:grid-cols-2 gap-2.5 sm:gap-3.5">
        {/* Sync status */}
        <div className="bg-surface-800/50 rounded-xl p-3 sm:p-3.5 border border-surface-700/50 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-xs sm:text-sm font-bold text-surface-200 uppercase tracking-wider flex items-center gap-1.5">
                <span>🔄</span> <span>Sync Status</span>
              </h3>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                pendingCount > 0 ? 'bg-warning-500/20 text-warning-400' : 'bg-success-500/20 text-success-400'
              }`}>
                {pendingCount > 0 ? `${pendingCount} Pending` : 'All Synced'}
              </span>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between py-1 px-2 rounded-lg bg-surface-900/40">
                <span className="text-surface-300 text-xs">Pending Sales</span>
                <span className={`text-xs font-bold ${pendingCount > 0 ? 'text-warning-400' : 'text-success-400'}`}>{pendingCount}</span>
              </div>
              <div className="flex items-center justify-between py-1 px-2 rounded-lg bg-surface-900/40">
                <span className="text-surface-300 text-xs">Failed Syncs</span>
                <span className={`text-xs font-bold ${failedCount > 0 ? 'text-danger-400' : 'text-success-400'}`}>{failedCount}</span>
              </div>
            </div>
          </div>
          <Link to="/sync" className="block mt-2.5 px-3 py-1.5 rounded-lg bg-surface-700 text-surface-200 text-xs text-center font-semibold hover:bg-surface-600 transition-colors">
            View Sync Details →
          </Link>
        </div>

        {/* Low stock alerts */}
        <div className="bg-surface-800/50 rounded-xl p-3 sm:p-3.5 border border-surface-700/50 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-xs sm:text-sm font-bold text-surface-200 uppercase tracking-wider flex items-center gap-1.5">
                <span>⚠️</span> <span>Low Stock Alerts</span>
              </h3>
              {lowStock.length > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-danger-500/20 text-danger-400 text-xs font-bold">
                  {lowStock.length} items
                </span>
              )}
            </div>
            {lowStock.length === 0 ? (
              <div className="text-center py-3">
                <span className="text-2xl mb-1 block">✅</span>
                <p className="text-surface-400 text-xs">Sapat ang lahat ng stock levels!</p>
              </div>
            ) : (
              <div className="space-y-1 max-h-[140px] overflow-y-auto">
                {lowStock.slice(0, 5).map(p => (
                  <div key={p.id} className="flex items-center justify-between py-1 px-2 rounded-lg bg-surface-900/40 hover:bg-surface-700/30 transition-colors">
                    <span className="text-surface-200 text-xs truncate flex-1">{p.name}</span>
                    <span className={`text-[10px] font-bold ml-2 px-1.5 py-0.2 rounded ${
                      p.current_stock === 0 ? 'bg-danger-500/20 text-danger-400' : 'bg-warning-500/20 text-warning-400'
                    }`}>
                      {p.current_stock} left
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-1.5 mt-2.5">
            {'Notification' in window && Notification.permission !== 'granted' && (
              <button
                type="button"
                onClick={() => requestNotificationPermission()}
                className="flex-1 px-2 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 text-xs font-bold transition-colors cursor-pointer"
              >
                🔔 Enable Notif
              </button>
            )}
            <Link to="/inventory" className="flex-1 block px-3 py-1.5 rounded-lg bg-surface-700 text-surface-200 text-xs text-center font-semibold hover:bg-surface-600 transition-colors">
              Manage Inventory →
            </Link>
          </div>
        </div>
      </div>

      {/* Category Sales Breakdown & Top Best Sellers */}
      <div className="flex-shrink-0 grid grid-cols-1 lg:grid-cols-2 gap-2.5 sm:gap-3.5">
        {/* Category Sales Breakdown — offline-first */}
        <div className="bg-surface-800/50 rounded-xl p-3 sm:p-3.5 border border-surface-700/50 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-xs sm:text-sm font-bold text-surface-200 uppercase tracking-wider flex items-center gap-1.5">
                <span>🏷️</span> <span>Sales by Category (Today)</span>
              </h3>
            </div>
            {catBreakdown.length === 0 ? (
              <p className="text-surface-400 text-xs py-4 text-center italic">Walang benta ngayong araw</p>
            ) : (
              (() => {
                const maxRev = catBreakdown[0]?.revenue || 1;
                return (
                  <div className="space-y-2">
                    {catBreakdown.map(cat => (
                      <div key={cat.name} className="flex items-center gap-2">
                        <span className="text-xs text-surface-300 w-28 shrink-0 truncate font-medium">{cat.name}</span>
                        <div className="flex-1 h-3 bg-surface-900/60 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-primary-500 to-primary-400 rounded-full transition-all duration-500"
                            style={{ width: `${Math.round((cat.revenue / maxRev) * 100)}%` }}
                          />
                        </div>
                        <span className="text-xs font-bold text-primary-300 shrink-0 w-24 text-right">{formatCurrency(cat.revenue)}</span>
                      </div>
                    ))}
                  </div>
                );
              })()
            )}
          </div>
          <Link to="/reports" className="block mt-2.5 px-3 py-1.5 rounded-lg bg-surface-700 text-surface-200 text-xs text-center font-semibold hover:bg-surface-600 transition-colors">
            View Category Analytics →
          </Link>
        </div>

        {/* Top 5 Best Sellers (Today) */}
        <div className="bg-surface-800/50 rounded-xl p-3 sm:p-3.5 border border-surface-700/50 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-xs sm:text-sm font-bold text-surface-200 uppercase tracking-wider flex items-center gap-1.5">
                <span>🏆</span> <span>Top Best Sellers</span>
              </h3>
            </div>
            {topSelling.length === 0 ? (
              <p className="text-surface-400 text-xs py-4 text-center italic">No sales recorded today yet</p>
            ) : (
              <div className="space-y-2">
                {topSelling.map((p, idx) => {
                  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
                  return (
                    <div key={p.id} className="flex items-center justify-between py-1 px-2 rounded-lg bg-surface-900/40">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm shrink-0">{medals[idx] || `${idx + 1}.`}</span>
                        <span className="text-xs font-semibold text-surface-200 truncate">{p.name}</span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-xs font-bold text-amber-300">{p.qty} sold</span>
                        <span className="text-xs font-mono font-bold text-primary-400 w-16 text-right">{formatCurrency(p.revenue)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <Link to="/reports" className="block mt-2.5 px-3 py-1.5 rounded-lg bg-surface-700 text-surface-200 text-xs text-center font-semibold hover:bg-surface-600 transition-colors">
            View All Reports →
          </Link>
        </div>
      </div>

      {/* Daily summary breakdown */}
      {dailyReport && (
        <div className="flex-shrink-0 bg-surface-800/50 rounded-xl p-3 sm:p-3.5 border border-surface-700/50 shadow-sm">
          <h3 className="text-xs sm:text-sm font-bold text-surface-200 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <span>📋</span> <span>Today's Summary Breakdown</span>
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="p-2 rounded-xl bg-surface-900/60 border border-surface-700/40 text-center">
              <p className="text-surface-300 text-[10px] uppercase font-bold">Transactions</p>
              <p className="text-surface-500 text-[9px]">Mga Resibo</p>
              <p className="text-surface-100 text-sm sm:text-base font-extrabold mt-0.5">{dailyReport.total_transactions}</p>
            </div>
            <div className="p-2 rounded-xl bg-surface-900/60 border border-surface-700/40 text-center">
              <p className="text-surface-300 text-[10px] uppercase font-bold">Revenue</p>
              <p className="text-surface-500 text-[9px]">Kabuuang Benta</p>
              <p className="text-primary-400 text-sm sm:text-base font-extrabold mt-0.5 truncate">{formatCurrency(dailyReport.total_sales)}</p>
            </div>
            <div className="p-2 rounded-xl bg-surface-900/60 border border-surface-700/40 text-center">
              <p className="text-surface-300 text-[10px] uppercase font-bold">Avg Basket</p>
              <p className="text-surface-500 text-[9px]">Bawat Order</p>
              <p className="text-amber-300 text-sm sm:text-base font-extrabold mt-0.5 truncate">{formatCurrency(dailyReport.avg_transaction)}</p>
            </div>
            <div className="p-2 rounded-xl bg-surface-900/60 border border-surface-700/40 text-center">
              <p className="text-surface-300 text-[10px] uppercase font-bold">Gross Profit</p>
              <p className="text-surface-500 text-[9px]">Tubo</p>
              <p className="text-emerald-400 text-sm sm:text-base font-extrabold mt-0.5 truncate">{formatCurrency(dailyReport.gross_profit)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, subLabel, value, sub, icon, gradient, border }: {
  label: string; subLabel?: string; value: string; sub: string; icon: string; gradient: string; border: string;
}) {
  return (
    <div className={`bg-gradient-to-br ${gradient} rounded-xl p-2.5 sm:p-3.5 border ${border} transition-all shadow-xs`}>
      <div className="flex items-start justify-between gap-1.5">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] sm:text-xs text-surface-200 font-bold truncate leading-tight">{label}</p>
          {subLabel && (
            <p className="text-[9px] text-surface-400 font-normal truncate leading-tight">{subLabel}</p>
          )}
          <p className="text-base sm:text-xl font-black text-surface-50 mt-1 truncate font-mono">{value}</p>
          <p className="text-[10px] sm:text-xs text-surface-400 mt-0.5 truncate">{sub}</p>
        </div>
        <span className="text-xl sm:text-2xl shrink-0">{icon}</span>
      </div>
    </div>
  );
}
