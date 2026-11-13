/**
 * POS Page - Full mobile-first ordering interface
 * 
 * Features:
 * - Multi-business Department Ribbon & Category tabs
 * - Camera Barcode Scanner with live camera & beep/vibrate
 * - Order Holding / Parking (Hold Order, Recall Held Orders)
 * - Discounts (Senior / PWD 20%, Custom %, Custom ₱)
 * - Custom / Open Item quick sale
 * - Wholesale / Pakyawan Mode 1-tap toggling
 * - Product grid with quick-add & stock indicators
 * - Slide-up cart drawer with quantity controls
 * - Checkout flow with payment methods, tendered & change calculator
 * - Direct Online Server Write + Offline IndexedDB auto-sync fallback
 * - Full Receipt view with itemized discount & print/new sale buttons
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useCartStore } from '../../features/cart/cartStore';
import { useSyncStore } from '../../features/sync/syncStore';
import { formatCurrency } from '../../utils/currency';
import { generateUUID } from '../../utils/uuid';
import { nowISO, formatDateTime } from '../../utils/date';
import { saveSale, generateReceiptNumber } from '../../db/salesRepository';
import { getActiveProducts, getAllCategories, getAllPaymentMethods, adjustProductStock } from '../../db/productRepository';
import { creditSaleToDailyClosing } from '../../db/closingRepository';
import { fetchProductUpdates, syncSalesToServer } from '../../api/sync';
import { replaceAllProducts, replaceAllCategories, replaceAllPaymentMethods, setLastProductSync } from '../../db/productRepository';
import { getCategoryIcon, type Product, type Category, type BusinessType, type BusinessDepartment } from '../../types/product';
import { getAllBusinessDepartments } from '../../utils/businessStorage';
import type { PaymentMethod, PendingSale, SplitPaymentLine } from '../../types/sale';
import { getAllCustomers, recordLocalCreditCharge } from '../../db/customerRepository';
import type { Customer } from '../../types/customer';
import { BarcodeScannerModal } from '../../components/pos/BarcodeScannerModal';
import { soundEffects } from '../../utils/soundEffects';
import { isValidImageUrl } from '../../utils/imageCompressor';

type POSView = 'menu' | 'cart' | 'checkout' | 'receipt';
type DiscountType = 'none' | 'senior_pwd' | 'percent' | 'fixed';

export interface ProductGroup {
  id: string;
  baseName: string;
  isGroup: boolean;
  category_name?: string;
  image_path?: string | null;
  items: Product[];
  minPrice: number;
  maxPrice: number;
  inCartCount: number;
  totalStock?: number;
}

export function POSPage() {
  const isOnline = useOnlineStatus();
  const {
    items,
    addItem,
    addItemByWeight,
    removeItem,
    incrementItem,
    decrementItem,
    clearCart,
    getItemCount,
    getSubtotal,
    parkCurrentCart,
    recallParkedCart,
    removeParkedCart,
    parkedCarts,
    addCustomItem,
    isWholesaleMode,
    toggleWholesaleMode,
  } = useCartStore();
  const { pendingCount, performSync, refreshCounts } = useSyncStore();

  const [view, setView] = useState<POSView>('menu');
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [activeCategory, setActiveCategory] = useState<number | null>(null);
  const [departments, setDepartments] = useState<BusinessDepartment[]>(() => getAllBusinessDepartments());
  const [selectedDept, setSelectedDept] = useState<BusinessType>('barbeque');

  // Rice / Variant Selection & Weight Keypad States
  const [selectedGroupForModal, setSelectedGroupForModal] = useState<ProductGroup | null>(null);
  const [weightModalProduct, setWeightModalProduct] = useState<Product | null>(null);
  const [weightInput, setWeightInput] = useState<string>('1.00');

  // Scanner, Hold, Custom Item, Discount States
  const [showScanner, setShowScanner] = useState(false);
  const [showHeldModal, setShowHeldModal] = useState(false);
  const [showParkModal, setShowParkModal] = useState(false);
  const [parkCustomerName, setParkCustomerName] = useState('');
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customPrice, setCustomPrice] = useState('');

  // Discount State
  const [discountType, setDiscountType] = useState<DiscountType>('none');
  const [discountPercent, setDiscountPercent] = useState<number>(0);
  const [discountFixed, setDiscountFixed] = useState<number>(0);

  // Toast message
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  useEffect(() => {
    const handleDeptUpdated = () => {
      setDepartments(getAllBusinessDepartments());
    };
    window.addEventListener('pos_departments_updated', handleDeptUpdated);
    return () => window.removeEventListener('pos_departments_updated', handleDeptUpdated);
  }, []);

  const getDeptOfCategory = (cat: Category): BusinessType => {
    if (cat.business_type) return cat.business_type;
    const n = cat.name.toLowerCase();
    if (n.includes('bbq') || n.includes('ihaw') || n.includes('barbeque')) return 'barbeque';
    if (n.includes('rice') || n.includes('bigas')) return 'rice';
    if (n.includes('gulay') || n.includes('vegetable')) return 'vegetables';
    return 'groceries';
  };

  const deptCategories = useMemo(() => {
    // Only include categories that actually have active products to sell in this department!
    const activeCatIds = new Set(
      products
        .filter(p => {
          if (!p.is_active || p.item_type === 'supply') return false;
          if (p.business_type) return p.business_type === selectedDept;
          const c = categories.find(cat => cat.id === p.category_id);
          return c ? getDeptOfCategory(c) === selectedDept : selectedDept === 'groceries';
        })
        .map(p => p.category_id)
    );
    return categories.filter(c => getDeptOfCategory(c) === selectedDept && activeCatIds.has(c.id));
  }, [categories, selectedDept, products]);

  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [syncingProducts, setSyncingProducts] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<PendingSale | null>(null);

  // Customer & Suki state for credit/utang
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);

  // Cashier management state
  const cashierList = useMemo<string[]>(() => {
    try {
      const s = JSON.parse(localStorage.getItem('pos_app_settings') || '{}');
      if (s.cashier_list && typeof s.cashier_list === 'string') {
        const list = s.cashier_list.split(',').map((c: string) => c.trim()).filter(Boolean);
        if (list.length > 0) return list;
      }
    } catch {}
    return ['Cashier 1', 'Manager'];
  }, []);

  const [activeCashier, setActiveCashier] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('pos_active_cashier');
      if (saved) return saved;
      const s = JSON.parse(localStorage.getItem('pos_app_settings') || '{}');
      if (s.cashier_list) {
        const list = s.cashier_list.split(',').map((c: string) => c.trim()).filter(Boolean);
        if (list[0]) return list[0];
      }
    } catch {}
    return 'Cashier 1';
  });
  const [showCashierModal, setShowCashierModal] = useState(false);
  const [newCashierInput, setNewCashierInput] = useState('');

  // Split payment state
  const [isSplitPayment, setIsSplitPayment] = useState(false);
  const [splitLines, setSplitLines] = useState<SplitPaymentLine[]>([
    { method_id: 1, method_name: 'Cash', amount: 0, reference: '' },
    { method_id: 2, method_name: 'GCash', amount: 0, reference: '' },
  ]);

  // Store Settings for Receipt Printing
  const storeSettings = useMemo(() => {
    try {
      const s = JSON.parse(localStorage.getItem('pos_app_settings') || '{}');
      return {
        store_name: s.store_name || 'AKING TINDAHAN',
        store_subtitle: s.store_subtitle || '',
        store_logo: s.store_logo || null,
        store_address: s.store_address || '',
        store_contact: s.store_contact || '',
        receipt_header: s.receipt_header || '*** OFFICIAL SALES RECEIPT ***',
        receipt_footer: s.receipt_footer || 'Maraming Salamat Po sa Inyong Pagtangkilik! Balik Kayo!',
        printer_width: s.printer_width || '58mm',
      };
    } catch {}
    return {
      store_name: 'AKING TINDAHAN',
      store_subtitle: '',
      store_logo: null,
      store_address: '',
      store_contact: '',
      receipt_header: '*** OFFICIAL SALES RECEIPT ***',
      receipt_footer: 'Maraming Salamat Po sa Inyong Pagtangkilik! Balik Kayo!',
      printer_width: '58mm',
    };
  }, [view]);

  // Checkout state
  const [paymentMethodId, setPaymentMethodId] = useState(1);
  const [cashTendered, setCashTendered] = useState<number>(0);
  const [paymentRef, setPaymentRef] = useState('');
  const [notes, setNotes] = useState('');
  const [processing, setProcessing] = useState(false);

  const itemCount = getItemCount();
  const subtotal = getSubtotal();

  // Dynamic Discount Calculation
  const discountAmount = useMemo(() => {
    if (discountType === 'senior_pwd') {
      return Math.round(subtotal * 0.20 * 100) / 100;
    }
    if (discountType === 'percent') {
      return Math.round(subtotal * (discountPercent / 100) * 100) / 100;
    }
    if (discountType === 'fixed') {
      return Math.min(subtotal, discountFixed);
    }
    return 0;
  }, [subtotal, discountType, discountPercent, discountFixed]);

  const total = Math.max(0, subtotal - discountAmount);

  // Load active customers and auto-fill split lines when entering checkout
  useEffect(() => {
    if (view === 'checkout') {
      getAllCustomers().then(c => setCustomers(c.filter(cust => cust.is_active))).catch(() => {});
      const sum = splitLines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
      if (sum === 0 && total > 0) {
        setSplitLines([
          { method_id: 1, method_name: 'Cash', amount: Math.ceil(total / 2), reference: '' },
          { method_id: 2, method_name: 'GCash', amount: Math.floor(total / 2), reference: '' },
        ]);
      }
    }
  }, [view, total]);

  // Load products from IndexedDB (offline-first) and listen for inventory updates
  useEffect(() => {
    loadLocalData();

    const handleInvUpdate = async () => {
      const prods = await getActiveProducts();
      setProducts(prods.filter(p => p.item_type !== 'supply'));
    };
    window.addEventListener('pos_inventory_updated', handleInvUpdate);
    window.addEventListener('pos_sync_completed', handleInvUpdate);
    window.addEventListener('focus', loadLocalData);
    const handleVis = () => {
      if (document.visibilityState === 'visible') loadLocalData();
    };
    document.addEventListener('visibilitychange', handleVis);

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel('pos_channel');
      channel.onmessage = (event) => {
        if (event.data?.type === 'INVENTORY_UPDATED' || event.data?.type === 'SYNC_COMPLETED') {
          handleInvUpdate();
        }
      };
    } catch (_) {}

    return () => {
      window.removeEventListener('pos_inventory_updated', handleInvUpdate);
      window.removeEventListener('pos_sync_completed', handleInvUpdate);
      window.removeEventListener('focus', loadLocalData);
      document.removeEventListener('visibilitychange', handleVis);
      if (channel) channel.close();
    };
  }, []);

  async function handleDownloadProducts() {
    setSyncingProducts(true);
    try {
      const data = await fetchProductUpdates();
      if (data.products && data.products.length > 0) {
        await replaceAllProducts(data.products);
        await replaceAllCategories(data.categories);
        await replaceAllPaymentMethods(data.payment_methods);
        await setLastProductSync(data.server_time);
        // Only show products (not supplies) in POS
        setProducts(data.products.filter(p => p.is_active && p.item_type !== 'supply'));
        setCategories(data.categories);
        setPaymentMethods(data.payment_methods.filter(m => m.is_active));
        showToast('✅ Na-download ang menu mula sa server!');
      }
    } catch (err) {
      showToast('⚠️ ' + (err instanceof Error ? err.message : 'Failed to reach server'));
    } finally {
      setSyncingProducts(false);
    }
  }

  async function loadLocalData() {
    try {
      const [prods, cats, methods] = await Promise.all([
        getActiveProducts(),
        getAllCategories(),
        getAllPaymentMethods(),
      ]);

      if (prods.length > 0) {
        setProducts(prods.filter(p => p.item_type !== 'supply'));
        setCategories(cats);
        setPaymentMethods(methods.length > 0 ? methods : [{ id: 1, name: 'Cash', is_active: true, sort_order: 1 }]);
        setLoading(false);
      }

      try {
        const data = await fetchProductUpdates();
        if (data.products && data.products.length > 0) {
          await replaceAllProducts(data.products);
          await replaceAllCategories(data.categories);
          await replaceAllPaymentMethods(data.payment_methods);
          await setLastProductSync(data.server_time);
          setProducts(data.products.filter(p => p.is_active && p.item_type !== 'supply'));
          setCategories(data.categories);
          setPaymentMethods(data.payment_methods.filter(m => m.is_active));
        }
      } catch (err) {
        console.warn('Background product stock refresh skipped (offline or network error):', err);
      }
    } finally {
      setLoading(false);
    }
  }

  // Barcode scanned handler
  function handleBarcodeScanned(barcode: string) {
    const raw = barcode.trim();
    const clean = raw.toLowerCase();
    const found = products.find(p => p.sku?.toLowerCase() === clean || p.name.toLowerCase().includes(clean));
    if (found) {
      // Check negative stock setting
      const allowNeg = localStorage.getItem('pos_allow_negative_stock') !== 'false';
      if (!allowNeg && (found.current_stock ?? 0) <= 0) {
        soundEffects.playWarningTone();
        showToast(`⚠️ Ubos na ang stock ng "${found.name}" (0 pcs)!`);
        return;
      }

      if (found.sell_by_weight || found.unit === 'kg') {
        soundEffects.playBeep();
        setWeightModalProduct(found);
        setWeightInput('1.00');
      } else {
        addItem(found);
        soundEffects.playBeep();
        showToast(`✅ Naidagdag sa Cart: ${found.name}`);
      }
    } else {
      soundEffects.playWarningTone();
      alert(`Hindi nahanap sa menu ang barcode: "${raw}". Maaari mo itong idagdag gamit ang + Custom Item o hanapin sa search bar.`);
    }
  }

  // Hold / Park Cart handler
  function handleHoldOrderSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (items.length === 0) return;
    const name = parkCustomerName.trim() || 'Customer';
    const success = parkCurrentCart(name);
    if (success) {
      setShowParkModal(false);
      setParkCustomerName('');
      setView('menu');
      showToast(`⏸️ Naka-hold na ang order para kay "${name}"!`);
    }
  }

  // Custom Item add handler
  function handleAddCustomItemSubmit(e: React.FormEvent) {
    e.preventDefault();
    const price = parseFloat(customPrice);
    if (!customName.trim() || isNaN(price) || price < 0) {
      alert('Maglagay ng wastong pangalan at presyo ng item.');
      return;
    }
    addCustomItem(customName.trim(), price, 1);
    soundEffects.playBeep();
    setShowCustomModal(false);
    setCustomName('');
    setCustomPrice('');
    showToast(`✅ Naidagdag: ${customName} (${formatCurrency(price)})`);
  }

  // Filter products strictly scoped to selected Business Department
  const filteredProducts = useMemo(() => {
    let result = products.filter(p => {
      if (p.business_type) return p.business_type === selectedDept;
      const c = categories.find(cat => cat.id === p.category_id);
      return c ? getDeptOfCategory(c) === selectedDept : selectedDept === 'groceries';
    });
    if (activeCategory !== null) {
      result = result.filter(p => p.category_id === activeCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(p => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
    }
    return result;
  }, [products, selectedDept, activeCategory, searchQuery, categories]);

  // Memoized grouped products for clean display (e.g. Buco Pandan with 3 variants)
  const displayCards = useMemo<ProductGroup[]>(() => {
    const groupMap = new Map<string, Product[]>();

    for (const prod of filteredProducts) {
      const dashIdx = prod.name.lastIndexOf(' - ');
      const base = dashIdx !== -1 ? prod.name.substring(0, dashIdx).trim() : prod.name.trim();

      if (!groupMap.has(base)) {
        groupMap.set(base, []);
      }
      groupMap.get(base)!.push(prod);
    }

    const cards: ProductGroup[] = [];

    for (const [baseName, prods] of groupMap.entries()) {
      const isGroup = prods.length > 1;

      const prices = prods.map(p =>
        isWholesaleMode && (p.reseller_price ?? 0) > 0 ? (p.reseller_price ?? p.selling_price) : p.selling_price
      );
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);

      const inCartCount = prods.reduce((sum, p) => {
        const c = items.find(i => i.product_id === p.id);
        return sum + (c ? (c.sell_by_weight ? 1 : c.quantity) : 0);
      }, 0);

      cards.push({
        id: isGroup ? `group-${baseName}` : String(prods[0].id),
        baseName,
        isGroup,
        category_name: prods[0].category_name,
        image_path: prods[0].image_path ?? null,
        items: prods,
        minPrice,
        maxPrice,
        inCartCount,
        totalStock: isGroup ? undefined : prods[0].current_stock,
      });
    }

    return cards;
  }, [filteredProducts, isWholesaleMode, items]);

  // Desktop POS Keyboard Shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT';

      // F2: Focus Search
      if (e.key === 'F2') {
        e.preventDefault();
        if (view !== 'menu') setView('menu');
        setTimeout(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }, 50);
        return;
      }

      // F4: Open Custom Item Modal
      if (e.key === 'F4') {
        e.preventDefault();
        setShowCustomModal(true);
        return;
      }

      // F8: Checkout
      if (e.key === 'F8') {
        e.preventDefault();
        if (items.length > 0 && view !== 'checkout') {
          setView('checkout');
        }
        return;
      }

      // Escape: Close modals, back to menu, or clear search
      if (e.key === 'Escape') {
        if (showCustomModal) { setShowCustomModal(false); return; }
        if (showScanner) { setShowScanner(false); return; }
        if (showHeldModal) { setShowHeldModal(false); return; }
        if (showParkModal) { setShowParkModal(false); return; }
        if (selectedGroupForModal) { setSelectedGroupForModal(null); return; }
        if (weightModalProduct) { setWeightModalProduct(null); return; }
        if (view === 'checkout') { setView('menu'); return; }
        if (searchQuery) {
          setSearchQuery('');
          searchInputRef.current?.blur();
          return;
        }
      }

      // '/' to quick search if not typing in an input
      if (e.key === '/' && !isInput && view === 'menu') {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [items.length, view, showCustomModal, showScanner, showHeldModal, showParkModal, selectedGroupForModal, weightModalProduct, searchQuery]);

  // Enter key inside search bar (for hardware barcode scanners or quick add)
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return;

      // 1. Exact SKU / Barcode match among all active products
      const exactMatch = products.find(p => p.sku?.toLowerCase() === q || p.name.toLowerCase() === q);
      if (exactMatch) {
        e.preventDefault();
        handleBarcodeScanned(exactMatch.sku || exactMatch.name);
        setSearchQuery('');
        return;
      }

      // 2. If exactly 1 product matched in current filtered list
      if (filteredProducts.length === 1) {
        e.preventDefault();
        const p = filteredProducts[0];
        handleBarcodeScanned(p.sku || p.name);
        setSearchQuery('');
        return;
      }
    }
  };

  // Process checkout
  async function handleCheckout() {
    if (items.length === 0) return;
    setProcessing(true);

    try {
      const receiptNumber = await generateReceiptNumber();
      const selectedMethod = paymentMethods.find(m => m.id === paymentMethodId);
      const selectedCustomer = customers.find(c => c.id === selectedCustomerId);

      let finalPaymentMethodName = selectedMethod?.name ?? 'Cash';
      let finalCashTendered: number | null = selectedMethod?.name === 'Cash' ? cashTendered : null;
      let finalChangeAmount: number | null = selectedMethod?.name === 'Cash' ? Math.max(0, cashTendered - total) : null;
      let finalSplitPayments: SplitPaymentLine[] | null = null;
      let utangAmountToRecord = 0;

      if (isSplitPayment) {
        const validSplits: SplitPaymentLine[] = splitLines.map(l => ({
          method_id: l.method_id,
          method_name: l.method_name,
          amount: Number(l.amount) || 0,
          reference: l.reference ? l.reference.trim() : null,
        }));
        finalSplitPayments = validSplits;
        finalPaymentMethodName = 'Split (' + validSplits.map(l => `${l.method_name}: ₱${l.amount.toFixed(2)}`).join(' + ') + ')';

        const cashLine = validSplits.find(l => l.method_name.toLowerCase().includes('cash'));
        const totalSplitAmount = validSplits.reduce((sum, l) => sum + l.amount, 0);

        if (cashLine && totalSplitAmount > total) {
          finalCashTendered = cashLine.amount;
          finalChangeAmount = totalSplitAmount - total;
        } else if (cashLine) {
          finalCashTendered = cashLine.amount;
          finalChangeAmount = null;
        } else {
          finalCashTendered = null;
          finalChangeAmount = null;
        }

        const utangLines = validSplits.filter(l => l.method_name.toLowerCase().includes('utang') || l.method_name.toLowerCase().includes('credit'));
        utangAmountToRecord = utangLines.reduce((sum, l) => sum + l.amount, 0);
      } else {
        if (finalPaymentMethodName.toLowerCase().includes('utang') || finalPaymentMethodName.toLowerCase().includes('credit')) {
          utangAmountToRecord = total;
        }
      }

      const sale: PendingSale = {
        uuid: generateUUID(),
        receipt_number: receiptNumber,
        items: items.map(i => ({ ...i })),
        subtotal,
        discount_amount: discountAmount,
        tax_amount: 0,
        total_amount: total,
        cash_tendered: finalCashTendered,
        change_amount: finalChangeAmount,
        payment_method_id: isSplitPayment ? 99 : paymentMethodId,
        payment_method_name: finalPaymentMethodName,
        payment_reference: isSplitPayment ? null : (paymentRef || null),
        split_payments: finalSplitPayments,
        customer_id: selectedCustomerId,
        customer_name: selectedCustomer?.name || null,
        cashier_name: activeCashier,
        source_device: localStorage.getItem('pos_device_id') ?? 'unknown',
        notes: notes || null,
        sold_at: nowISO(),
        sync_status: 'PENDING',
        created_at: nowISO(),
      };

      // ── Direct Online Write ──
      try {
        if (typeof navigator === 'undefined' || navigator.onLine) {
          const syncRes = await syncSalesToServer([sale]);
          if (syncRes && (syncRes.synced?.length > 0 || syncRes.duplicates?.length > 0)) {
            sale.sync_status = 'SYNCED';
            sale.synced_at = new Date().toISOString();
          }
        }
      } catch (directErr) {
        console.info('Offline transaction queued for auto-sync:', directErr);
        sale.sync_status = 'PENDING';
      }

      await saveSale(sale);

      // Record credit charge locally in customer ledger if utang was used
      if (utangAmountToRecord > 0 && selectedCustomerId) {
        try {
          await recordLocalCreditCharge(selectedCustomerId, sale, utangAmountToRecord);
        } catch (credErr) {
          console.warn('Could not record credit charge locally:', credErr);
        }
      }

      // Instantly deduct local stock in IndexedDB and record movement log
      for (const item of sale.items) {
        try {
          await adjustProductStock(
            item.product_id,
            -item.quantity,
            'SALE',
            `POS Resibo #${sale.receipt_number}`
          );
        } catch (stockErr) {
          console.warn(`Could not adjust stock for ${item.product_name}:`, stockErr);
        }
      }

      // Automatically credit POS transaction to today's Daily Closing draft
      try {
        await creditSaleToDailyClosing(sale);
      } catch (closingErr) {
        console.warn('Could not credit sale to daily closing:', closingErr);
      }

      // Update in-memory product stock in POS screen
      setProducts(prev =>
        prev.map(p => {
          const sold = sale.items.find(i => i.product_id === p.id);
          if (sold) {
            return { ...p, current_stock: Math.max(0, (p.current_stock || 0) - sold.quantity) };
          }
          return p;
        })
      );

      setLastReceipt(sale);
      clearCart();
      setCashTendered(0);
      setPaymentRef('');
      setNotes('');
      setDiscountType('none');
      setDiscountPercent(0);
      setDiscountFixed(0);
      setView('receipt');
      refreshCounts();

      // Sound effect & auto-print receipt
      soundEffects.playSuccessChime();
      if (typeof window !== 'undefined' && localStorage.getItem('pos_auto_print_receipt') === 'true') {
        setTimeout(() => {
          window.print();
        }, 400);
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('pos_sale_completed'));
        try {
          const ch = new BroadcastChannel('pos_channel');
          ch.postMessage({ type: 'SALE_COMPLETED', timestamp: Date.now() });
          ch.close();
        } catch (_) {}
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Checkout failed');
    } finally {
      setProcessing(false);
    }
  }

  function startNewSale() {
    setLastReceipt(null);
    setDiscountType('none');
    setDiscountPercent(0);
    setDiscountFixed(0);
    setSelectedCustomerId(null);
    setIsSplitPayment(false);
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
      <div className="min-h-dvh bg-surface-950 flex flex-col justify-center items-center p-3 sm:p-4">
        {/* On-Screen Card Preview */}
        <div className="w-full max-w-sm bg-surface-850 rounded-2xl border border-surface-700 p-5 sm:p-6 shadow-2xl animate-fade-in no-print">
          {/* Success header */}
          <div className="text-center mb-4">
            <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-2 shadow-inner">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            {storeSettings.store_logo && (
              <img
                src={storeSettings.store_logo}
                alt="Logo"
                className="w-12 h-12 mx-auto mb-2 rounded-xl object-cover border border-surface-700/60 shadow-xs"
              />
            )}
            <h2 className="text-base sm:text-lg font-black text-surface-50">{storeSettings.store_name}</h2>
            <p className="text-emerald-400 font-bold text-xs mt-0.5">✓ Transaction Completed!</p>
          </div>

          {/* Receipt details */}
          <div className="space-y-2 text-xs border-t border-dashed border-surface-700/80 pt-3">
            <div className="flex justify-between">
              <span className="text-surface-400">Receipt #:</span>
              <span className="text-surface-100 font-mono font-bold">{lastReceipt.receipt_number}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-surface-400">Cashier:</span>
              <span className="text-surface-200 font-semibold">{lastReceipt.cashier_name || activeCashier}</span>
            </div>
            {lastReceipt.customer_name && (
              <div className="flex justify-between">
                <span className="text-surface-400">Customer:</span>
                <span className="text-amber-300 font-bold">{lastReceipt.customer_name}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-surface-400">Items:</span>
              <span className="text-surface-200 font-semibold">{lastReceipt.items.length} items</span>
            </div>

            <div className="max-h-40 overflow-y-auto space-y-1 pl-2 border-l border-surface-750 my-1 py-1">
              {lastReceipt.items.map((item, i) => (
                <div key={i} className="flex justify-between text-[11px]">
                  <span className="text-surface-300 truncate max-w-[65%]">
                    {item.sell_by_weight ? `${item.quantity.toFixed(2)} kg × ` : `${item.quantity}× `}{item.product_name}
                  </span>
                  <span className="text-surface-200 font-mono font-medium">{formatCurrency(item.line_total)}</span>
                </div>
              ))}
            </div>

            <div className="border-t border-dashed border-surface-700/80 pt-2 space-y-1">
              <div className="flex justify-between text-surface-400">
                <span>Subtotal</span>
                <span className="font-mono">{formatCurrency(lastReceipt.subtotal)}</span>
              </div>
              {Number(lastReceipt.discount_amount) > 0 && (
                <div className="flex justify-between text-amber-400 font-bold">
                  <span>Discount</span>
                  <span className="font-mono">-{formatCurrency(lastReceipt.discount_amount)}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-black pt-1 border-t border-surface-750">
                <span className="text-surface-100">Total</span>
                <span className="text-emerald-400 font-mono">{formatCurrency(lastReceipt.total_amount)}</span>
              </div>
            </div>

            {/* Payment Info */}
            <div className="pt-2 border-t border-surface-750 space-y-1">
              <div className="flex justify-between">
                <span className="text-surface-400">Payment Method:</span>
                <span className="text-surface-200 font-bold">{lastReceipt.payment_method_name}</span>
              </div>

              {/* Split payment tender breakdown */}
              {lastReceipt.split_payments && lastReceipt.split_payments.length > 0 && (
                <div className="p-2 rounded-lg bg-surface-900 border border-surface-750 space-y-1 mt-1">
                  <p className="text-[10px] uppercase font-bold text-surface-400 tracking-wider">Split Payment Breakdown:</p>
                  {lastReceipt.split_payments.map((sp, idx) => (
                    <div key={idx} className="flex justify-between text-[11px]">
                      <span className="text-surface-300">• {sp.method_name} {sp.reference ? `(${sp.reference})` : ''}</span>
                      <span className="text-surface-100 font-mono font-bold">{formatCurrency(sp.amount)}</span>
                    </div>
                  ))}
                </div>
              )}

              {lastReceipt.cash_tendered !== null && lastReceipt.cash_tendered !== undefined && (
                <div className="flex justify-between">
                  <span className="text-surface-400">Cash Tendered:</span>
                  <span className="text-surface-100 font-mono">{formatCurrency(lastReceipt.cash_tendered)}</span>
                </div>
              )}
              {lastReceipt.change_amount !== null && lastReceipt.change_amount !== undefined && (
                <div className="flex justify-between font-black text-sm pt-0.5 text-emerald-400">
                  <span>Change Due:</span>
                  <span className="font-mono">{formatCurrency(lastReceipt.change_amount)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Sync status badge */}
          <div className={`mt-3 p-2.5 rounded-xl text-center ${
            lastReceipt.sync_status === 'SYNCED' ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-amber-500/10 border border-amber-500/20'
          }`}>
            <p className={`text-xs font-semibold ${lastReceipt.sync_status === 'SYNCED' ? 'text-emerald-400' : 'text-amber-400'}`}>
              {lastReceipt.sync_status === 'SYNCED' ? '✅ Synced with server database' : '⏳ Saved offline (Queued for background sync)'}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="mt-4 space-y-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs sm:text-sm transition-all shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 cursor-pointer active:scale-98"
            >
              <span>🖨️</span>
              <span>Print Receipt</span>
            </button>
            <button
              type="button"
              onClick={startNewSale}
              className="w-full py-2.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white font-bold text-xs sm:text-sm transition-all shadow-md cursor-pointer active:scale-98"
            >
              🛒 New Transaction
            </button>
            <button
              type="button"
              onClick={() => { performSync(); startNewSale(); }}
              className="w-full py-2 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-300 font-semibold text-xs transition-colors cursor-pointer"
            >
              🔄 Sync & New Transaction
            </button>
          </div>
        </div>

        {/* ── 58mm / 80mm Print-Only Thermal Receipt Standard ── */}
        <div
          id="thermal-receipt"
          className={`hidden font-mono text-black ${
            storeSettings.printer_width === '80mm' ? 'thermal-80mm' : 'thermal-58mm'
          }`}
        >
          {/* Store Header */}
          <div className="text-center pb-2 border-b border-dashed border-black">
            {storeSettings.store_logo && (
              <img
                src={storeSettings.store_logo}
                alt="Logo"
                className="w-12 h-12 mx-auto mb-1 object-contain grayscale"
              />
            )}
            <h2 className="font-extrabold uppercase text-sm leading-tight">
              {storeSettings.store_name}
            </h2>
            {storeSettings.store_subtitle && (
              <p className="text-[10px] font-semibold">{storeSettings.store_subtitle}</p>
            )}
            {storeSettings.store_address && (
              <p className="text-[10px] mt-0.5">{storeSettings.store_address}</p>
            )}
            {storeSettings.store_contact && (
              <p className="text-[10px]">Tel / GCash: {storeSettings.store_contact}</p>
            )}
            <p className="text-[10px] font-bold mt-1 uppercase">{storeSettings.receipt_header}</p>
            <div className="flex justify-between text-[10px] mt-1 pt-1 border-t border-dotted border-black">
              <span>Receipt #:</span>
              <span className="font-bold">{lastReceipt.receipt_number}</span>
            </div>
            <div className="flex justify-between text-[9px]">
              <span>Date / Time:</span>
              <span>{formatDateTime(lastReceipt.sold_at)}</span>
            </div>
            <div className="flex justify-between text-[9px]">
              <span>Cashier:</span>
              <span>{lastReceipt.cashier_name || activeCashier}</span>
            </div>
            {lastReceipt.customer_name && (
              <div className="flex justify-between text-[9px]">
                <span>Customer:</span>
                <span className="font-bold">{lastReceipt.customer_name}</span>
              </div>
            )}
          </div>

          {/* Itemized List */}
          <div className="py-2 border-b border-dashed border-black space-y-1">
            <div className="flex justify-between text-[9px] font-bold uppercase pb-0.5 border-b border-dotted border-black">
              <span>Item Description</span>
              <span>Amount</span>
            </div>
            {lastReceipt.items.map((item, idx) => (
              <div key={idx} className="text-[10px]">
                <div className="flex justify-between font-semibold">
                  <span className="truncate max-w-[70%]">{item.product_name}</span>
                  <span>{formatCurrency(item.line_total)}</span>
                </div>
                <div className="text-[9px] text-gray-700">
                  {item.sell_by_weight
                    ? `${item.quantity.toFixed(2)} kg @ ${formatCurrency(item.unit_price)}/kg`
                    : `${item.quantity} × ${formatCurrency(item.unit_price)}`}
                </div>
              </div>
            ))}
          </div>

          {/* Subtotal, Discount & Total */}
          <div className="py-2 border-b border-dashed border-black space-y-0.5 text-xs">
            <div className="flex justify-between text-[10px]">
              <span>Subtotal:</span>
              <span>{formatCurrency(lastReceipt.subtotal)}</span>
            </div>
            {lastReceipt.discount_amount > 0 && (
              <div className="flex justify-between text-[10px] font-bold">
                <span>Discount:</span>
                <span>-{formatCurrency(lastReceipt.discount_amount)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-black pt-1 border-t border-dotted border-black">
              <span>TOTAL:</span>
              <span>{formatCurrency(lastReceipt.total_amount)}</span>
            </div>
          </div>

          {/* Payment & Change Breakdown */}
          <div className="py-2 border-b border-dashed border-black text-[10px] space-y-1">
            <p className="font-bold uppercase text-[9px]">=== PAYMENT BREAKDOWN ===</p>
            {lastReceipt.split_payments && lastReceipt.split_payments.length > 0 ? (
              lastReceipt.split_payments.map((sp, sIdx) => (
                <div key={sIdx} className="flex justify-between">
                  <span>
                    • {sp.method_name} {sp.reference ? `(${sp.reference})` : ''}:
                  </span>
                  <span className="font-bold">{formatCurrency(sp.amount)}</span>
                </div>
              ))
            ) : (
              <div className="flex justify-between">
                <span>Payment Method:</span>
                <span className="font-bold">
                  {lastReceipt.payment_method_name} {lastReceipt.payment_reference ? `(${lastReceipt.payment_reference})` : ''}
                </span>
              </div>
            )}

            {lastReceipt.cash_tendered !== null && lastReceipt.cash_tendered !== undefined && (
              <div className="flex justify-between pt-0.5">
                <span>Cash Tendered:</span>
                <span>{formatCurrency(lastReceipt.cash_tendered)}</span>
              </div>
            )}
            {lastReceipt.change_amount !== null && lastReceipt.change_amount !== undefined && (
              <div className="flex justify-between font-black text-xs pt-0.5 border-t border-dotted border-black">
                <span>CHANGE:</span>
                <span>{formatCurrency(lastReceipt.change_amount)}</span>
              </div>
            )}
          </div>

          {/* Footer Greeting */}
          <div className="text-center pt-2 text-[9px] space-y-0.5">
            <p className="font-bold">{storeSettings.receipt_footer}</p>
            <p className="text-[8px] text-gray-500">POS Offline & Inverted Sync System</p>
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
    const isUtangSingle = selectedMethod?.name.toLowerCase().includes('utang') || selectedMethod?.name.toLowerCase().includes('credit');
    const selectedCustomer = customers.find(c => c.id === selectedCustomerId);

    // Split payment calculations
    const splitTotal = splitLines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
    const splitHasCash = splitLines.some(l => l.method_name.toLowerCase().includes('cash'));
    const splitDifference = splitTotal - total;
    const splitChange = splitHasCash && splitDifference > 0 ? splitDifference : 0;
    const splitRemaining = Math.max(0, total - splitTotal);

    let canCheckout = false;
    let changeAmount = 0;

    if (isSplitPayment) {
      // Split payment mode:
      canCheckout = items.length > 0 && (
        (Math.abs(splitTotal - total) < 0.01) ||
        (splitTotal > total && splitHasCash)
      );
      changeAmount = splitChange;
    } else {
      // Single payment mode:
      if (isCash) {
        canCheckout = items.length > 0 && cashTendered >= total;
        changeAmount = Math.max(0, cashTendered - total);
      } else if (isUtangSingle) {
        canCheckout = items.length > 0 && selectedCustomerId !== null;
        changeAmount = 0;
      } else {
        canCheckout = items.length > 0;
        changeAmount = 0;
      }
    }

    // Available payment methods including Utang if customer is selected
    const availableMethods = [...paymentMethods];
    if (selectedCustomerId !== null && !availableMethods.some(m => m.name.toLowerCase().includes('utang'))) {
      availableMethods.push({
        id: 9999,
        name: 'Utang / Suki Credit',
        is_active: true,
        sort_order: 99,
      });
    }

    const updateSplitLine = (index: number, field: keyof SplitPaymentLine, value: any) => {
      setSplitLines(prev => {
        const updated = [...prev];
        updated[index] = { ...updated[index], [field]: value };
        return updated;
      });
    };

    const removeSplitLine = (index: number) => {
      if (splitLines.length <= 1) return;
      setSplitLines(prev => prev.filter((_, i) => i !== index));
    };

    const addSplitLine = () => {
      const currentSum = splitLines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
      const remaining = Math.max(0, total - currentSum);
      setSplitLines(prev => [
        ...prev,
        { method_id: 2, method_name: 'GCash', amount: remaining, reference: '' },
      ]);
    };

    return (
      <div className="min-h-dvh bg-surface-950 flex flex-col">
        {/* Header */}
        <header className="flex items-center gap-3 px-4 py-3 bg-surface-900 border-b border-surface-700/50">
          <button onClick={() => setView('menu')} className="p-2 rounded-lg text-surface-400 hover:text-surface-200 cursor-pointer" title="Bumalik sa Menu (Esc)">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base sm:text-lg font-bold text-surface-100 flex items-center gap-2">
              <span>Checkout</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30 font-medium">
                👤 {activeCashier}
              </span>
            </h1>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3.5 max-w-2xl mx-auto w-full">
          {/* Order summary */}
          <div className="bg-surface-800/50 rounded-2xl p-4 border border-surface-700/50 shadow-xs">
            <h3 className="text-sm font-semibold text-surface-300 mb-2.5">Order Summary</h3>
            <div className="max-h-48 overflow-y-auto divide-y divide-surface-700/30 pr-1">
              {items.map(item => (
                <div key={item.product_id} className="flex justify-between py-1.5 text-xs sm:text-sm">
                  <span className="text-surface-300 truncate max-w-[70%]">
                    {item.sell_by_weight ? `${item.quantity.toFixed(2)} kg × ` : `${item.quantity}× `}{item.product_name}
                  </span>
                  <span className="text-surface-200 font-mono font-medium">{formatCurrency(item.line_total)}</span>
                </div>
              ))}
            </div>
            
            {/* Discount Section in Checkout */}
            <div className="border-t border-surface-700/50 mt-3 pt-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-surface-300">Discount Option:</span>
                {discountAmount > 0 && (
                  <span className="font-bold text-amber-400">-{formatCurrency(discountAmount)}</span>
                )}
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                <button
                  type="button"
                  onClick={() => setDiscountType('none')}
                  className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-all border cursor-pointer ${
                    discountType === 'none' ? 'bg-surface-600 text-white border-surface-500' : 'bg-surface-800 text-surface-400 border-surface-700'
                  }`}
                >
                  Wala
                </button>
                <button
                  type="button"
                  onClick={() => setDiscountType('senior_pwd')}
                  className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-all border cursor-pointer ${
                    discountType === 'senior_pwd' ? 'bg-primary-600 text-white border-primary-500 shadow-sm' : 'bg-surface-800 text-surface-400 border-surface-700'
                  }`}
                >
                  👴 Senior (20%)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const val = prompt('Ilang porsyento ang discount? (%)', String(discountPercent || 10));
                    if (val !== null) {
                      setDiscountPercent(parseFloat(val) || 0);
                      setDiscountType('percent');
                    }
                  }}
                  className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-all border cursor-pointer ${
                    discountType === 'percent' ? 'bg-primary-600 text-white border-primary-500 shadow-sm' : 'bg-surface-800 text-surface-400 border-surface-700'
                  }`}
                >
                  %{discountType === 'percent' && discountPercent > 0 ? ` ${discountPercent}%` : ' Custom'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const val = prompt('Magkano ang discount? (₱)', String(discountFixed || 50));
                    if (val !== null) {
                      setDiscountFixed(parseFloat(val) || 0);
                      setDiscountType('fixed');
                    }
                  }}
                  className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-all border cursor-pointer ${
                    discountType === 'fixed' ? 'bg-primary-600 text-white border-primary-500 shadow-sm' : 'bg-surface-800 text-surface-400 border-surface-700'
                  }`}
                >
                  ₱{discountType === 'fixed' && discountFixed > 0 ? ` ${discountFixed}` : ' Bawas'}
                </button>
              </div>
            </div>

            <div className="border-t border-surface-700/50 mt-3 pt-3 space-y-1">
              <div className="flex justify-between text-xs text-surface-400">
                <span>Subtotal</span>
                <span className="font-mono">{formatCurrency(subtotal)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-xs text-amber-400 font-semibold">
                  <span>Bawas (Discount)</span>
                  <span className="font-mono">-{formatCurrency(discountAmount)}</span>
                </div>
              )}
              <div className="flex justify-between text-lg sm:text-xl font-black pt-1 border-t border-surface-700/60">
                <span className="text-surface-100">Kabuuan (Total)</span>
                <span className="text-emerald-400 font-mono">{formatCurrency(total)}</span>
              </div>
            </div>
          </div>

          {/* Customer / Suki Account Selector */}
          <div className="bg-surface-800/50 rounded-2xl p-4 border border-surface-700/50 shadow-xs space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs sm:text-sm font-bold text-surface-200 flex items-center gap-1.5">
                <span>👤</span> <span>Customer / Suki Account (Opsyonal)</span>
              </h3>
              {selectedCustomerId && (
                <button
                  type="button"
                  onClick={() => setSelectedCustomerId(null)}
                  className="text-xs text-rose-400 hover:text-rose-300 font-semibold cursor-pointer"
                >
                  ✕ Alisin
                </button>
              )}
            </div>

            <select
              value={selectedCustomerId ?? ''}
              onChange={e => setSelectedCustomerId(e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2.5 rounded-xl bg-surface-900 border border-surface-700 text-surface-100 text-xs sm:text-sm focus:outline-none focus:border-primary-500 font-medium"
            >
              <option value="">Walk-in Customer (Hindi nakalista)</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.current_balance > 0 ? `(May Utang: ₱${c.current_balance.toFixed(2)})` : ''}
                </option>
              ))}
            </select>

            {selectedCustomer && (
              <div className="p-3 rounded-xl bg-surface-900 border border-surface-750 text-xs space-y-1 animate-fade-in">
                <div className="flex justify-between">
                  <span className="text-surface-400">Kasalukuyang Utang ni {selectedCustomer.name}:</span>
                  <span className={`font-bold font-mono ${selectedCustomer.current_balance > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {formatCurrency(selectedCustomer.current_balance)}
                  </span>
                </div>
                {selectedCustomer.credit_limit > 0 && (
                  <div className="flex justify-between text-[11px] text-surface-500">
                    <span>Credit Limit:</span>
                    <span className="font-mono">{formatCurrency(selectedCustomer.credit_limit)}</span>
                  </div>
                )}
                <p className="text-[10px] text-sky-400/90 pt-0.5">
                  💡 Pwede itong bayaran nang buo, split payment, o ilista sa utang.
                </p>
              </div>
            )}
          </div>

          {/* Payment Section: Single vs Split Payment */}
          <div className="bg-surface-800/50 rounded-2xl p-4 border border-surface-700/50 shadow-xs space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-xs sm:text-sm font-bold text-surface-200 flex items-center gap-1.5">
                <span>💳</span> <span>Paraan ng Pagbabayad</span>
              </h3>
              {/* Payment Mode Toggle Tabs */}
              <div className="flex bg-surface-900 rounded-xl p-1 border border-surface-750">
                <button
                  type="button"
                  onClick={() => setIsSplitPayment(false)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    !isSplitPayment ? 'bg-primary-600 text-white shadow-xs' : 'text-surface-400 hover:text-surface-200'
                  }`}
                >
                  💵 Isahan (Single)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsSplitPayment(true);
                    if (splitLines.reduce((s, l) => s + (Number(l.amount) || 0), 0) === 0 && total > 0) {
                      setSplitLines([
                        { method_id: 1, method_name: 'Cash', amount: Math.ceil(total / 2), reference: '' },
                        { method_id: 2, method_name: 'GCash', amount: Math.floor(total / 2), reference: '' },
                      ]);
                    }
                  }}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    isSplitPayment ? 'bg-purple-600 text-white shadow-xs' : 'text-surface-400 hover:text-surface-200'
                  }`}
                >
                  🔀 Split Payment
                </button>
              </div>
            </div>

            {/* SINGLE PAYMENT MODE */}
            {!isSplitPayment ? (
              <div className="space-y-3 pt-1">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {availableMethods.map(m => {
                    const isSelected = paymentMethodId === m.id;
                    const isUtangBtn = m.name.toLowerCase().includes('utang') || m.name.toLowerCase().includes('credit');
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setPaymentMethodId(m.id)}
                        className={`px-3 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 border ${
                          isSelected
                            ? isUtangBtn
                              ? 'bg-amber-600 text-white border-amber-500 shadow-md scale-[1.02]'
                              : 'bg-primary-600 text-white border-primary-500 shadow-md scale-[1.02]'
                            : 'bg-surface-800 text-surface-300 border-surface-700 hover:bg-surface-750 hover:text-white'
                        }`}
                      >
                        <span>{m.name === 'Cash' ? '💵' : isUtangBtn ? '📋' : '📱'}</span>
                        <span className="truncate">{m.name}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Cash Tendered Input */}
                {isCash && (
                  <div className="bg-surface-900/80 rounded-xl p-3 border border-surface-750 space-y-2.5 animate-fade-in">
                    <div className="flex items-center justify-between text-xs text-surface-300 font-semibold">
                      <span>Halagang Natanggap (Cash Received):</span>
                      <span className="text-surface-400 font-normal">Kailangang Bayaran: {formatCurrency(total)}</span>
                    </div>
                    <input
                      type="number"
                      value={cashTendered || ''}
                      placeholder="0.00"
                      autoFocus
                      onFocus={e => e.target.select()}
                      onClick={e => (e.target as HTMLInputElement).select()}
                      onChange={e => setCashTendered(parseFloat(e.target.value) || 0)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && canCheckout && !processing) {
                          e.preventDefault();
                          handleCheckout();
                        }
                      }}
                      className="w-full py-2.5 px-3 rounded-xl bg-surface-950 border border-surface-700 text-2xl font-black text-center text-surface-50 focus:outline-none focus:border-primary-500 font-mono"
                      min={0}
                      step="0.01"
                    />

                    {/* Quick Cash Amounts */}
                    <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                      {quickCashAmounts.map(amt => (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => setCashTendered(amt)}
                          className={`py-1.5 rounded-lg text-xs font-bold transition-all border cursor-pointer ${
                            cashTendered === amt ? 'bg-primary-600 text-white border-primary-500 shadow-sm' : 'bg-surface-800 text-surface-300 border-surface-700 hover:bg-surface-750'
                          }`}
                        >
                          ₱{amt}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setCashTendered(total)}
                        className="py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-bold hover:bg-emerald-500/30 transition-colors cursor-pointer col-span-2 sm:col-span-1"
                      >
                        Exact
                      </button>
                    </div>

                    {/* Change / Kulang Display */}
                    {cashTendered > 0 && (
                      <div className={`p-3 rounded-xl text-center border animate-fade-in ${
                        cashTendered >= total ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-rose-500/10 border-rose-500/30'
                      }`}>
                        {cashTendered >= total ? (
                          <div>
                            <p className="text-surface-400 text-xs font-semibold">Sukli (Change)</p>
                            <p className="text-emerald-400 text-2xl sm:text-3xl font-black font-mono">{formatCurrency(changeAmount)}</p>
                          </div>
                        ) : (
                          <p className="text-rose-400 text-sm font-bold">
                            ⚠️ Kulang ng {formatCurrency(total - cashTendered)}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Utang Confirmation Notice */}
                {isUtangSingle && (
                  <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs space-y-1 animate-fade-in">
                    <p className="font-bold flex items-center gap-1.5">
                      <span>📋</span> <span>Ilista sa Utang ng Customer</span>
                    </p>
                    <p className="text-[11px] text-amber-200/90">
                      Ang buong halaga na <strong>{formatCurrency(total)}</strong> ay idadagdag sa listahan ng utang ni <strong>{selectedCustomer?.name}</strong>.
                    </p>
                  </div>
                )}

                {/* Payment reference for non-cash */}
                {!isCash && !isUtangSingle && (
                  <div className="bg-surface-900/80 rounded-xl p-3 border border-surface-750 space-y-1.5">
                    <label className="block text-xs font-semibold text-surface-300">Reference Number (GCash / Maya ref)</label>
                    <input
                      type="text"
                      value={paymentRef}
                      onChange={e => setPaymentRef(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-surface-950 border border-surface-700 text-surface-100 text-xs sm:text-sm focus:outline-none focus:border-primary-500"
                      placeholder="hal. 1002345892..."
                    />
                  </div>
                )}
              </div>
            ) : (
              /* SPLIT PAYMENT MODE */
              <div className="space-y-3 pt-1 animate-fade-in">
                <div className="flex items-center justify-between text-xs text-surface-300">
                  <span className="font-semibold">Mga Hatiang Bayad (Tenders):</span>
                  <button
                    type="button"
                    onClick={() => {
                      // 50/50 split quick button
                      setSplitLines([
                        { method_id: 1, method_name: 'Cash', amount: Math.ceil(total / 2), reference: '' },
                        { method_id: 2, method_name: 'GCash', amount: Math.floor(total / 2), reference: '' },
                      ]);
                    }}
                    className="text-[11px] text-purple-400 hover:text-purple-300 font-bold underline cursor-pointer"
                  >
                    50/50 Hati
                  </button>
                </div>

                {/* Tender Rows */}
                <div className="space-y-2">
                  {splitLines.map((line, idx) => {
                    const isLineCash = line.method_name.toLowerCase().includes('cash');
                    const isLineUtang = line.method_name.toLowerCase().includes('utang');

                    return (
                      <div key={idx} className="p-2.5 rounded-xl bg-surface-900 border border-surface-750 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-purple-500/20 text-purple-300 flex items-center justify-center text-[10px] font-black shrink-0">
                            {idx + 1}
                          </span>
                          
                          {/* Method Selector */}
                          <select
                            value={line.method_name}
                            onChange={e => {
                              const chosenName = e.target.value;
                              const m = availableMethods.find(m => m.name === chosenName);
                              updateSplitLine(idx, 'method_name', chosenName);
                              if (m) updateSplitLine(idx, 'method_id', m.id);
                            }}
                            className="flex-1 px-2.5 py-1.5 rounded-lg bg-surface-950 border border-surface-700 text-surface-100 text-xs font-bold focus:outline-none focus:border-purple-500"
                          >
                            {availableMethods.map(m => (
                              <option key={m.id} value={m.name}>
                                {m.name}
                              </option>
                            ))}
                          </select>

                          {/* Amount Input */}
                          <div className="relative w-32 sm:w-40">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-surface-400">₱</span>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={line.amount || ''}
                              placeholder="0.00"
                              onChange={e => updateSplitLine(idx, 'amount', parseFloat(e.target.value) || 0)}
                              className="w-full pl-6 pr-2 py-1.5 rounded-lg bg-surface-950 border border-surface-700 text-surface-100 text-xs sm:text-sm font-black font-mono text-right focus:outline-none focus:border-purple-500"
                            />
                          </div>

                          {/* Remove Tender Button */}
                          {splitLines.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeSplitLine(idx)}
                              className="p-1.5 rounded-lg text-surface-500 hover:text-rose-400 hover:bg-surface-800 transition-colors cursor-pointer"
                              title="Alisin ang tender na ito"
                            >
                              ✕
                            </button>
                          )}
                        </div>

                        {/* Reference input for non-cash & non-utang */}
                        {!isLineCash && !isLineUtang && (
                          <div className="pl-7">
                            <input
                              type="text"
                              value={line.reference || ''}
                              onChange={e => updateSplitLine(idx, 'reference', e.target.value)}
                              placeholder="Reference # (e.g. GCash Ref / Transfer ID)"
                              className="w-full px-2.5 py-1 rounded-lg bg-surface-950 border border-surface-800 text-surface-200 text-[11px] focus:outline-none focus:border-purple-500"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Add Tender Button */}
                <button
                  type="button"
                  onClick={addSplitLine}
                  className="w-full py-2 rounded-xl bg-surface-800 hover:bg-surface-750 text-purple-300 border border-purple-500/30 text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <span>➕</span>
                  <span>Magdagdag ng Isa Pang Paraan ng Bayad (Add Tender)</span>
                </button>

                {/* Split Calculation Banner */}
                <div className="p-3 rounded-xl bg-surface-900 border border-surface-750 space-y-1 text-xs">
                  <div className="flex justify-between text-surface-400">
                    <span>Kailangang Bayaran (Total):</span>
                    <span className="font-mono font-bold text-surface-200">{formatCurrency(total)}</span>
                  </div>
                  <div className="flex justify-between text-surface-400">
                    <span>Kabuuang Naibigay (Tenders):</span>
                    <span className="font-mono font-bold text-surface-200">{formatCurrency(splitTotal)}</span>
                  </div>

                  {splitRemaining > 0 ? (
                    <div className="pt-1 border-t border-surface-800 flex justify-between font-bold text-rose-400 text-xs">
                      <span>⚠️ Kulang pa:</span>
                      <span className="font-mono">{formatCurrency(splitRemaining)}</span>
                    </div>
                  ) : splitTotal === total ? (
                    <div className="pt-1 border-t border-surface-800 flex justify-between font-bold text-emerald-400 text-xs">
                      <span>✅ Sakto ang Bayad:</span>
                      <span className="font-mono">₱0.00 Balanse</span>
                    </div>
                  ) : splitHasCash ? (
                    <div className="pt-1 border-t border-surface-800 flex justify-between font-bold text-emerald-400 text-xs">
                      <span>💵 Sukli sa Cash (Change):</span>
                      <span className="font-mono">{formatCurrency(splitChange)}</span>
                    </div>
                  ) : (
                    <div className="pt-1 border-t border-surface-800 flex justify-between font-bold text-amber-400 text-xs">
                      <span>⚠️ Sobra ang non-cash tenders:</span>
                      <span className="font-mono">{formatCurrency(splitDifference)}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Notes */}
            <div className="pt-1">
              <label className="block text-xs font-semibold text-surface-300 mb-1">Mga Paalala / Notes (Opsyonal)</label>
              <input
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-surface-900 border border-surface-700 text-surface-100 text-xs sm:text-sm focus:outline-none focus:border-primary-500"
                placeholder="hal. Pa-repack, pickup sa hapon..."
              />
            </div>
          </div>
        </div>

        {/* Complete sale button */}
        <div className="p-3 sm:p-4 bg-surface-900 border-t border-surface-700/50 safe-area-bottom">
          <button
            onClick={handleCheckout}
            disabled={!canCheckout || processing}
            className="w-full py-3.5 sm:py-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-base sm:text-lg font-black transition-all active:scale-[0.98] shadow-xl shadow-emerald-950/50 cursor-pointer flex items-center justify-center gap-2"
          >
            {processing ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Processing...</span>
              </span>
            ) : (
              <span>Complete Sale — {formatCurrency(total)} (Enter ↵)</span>
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
          <button onClick={() => setView('menu')} className="p-2 rounded-lg text-surface-400 hover:text-surface-200 cursor-pointer">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <h1 className="text-lg font-bold text-surface-100">Cart ({itemCount})</h1>

          <div className="ml-auto flex items-center gap-2">
            {/* Hold Current Order Button */}
            {items.length > 0 && (
              <button
                type="button"
                onClick={() => setShowParkModal(true)}
                className="px-2.5 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/40 text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                title="I-hold ang kasalukuyang order"
              >
                <span>⏸️</span>
                <span>Hold</span>
              </button>
            )}

            {items.length > 0 && (
              <button onClick={clearCart} className="text-danger-500 text-xs font-semibold hover:text-danger-400 px-2 py-1 cursor-pointer">
                Clear All
              </button>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <span className="text-5xl mb-4">🛒</span>
              <p className="text-surface-300 font-medium">Cart is empty</p>
              <p className="text-surface-500 text-sm mt-1">Magdagdag ng paninda mula sa menu</p>
              <button onClick={() => setView('menu')} className="mt-4 px-6 py-2 rounded-xl bg-primary-600 text-white text-sm font-medium hover:bg-primary-500 cursor-pointer">Browse Menu</button>
            </div>
          ) : (
            <div className="divide-y divide-surface-700/30">
              {items.map(item => (
                <div key={item.product_id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-surface-100 font-medium text-sm truncate">{item.product_name}</p>
                    <p className="text-surface-400 text-xs">
                      {item.sell_by_weight ? `${formatCurrency(item.unit_price)} / kg` : `${formatCurrency(item.unit_price)} each`}
                    </p>
                  </div>
                  {/* Quantity / Weight controls */}
                  {item.sell_by_weight ? (
                    <button
                      type="button"
                      onClick={() => {
                        const p = products.find(prod => prod.id === item.product_id);
                        if (p) {
                          setWeightModalProduct(p);
                          setWeightInput(item.quantity.toString());
                        }
                      }}
                      className="flex items-center gap-1.5 bg-surface-800 hover:bg-surface-750 px-2.5 py-1.5 rounded-xl border border-surface-700 cursor-pointer transition-colors"
                      title="Pindutin para baguhin ang timbang"
                    >
                      <span className="text-xs">⚖️</span>
                      <span className="text-surface-100 font-bold text-xs sm:text-sm">{item.quantity.toFixed(2)} kg</span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-0">
                      <button onClick={() => decrementItem(item.product_id)} className="w-8 h-8 rounded-lg bg-surface-700 text-surface-200 flex items-center justify-center hover:bg-surface-600 transition-colors text-lg font-bold cursor-pointer">−</button>
                      <span className="w-10 text-center text-surface-100 font-bold text-sm">{item.quantity}</span>
                      <button onClick={() => incrementItem(item.product_id)} className="w-8 h-8 rounded-lg bg-surface-700 text-surface-200 flex items-center justify-center hover:bg-surface-600 transition-colors text-lg font-bold cursor-pointer">+</button>
                    </div>
                  )}
                  <div className="w-20 text-right">
                    <p className="text-surface-100 font-bold text-sm">{formatCurrency(item.line_total)}</p>
                  </div>
                  <button onClick={() => removeItem(item.product_id)} className="p-1 text-surface-500 hover:text-danger-500 transition-colors cursor-pointer">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Cart footer with Discounts */}
        {items.length > 0 && (
          <div className="p-4 bg-surface-900 border-t border-surface-700/50 safe-area-bottom space-y-3">
            {/* Quick Discount Selector */}
            <div className="bg-surface-850 p-2.5 rounded-xl border border-surface-700/60 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-surface-300 font-semibold">Bawas / Discount:</span>
                {discountAmount > 0 && (
                  <span className="text-amber-400 font-bold">-{formatCurrency(discountAmount)}</span>
                )}
              </div>
              <div className="grid grid-cols-4 gap-1">
                <button
                  type="button"
                  onClick={() => setDiscountType('none')}
                  className={`py-1 px-1.5 rounded-lg text-[10px] font-bold transition-all border cursor-pointer ${
                    discountType === 'none' ? 'bg-surface-600 text-white border-surface-500' : 'bg-surface-800 text-surface-400 border-surface-700'
                  }`}
                >
                  Wala
                </button>
                <button
                  type="button"
                  onClick={() => setDiscountType('senior_pwd')}
                  className={`py-1 px-1.5 rounded-lg text-[10px] font-bold transition-all border cursor-pointer ${
                    discountType === 'senior_pwd' ? 'bg-primary-600 text-white border-primary-500 shadow-sm' : 'bg-surface-800 text-surface-400 border-surface-700'
                  }`}
                >
                  👴 Senior (20%)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const val = prompt('Ilang porsyento ang discount? (%)', String(discountPercent || 10));
                    if (val !== null) {
                      setDiscountPercent(parseFloat(val) || 0);
                      setDiscountType('percent');
                    }
                  }}
                  className={`py-1 px-1.5 rounded-lg text-[10px] font-bold transition-all border cursor-pointer ${
                    discountType === 'percent' ? 'bg-primary-600 text-white border-primary-500 shadow-sm' : 'bg-surface-800 text-surface-400 border-surface-700'
                  }`}
                >
                  %{discountType === 'percent' && discountPercent > 0 ? ` ${discountPercent}%` : ' Custom'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const val = prompt('Magkano ang discount? (₱)', String(discountFixed || 50));
                    if (val !== null) {
                      setDiscountFixed(parseFloat(val) || 0);
                      setDiscountType('fixed');
                    }
                  }}
                  className={`py-1 px-1.5 rounded-lg text-[10px] font-bold transition-all border cursor-pointer ${
                    discountType === 'fixed' ? 'bg-primary-600 text-white border-primary-500 shadow-sm' : 'bg-surface-800 text-surface-400 border-surface-700'
                  }`}
                >
                  ₱{discountType === 'fixed' && discountFixed > 0 ? ` ${discountFixed}` : ' Bawas'}
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs text-surface-400">
                <span>Subtotal</span>
                <span>{formatCurrency(subtotal)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-xs text-amber-400 font-semibold">
                  <span>Discount</span>
                  <span>-{formatCurrency(discountAmount)}</span>
                </div>
              )}
              <div className="flex justify-between text-lg pt-1 border-t border-surface-800">
                <span className="text-surface-300 font-medium">Kabuuan (Total)</span>
                <span className="text-surface-50 font-bold">{formatCurrency(total)}</span>
              </div>
            </div>

            <button
              onClick={() => setView('checkout')}
              className="w-full py-4 rounded-xl bg-primary-600 text-white text-lg font-bold hover:bg-primary-500 transition-all active:scale-[0.98] shadow-lg shadow-primary-600/20 cursor-pointer"
            >
              Proceed to Checkout — {formatCurrency(total)}
            </button>
          </div>
        )}

        {/* Modal to Hold Current Order */}
        {showParkModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
            <div className="bg-surface-900 border border-surface-700 rounded-2xl p-5 max-w-sm w-full shadow-2xl">
              <h3 className="text-base font-bold text-surface-50 mb-1 flex items-center gap-2">
                <span>⏸️</span> I-hold ang Order na ito
              </h3>
              <p className="text-xs text-surface-400 mb-4">
                Pansamantalang itabi ang cart habang naghihintay o may ibang customer na bibili.
              </p>
              <form onSubmit={handleHoldOrderSubmit} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-surface-300 mb-1">
                    Pangalan ng Customer o Table # (Opsyonal)
                  </label>
                  <input
                    type="text"
                    value={parkCustomerName}
                    onChange={e => setParkCustomerName(e.target.value)}
                    placeholder="hal. Table 3, Kuya Ben, Takeout..."
                    className="w-full px-3 py-2 rounded-xl bg-surface-800 border border-surface-700 text-surface-100 text-sm focus:outline-none focus:border-primary-500"
                    autoFocus
                  />
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowParkModal(false)}
                    className="flex-1 py-2.5 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-300 text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Kanselahin
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition-colors cursor-pointer shadow-md"
                  >
                    I-hold Order
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============================================================
  // MENU VIEW (default)
  // ============================================================
  return (
    <div className="flex-1 flex flex-col lg:flex-row min-h-0 bg-surface-950 overflow-hidden">
      {/* ── LEFT PANE: Product Catalog & Fast Controls ── */}
      <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
        {/* Toast Notification */}
        {toastMsg && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-surface-900 border border-emerald-500/50 text-emerald-300 text-xs sm:text-sm font-semibold shadow-2xl animate-fade-in flex items-center gap-2">
            <span>{toastMsg}</span>
          </div>
        )}

      {/* Top bar */}
      <header className="flex items-center gap-2 px-3 py-2 bg-surface-900 border-b border-surface-700/50 flex-shrink-0">
        {/* Burger Button */}
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('toggle_pos_sidebar'))}
          className="p-1.5 -ml-1 rounded-xl text-surface-200 hover:text-white hover:bg-surface-800 transition-colors active:scale-95 shrink-0 lg:hidden cursor-pointer"
          aria-label="Open navigation menu"
          title="Open Menu"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <div className="flex-1 min-w-0">
          <h1 className="text-sm sm:text-base font-bold text-surface-50 truncate flex items-center gap-1.5">
            <span>🛒</span> <span>Point of Sale</span>
          </h1>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Active Cashier Switcher */}
          <button
            type="button"
            onClick={() => {
              setNewCashierInput('');
              setShowCashierModal(true);
            }}
            className="px-2.5 py-1.5 rounded-xl bg-surface-800 text-surface-200 hover:bg-surface-750 border border-surface-700/60 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs"
            title="Click to switch active cashier"
          >
            <span>👤</span>
            <span className="truncate max-w-[60px] sm:max-w-[100px]">{activeCashier}</span>
            <span className="text-[10px] text-surface-400">▾</span>
          </button>

          {/* Held Orders Button */}
          <button
            type="button"
            onClick={() => setShowHeldModal(true)}
            className={`relative px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1 cursor-pointer border ${
              parkedCarts.length > 0
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-sm animate-pulse'
                : 'bg-surface-800 text-surface-400 border-surface-700/60 hover:text-surface-200'
            }`}
            title="Tingnan ang mga Naka-Hold na Order"
          >
            <span>⏸️</span>
            <span className="hidden xs:inline">Held</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${
              parkedCarts.length > 0 ? 'bg-amber-500 text-black' : 'bg-surface-700 text-surface-400'
            }`}>
              {parkedCarts.length}
            </span>
          </button>

          {/* Online/offline indicator */}
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${
            isOnline ? 'bg-success-500/20 text-success-500' : 'bg-danger-500/20 text-danger-500'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-success-500' : 'bg-danger-500'}`} />
            <span className="hidden xs:inline">{isOnline ? 'Online' : 'Offline'}</span>
          </div>

          {/* Refresh products from server */}
          <button
            onClick={handleDownloadProducts}
            disabled={syncingProducts}
            title="Download latest menu from server"
            className="p-1.5 rounded-lg text-surface-400 hover:text-surface-200 hover:bg-surface-800 transition-colors cursor-pointer"
          >
            <svg className={`w-4 h-4 ${syncingProducts ? 'animate-spin text-primary-400' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>

          {/* Pending sync badge */}
          {pendingCount > 0 && (
            <button onClick={performSync} className="flex items-center gap-1 px-2 py-1 rounded-full bg-warning-500/20 text-warning-500 text-xs font-medium animate-pulse cursor-pointer">
              🔄 {pendingCount}
            </button>
          )}

          {/* Dashboard link */}
          <Link to="/dashboard" className="p-1.5 rounded-lg text-surface-400 hover:text-surface-200 cursor-pointer" title="Dashboard">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
          </Link>
        </div>
      </header>

      {/* Action Row: Search Bar + Camera Scan + Custom Item + Wholesale Toggle + Desktop Shortcuts */}
      <div className="px-3.5 py-2 bg-surface-900/50 flex items-center gap-1.5 flex-wrap">
        <div className="relative flex-1 min-w-[130px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search products... (F2 o /)"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-surface-800 border border-surface-700/50 text-surface-100 text-xs sm:text-sm placeholder:text-surface-500 focus:outline-none focus:border-primary-500"
          />
        </div>

        {/* Camera Barcode Scanner Button */}
        <button
          type="button"
          onClick={() => setShowScanner(true)}
          className="px-2.5 py-2 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-200 border border-surface-700/60 text-xs font-semibold flex items-center gap-1 shrink-0 cursor-pointer shadow-xs active:scale-95"
          title="Scan Barcode gamit ang Camera"
        >
          <span>📷</span>
          <span className="hidden sm:inline">Scan</span>
        </button>

        {/* Custom / Open Item Button */}
        <button
          type="button"
          onClick={() => setShowCustomModal(true)}
          className="px-2.5 py-2 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-200 border border-surface-700/60 text-xs font-semibold flex items-center gap-1 shrink-0 cursor-pointer shadow-xs active:scale-95"
          title="Magbenta ng Custom o Open Item (Shortcut: F4)"
        >
          <span>➕</span>
          <span className="hidden sm:inline">Custom</span>
        </button>

        {/* Wholesale / Pakyawan Mode Toggle */}
        <button
          type="button"
          onClick={toggleWholesaleMode}
          className={`px-2.5 py-2 rounded-xl border text-xs font-bold flex items-center gap-1 shrink-0 cursor-pointer shadow-xs transition-all active:scale-95 ${
            isWholesaleMode
              ? 'bg-primary-600 text-white border-primary-500 shadow-primary-950/40'
              : 'bg-surface-800 text-surface-400 border-surface-700/60 hover:text-surface-200'
          }`}
          title="Pindutin para magpalit sa Presyong Pakyawan (Wholesale)"
        >
          <span>🏷️</span>
          <span>{isWholesaleMode ? 'Pakyawan' : 'Retail'}</span>
        </button>

        {/* Desktop Keyboard Shortcuts Ribbon */}
        <div className="hidden xl:flex items-center gap-1.5 text-[11px] text-surface-400 font-mono ml-auto">
          <span className="px-2 py-1 rounded-lg bg-surface-800/80 border border-surface-700/60 text-surface-300 shadow-xs flex items-center gap-1">
            <kbd className="font-bold text-primary-400">F2</kbd> Search
          </span>
          <span className="px-2 py-1 rounded-lg bg-surface-800/80 border border-surface-700/60 text-surface-300 shadow-xs flex items-center gap-1">
            <kbd className="font-bold text-amber-400">F4</kbd> Custom
          </span>
          <span className="px-2 py-1 rounded-lg bg-surface-800/80 border border-surface-700/60 text-surface-300 shadow-xs flex items-center gap-1">
            <kbd className="font-bold text-emerald-400">F8</kbd> Checkout
          </span>
          <span className="px-2 py-1 rounded-lg bg-surface-800/80 border border-surface-700/60 text-surface-300 shadow-xs flex items-center gap-1">
            <kbd className="font-bold text-rose-400">ESC</kbd> Cancel
          </span>
        </div>
      </div>

      {/* Strict Business Departments Ribbon (NO "Lahat" button) */}
      <div className="flex items-center gap-1.5 px-3.5 pt-2 overflow-x-auto no-scrollbar">
        {departments.map(dept => {
          const isActive = selectedDept === dept.id;
          return (
            <button
              key={dept.id}
              onClick={() => {
                setSelectedDept(dept.id);
                setActiveCategory(null);
              }}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all border cursor-pointer ${
                isActive
                  ? 'bg-primary-600 text-white border-primary-500 shadow-sm'
                  : 'bg-surface-800/90 text-surface-400 hover:text-surface-200 border-surface-700/60'
              }`}
            >
              <span>{dept.icon}</span>
              <span>{dept.label}</span>
            </button>
          );
        })}
      </div>

      {/* Category tabs for active department */}
      {deptCategories.length > 1 && (
        <div className="flex items-center gap-1.5 px-3.5 py-1.5 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveCategory(null)}
            className={`shrink-0 px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              activeCategory === null
                ? 'bg-surface-600 text-white shadow-xs'
                : 'bg-surface-800/70 text-surface-400 hover:text-surface-200'
            }`}
          >
            Lahat sa {departments.find(d => d.id === selectedDept)?.label}
          </button>
          {deptCategories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`shrink-0 px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                activeCategory === cat.id
                  ? 'bg-primary-600 text-white shadow-xs'
                  : 'bg-surface-800/70 text-surface-400 hover:text-surface-200'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      )}

      {/* Product grid */}
      <div className="flex-1 overflow-y-auto px-3.5 py-2.5 pb-24 lg:pb-4 no-scrollbar">
        {filteredProducts.length === 0 ? (
          <div className="text-center py-12 px-4">
            <span className="text-4xl mb-3 block">📦</span>
            <p className="text-surface-200 font-semibold text-base sm:text-lg">
              {searchQuery ? 'Walang nahanap na produkto' : 'Walang produkto sa linyang ito'}
            </p>
            {products.length === 0 ? (
              <>
                <p className="text-surface-400 text-xs sm:text-sm mt-1 max-w-xs mx-auto">
                  I-download ang menu mula sa laptop server para magamit nang offline.
                </p>
                <button
                  onClick={handleDownloadProducts}
                  disabled={syncingProducts}
                  className="mt-4 px-6 py-3 rounded-xl bg-primary-600 text-white font-medium hover:bg-primary-500 transition-all flex items-center justify-center gap-2 mx-auto disabled:opacity-50 cursor-pointer"
                >
                  {syncingProducts ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Downloading...
                    </>
                  ) : (
                    'Download Menu from Laptop'
                  )}
                </button>
              </>
            ) : null}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2 sm:gap-2.5">
            {displayCards.map(card => {
              const isSelected = card.inCartCount > 0;
              const singleProd = card.items[0];
              const isWeight = !card.isGroup && (singleProd.sell_by_weight || singleProd.unit === 'kg');
              return (
                <button
                  key={card.id}
                  onClick={() => {
                    if (card.isGroup) {
                      soundEffects.playBeep();
                      setSelectedGroupForModal(card);
                    } else if (isWeight) {
                      soundEffects.playBeep();
                      setWeightModalProduct(singleProd);
                      setWeightInput('1.00');
                    } else {
                      // Check negative stock setting
                      const allowNeg = localStorage.getItem('pos_allow_negative_stock') !== 'false';
                      if (!allowNeg && card.totalStock !== undefined && card.totalStock <= 0) {
                        soundEffects.playWarningTone();
                        showToast(`⚠️ Ubos na ang stock ng "${singleProd.name}" (0 pcs)!`);
                        return;
                      }
                      addItem(singleProd);
                      soundEffects.playBeep();
                      showToast(`✅ Naidagdag sa Cart: ${singleProd.name}`);
                    }
                  }}
                  className={`group rounded-xl border text-left transition-all relative flex flex-col justify-between cursor-pointer overflow-hidden ${
                    isSelected
                      ? 'bg-primary-600/15 border-primary-500/60 shadow-md ring-1 ring-primary-500/40'
                      : 'bg-surface-800/80 border-surface-700/60 hover:bg-surface-750 hover:border-surface-600 active:scale-[0.98]'
                  }`}
                >
                  {/* Photo / Visual Banner Header */}
                  <div className="w-full h-24 sm:h-28 relative overflow-hidden bg-surface-900 border-b border-surface-700/40 flex items-center justify-center shrink-0">
                    {card.image_path && isValidImageUrl(card.image_path) ? (
                      <img
                        src={card.image_path}
                        alt={card.baseName}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        loading="lazy"
                        onError={(e) => {
                          (e.currentTarget as HTMLElement).style.display = 'none';
                          const fallback = (e.currentTarget as HTMLElement).nextElementSibling;
                          if (fallback) (fallback as HTMLElement).classList.remove('hidden');
                        }}
                      />
                    ) : null}
                    <div className={`w-full h-full bg-surface-850 flex flex-col items-center justify-center ${card.image_path && isValidImageUrl(card.image_path) ? 'hidden' : ''}`}>
                      <span className="text-2xl sm:text-3xl drop-shadow-xs transition-transform duration-200 group-hover:scale-110">
                        {getCategoryIcon(card.category_name)}
                      </span>
                      <span className="text-[9px] font-semibold text-surface-500 uppercase tracking-wider mt-1 px-1 truncate max-w-full">
                        {card.category_name || 'Paninda'}
                      </span>
                    </div>

                    {/* In-cart count badge (top-right overlay on image) */}
                    {isSelected && (
                      <span className="absolute top-1.5 right-1.5 px-2 py-0.5 rounded-full bg-primary-600 text-white text-[11px] font-black shadow-md border border-white/20 animate-scale-in">
                        {card.inCartCount}
                      </span>
                    )}

                    {/* Stock badge overlay (bottom-right on image) */}
                    {!card.isGroup && card.totalStock !== undefined && (
                      <span
                        className={`absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[9px] font-bold shadow-sm backdrop-blur-xs ${
                          card.totalStock === 0
                            ? 'bg-rose-600/90 text-white'
                            : card.totalStock <= (singleProd.low_stock_threshold || 5)
                            ? 'bg-amber-500/90 text-black font-extrabold'
                            : 'bg-black/60 text-surface-200'
                        }`}
                      >
                        {isWeight ? `${card.totalStock.toFixed(1)} kg` : `${card.totalStock} left`}
                      </span>
                    )}
                  </div>

                  {/* Body details */}
                  <div className="p-2 sm:p-2.5 flex-1 flex flex-col justify-between">
                    <div>
                      <h3 className="text-xs sm:text-sm font-semibold text-surface-100 line-clamp-2 leading-tight">
                        {card.baseName}
                      </h3>
                      <p className="text-[10px] text-surface-400 mt-0.5 truncate">
                        {card.isGroup ? `${card.category_name || 'Rice'} · ${card.items.length} Sukat` : card.category_name}
                      </p>
                      {isWholesaleMode && (
                        <span className="inline-block mt-0.5 px-1 py-0.2 rounded text-[9px] font-bold bg-purple-500/20 text-purple-300">
                          Pakyawan
                        </span>
                      )}
                    </div>

                    <div className="mt-2 pt-1.5 border-t border-surface-700/40 flex items-center justify-between">
                      <span className="text-xs sm:text-sm font-bold text-emerald-400">
                        {card.isGroup
                          ? `${formatCurrency(card.minPrice)} - ${formatCurrency(card.maxPrice)}`
                          : `${formatCurrency(card.minPrice)}${isWeight ? ' / kg' : ''}`}
                      </span>
                      {card.isGroup ? (
                        <span className="text-[10px] font-semibold text-primary-400 bg-primary-500/15 px-1.5 py-0.5 rounded">
                          Pumili ▾
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      </div>

      {/* ── DESKTOP PERSISTENT REGISTER CART (Visible on lg: screens) ── */}
      <aside className="hidden lg:flex w-80 xl:w-96 2xl:w-[410px] shrink-0 border-l border-surface-700/60 bg-surface-900/95 flex-col h-full shadow-2xl z-10">
        {/* Register Header */}
        <div className="px-4 py-2.5 bg-surface-850/90 border-b border-surface-700/60 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-lg">🧾</span>
            <div>
              <h2 className="text-sm font-black text-surface-100 flex items-center gap-1.5">
                <span>Resibo / Cart</span>
                <span className="px-2 py-0.2 rounded-full text-[10px] font-extrabold bg-primary-500/20 text-primary-300 border border-primary-500/30">
                  {itemCount} {itemCount === 1 ? 'item' : 'items'}
                </span>
              </h2>
              <p className="text-[10px] text-surface-400 font-medium">Real-time Order Register</p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {items.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setShowParkModal(true)}
                  className="px-2 py-1 rounded-lg bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/40 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                  title="I-hold ang kasalukuyang order (F7)"
                >
                  <span>⏸️</span>
                  <span>Hold</span>
                </button>
                <button
                  type="button"
                  onClick={clearCart}
                  className="px-2 py-1 rounded-lg bg-surface-800 text-rose-400 hover:bg-rose-500/15 hover:text-rose-300 border border-surface-700/60 text-[11px] font-bold cursor-pointer transition-colors"
                  title="Alisin lahat ng laman ng Cart"
                >
                  Clear
                </button>
              </>
            )}
          </div>
        </div>

        {/* Scrollable Cart Items List */}
        <div className="flex-1 overflow-y-auto px-3 py-2 divide-y divide-surface-800/80 no-scrollbar">
          {items.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center p-6 text-center text-surface-500">
              <div className="w-16 h-16 rounded-2xl bg-surface-800/60 border border-surface-700/50 flex items-center justify-center text-3xl mb-3 shadow-inner">
                🛒
              </div>
              <p className="text-sm font-bold text-surface-300">Walang laman ang cart</p>
              <p className="text-xs text-surface-400 mt-1 max-w-[220px]">
                Pumili ng paninda sa kaliwa o mag-scan gamit ang barcode scanner.
              </p>
            </div>
          ) : (
            items.map(item => (
              <div key={item.product_id} className="py-2.5 flex items-center gap-2 group">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-surface-100 truncate" title={item.product_name}>
                    {item.product_name}
                  </p>
                  <p className="text-[11px] text-surface-400 mt-0.5">
                    {item.sell_by_weight ? `${formatCurrency(item.unit_price)} / kg` : `${formatCurrency(item.unit_price)} each`}
                  </p>
                </div>

                {/* Controls */}
                {item.sell_by_weight ? (
                  <button
                    type="button"
                    onClick={() => {
                      const p = products.find(prod => prod.id === item.product_id);
                      if (p) {
                        setWeightModalProduct(p);
                        setWeightInput(item.quantity.toString());
                      }
                    }}
                    className="px-2 py-1 rounded-lg bg-surface-800 hover:bg-surface-750 text-surface-200 border border-surface-700 text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                    title="Pindutin para baguhin ang timbang"
                  >
                    <span>⚖️</span>
                    <span>{item.quantity.toFixed(2)} kg</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-0 bg-surface-800 rounded-lg border border-surface-700/60 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => decrementItem(item.product_id)}
                      className="w-6 h-6 text-surface-300 hover:text-white hover:bg-surface-700 flex items-center justify-center font-bold text-sm cursor-pointer transition-colors"
                    >
                      −
                    </button>
                    <span className="w-7 text-center text-xs font-bold text-surface-100 font-mono">
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => incrementItem(item.product_id)}
                      className="w-6 h-6 text-surface-300 hover:text-white hover:bg-surface-700 flex items-center justify-center font-bold text-sm cursor-pointer transition-colors"
                    >
                      +
                    </button>
                  </div>
                )}

                <div className="w-16 text-right shrink-0">
                  <p className="text-xs font-black text-emerald-400 font-mono">
                    {formatCurrency(item.line_total)}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => removeItem(item.product_id)}
                  className="p-1 text-surface-500 hover:text-rose-400 transition-colors cursor-pointer"
                  title="Alisin"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))
          )}
        </div>

        {/* Register Bottom Panel: Discounts & Checkout */}
        <div className="p-3 bg-surface-850/95 border-t border-surface-700/60 space-y-2 shrink-0">
          {/* Quick Discount Selector */}
          <div className="bg-surface-900 p-2 rounded-xl border border-surface-750 space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-surface-300 font-semibold">Bawas / Discount:</span>
              {discountAmount > 0 && (
                <span className="text-amber-400 font-black">-{formatCurrency(discountAmount)}</span>
              )}
            </div>
            <div className="grid grid-cols-4 gap-1">
              <button
                type="button"
                onClick={() => setDiscountType('none')}
                className={`py-1 px-1 rounded-lg text-[10px] font-bold transition-all border cursor-pointer ${
                  discountType === 'none' ? 'bg-surface-600 text-white border-surface-500' : 'bg-surface-800 text-surface-400 border-surface-700'
                }`}
              >
                Wala
              </button>
              <button
                type="button"
                onClick={() => setDiscountType('senior_pwd')}
                className={`py-1 px-1 rounded-lg text-[10px] font-bold transition-all border cursor-pointer ${
                  discountType === 'senior_pwd' ? 'bg-primary-600 text-white border-primary-500 shadow-sm' : 'bg-surface-800 text-surface-400 border-surface-700'
                }`}
              >
                👴 Senior
              </button>
              <button
                type="button"
                onClick={() => {
                  const val = prompt('Ilang porsyento ang discount? (%)', String(discountPercent || 10));
                  if (val !== null) {
                    setDiscountPercent(parseFloat(val) || 0);
                    setDiscountType('percent');
                  }
                }}
                className={`py-1 px-1 rounded-lg text-[10px] font-bold transition-all border cursor-pointer ${
                  discountType === 'percent' ? 'bg-primary-600 text-white border-primary-500 shadow-sm' : 'bg-surface-800 text-surface-400 border-surface-700'
                }`}
              >
                %{discountType === 'percent' && discountPercent > 0 ? ` ${discountPercent}%` : ' Custom'}
              </button>
              <button
                type="button"
                onClick={() => {
                  const val = prompt('Magkano ang discount? (₱)', String(discountFixed || 50));
                  if (val !== null) {
                    setDiscountFixed(parseFloat(val) || 0);
                    setDiscountType('fixed');
                  }
                }}
                className={`py-1 px-1 rounded-lg text-[10px] font-bold transition-all border cursor-pointer ${
                  discountType === 'fixed' ? 'bg-primary-600 text-white border-primary-500 shadow-sm' : 'bg-surface-800 text-surface-400 border-surface-700'
                }`}
              >
                ₱{discountType === 'fixed' && discountFixed > 0 ? ` ${discountFixed}` : ' Bawas'}
              </button>
            </div>
          </div>

          {/* Subtotal & Total */}
          <div className="space-y-1 px-1">
            <div className="flex justify-between text-xs text-surface-400">
              <span>Subtotal</span>
              <span className="font-mono">{formatCurrency(subtotal)}</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between text-xs text-amber-400 font-semibold">
                <span>Discount</span>
                <span className="font-mono">-{formatCurrency(discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between items-baseline pt-1.5 border-t border-surface-700/60">
              <span className="text-xs font-bold text-surface-300 uppercase tracking-wider">Kabuuan</span>
              <span className="text-xl xl:text-2xl font-black text-emerald-400 font-mono">
                {formatCurrency(total)}
              </span>
            </div>
          </div>

          {/* Big Checkout / F8 Button */}
          <button
            type="button"
            disabled={items.length === 0}
            onClick={() => setView('checkout')}
            className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black text-sm flex items-center justify-between px-4 shadow-xl shadow-emerald-950/50 transition-all active:scale-[0.98] cursor-pointer"
          >
            <div className="flex items-center gap-1.5">
              <span>💳</span>
              <span>Bayad / Checkout</span>
              <kbd className="px-1.5 py-0.5 rounded bg-black/30 text-[10px] font-mono text-emerald-200">F8</kbd>
            </div>
            <span className="text-base font-black font-mono">
              {formatCurrency(total)} →
            </span>
          </button>
        </div>
      </aside>

      {/* Floating cart bar for mobile (< lg:) */}
      {itemCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 p-3 sm:p-4 safe-area-bottom z-20 lg:hidden">
          <button
            onClick={() => setView('cart')}
            className="w-full py-3.5 sm:py-4 rounded-2xl bg-primary-600 text-white font-bold flex items-center justify-between px-5 sm:px-6 shadow-2xl shadow-primary-600/40 hover:bg-primary-500 transition-all active:scale-[0.98] cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center text-sm font-bold">{itemCount}</span>
              <span className="text-sm sm:text-base">View Cart</span>
            </div>
            <div className="flex items-center gap-2">
              {discountAmount > 0 && (
                <span className="text-xs bg-amber-500 text-black px-1.5 py-0.5 rounded font-extrabold">
                  -{formatCurrency(discountAmount)}
                </span>
              )}
              <span className="text-base sm:text-lg">{formatCurrency(total)}</span>
            </div>
          </button>
        </div>
      )}

      {/* ── Camera Barcode Scanner Modal ── */}
      <BarcodeScannerModal
        isOpen={showScanner}
        onClose={() => setShowScanner(false)}
        onScan={handleBarcodeScanned}
      />

      {/* ── Held Orders (Parked Carts) Modal ── */}
      {showHeldModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="bg-surface-900 border border-surface-700 rounded-3xl max-w-md w-full max-h-[85dvh] flex flex-col shadow-2xl overflow-hidden">
            <div className="px-5 py-4 bg-surface-850 border-b border-surface-700/60 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">⏸️</span>
                <div>
                  <h3 className="text-sm font-bold text-surface-50">Naka-Hold na mga Order ({parkedCarts.length})</h3>
                  <p className="text-[10px] text-surface-400">Pindutin ang Ibalik sa Cart para ituloy ang bayad</p>
                </div>
              </div>
              <button
                onClick={() => setShowHeldModal(false)}
                className="p-1.5 rounded-xl bg-surface-800 text-surface-400 hover:text-white transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {parkedCarts.length === 0 ? (
                <div className="py-12 text-center">
                  <span className="text-4xl block mb-2 opacity-60">📋</span>
                  <p className="text-surface-300 font-semibold text-sm">Walang naka-hold na order ngayon</p>
                  <p className="text-surface-500 text-xs mt-1">
                    Kapag may customer na kailangang mag-pause, pumunta sa Cart at pindutin ang "Hold".
                  </p>
                </div>
              ) : (
                parkedCarts.map(cart => (
                  <div
                    key={cart.id}
                    className="p-3 rounded-2xl bg-surface-800/80 border border-surface-700/60 flex flex-col gap-2 hover:border-amber-500/40 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-amber-400">{cart.customerName || 'Customer'}</span>
                          <span className="text-[10px] text-surface-500 font-mono">({cart.id})</span>
                        </div>
                        <p className="text-[10px] text-surface-400 mt-0.5">
                          {new Date(cart.parkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {cart.items.length} item(s)
                        </p>
                      </div>
                      <span className="text-sm font-bold text-primary-400">{formatCurrency(cart.total)}</span>
                    </div>

                    <div className="text-[11px] text-surface-300 bg-surface-900/60 p-2 rounded-xl line-clamp-2">
                      {cart.items.map(i => `${i.quantity}× ${i.product_name}`).join(', ')}
                    </div>

                    <div className="flex items-center gap-2 pt-1 border-t border-surface-700/50">
                      <button
                        onClick={() => {
                          removeParkedCart(cart.id);
                          showToast('🗑️ Tinanggal ang held order');
                        }}
                        className="py-1.5 px-3 rounded-xl bg-surface-750 hover:bg-danger-600/20 text-surface-400 hover:text-danger-400 border border-surface-700/60 text-xs font-semibold transition-colors cursor-pointer"
                      >
                        I-delete
                      </button>
                      <button
                        onClick={() => {
                          recallParkedCart(cart.id);
                          setShowHeldModal(false);
                          setView('cart');
                          showToast(`🛒 Naibalik sa Cart ang order ni ${cart.customerName || 'Customer'}!`);
                        }}
                        className="flex-1 py-1.5 px-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-1 shadow-sm"
                      >
                        <span>🛒 Ibalik sa Cart</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Custom Item Modal ── */}
      {showCustomModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-surface-900 border border-surface-700 rounded-3xl p-5 max-w-sm w-full shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-surface-50 flex items-center gap-2">
                <span>➕</span> Custom / Open Item
              </h3>
              <button onClick={() => setShowCustomModal(false)} className="p-1 rounded-lg text-surface-400 hover:text-white">✕</button>
            </div>
            <p className="text-xs text-surface-400 mb-4">
              Magbenta ng bagay na wala sa listahan o espesyal na presyo.
            </p>
            <form onSubmit={handleAddCustomItemSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-surface-300 mb-1">Pangalan ng Item *</label>
                <input
                  type="text"
                  value={customName}
                  onChange={e => setCustomName(e.target.value)}
                  placeholder="hal. Special BBQ Pack, Plastic Container..."
                  className="w-full px-3 py-2 rounded-xl bg-surface-800 border border-surface-700 text-surface-100 text-sm focus:outline-none focus:border-primary-500"
                  autoFocus
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-surface-300 mb-1">Presyo (₱) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={customPrice}
                  onChange={e => setCustomPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 rounded-xl bg-surface-800 border border-surface-700 text-surface-100 text-sm font-bold focus:outline-none focus:border-primary-500"
                  required
                />
              </div>
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCustomModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-300 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold cursor-pointer shadow-md"
                >
                  Idagdag sa Cart
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Rice & Multi-packaging Variant Selection Modal ── */}
      {selectedGroupForModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="bg-surface-900 border border-surface-700 rounded-3xl max-w-md w-full shadow-2xl overflow-hidden flex flex-col">
            {/* Header */}
            <div className="p-4 sm:p-5 bg-surface-850 border-b border-surface-700/60 flex items-center justify-between">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-2xl shrink-0">🌾</span>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-surface-50 leading-tight truncate">
                    {selectedGroupForModal.baseName}
                  </h3>
                  <p className="text-xs text-surface-400 mt-0.5">Pumili ng Sukat o Packaging:</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedGroupForModal(null)}
                className="p-1.5 rounded-xl bg-surface-800 text-surface-400 hover:text-white transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Variant List */}
            <div className="p-4 space-y-2.5 max-h-[60dvh] overflow-y-auto">
              {selectedGroupForModal.items.map(prod => {
                const inCartItem = items.find(i => i.product_id === prod.id);
                const price = isWholesaleMode && (prod.reseller_price ?? 0) > 0 ? (prod.reseller_price ?? prod.selling_price) : prod.selling_price;

                const dashIdx = prod.name.lastIndexOf(' - ');
                let variantLabel = dashIdx !== -1 ? prod.name.substring(dashIdx + 3).trim() : prod.name;
                const isWeight = prod.sell_by_weight || prod.unit === 'kg' || variantLabel.toLowerCase().includes('kilo');

                let icon = '📦';
                let badgeText = 'Pack';
                if (isWeight) {
                  icon = '⚖️';
                  variantLabel = 'Per Kilo (Tingi / Timbang)';
                  badgeText = 'Tingi';
                } else if (variantLabel.toLowerCase().includes('5kg')) {
                  icon = '🛍️';
                  variantLabel = '5kg Pack (Naka-supot)';
                  badgeText = '5kg';
                } else if (variantLabel.toLowerCase().includes('25kg') || prod.unit === 'sako') {
                  icon = '🌾';
                  variantLabel = '25kg Sako (Isang Kaban)';
                  badgeText = 'Sako';
                }

                return (
                  <button
                    key={prod.id}
                    onClick={() => {
                      if (isWeight) {
                        setSelectedGroupForModal(null);
                        setWeightModalProduct(prod);
                        setWeightInput('1.00');
                      } else {
                        // Check negative stock setting
                        const allowNeg = localStorage.getItem('pos_allow_negative_stock') !== 'false';
                        if (!allowNeg && (prod.current_stock ?? 0) <= 0) {
                          soundEffects.playWarningTone();
                          showToast(`⚠️ Ubos na ang stock ng "${prod.name}" (0 pcs)!`);
                          return;
                        }
                        addItem(prod);
                        soundEffects.playBeep();
                        showToast(`✅ Naidagdag: ${prod.name}`);
                        setSelectedGroupForModal(null);
                      }
                    }}
                    className={`w-full p-3.5 rounded-2xl border text-left transition-all flex items-center justify-between gap-3 cursor-pointer ${
                      inCartItem
                        ? 'bg-primary-600/15 border-primary-500/60 shadow-sm'
                        : 'bg-surface-800/80 border-surface-700/60 hover:bg-surface-700/70 hover:border-surface-600 active:scale-[0.99]'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-2xl shrink-0 p-2 rounded-xl bg-surface-750">{icon}</span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-surface-100 truncate">{variantLabel}</span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-surface-700 text-surface-300">
                            {badgeText}
                          </span>
                        </div>
                        <p className="text-xs text-surface-400 mt-0.5">
                          Stock: {prod.current_stock !== undefined ? `${prod.current_stock} ${prod.unit || 'pcs'}` : 'May stock'}
                        </p>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="text-base font-extrabold text-emerald-400">
                        {formatCurrency(price)}{isWeight ? ' / kg' : ''}
                      </p>
                      {inCartItem ? (
                        <span className="inline-block mt-0.5 text-xs font-bold text-primary-400 bg-primary-500/15 px-2 py-0.5 rounded-full">
                          {inCartItem.sell_by_weight ? `${inCartItem.quantity.toFixed(2)} kg` : `${inCartItem.quantity} nasa cart`}
                        </span>
                      ) : (
                        <span className="text-xs text-surface-400 font-medium">Piliin →</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Weight Keypad Modal (For by-weight items: Veggies & Per Kilo Rice) ── */}
      {weightModalProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-fade-in">
          <div className="bg-surface-900 border border-surface-700 rounded-3xl max-w-sm w-full shadow-2xl overflow-hidden flex flex-col">
            {/* Header */}
            <div className="p-4 bg-surface-850 border-b border-surface-700/60 flex items-center justify-between">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-2xl p-2 rounded-xl bg-primary-500/20 text-primary-400 shrink-0">⚖️</span>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-surface-50 truncate">{weightModalProduct.name}</h3>
                  <p className="text-xs text-emerald-400 font-semibold">
                    {formatCurrency(
                      isWholesaleMode && (weightModalProduct.reseller_price ?? 0) > 0
                        ? (weightModalProduct.reseller_price ?? weightModalProduct.selling_price)
                        : weightModalProduct.selling_price
                    )} / kilo
                  </p>
                </div>
              </div>
              <button
                onClick={() => setWeightModalProduct(null)}
                className="p-1.5 rounded-xl bg-surface-800 text-surface-400 hover:text-white transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-4 space-y-3.5">
              {/* Large Display: Weight & Computed Total */}
              <div className="bg-surface-950 p-3.5 rounded-2xl border border-surface-750 text-center">
                <p className="text-xs text-surface-400 font-medium uppercase tracking-wider">Bigat / Timbang</p>
                <div className="text-3xl sm:text-4xl font-extrabold text-surface-50 tracking-tight my-1">
                  {weightInput || '0'} <span className="text-primary-400 text-2xl font-bold">kg</span>
                </div>
                <div className="text-sm font-bold text-emerald-400 pt-1 border-t border-surface-800 flex items-center justify-center gap-1.5">
                  <span className="text-surface-400 text-xs font-normal">Halaga:</span>
                  <span>
                    {formatCurrency(
                      (parseFloat(weightInput) || 0) *
                      (isWholesaleMode && (weightModalProduct.reseller_price ?? 0) > 0
                        ? (weightModalProduct.reseller_price ?? weightModalProduct.selling_price)
                        : weightModalProduct.selling_price)
                    )}
                  </span>
                </div>
              </div>

              {/* Quick Presets Buttons (1-tap) */}
              <div>
                <p className="text-[11px] font-semibold text-surface-400 mb-1.5">Mabilisang Pindot (Presets):</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {[
                    { label: '¼ kg', val: '0.25' },
                    { label: '½ kg', val: '0.50' },
                    { label: '¾ kg', val: '0.75' },
                    { label: '1 kg', val: '1.00' },
                    { label: '1.5 kg', val: '1.50' },
                    { label: '2 kg', val: '2.00' },
                    { label: '3 kg', val: '3.00' },
                    { label: '5 kg', val: '5.00' },
                  ].map(preset => (
                    <button
                      key={preset.val}
                      type="button"
                      onClick={() => setWeightInput(preset.val)}
                      className={`py-1.5 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                        weightInput === preset.val
                          ? 'bg-primary-600 text-white border-primary-500 shadow-sm'
                          : 'bg-surface-800 text-surface-300 border-surface-700 hover:bg-surface-750'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Number Keypad */}
              <div className="grid grid-cols-3 gap-1.5">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map(btn => (
                  <button
                    key={btn}
                    type="button"
                    onClick={() => {
                      if (btn === '⌫') {
                        setWeightInput(prev => (prev.length > 1 ? prev.slice(0, -1) : ''));
                      } else if (btn === '.') {
                        if (!weightInput.includes('.')) {
                          setWeightInput(prev => (prev ? prev + '.' : '0.'));
                        }
                      } else {
                        setWeightInput(prev => {
                          if (prev === '0') return btn;
                          if (prev.includes('.')) {
                            const [, dec] = prev.split('.');
                            if (dec && dec.length >= 3) return prev;
                          }
                          return prev + btn;
                        });
                      }
                    }}
                    className={`h-11 rounded-xl text-base font-bold transition-all active:scale-95 cursor-pointer flex items-center justify-center ${
                      btn === '⌫'
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30'
                        : 'bg-surface-800 text-surface-100 border border-surface-700/70 hover:bg-surface-750'
                    }`}
                  >
                    {btn}
                  </button>
                ))}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setWeightModalProduct(null)}
                  className="flex-1 py-3 rounded-xl bg-surface-800 hover:bg-surface-750 text-surface-300 text-xs font-semibold cursor-pointer transition-colors"
                >
                  Kanselahin
                </button>
                <button
                  type="button"
                  disabled={!parseFloat(weightInput) || parseFloat(weightInput) <= 0}
                  onClick={() => {
                    const weightVal = parseFloat(weightInput);
                    if (weightVal && weightVal > 0) {
                      addItemByWeight(weightModalProduct, weightVal);
                      showToast(`✅ Naidagdag: ${weightVal} kg ng ${weightModalProduct.name}`);
                      setWeightModalProduct(null);
                    }
                  }}
                  className="flex-1 py-3 rounded-xl bg-primary-600 hover:bg-primary-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold cursor-pointer transition-colors shadow-lg shadow-primary-600/30"
                >
                  Idagdag sa Cart
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Cashier Switcher Modal ── */}
      {showCashierModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-fade-in">
          <div className="bg-surface-900 border border-surface-700 rounded-2xl max-w-xs w-full p-5 shadow-2xl space-y-4 animate-scale-up text-center">
            <div className="w-12 h-12 rounded-2xl bg-sky-500/20 text-sky-300 border border-sky-500/40 flex items-center justify-center text-2xl mx-auto shadow-md">
              👤
            </div>
            <div>
              <h3 className="text-base font-black text-surface-100">Select Active Cashier</h3>
              <p className="text-[11px] text-surface-400 mt-0.5">
                This cashier will be attributed on receipts and end-of-day reports.
              </p>
            </div>

            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {cashierList.map((cName: string) => (
                <button
                  key={cName}
                  type="button"
                  onClick={() => {
                    setActiveCashier(cName);
                    localStorage.setItem('pos_active_cashier', cName);
                    setShowCashierModal(false);
                    showToast(`👤 Active Cashier: ${cName}`);
                  }}
                  className={`w-full py-2 px-3 rounded-xl text-xs font-bold transition-all text-left flex items-center justify-between cursor-pointer border ${
                    activeCashier === cName
                      ? 'bg-sky-600 text-white border-sky-500 shadow-sm'
                      : 'bg-surface-800 text-surface-200 border-surface-700 hover:bg-surface-750'
                  }`}
                >
                  <span>{cName}</span>
                  {activeCashier === cName && <span>✓</span>}
                </button>
              ))}
            </div>

            {/* Custom Cashier Input */}
            <div className="pt-2 border-t border-surface-750 space-y-2">
              <input
                type="text"
                placeholder="Or enter new cashier name..."
                value={newCashierInput}
                onChange={e => setNewCashierInput(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-surface-950 border border-surface-700 text-surface-100 text-xs focus:outline-none focus:border-sky-500"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowCashierModal(false)}
                  className="flex-1 py-2 rounded-xl bg-surface-800 hover:bg-surface-750 text-surface-300 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!newCashierInput.trim()}
                  onClick={() => {
                    const name = newCashierInput.trim();
                    if (name) {
                      setActiveCashier(name);
                      localStorage.setItem('pos_active_cashier', name);
                      setShowCashierModal(false);
                      showToast(`👤 Active Cashier: ${name}`);
                    }
                  }}
                  className="flex-1 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-xs font-bold cursor-pointer shadow-md"
                >
                  Select
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
