/**
 * Dashboard Page - Business overview with metrics, charts, and quick actions
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { fetchDashboardSummary, fetchLowStockProducts, fetchDailyReport } from '../../api/endpoints';
import { formatCurrency } from '../../utils/currency';
import { useSyncStore } from '../../features/sync/syncStore';
import type { DashboardSummary, DailyReport } from '../../types/common';
import type { Product } from '../../types/product';

export function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [dailyReport, setDailyReport] = useState<DailyReport | null>(null);
  const [lowStock, setLowStock] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { pendingCount, failedCount } = useSyncStore();

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, lowStockRes, dailyRes] = await Promise.all([
        fetchDashboardSummary(),
        fetchLowStockProducts(),
        fetchDailyReport(),
      ]);
      setSummary(summaryRes.data);
      setLowStock(lowStockRes.data);
      setDailyReport(dailyRes.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
          <p className="text-surface-400 text-sm">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="bg-danger-500/10 border border-danger-500/30 rounded-xl p-6 text-center">
          <span className="text-4xl block mb-3">⚠️</span>
          <p className="text-danger-500 font-medium mb-2">{error}</p>
          <p className="text-surface-400 text-sm mb-4">Make sure the server is running and you're connected to the network.</p>
          <button onClick={loadDashboard} className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm hover:bg-primary-500 transition-colors">
            Retry
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
    <div className="space-y-6 animate-fade-in pb-20 lg:pb-0">
      <div className="flex items-center justify-between">
        <span className="text-sm text-surface-400">Overview and key business metrics</span>
        <button onClick={loadDashboard} className="p-2 rounded-lg text-surface-400 hover:bg-surface-800 hover:text-surface-200 transition-colors" title="Refresh">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Revenue cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          label="Today's Sales"
          value={formatCurrency(s.today.sales)}
          sub={`${s.today.transactions} transaction${s.today.transactions !== 1 ? 's' : ''}`}
          icon="💰"
          gradient="from-primary-500/20 to-primary-700/20"
          border="border-primary-500/30"
        />
        <MetricCard
          label="This Week"
          value={formatCurrency(s.this_week.sales)}
          sub={`${s.this_week.transactions} transactions`}
          icon="📈"
          gradient="from-success-500/20 to-success-700/20"
          border="border-success-500/30"
        />
        <MetricCard
          label="This Month"
          value={formatCurrency(s.this_month.sales)}
          sub={`${s.this_month.transactions} transactions`}
          icon="📊"
          gradient="from-[#f59e0b]/20 to-[#d97706]/20"
          border="border-[#f59e0b]/30"
        />
        <MetricCard
          label="Total Products"
          value={String(s.total_products)}
          sub={`${s.low_stock_count} low stock`}
          icon="📦"
          gradient="from-[#8b5cf6]/20 to-[#7c3aed]/20"
          border="border-[#8b5cf6]/30"
        />
      </div>

      {/* Sales chart */}
      {hourlyData.length > 0 && (
        <div className="bg-surface-800/50 rounded-xl p-5 border border-surface-700/50">
          <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wider mb-4">Today's Sales by Hour</h3>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={hourlyData}>
                <defs>
                  <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="hour" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#475569' }} tickLine={false} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#475569' }} tickLine={false} tickFormatter={(v: number) => `₱${v}`} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#e2e8f0' }}
                  formatter={(value: unknown) => [formatCurrency(Number(value)), 'Sales']}
                  labelStyle={{ color: '#94a3b8' }}
                />
                <Area type="monotone" dataKey="sales" stroke="#3b82f6" strokeWidth={2} fill="url(#salesGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Quick status + actions + low stock */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Sync status */}
        <div className="bg-surface-800/50 rounded-xl p-5 border border-surface-700/50">
          <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wider mb-4">Sync Status</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-surface-400 text-sm">Pending Sales</span>
              <span className={`text-sm font-bold ${pendingCount > 0 ? 'text-warning-500' : 'text-success-500'}`}>{pendingCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-surface-400 text-sm">Failed Syncs</span>
              <span className={`text-sm font-bold ${failedCount > 0 ? 'text-danger-500' : 'text-success-500'}`}>{failedCount}</span>
            </div>
            <Link to="/sync" className="block mt-3 px-4 py-2 rounded-lg bg-surface-700 text-surface-200 text-sm text-center hover:bg-surface-600 transition-colors">
              View Sync Details
            </Link>
          </div>
        </div>

        {/* Quick actions */}
        <div className="bg-surface-800/50 rounded-xl p-5 border border-surface-700/50">
          <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wider mb-4">Quick Actions</h3>
          <div className="grid grid-cols-2 gap-2">
            <Link to="/pos" className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-primary-600/20 text-primary-400 text-sm font-medium hover:bg-primary-600/30 transition-colors border border-primary-600/20">
              🛒 New Sale
            </Link>
            <Link to="/products" className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-surface-700/50 text-surface-200 text-sm font-medium hover:bg-surface-700 transition-colors border border-surface-700/50">
              📦 Products
            </Link>
            <Link to="/inventory" className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-surface-700/50 text-surface-200 text-sm font-medium hover:bg-surface-700 transition-colors border border-surface-700/50">
              📋 Inventory
            </Link>
            <Link to="/expenses" className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-surface-700/50 text-surface-200 text-sm font-medium hover:bg-surface-700 transition-colors border border-surface-700/50">
              💸 Expenses
            </Link>
          </div>
        </div>

        {/* Low stock alerts */}
        <div className="bg-surface-800/50 rounded-xl p-5 border border-surface-700/50">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">Low Stock Alerts</h3>
            {lowStock.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-danger-500/20 text-danger-500 text-xs font-bold">{lowStock.length}</span>
            )}
          </div>
          {lowStock.length === 0 ? (
            <div className="text-center py-4">
              <span className="text-3xl mb-2 block">✅</span>
              <p className="text-surface-400 text-sm">All stock levels are good!</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[200px] overflow-y-auto">
              {lowStock.slice(0, 8).map((p) => (
                <div key={p.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-surface-700/50 transition-colors">
                  <span className="text-surface-200 text-sm truncate flex-1">{p.name}</span>
                  <span className={`text-xs font-bold ml-2 px-1.5 py-0.5 rounded ${
                    p.current_stock === 0 ? 'bg-danger-500/20 text-danger-500' : 'bg-warning-500/20 text-warning-500'
                  }`}>
                    {p.current_stock} left
                  </span>
                </div>
              ))}
              {lowStock.length > 8 && (
                <Link to="/inventory" className="block text-center text-primary-400 text-xs hover:text-primary-300 mt-2">
                  +{lowStock.length - 8} more →
                </Link>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Daily summary stats */}
      {dailyReport && (
        <div className="bg-surface-800/50 rounded-xl p-5 border border-surface-700/50">
          <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wider mb-4">Today's Summary</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="text-center">
              <p className="text-surface-400 text-xs">Transactions</p>
              <p className="text-surface-100 text-xl font-bold mt-1">{dailyReport.total_transactions}</p>
            </div>
            <div className="text-center">
              <p className="text-surface-400 text-xs">Revenue</p>
              <p className="text-primary-400 text-xl font-bold mt-1">{formatCurrency(dailyReport.total_sales)}</p>
            </div>
            <div className="text-center">
              <p className="text-surface-400 text-xs">Avg Transaction</p>
              <p className="text-surface-100 text-xl font-bold mt-1">{formatCurrency(dailyReport.avg_transaction)}</p>
            </div>
            <div className="text-center">
              <p className="text-surface-400 text-xs">Gross Profit</p>
              <p className="text-success-500 text-xl font-bold mt-1">{formatCurrency(dailyReport.gross_profit)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, sub, icon, gradient, border }: {
  label: string; value: string; sub: string; icon: string; gradient: string; border: string;
}) {
  return (
    <div className={`bg-gradient-to-br ${gradient} rounded-xl p-5 border ${border} transition-transform hover:scale-[1.02]`}>
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-sm text-surface-300 font-medium">{label}</p>
          <p className="text-2xl font-bold text-surface-50 mt-1 truncate">{value}</p>
          <p className="text-xs text-surface-400 mt-1">{sub}</p>
        </div>
        <span className="text-3xl flex-shrink-0">{icon}</span>
      </div>
    </div>
  );
}
