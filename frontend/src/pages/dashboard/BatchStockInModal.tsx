import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { formatCurrency } from '../../utils/currency';
import { SYSTEM_START_DATE } from '../../utils/date';
import { batchStockIn } from '../../db/productRepository';
import { createStockAdjustment } from '../../api/endpoints';
import type { InventoryItem } from '../../types/inventory';

interface BatchStockInModalProps {
  items: InventoryItem[];
  onClose: () => void;
  onSuccess: () => void;
}

interface StockInRow {
  productId: number;
  productName: string;
  sku: string;
  currentStock: number;
  qty: number;
  unitCost: number;
}

export function BatchStockInModal({ items, onClose, onSuccess }: BatchStockInModalProps) {
  const [date, setDate] = useState(() => {
    const today = new Date().toISOString().slice(0, 10);
    return today < SYSTEM_START_DATE ? SYSTEM_START_DATE : today;
  });
  const [supplier, setSupplier] = useState('Supplier / Reseller');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize row for each product
  const [rows, setRows] = useState<StockInRow[]>(() =>
    items.map(p => ({
      productId: p.id,
      productName: p.name,
      sku: p.sku,
      currentStock: p.current_stock,
      qty: 0,
      unitCost: Number(p.cost_price) || 0,
    }))
  );

  const updateRow = (productId: number, field: 'qty' | 'unitCost', value: number) => {
    setRows(prev =>
      prev.map(r => (r.productId === productId ? { ...r, [field]: value } : r))
    );
  };

  const summary = useMemo(() => {
    const activeRows = rows.filter(r => r.qty > 0);
    const totalPcs = activeRows.reduce((sum, r) => sum + r.qty, 0);
    const totalCost = activeRows.reduce((sum, r) => sum + r.qty * r.unitCost, 0);
    return { activeCount: activeRows.length, totalPcs, totalCost };
  }, [rows]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const toProcess = rows.filter(r => r.qty > 0);
    if (toProcess.length === 0) {
      setError('Maglagay ng dami (Quantity > 0) sa kahit isang produkto.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // 1. Update IndexedDB locally (offline-first)
      await batchStockIn(
        toProcess.map(r => ({
          productId: r.productId,
          quantity: r.qty,
          unitCost: r.unitCost,
        }))
      );

      // 2. Try sending movements to server if online (non-blocking)
      for (const r of toProcess) {
        try {
          await createStockAdjustment({
            product_id: r.productId,
            type: 'STOCK_IN',
            quantity: r.qty,
            notes: `Re-order / Batch Stock In from ${supplier} (${date}). ${notes}`.trim(),
          });
        } catch {
          // Will be synced or is offline
        }
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save batch stock in');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-surface-800 rounded-2xl p-4 sm:p-6 max-w-2xl w-full border border-surface-700 shadow-2xl animate-fade-in flex flex-col max-h-[92dvh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-surface-700/60 flex-shrink-0">
          <div>
            <h3 className="text-lg font-bold text-surface-100 flex items-center gap-2">
              <span>📥</span> Receive Stock / Re-Order
            </h3>
            <p className="text-xs text-surface-400 mt-0.5">
              Pagtanggap ng bagong batch mula sa supplier at dagdag sa imbentaryo
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-surface-400 hover:text-surface-200 hover:bg-surface-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="my-3 p-3 rounded-xl bg-danger-500/10 border border-danger-500/30 text-danger-400 text-xs sm:text-sm flex-shrink-0">
            ⚠️ {error}
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col pt-3">
          {/* Top meta inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3 flex-shrink-0">
            <div>
              <label className="block text-xs font-semibold text-surface-300 mb-1">Date Received *</label>
              <input
                type="date"
                value={date}
                min={SYSTEM_START_DATE}
                onChange={e => {
                  const val = e.target.value;
                  setDate(val < SYSTEM_START_DATE ? SYSTEM_START_DATE : val);
                }}
                className="form-input text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-300 mb-1">Supplier / Reseller</label>
              <input
                type="text"
                value={supplier}
                onChange={e => setSupplier(e.target.value)}
                placeholder="e.g. Main Commissary / Supplier"
                className="form-input text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-300 mb-1">Batch Notes</label>
              <input
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="e.g. Regular delivery"
                className="form-input text-sm"
              />
            </div>
          </div>

          {/* Product Items Table */}
          <div className="flex-1 min-h-0 bg-surface-900/60 rounded-xl border border-surface-700/50 overflow-hidden flex flex-col mb-3">
            <div className="flex-1 min-h-0 overflow-y-auto">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-surface-900 border-b border-surface-700/60 z-10">
                  <tr>
                    <th className="px-3 py-2 text-xs font-semibold text-surface-400">Product</th>
                    <th className="px-2 py-2 text-xs font-semibold text-surface-400 text-center">Cur. Stock</th>
                    <th className="px-2 py-2 text-xs font-semibold text-surface-400 text-center w-24">Qty Received</th>
                    <th className="px-2 py-2 text-xs font-semibold text-surface-400 text-right w-24">Unit Cost (₱)</th>
                    <th className="px-3 py-2 text-xs font-semibold text-surface-400 text-right">Total Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-700/30">
                  {rows.map(row => {
                    const lineTotal = row.qty * row.unitCost;
                    return (
                      <tr key={row.productId} className="hover:bg-surface-800/40 transition-colors">
                        <td className="px-3 py-2">
                          <p className="text-surface-100 font-medium text-xs sm:text-sm truncate max-w-[150px] sm:max-w-none">
                            {row.productName}
                          </p>
                          <span className="text-[10px] text-surface-500">{row.sku}</span>
                        </td>
                        <td className="px-2 py-2 text-center text-xs text-surface-400 font-medium">
                          {row.currentStock}
                        </td>
                        <td className="px-2 py-2 text-center">
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={row.qty === 0 ? '' : row.qty}
                            placeholder="0"
                            onFocus={e => e.target.select()}
                            onClick={e => (e.target as HTMLInputElement).select()}
                            onChange={e => updateRow(row.productId, 'qty', parseInt(e.target.value) || 0)}
                            className="w-20 px-2 py-1 text-center rounded-lg bg-surface-800 border border-surface-600/60 text-surface-100 text-xs sm:text-sm focus:border-primary-500 focus:outline-none"
                          />
                        </td>
                        <td className="px-2 py-2 text-right">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.unitCost === 0 ? '' : row.unitCost}
                            placeholder="0.00"
                            onFocus={e => e.target.select()}
                            onClick={e => (e.target as HTMLInputElement).select()}
                            onChange={e => updateRow(row.productId, 'unitCost', parseFloat(e.target.value) || 0)}
                            className="w-20 px-2 py-1 text-right rounded-lg bg-surface-800 border border-surface-600/60 text-surface-100 text-xs sm:text-sm focus:border-primary-500 focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-2 text-right text-xs sm:text-sm font-semibold text-emerald-400">
                          {formatCurrency(lineTotal)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bottom Summary & Notes */}
          <div className="flex-shrink-0 space-y-3">
            <div className="p-3 rounded-xl bg-surface-900/80 border border-surface-700/60 flex items-center justify-between text-xs sm:text-sm">
              <div className="flex items-center gap-3">
                <span className="text-surface-400">Total Items:</span>
                <span className="font-bold text-surface-100">{summary.totalPcs} pcs ({summary.activeCount} products)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-surface-400">Total Re-Order Cost:</span>
                <span className="text-base font-extrabold text-primary-400">{formatCurrency(summary.totalCost)}</span>
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2.5 rounded-xl bg-surface-700 text-surface-200 text-sm font-medium hover:bg-surface-600 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || summary.totalPcs === 0}
                className="flex-1 px-4 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-bold hover:bg-primary-500 disabled:opacity-40 transition-colors shadow-lg shadow-primary-600/20"
              >
                {saving ? 'Processing...' : `Confirm & Stock In (+${summary.totalPcs} pcs)`}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
