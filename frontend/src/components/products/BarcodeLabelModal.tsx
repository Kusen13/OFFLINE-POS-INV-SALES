/**
 * Barcode & Shelf Price Tag Generator Modal
 * Nagje-generate ng propesyonal na shelf price tags at sticker barcodes
 * para sa estante o sa supot ng paninda na pwedeng i-print sa kahit anong printer.
 */

import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { formatCurrency } from '../../utils/currency';
import { generateBarcodeSVG } from '../../utils/barcodeGenerator';
import type { Product, Category } from '../../types/product';

interface BarcodeLabelModalProps {
  products: Product[];
  categories: Category[];
  onClose: () => void;
}

type TagStyle = 'shelf' | 'sticker';

export function BarcodeLabelModal({ products, categories, onClose }: BarcodeLabelModalProps) {
  useEffect(() => {
    document.body.classList.add('barcode-print-active');
    return () => {
      document.body.classList.remove('barcode-print-active');
    };
  }, []);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<number>>(() => {
    // Default to first 12 sellable products
    const initial = products.filter(p => p.item_type !== 'supply').slice(0, 12);
    return new Set(initial.map(p => p.id));
  });

  const [tagCopies, setTagCopies] = useState<Record<number, number>>({});
  const [tagStyle, setTagStyle] = useState<TagStyle>('shelf');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const storeSettings = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('pos_app_settings') || '{}');
    } catch {
      return {};
    }
  }, []);

  // Filter sellable products
  const availableProducts = useMemo(() => {
    return products.filter(p => {
      if (p.item_type === 'supply') return false;
      if (categoryFilter !== 'ALL' && String(p.category_id) !== categoryFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = p.name.toLowerCase().includes(q);
        const matchesSku = p.sku.toLowerCase().includes(q);
        if (!matchesName && !matchesSku) return false;
      }
      return true;
    });
  }, [products, categoryFilter, searchQuery]);

  // Toggle selection
  const handleToggleProduct = (id: number) => {
    setSelectedProductIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedProductIds(new Set(availableProducts.map(p => p.id)));
  };

  const handleClearAll = () => {
    setSelectedProductIds(new Set());
  };

  // Compile list of tags to print (including copies)
  const printItems = useMemo(() => {
    const list: Product[] = [];
    products.forEach(p => {
      if (selectedProductIds.has(p.id)) {
        const copies = tagCopies[p.id] ?? 1;
        for (let i = 0; i < copies; i++) {
          list.push(p);
        }
      }
    });
    return list;
  }, [products, selectedProductIds, tagCopies]);

  const handlePrint = () => {
    window.print();
  };

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 animate-fade-in print:static print:inset-auto print:p-0 print:m-0 print:bg-white print:block">
      <div className="bg-surface-900 border border-surface-700 rounded-2xl max-w-4xl w-full h-[92vh] flex flex-col shadow-2xl overflow-hidden print:static print:border-none print:shadow-none print:h-auto print:max-w-none print:w-full print:bg-white print:overflow-visible print:block">

        {/* Modal Header (Hidden on Print) */}
        <div className="px-4 py-3 bg-surface-950 border-b border-surface-800 flex items-center justify-between shrink-0 print:hidden">
          <div className="flex items-center gap-2">
            <span className="text-xl">🏷️</span>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-surface-100">
                Shelf Barcode & Price Tag Generator
              </h3>
              <p className="text-[11px] text-surface-400">
                Mag-print ng malinaw na Price Tag sa Estante o Barcode Sticker sa Paninda
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-surface-800 hover:bg-surface-700 text-surface-400 hover:text-white flex items-center justify-center text-sm transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Modal Controls Bar (Hidden on Print) */}
        <div className="p-3 bg-surface-900 border-b border-surface-800 flex items-center justify-between flex-wrap gap-2 text-xs shrink-0 print:hidden">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Style Selector */}
            <div className="flex items-center gap-1 bg-surface-950 p-1 rounded-xl border border-surface-800">
              <button
                type="button"
                onClick={() => setTagStyle('shelf')}
                className={`px-3 py-1 rounded-lg font-bold text-xs transition-all cursor-pointer ${
                  tagStyle === 'shelf'
                    ? 'bg-primary-600 text-white shadow-xs'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                🏷️ Estante (Shelf Talker)
              </button>
              <button
                type="button"
                onClick={() => setTagStyle('sticker')}
                className={`px-3 py-1 rounded-lg font-bold text-xs transition-all cursor-pointer ${
                  tagStyle === 'sticker'
                    ? 'bg-primary-600 text-white shadow-xs'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                📦 Sticker (Pang-Supot)
              </button>
            </div>

            {/* Category Filter */}
            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
              className="px-2 py-1.5 rounded-lg bg-surface-950 border border-surface-800 text-surface-200 text-xs font-semibold focus:outline-none cursor-pointer"
            >
              <option value="ALL">Lahat ng Kategorya</option>
              {categories.map(c => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>

            {/* Search */}
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="🔍 Maghanap..."
              className="px-2 py-1.5 rounded-lg bg-surface-950 border border-surface-800 text-surface-100 text-xs focus:outline-none w-32 sm:w-40"
            />
          </div>

          {/* Quick Select & Print Trigger */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSelectAll}
              className="px-2 py-1 rounded-lg bg-surface-800 hover:bg-surface-700 text-surface-300 text-xs font-semibold cursor-pointer border border-surface-700"
            >
              Piliin Lahat
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              className="px-2 py-1 rounded-lg bg-surface-800 hover:bg-surface-700 text-surface-400 text-xs font-semibold cursor-pointer border border-surface-700"
            >
              I-clear
            </button>
            <button
              type="button"
              onClick={handlePrint}
              disabled={printItems.length === 0}
              className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-md flex items-center gap-1.5 cursor-pointer active:scale-95"
            >
              <span>🖨️</span>
              <span>I-print ang {printItems.length} Tag</span>
            </button>
          </div>
        </div>

        {/* Modal Body: Split View (Left: Product Picker, Right: Live Sheet Preview) */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden print:block print:h-auto print:overflow-visible print:p-0 print:m-0">
          {/* Left: Product Checklist (Hidden on Print) */}
          <div className="w-full md:w-80 border-b md:border-b-0 md:border-r border-surface-800/80 p-2 overflow-y-auto bg-surface-950/40 shrink-0 print:hidden space-y-1">
            <div className="flex items-center justify-between px-2 py-1 text-[11px] font-bold text-surface-400 uppercase">
              <span>Produkto ({availableProducts.length})</span>
              <span>Kopya</span>
            </div>

            {availableProducts.length === 0 ? (
              <div className="p-4 text-center text-surface-500 text-xs">
                Walang nakitang produkto.
              </div>
            ) : (
              availableProducts.map(p => {
                const isChecked = selectedProductIds.has(p.id);
                const copies = tagCopies[p.id] ?? 1;

                return (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between p-2 rounded-xl border text-xs transition-colors ${
                      isChecked
                        ? 'bg-primary-500/10 border-primary-500/40 text-surface-100'
                        : 'bg-surface-900 border-surface-800 text-surface-400 hover:border-surface-700'
                    }`}
                  >
                    <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleProduct(p.id)}
                        className="accent-primary-500 rounded cursor-pointer"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-surface-100 truncate">{p.name}</p>
                        <p className="text-[10px] text-surface-400">
                          {formatCurrency(p.selling_price)} • <span className="font-mono">{p.sku}</span>
                        </p>
                      </div>
                    </label>

                    {isChecked && (
                      <div className="flex items-center gap-1 shrink-0 ml-2">
                        <input
                          type="number"
                          min="1"
                          max="50"
                          value={copies}
                          onChange={e => {
                            const val = Math.max(1, parseInt(e.target.value) || 1);
                            setTagCopies(prev => ({ ...prev, [p.id]: val }));
                          }}
                          className="w-10 text-center py-0.5 rounded bg-surface-950 border border-surface-700 text-surface-100 text-xs font-bold"
                          title="Dami ng tag na ipi-print"
                        />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Right: Live Print Preview Canvas */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4 bg-surface-950 flex justify-center print:bg-white print:p-0 print:m-0 print:overflow-visible print:block">
            {printItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center my-auto print:hidden">
                <span className="text-4xl mb-2">🏷️</span>
                <p className="text-surface-300 font-bold text-sm">Walang napiling produkto</p>
                <p className="text-surface-500 text-xs mt-1">
                  Pumili ng mga produkto sa kaliwa upang makita ang preview ng mga price tag.
                </p>
              </div>
            ) : (
              <div
                id="barcode-print-sheet"
                className="w-full max-w-2xl bg-white text-black p-4 sm:p-6 rounded-lg shadow-xl print:shadow-none print:p-0 print:m-0 print:max-w-none print:w-full print:block"
              >
                {/* Print Grid */}
                <div
                  className={`grid gap-3 sm:gap-4 print:gap-2.5 ${
                    tagStyle === 'shelf'
                      ? 'grid-cols-2 sm:grid-cols-3 print:grid-cols-3'
                      : 'grid-cols-3 sm:grid-cols-4 print:grid-cols-4'
                  }`}
                >
                  {printItems.map((p, idx) => {
                    const barcodeSku = p.sku?.trim() || String(p.id).padStart(6, '0');
                    const svgMarkup = generateBarcodeSVG(barcodeSku, {
                      height: tagStyle === 'shelf' ? 32 : 24,
                      barWidth: 1.2,
                      showText: false,
                    });

                    return (
                      <div
                        key={`${p.id}-${idx}`}
                        className={`barcode-tag border-2 border-dashed border-gray-400 rounded-lg p-2.5 flex flex-col justify-between bg-white text-black break-inside-avoid shadow-xs print:border-gray-500 print:shadow-none ${
                          tagStyle === 'shelf' ? 'min-h-[140px]' : 'min-h-[105px]'
                        }`}
                      >
                        {/* Store Tag Header */}
                        <div className="border-b border-gray-300 pb-1 flex items-center justify-between">
                          <span className="text-[8px] font-black uppercase tracking-wider text-gray-700 truncate">
                            {storeSettings.store_name || 'AKING TINDAHAN'}
                          </span>
                          <span className="text-[8px] font-bold text-gray-500 uppercase">
                            {p.unit || 'pc'}
                          </span>
                        </div>

                        {/* Product Title */}
                        <div className="my-1">
                          <p className="font-extrabold text-xs sm:text-sm leading-tight line-clamp-2 text-gray-900">
                            {p.name}
                          </p>
                        </div>

                        {/* Price Callout */}
                        <div className="flex items-baseline justify-between my-0.5">
                          <span className="text-[9px] uppercase font-bold text-gray-600">SRP:</span>
                          <span className="text-base sm:text-lg font-black text-gray-950 font-mono tracking-tight">
                            {formatCurrency(p.selling_price)}
                          </span>
                        </div>

                        {/* Barcode & SKU */}
                        <div className="pt-1 border-t border-gray-200 flex flex-col items-center">
                          <div
                            className="w-full flex justify-center [&>svg]:max-w-full [&>svg]:h-auto"
                            dangerouslySetInnerHTML={{ __html: svgMarkup }}
                          />
                          <span className="text-[9px] font-mono font-bold tracking-widest text-gray-800 mt-0.5">
                            {barcodeSku}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

