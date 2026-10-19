/**
 * POS Page - Full mobile-first ordering interface
 * 
 * Features:
 * - Category tabs for browsing
 * - Product grid with quick-add
 * - Slide-up cart drawer
 * - Checkout flow with payment selection
 * - Cash tendered / change calculator
 * - Offline sale saving to IndexedDB
 * - Receipt view
 */

import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useCartStore } from '../../features/cart/cartStore';
import { useSyncStore } from '../../features/sync/syncStore';
import { formatCurrency } from '../../utils/currency';
import { generateUUID } from '../../utils/uuid';
import { nowISO } from '../../utils/date';
import { saveSale, generateReceiptNumber } from '../../db/salesRepository';
import { getActiveProducts, getAllCategories, getAllPaymentMethods } from '../../db/productRepository';
import { fetchProductUpdates } from '../../api/sync';
import { replaceAllProducts, replaceAllCategories, replaceAllPaymentMethods, setLastProductSync } from '../../db/productRepository';
import type { Product, Category } from '../../types/product';
import type { PaymentMethod, PendingSale } from '../../types/sale';

type POSView = 'menu' | 'cart' | 'checkout' | 'receipt';

export function POSPage() {
  const isOnline = useOnlineStatus();
  const { items, addItem, removeItem, incrementItem, decrementItem, clearCart, getItemCount, getSubtotal } = useCartStore();
  const { pendingCount, performSync, refreshCounts } = useSyncStore();

  const [view, setView] = useState<POSView>('menu');
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [activeCategory, setActiveCategory] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncingProducts, setSyncingProducts] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [lastReceipt, setLastReceipt] = useState<PendingSale | null>(null);

  // Checkout state
  const [paymentMethodId, setPaymentMethodId] = useState(1);
  const [cashTendered, setCashTendered] = useState<number>(0);
  const [paymentRef, setPaymentRef] = useState('');
  const [notes, setNotes] = useState('');
  const [processing, setProcessing] = useState(false);

  const itemCount = getItemCount();
  const subtotal = getSubtotal();
  const total = subtotal; // No tax/discount for now

  // Load products from IndexedDB (offline-first)
  useEffect(() => {
    loadLocalData();
  }, []);

  async function handleDownloadProducts() {
    setSyncingProducts(true);
    setDownloadError(null);
    try {
      const data = await fetchProductUpdates();
      if (data.products && data.products.length > 0) {
        await replaceAllProducts(data.products);
        await replaceAllCategories(data.categories);
        await replaceAllPaymentMethods(data.payment_methods);
        await setLastProductSync(data.server_time);
        setProducts(data.products.filter(p => p.is_active));
        setCategories(data.categories);
        setPaymentMethods(data.payment_methods.filter(m => m.is_active));
      }
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Failed to reach server');
    } finally {
      setSyncingProducts(false);
    }
  }

  async function loadLocalData() {
    setLoading(true);
    try {
      let prods = await getActiveProducts();
      let cats = await getAllCategories();
      let methods = await getAllPaymentMethods();

      // If no local data, try to fetch from server
      if (prods.length === 0) {
        try {
          const data = await fetchProductUpdates();
          if (data.products && data.products.length > 0) {
            await replaceAllProducts(data.products);
            await replaceAllCategories(data.categories);
            await replaceAllPaymentMethods(data.payment_methods);
            await setLastProductSync(data.server_time);
            prods = data.products.filter(p => p.is_active);
            cats = data.categories;
            methods = data.payment_methods.filter(m => m.is_active);
          }
        } catch (err) {
          console.warn('Initial product fetch failed:', err);
          setDownloadError(err instanceof Error ? err.message : 'Failed to reach server');
        }
      }

      setProducts(prods);
      setCategories(cats);
      setPaymentMethods(methods.length > 0 ? methods : [{ id: 1, name: 'Cash', is_active: true, sort_order: 1 }]);
    } finally {
      setLoading(false);
    }
  }

  // Filter products
  const filteredProducts = useMemo(() => {
    let result = products;
    if (activeCategory !== null) {
      result = result.filter(p => p.category_id === activeCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(p => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
    }
    return result;
  }, [products, activeCategory, searchQuery]);

  // Process checkout
  async function handleCheckout() {
    if (items.length === 0) return;
    setProcessing(true);

    try {
      const receiptNumber = await generateReceiptNumber();
      const selectedMethod = paymentMethods.find(m => m.id === paymentMethodId);

      const sale: PendingSale = {
        uuid: generateUUID(),
        receipt_number: receiptNumber,
        items: items.map(i => ({ ...i })),
        subtotal,
        discount_amount: 0,
        tax_amount: 0,
        total_amount: total,
        cash_tendered: selectedMethod?.name === 'Cash' ? cashTendered : null,
        change_amount: selectedMethod?.name === 'Cash' ? Math.max(0, cashTendered - total) : null,
        payment_method_id: paymentMethodId,
        payment_method_name: selectedMethod?.name ?? 'Cash',
        payment_reference: paymentRef || null,
        source_device: localStorage.getItem('pos_device_id') ?? 'unknown',
        notes: notes || null,
        sold_at: nowISO(),
        sync_status: 'PENDING',
        created_at: nowISO(),
      };

      await saveSale(sale);
      setLastReceipt(sale);
      clearCart();
      setCashTendered(0);
      setPaymentRef('');
      setNotes('');
      setView('receipt');
      refreshCounts();
    } catch (err) {
      alert('Failed to save sale: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setProcessing(false);
    }
  }

  function startNewSale() {
    setLastReceipt(null);
    setView('menu');
  }

  // Quick cash buttons
  const quickCashAmounts = [20, 50, 100, 200, 500, 1000];

  if (loading) {
    return (
      <div className="min-h-dvh bg-surface-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 border-3 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
          <p className="text-surface-400 text-sm">Loading products...</p>
        </div>
      </div>
    );
  }

  // ============================================================
  // RECEIPT VIEW
  // ============================================================
  if (view === 'receipt' && lastReceipt) {
    return (
      <div className="min-h-dvh bg-surface-950 flex flex-col">
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-surface-800/80 rounded-2xl border border-surface-700/50 p-6 animate-fade-in">
            {/* Success header */}
            <div className="text-center mb-6">
              <div className="w-16 h-16 mx-auto rounded-full bg-success-500/20 flex items-center justify-center mb-3">
                <svg className="w-8 h-8 text-success-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              </div>
              <h2 className="text-xl font-bold text-surface-100">Sale Complete!</h2>
              <p className="text-surface-400 text-sm mt-1">Receipt saved offline</p>
            </div>

            {/* Receipt details */}
            <div className="space-y-2 text-sm border-t border-dashed border-surface-600 pt-4">
              <div className="flex justify-between">
                <span className="text-surface-400">Receipt #</span>
                <span className="text-surface-200 font-mono text-xs">{lastReceipt.receipt_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-surface-400">Items</span>
                <span className="text-surface-200">{lastReceipt.items.length}</span>
              </div>
              {lastReceipt.items.map((item, i) => (
                <div key={i} className="flex justify-between pl-3">
                  <span className="text-surface-400 text-xs">{item.quantity}× {item.product_name}</span>
                  <span className="text-surface-300 text-xs">{formatCurrency(item.line_total)}</span>
                </div>
              ))}
              <div className="border-t border-dashed border-surface-600 pt-2 mt-2">
                <div className="flex justify-between text-lg font-bold">
                  <span className="text-surface-200">Total</span>
                  <span className="text-primary-400">{formatCurrency(lastReceipt.total_amount)}</span>
                </div>
              </div>
              <div className="flex justify-between">
                <span className="text-surface-400">Payment</span>
                <span className="text-surface-200">{lastReceipt.payment_method_name}</span>
              </div>
              {lastReceipt.cash_tendered && (
                <>
                  <div className="flex justify-between">
                    <span className="text-surface-400">Cash</span>
                    <span className="text-surface-200">{formatCurrency(lastReceipt.cash_tendered)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-surface-400">Change</span>
                    <span className="text-success-500 font-bold">{formatCurrency(lastReceipt.change_amount ?? 0)}</span>
                  </div>
                </>
              )}
            </div>

            {/* Sync status */}
            <div className="mt-4 p-3 rounded-lg bg-warning-500/10 border border-warning-500/20">
              <p className="text-warning-500 text-xs font-medium">⏳ Pending sync — will be sent to server when you tap Sync</p>
            </div>

            {/* Actions */}
            <div className="mt-6 space-y-2">
              <button onClick={startNewSale} className="w-full py-3 rounded-xl bg-primary-600 text-white font-semibold hover:bg-primary-500 transition-colors">
                New Sale
              </button>
              <button onClick={() => { performSync(); startNewSale(); }} className="w-full py-3 rounded-xl bg-surface-700 text-surface-200 font-medium hover:bg-surface-600 transition-colors">
                Sync & New Sale
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================
  // CHECKOUT VIEW
  // ============================================================
  if (view === 'checkout') {
    const selectedMethod = paymentMethods.find(m => m.id === paymentMethodId);
    const isCash = selectedMethod?.name === 'Cash';
    const changeAmount = isCash ? Math.max(0, cashTendered - total) : 0;
    const canCheckout = items.length > 0 && (!isCash || cashTendered >= total);

    return (
      <div className="min-h-dvh bg-surface-950 flex flex-col">
        {/* Header */}
        <header className="flex items-center gap-3 px-4 py-3 bg-surface-900 border-b border-surface-700/50">
          <button onClick={() => setView('cart')} className="p-2 rounded-lg text-surface-400 hover:text-surface-200">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <h1 className="text-lg font-bold text-surface-100">Checkout</h1>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Order summary */}
          <div className="bg-surface-800/50 rounded-xl p-4 border border-surface-700/50">
            <h3 className="text-sm font-semibold text-surface-300 mb-3">Order Summary</h3>
            {items.map(item => (
              <div key={item.product_id} className="flex justify-between py-1">
                <span className="text-surface-300 text-sm">{item.quantity}× {item.product_name}</span>
                <span className="text-surface-200 text-sm">{formatCurrency(item.line_total)}</span>
              </div>
            ))}
            <div className="border-t border-surface-700/50 mt-2 pt-2">
              <div className="flex justify-between text-lg font-bold">
                <span className="text-surface-100">Total</span>
                <span className="text-primary-400">{formatCurrency(total)}</span>
              </div>
            </div>
          </div>

          {/* Payment method */}
          <div className="bg-surface-800/50 rounded-xl p-4 border border-surface-700/50">
            <h3 className="text-sm font-semibold text-surface-300 mb-3">Payment Method</h3>
            <div className="grid grid-cols-2 gap-2">
              {paymentMethods.map(m => (
                <button
                  key={m.id}
                  onClick={() => setPaymentMethodId(m.id)}
                  className={`px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                    paymentMethodId === m.id
                      ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/20 scale-[1.02]'
                      : 'bg-surface-700 text-surface-300 hover:bg-surface-600'
                  }`}
                >
                  {m.name === 'Cash' ? '💵' : '📱'} {m.name}
                </button>
              ))}
            </div>
          </div>

          {/* Cash tendered */}
          {isCash && (
            <div className="bg-surface-800/50 rounded-xl p-4 border border-surface-700/50">
              <h3 className="text-sm font-semibold text-surface-300 mb-3">Cash Received</h3>
              <input
                type="number"
                value={cashTendered || ''}
                onChange={e => setCashTendered(parseFloat(e.target.value) || 0)}
                className="form-input text-2xl font-bold text-center mb-3"
                placeholder="0.00"
                min={0}
                step="0.01"
              />
              {/* Quick amounts */}
              <div className="grid grid-cols-3 gap-2">
                {quickCashAmounts.map(amt => (
                  <button
                    key={amt}
                    onClick={() => setCashTendered(amt)}
                    className={`py-2 rounded-lg text-sm font-medium transition-colors ${
                      cashTendered === amt ? 'bg-primary-600 text-white' : 'bg-surface-700 text-surface-300 hover:bg-surface-600'
                    }`}
                  >
                    ₱{amt}
                  </button>
                ))}
                <button
                  onClick={() => setCashTendered(total)}
                  className="py-2 rounded-lg bg-success-600/20 text-success-500 text-sm font-medium hover:bg-success-600/30 transition-colors"
                >
                  Exact
                </button>
              </div>

              {/* Change display */}
              {cashTendered > 0 && (
                <div className={`mt-3 p-3 rounded-xl text-center ${
                  cashTendered >= total ? 'bg-success-500/10 border border-success-500/20' : 'bg-danger-500/10 border border-danger-500/20'
                }`}>
                  {cashTendered >= total ? (
                    <div>
                      <p className="text-surface-400 text-xs">Change</p>
                      <p className="text-success-500 text-2xl font-bold">{formatCurrency(changeAmount)}</p>
                    </div>
                  ) : (
                    <p className="text-danger-500 text-sm font-medium">
                      Short by {formatCurrency(total - cashTendered)}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Payment reference for non-cash */}
          {!isCash && (
            <div className="bg-surface-800/50 rounded-xl p-4 border border-surface-700/50">
              <h3 className="text-sm font-semibold text-surface-300 mb-3">Reference Number</h3>
              <input type="text" value={paymentRef} onChange={e => setPaymentRef(e.target.value)} className="form-input" placeholder="e.g., GCash reference #" />
            </div>
          )}

          {/* Notes */}
          <div className="bg-surface-800/50 rounded-xl p-4 border border-surface-700/50">
            <h3 className="text-sm font-semibold text-surface-300 mb-3">Notes (optional)</h3>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)} className="form-input" placeholder="Special instructions..." />
          </div>
        </div>

        {/* Complete sale button */}
        <div className="p-4 bg-surface-900 border-t border-surface-700/50 safe-area-bottom">
          <button
            onClick={handleCheckout}
            disabled={!canCheckout || processing}
            className="w-full py-4 rounded-xl bg-success-600 text-white text-lg font-bold hover:bg-success-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
          >
            {processing ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Processing...
              </span>
            ) : (
              `Complete Sale — ${formatCurrency(total)}`
            )}
          </button>
        </div>
      </div>
    );
  }

  // ============================================================
  // CART VIEW
  // ============================================================
  if (view === 'cart') {
    return (
      <div className="min-h-dvh bg-surface-950 flex flex-col">
        <header className="flex items-center gap-3 px-4 py-3 bg-surface-900 border-b border-surface-700/50">
          <button onClick={() => setView('menu')} className="p-2 rounded-lg text-surface-400 hover:text-surface-200">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <h1 className="text-lg font-bold text-surface-100">Cart ({itemCount})</h1>
          {items.length > 0 && (
            <button onClick={clearCart} className="ml-auto text-danger-500 text-sm hover:text-danger-400">Clear All</button>
          )}
        </header>

        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <span className="text-5xl mb-4">🛒</span>
              <p className="text-surface-300 font-medium">Cart is empty</p>
              <p className="text-surface-500 text-sm mt-1">Add items from the menu</p>
              <button onClick={() => setView('menu')} className="mt-4 px-6 py-2 rounded-xl bg-primary-600 text-white text-sm font-medium hover:bg-primary-500">Browse Menu</button>
            </div>
          ) : (
            <div className="divide-y divide-surface-700/30">
              {items.map(item => (
                <div key={item.product_id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-surface-100 font-medium text-sm truncate">{item.product_name}</p>
                    <p className="text-surface-400 text-xs">{formatCurrency(item.unit_price)} each</p>
                  </div>
                  {/* Quantity controls */}
                  <div className="flex items-center gap-0">
                    <button onClick={() => decrementItem(item.product_id)} className="w-8 h-8 rounded-lg bg-surface-700 text-surface-200 flex items-center justify-center hover:bg-surface-600 transition-colors text-lg font-bold">−</button>
                    <span className="w-10 text-center text-surface-100 font-bold text-sm">{item.quantity}</span>
                    <button onClick={() => incrementItem(item.product_id)} className="w-8 h-8 rounded-lg bg-surface-700 text-surface-200 flex items-center justify-center hover:bg-surface-600 transition-colors text-lg font-bold">+</button>
                  </div>
                  <div className="w-20 text-right">
                    <p className="text-surface-100 font-bold text-sm">{formatCurrency(item.line_total)}</p>
                  </div>
                  <button onClick={() => removeItem(item.product_id)} className="p-1 text-surface-500 hover:text-danger-500 transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Cart footer */}
        {items.length > 0 && (
          <div className="p-4 bg-surface-900 border-t border-surface-700/50 safe-area-bottom space-y-3">
            <div className="flex justify-between text-lg">
              <span className="text-surface-300 font-medium">Total</span>
              <span className="text-surface-50 font-bold">{formatCurrency(total)}</span>
            </div>
            <button
              onClick={() => setView('checkout')}
              className="w-full py-4 rounded-xl bg-primary-600 text-white text-lg font-bold hover:bg-primary-500 transition-all active:scale-[0.98] shadow-lg shadow-primary-600/20"
            >
              Proceed to Checkout
            </button>
          </div>
        )}
      </div>
    );
  }

  // ============================================================
  // MENU VIEW (default)
  // ============================================================
  return (
    <div className="min-h-dvh bg-surface-950 flex flex-col">
      {/* Top bar */}
      <header className="flex items-center gap-3 px-4 py-3 bg-surface-900 border-b border-surface-700/50">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center text-white font-bold text-sm">P</div>
        <div className="flex-1">
          <h1 className="text-base font-bold text-surface-50">Point of Sale</h1>
        </div>
        <div className="flex items-center gap-2">
          {/* Online/offline indicator */}
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${
            isOnline ? 'bg-success-500/20 text-success-500' : 'bg-danger-500/20 text-danger-500'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-success-500' : 'bg-danger-500'}`} />
            {isOnline ? 'Online' : 'Offline'}
          </div>
          {/* Refresh products from server */}
          <button
            onClick={handleDownloadProducts}
            disabled={syncingProducts}
            title="Download latest menu from server"
            className="p-1.5 rounded-lg text-surface-400 hover:text-surface-200 hover:bg-surface-800 transition-colors"
          >
            <svg className={`w-4 h-4 ${syncingProducts ? 'animate-spin text-primary-400' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          {/* Pending sync badge */}
          {pendingCount > 0 && (
            <button onClick={performSync} className="flex items-center gap-1 px-2 py-1 rounded-full bg-warning-500/20 text-warning-500 text-xs font-medium animate-pulse">
              🔄 {pendingCount}
            </button>
          )}
          {/* Dashboard link */}
          <Link to="/dashboard" className="p-2 rounded-lg text-surface-400 hover:text-surface-200">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
          </Link>
        </div>
      </header>

      {/* Search bar */}
      <div className="px-4 py-2 bg-surface-900/50">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search products..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-surface-800 border border-surface-700/50 text-surface-100 text-sm placeholder:text-surface-500 focus:outline-none focus:border-primary-500"
          />
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex gap-2 px-4 py-2 overflow-x-auto no-scrollbar">
        <button
          onClick={() => setActiveCategory(null)}
          className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
            activeCategory === null ? 'bg-primary-600 text-white' : 'bg-surface-800 text-surface-300 hover:bg-surface-700'
          }`}
        >
          All
        </button>
        {categories.map(cat => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
              activeCategory === cat.id ? 'bg-primary-600 text-white' : 'bg-surface-800 text-surface-300 hover:bg-surface-700'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Product grid */}
      <div className="flex-1 overflow-y-auto px-4 py-3 pb-24">
        {filteredProducts.length === 0 ? (
          <div className="text-center py-12 px-4">
            <span className="text-4xl mb-3 block">📦</span>
            <p className="text-surface-200 font-semibold text-lg">
              {searchQuery ? 'No products match search' : 'No products loaded yet'}
            </p>
            {products.length === 0 ? (
              <>
                <p className="text-surface-400 text-sm mt-1 max-w-xs mx-auto">
                  Download your menu from the laptop to use this POS offline.
                </p>
                <button
                  onClick={handleDownloadProducts}
                  disabled={syncingProducts}
                  className="mt-4 px-6 py-3 rounded-xl bg-primary-600 text-white font-medium hover:bg-primary-500 transition-all flex items-center justify-center gap-2 mx-auto disabled:opacity-50"
                >
                  {syncingProducts ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Downloading...
                    </>
                  ) : (
                    <>
                      <span>🔄</span> Download Menu & Products
                    </>
                  )}
                </button>
                {downloadError && (
                  <p className="text-danger-400 text-xs mt-3 bg-danger-500/10 py-2 px-3 rounded-lg border border-danger-500/20 max-w-xs mx-auto">
                    {downloadError}
                  </p>
                )}
              </>
            ) : (
              <p className="text-surface-500 text-sm mt-2">Try clearing search or filters</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {filteredProducts.map(product => {
              const cartItem = items.find(i => i.product_id === product.id);
              const inCart = cartItem ? cartItem.quantity : 0;

              return (
                <button
                  key={product.id}
                  onClick={() => addItem(product)}
                  className={`relative bg-surface-800/70 rounded-xl p-3 border text-left transition-all active:scale-[0.97] hover:border-primary-500/50 ${
                    inCart > 0 ? 'border-primary-500/40 bg-primary-500/5' : 'border-surface-700/50'
                  }`}
                >
                  {/* Quantity badge */}
                  {inCart > 0 && (
                    <div className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-primary-600 text-white text-xs font-bold flex items-center justify-center shadow-lg">
                      {inCart}
                    </div>
                  )}

                  <p className="text-surface-100 font-medium text-sm leading-tight line-clamp-2">{product.name}</p>
                  <p className="text-primary-400 font-bold text-sm mt-2">{formatCurrency(product.selling_price)}</p>
                  {product.current_stock <= product.low_stock_threshold && (
                    <p className={`text-xs mt-1 ${product.current_stock === 0 ? 'text-danger-500' : 'text-warning-500'}`}>
                      {product.current_stock === 0 ? 'Out of stock' : `${product.current_stock} left`}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating cart button */}
      {itemCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 p-4 safe-area-bottom z-20">
          <button
            onClick={() => setView('cart')}
            className="w-full py-4 rounded-2xl bg-primary-600 text-white font-bold flex items-center justify-between px-6 shadow-2xl shadow-primary-600/30 hover:bg-primary-500 transition-all active:scale-[0.98]"
          >
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center text-sm font-bold">{itemCount}</span>
              <span>View Cart</span>
            </div>
            <span className="text-lg">{formatCurrency(total)}</span>
          </button>
        </div>
      )}
    </div>
  );
}
