/**
 * Sales History Page - Transaction records with filters and details
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { fetchSales, fetchSaleDetail } from '../../api/endpoints';
import { formatCurrency } from '../../utils/currency';
import { formatDateTime, getTodayStr, SYSTEM_START_DATE } from '../../utils/date';
import { exportToCSV, formatSalesForCSV } from '../../utils/csv';
import type { Sale } from '../../types/sale';

export function SalesHistoryPage() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, per_page: 15, total_pages: 0 });
  const [filters, setFilters] = useState(() => {
    const today = getTodayStr();
    return { page: 1, per_page: 15, date_from: today, date_to: today };
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);

  // Layout & View Switcher States
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('table');

  const loadSales = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchSales({
        page: filters.page,
        per_page: filters.per_page,
        date_from: filters.date_from || undefined,
        date_to: filters.date_to || undefined,
      });
      setSales(res.data);
      setPagination(res.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { loadSales(); }, [loadSales]);

  async function viewSaleDetail(sale: Sale) {
    try {
      const res = await fetchSaleDetail(sale.id);
      setSelectedSale(res.data);
    } catch {
      setSelectedSale(sale);
    }
  }

  // Summary Metrics
  const totalSalesAmount = useMemo(() => sales.reduce((sum, s) => sum + (Number(s.total_amount) || 0), 0), [sales]);
  const todayStr = getTodayStr();
  const todaySales = useMemo(() => sales.filter(s => s.sold_at?.startsWith(todayStr)), [sales, todayStr]);
  const todayTotal = useMemo(() => todaySales.reduce((sum, s) => sum + (Number(s.total_amount) || 0), 0), [todaySales]);
  const avgTicket = useMemo(() => (sales.length > 0 ? totalSalesAmount / sales.length : 0), [sales, totalSalesAmount]);

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-2.5 sm:space-y-3.5 animate-fade-in">
      {/* Top Header Bar - Date Filters above Summary Cards */}
      <div className="flex-shrink-0 flex items-center justify-between gap-2.5">
        <div className="hidden lg:block">
          <h1 className="text-xl sm:text-2xl font-bold text-surface-50 tracking-tight">Sales History</h1>
          <p className="text-surface-400 mt-0.5 text-xs sm:text-sm">
            Talaan ng mga transaksyon at resibo mula sa POS
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
                  const val = e.target.value;
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
                onChange={e => setFilters(f => ({ ...f, page: 1, date_to: e.target.value }))}
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
                title="Ipakita ang Lahat ng Transaksyon"
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
          <span className="text-[10px] font-bold text-surface-400 uppercase tracking-wider">Total Sales</span>
          <div className="flex items-baseline justify-between mt-0.5">
            <span className="text-sm sm:text-base font-extrabold text-primary-400">
              {formatCurrency(totalSalesAmount)}
            </span>
            <span className="text-[10px] text-surface-500 font-medium">
              {pagination.total} sales
            </span>
          </div>
        </div>

        <div className="p-2 sm:p-2.5 rounded-xl bg-surface-800/90 border border-surface-700/60 shadow-xs flex flex-col justify-between">
          <span className="text-[10px] font-bold text-surface-400 uppercase tracking-wider">Ngayong Araw (Today)</span>
          <div className="flex items-baseline justify-between mt-0.5">
            <span className="text-sm sm:text-base font-extrabold text-emerald-400">
              {formatCurrency(todayTotal)}
            </span>
            <span className="text-[10px] text-surface-500 font-medium">
              {todaySales.length} trans
            </span>
          </div>
        </div>

        <div className="col-span-2 sm:col-span-1 p-2 sm:p-2.5 rounded-xl bg-surface-800/90 border border-surface-700/60 shadow-xs flex flex-col justify-between">
          <span className="text-[10px] font-bold text-surface-400 uppercase tracking-wider">Average Basket</span>
          <div className="flex items-baseline justify-between mt-0.5">
            <span className="text-xs sm:text-sm font-bold text-amber-300">
              {formatCurrency(avgTicket)}
            </span>
            <span className="text-[10px] text-surface-500 font-medium">per order</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex-shrink-0 bg-danger-500/10 border border-danger-500/30 rounded-xl p-3">
          <p className="text-danger-500 text-xs">⚠️ {error}</p>
        </div>
      )}

      {/* Main Table Card with View Switcher */}
      <div className="flex-1 min-h-0 bg-surface-800/50 rounded-xl border border-surface-700/50 flex flex-col overflow-hidden shadow-sm">
        {/* Table/Card Header Bar */}
        <div className="px-3 py-2 sm:px-4 sm:py-2.5 bg-surface-900/70 border-b border-surface-700/50 flex items-center justify-between gap-2 flex-nowrap shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-xs sm:text-sm font-bold text-surface-100 flex items-center gap-1.5 truncate">
              <span>🧾</span> <span>Mga Transaksyon (Transactions)</span>
            </h3>
            <span className="text-[10px] sm:text-xs text-surface-400 hidden sm:inline whitespace-nowrap">
              ({pagination.total} sales)
            </span>
          </div>

          {/* Actions & View Switcher */}
          <div className="flex items-center gap-1.5 shrink-0">
            {sales.length > 0 && (
              <button
                onClick={() => exportToCSV(formatSalesForCSV(sales), `sales_export_${getTodayStr()}`)}
                className="px-2.5 py-1 rounded-lg bg-surface-800 hover:bg-surface-700 text-surface-200 border border-surface-700 text-xs font-semibold transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 shadow-xs cursor-pointer"
                title="Export transactions to CSV"
              >
                <span>📥</span>
                <span className="hidden xs:inline">Export</span> <span>CSV</span>
              </button>
            )}

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
        </div>

        {loading ? (
          <div className="flex-1 min-h-0 flex items-center justify-center py-16">
            <div className="flex flex-col items-center gap-2">
              <div className="w-8 h-8 border-3 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
              <p className="text-xs text-surface-400">Kinukuha ang talaan ng mga benta...</p>
            </div>
          </div>
        ) : sales.length === 0 ? (
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center py-12 text-center">
            <span className="text-3xl mb-2 block">💰</span>
            <p className="text-surface-300 font-medium text-xs sm:text-sm">Walang transaksyon na nahanap</p>
            <p className="text-surface-500 text-[11px] sm:text-xs mt-0.5">Lilitaw dito ang mga benta kapag nag-checkout sa POS</p>
          </div>
        ) : (
          <>
            {/* Scrollable Container for Table or Cards */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {viewMode === 'cards' ? (
                /* Cards View - 100% Mobile Friendly */
                <div className="p-2 sm:p-2.5 space-y-1.5">
                  {sales.map(sale => (
                    <button
                      key={sale.id}
                      onClick={() => viewSaleDetail(sale)}
                      className="w-full p-2.5 rounded-xl bg-surface-900/40 hover:bg-surface-700/20 border border-surface-800/60 text-left transition-colors cursor-pointer group"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-surface-200 text-xs font-mono font-bold group-hover:text-primary-300 transition-colors">
                          {sale.receipt_number}
                        </span>
                        <span className="text-primary-400 font-extrabold text-xs sm:text-sm whitespace-nowrap">
                          {formatCurrency(sale.total_amount)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-1 text-[11px] text-surface-400">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span>{formatDateTime(sale.sold_at)}</span>
                          <span>•</span>
                          <span>{sale.item_count ?? 0} items</span>
                        </div>
                        <span className="px-1.5 py-0.2 rounded bg-surface-800 text-surface-300 border border-surface-700/60 text-[10px]">
                          {sale.payment_method_name ?? 'Cash'}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                /* Responsive Table View - Zero Horizontal Overflow */
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-surface-900 border-b border-surface-700/60 z-10 shadow-xs">
                    <tr>
                      <th className="px-2.5 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase whitespace-nowrap">
                        Receipt
                      </th>
                      <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase whitespace-nowrap">
                        Date & Time
                      </th>
                      <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-center whitespace-nowrap hidden sm:table-cell">
                        Items
                      </th>
                      <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase whitespace-nowrap hidden md:table-cell">
                        Payment
                      </th>
                      <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-right whitespace-nowrap">
                        Total
                      </th>
                      <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-right whitespace-nowrap">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-700/30">
                    {sales.map(sale => (
                      <tr key={sale.id} className="hover:bg-surface-700/20 transition-colors">
                        <td className="px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs font-mono font-semibold text-surface-200 whitespace-nowrap">
                          {sale.receipt_number}
                        </td>
                        <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-xs text-surface-300 whitespace-nowrap">
                          {formatDateTime(sale.sold_at)}
                        </td>
                        <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-center text-xs text-surface-300 whitespace-nowrap hidden sm:table-cell">
                          {sale.item_count ?? '-'}
                        </td>
                        <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-xs text-surface-300 whitespace-nowrap hidden md:table-cell">
                          <span className="px-2 py-0.5 rounded-full bg-surface-700/60 text-surface-300 text-[10px] border border-surface-600/40">
                            {sale.payment_method_name ?? 'Cash'}
                          </span>
                        </td>
                        <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-right text-xs font-bold text-primary-400 whitespace-nowrap">
                          {formatCurrency(sale.total_amount)}
                        </td>
                        <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-right whitespace-nowrap">
                          <button
                            onClick={() => viewSaleDetail(sale)}
                            className="px-2 py-0.5 rounded-lg text-primary-400 text-xs font-medium hover:bg-primary-500/10 border border-transparent hover:border-primary-500/30 transition-colors cursor-pointer"
                          >
                            View
                          </button>
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

      {/* Sale detail modal */}
      {selectedSale && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-surface-800 rounded-2xl p-4 sm:p-6 max-w-md w-full border border-surface-700 shadow-2xl animate-fade-in max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-surface-100">Sale Details</h3>
              <button onClick={() => setSelectedSale(null)} className="p-1 rounded-lg text-surface-400 hover:text-surface-200 hover:bg-surface-700 cursor-pointer">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-surface-400">Receipt:</span>
                <span className="text-surface-200 font-mono">{selectedSale.receipt_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-surface-400">Date:</span>
                <span className="text-surface-200">{formatDateTime(selectedSale.sold_at)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-surface-400">Payment:</span>
                <span className="text-surface-200">{selectedSale.payment_method_name ?? 'Cash'}</span>
              </div>
              {selectedSale.source_device && (
                <div className="flex justify-between">
                  <span className="text-surface-400">Device:</span>
                  <span className="text-surface-200">{selectedSale.source_device}</span>
                </div>
              )}

              {/* Line items */}
              {selectedSale.items && selectedSale.items.length > 0 && (
                <div className="mt-4 pt-4 border-t border-surface-700/50">
                  <p className="text-xs font-semibold text-surface-400 uppercase mb-2">Items</p>
                  <div className="space-y-2">
                    {selectedSale.items.map((item, i) => (
                      <div key={i} className="flex justify-between">
                        <span className="text-surface-200">{item.quantity}× {item.product_name}</span>
                        <span className="text-surface-100 font-medium">{formatCurrency(item.line_total)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Totals */}
              <div className="mt-4 pt-4 border-t border-surface-700/50 space-y-1">
                <div className="flex justify-between">
                  <span className="text-surface-400">Subtotal:</span>
                  <span className="text-surface-200">{formatCurrency(selectedSale.subtotal)}</span>
                </div>
                {selectedSale.discount_amount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-surface-400">Discount:</span>
                    <span className="text-success-500">-{formatCurrency(selectedSale.discount_amount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-bold">
                  <span className="text-surface-200">Total:</span>
                  <span className="text-primary-400">{formatCurrency(selectedSale.total_amount)}</span>
                </div>
                {selectedSale.cash_tendered && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-surface-400">Cash:</span>
                      <span className="text-surface-200">{formatCurrency(selectedSale.cash_tendered)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-surface-400">Change:</span>
                      <span className="text-surface-200">{formatCurrency(selectedSale.change_amount ?? 0)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
