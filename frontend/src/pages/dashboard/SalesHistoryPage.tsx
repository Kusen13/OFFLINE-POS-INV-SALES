/**
 * Sales History Page - Transaction records with filters and details
 */

import { useState, useEffect, useCallback } from 'react';
import { fetchSales, fetchSaleDetail } from '../../api/endpoints';
import { formatCurrency } from '../../utils/currency';
import { formatDateTime, getTodayStr } from '../../utils/date';
import type { Sale } from '../../types/sale';

export function SalesHistoryPage() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, per_page: 20, total_pages: 0 });
  const [filters, setFilters] = useState({ page: 1, per_page: 20, date_from: '', date_to: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);

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

  return (
    <div className="space-y-5 animate-fade-in pb-20 lg:pb-0">
      <div>
        <h1 className="text-2xl font-bold text-surface-50">Sales History</h1>
        <p className="text-surface-400 mt-1">{pagination.total} transactions</p>
      </div>

      {/* Date filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-2 flex-1">
          <label className="text-surface-400 text-sm whitespace-nowrap">From:</label>
          <input type="date" value={filters.date_from} onChange={e => setFilters(f => ({ ...f, page: 1, date_from: e.target.value }))} className="form-input flex-1" />
        </div>
        <div className="flex items-center gap-2 flex-1">
          <label className="text-surface-400 text-sm whitespace-nowrap">To:</label>
          <input type="date" value={filters.date_to} onChange={e => setFilters(f => ({ ...f, page: 1, date_to: e.target.value }))} className="form-input flex-1" />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setFilters(f => ({ ...f, page: 1, date_from: getTodayStr(), date_to: getTodayStr() }))}
            className="px-3 py-2 rounded-xl bg-surface-700 text-surface-200 text-sm hover:bg-surface-600 transition-colors"
          >
            Today
          </button>
          <button
            onClick={() => setFilters(f => ({ ...f, page: 1, date_from: '', date_to: '' }))}
            className="px-3 py-2 rounded-xl bg-surface-700 text-surface-200 text-sm hover:bg-surface-600 transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-danger-500/10 border border-danger-500/30 rounded-xl p-4">
          <p className="text-danger-500 text-sm">⚠️ {error}</p>
        </div>
      )}

      <div className="bg-surface-800/50 rounded-xl border border-surface-700/50 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12"><div className="w-8 h-8 border-3 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" /></div>
        ) : sales.length === 0 ? (
          <div className="text-center py-12">
            <span className="text-4xl mb-3 block">💰</span>
            <p className="text-surface-300 font-medium">No sales found</p>
            <p className="text-surface-500 text-sm mt-1">Sales will appear here after syncing from mobile POS</p>
          </div>
        ) : (
          <>
            {/* Desktop view */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-surface-700/50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-surface-400 uppercase tracking-wider">Receipt</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-surface-400 uppercase tracking-wider">Date</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-surface-400 uppercase tracking-wider">Items</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-surface-400 uppercase tracking-wider">Payment</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-surface-400 uppercase tracking-wider">Total</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-surface-400 uppercase tracking-wider">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-700/30">
                  {sales.map(sale => (
                    <tr key={sale.id} className="hover:bg-surface-700/20 transition-colors">
                      <td className="px-4 py-3">
                        <span className="text-surface-200 text-sm font-mono">{sale.receipt_number}</span>
                      </td>
                      <td className="px-4 py-3 text-surface-300 text-sm">{formatDateTime(sale.sold_at)}</td>
                      <td className="px-4 py-3 text-center text-surface-300 text-sm">{sale.item_count ?? '-'}</td>
                      <td className="px-4 py-3 text-surface-300 text-sm">{sale.payment_method_name ?? 'Cash'}</td>
                      <td className="px-4 py-3 text-right text-surface-100 font-bold text-sm">{formatCurrency(sale.total_amount)}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => viewSaleDetail(sale)}
                          className="px-2.5 py-1 rounded-lg text-primary-400 text-xs font-medium hover:bg-primary-500/10 transition-colors"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile view */}
            <div className="md:hidden divide-y divide-surface-700/30">
              {sales.map(sale => (
                <button key={sale.id} onClick={() => viewSaleDetail(sale)} className="w-full p-4 text-left hover:bg-surface-700/20 transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="text-surface-200 text-sm font-mono">{sale.receipt_number}</span>
                    <span className="text-surface-100 font-bold text-sm">{formatCurrency(sale.total_amount)}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-surface-500 text-xs">{formatDateTime(sale.sold_at)}</span>
                    <span className="text-surface-500 text-xs">•</span>
                    <span className="text-surface-500 text-xs">{sale.item_count ?? 0} items</span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Pagination */}
      {pagination.total_pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-surface-400 text-sm">Page {pagination.page} of {pagination.total_pages}</p>
          <div className="flex gap-1">
            <button onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))} disabled={pagination.page <= 1} className="px-3 py-1.5 rounded-lg bg-surface-800 text-surface-300 text-sm hover:bg-surface-700 disabled:opacity-40 transition-colors">← Prev</button>
            <button onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))} disabled={pagination.page >= pagination.total_pages} className="px-3 py-1.5 rounded-lg bg-surface-800 text-surface-300 text-sm hover:bg-surface-700 disabled:opacity-40 transition-colors">Next →</button>
          </div>
        </div>
      )}

      {/* Sale detail modal */}
      {selectedSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-surface-800 rounded-2xl p-6 max-w-md w-full border border-surface-700 shadow-2xl animate-fade-in max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-surface-100">Sale Details</h3>
              <button onClick={() => setSelectedSale(null)} className="p-1 rounded-lg text-surface-400 hover:text-surface-200 hover:bg-surface-700">
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
        </div>
      )}
    </div>
  );
}
