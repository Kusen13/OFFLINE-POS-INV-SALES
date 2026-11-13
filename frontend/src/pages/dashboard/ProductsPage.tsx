/**
 * Products Page - Full product management with CRUD, search, filters, and pagination
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { fetchProducts, fetchCategories, createProduct, updateProduct, deleteProduct } from '../../api/endpoints';
import { getAllProducts, saveLocalProduct, deleteLocalProduct, getAllCategories, upsertProducts } from '../../db/productRepository';
import { addPendingMutation, removeMutationByTempId } from '../../db/mutationRepository';
import { useSyncStore } from '../../features/sync/syncStore';
import { useAuthStore } from '../../features/security/authStore';
import { formatCurrency } from '../../utils/currency';
import { getTodayStr, SYSTEM_START_DATE } from '../../utils/date';
import { exportToCSV, formatProductsForCSV } from '../../utils/csv';
import { getCategoryIcon } from '../../types/product';
import type { Product, Category, ProductFormData, ItemType, BusinessType, BusinessDepartment } from '../../types/product';
import { getAllBusinessDepartments } from '../../utils/businessStorage';
import { BusinessDepartmentModal } from '../../components/categories/BusinessDepartmentModal';
import { getAllSuppliers } from '../../db/supplierRepository';
import type { Supplier } from '../../types/supplier';
import { getAllOrderItems, createOrderItem, updateOrderItem } from '../../db/orderItemRepository';
import { type RicePackagingFilter, RICE_PACKAGING_OPTIONS, matchRicePackaging } from '../../utils/ricePackaging';
import { ProductExcelImportModal } from '../../components/products/ProductExcelImportModal';
import { BarcodeLabelModal } from '../../components/products/BarcodeLabelModal';
import { ProductCameraCaptureModal } from '../../components/products/ProductCameraCaptureModal';
import { compressImageFile, compressImageUrl, isValidImageUrl } from '../../utils/imageCompressor';

interface ProductFilters {
  page: number;
  per_page: number;
  search: string;
  category_id: number | undefined;
  item_type: ItemType | undefined;
}

export function ProductsPage() {
  const [products, setProducts] = useState<(Product & { is_pending?: boolean })[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, per_page: 15, total_pages: 0 });
  const [filters, setFilters] = useState<ProductFilters>({ page: 1, per_page: 15, search: '', category_id: undefined, item_type: undefined });

  // Auth & Cost Privacy
  const { isOwner, hideCostFromCashier } = useAuthStore();
  const canViewCost = isOwner || !hideCostFromCashier;

  // Dynamic Business Departments
  const [departments, setDepartments] = useState<BusinessDepartment[]>(() => getAllBusinessDepartments());
  const [selectedDept, setSelectedDept] = useState<BusinessType>('barbeque');
  const [showDeptModal, setShowDeptModal] = useState(false);
  const [deptToEdit, setDeptToEdit] = useState<BusinessDepartment | null>(null);

  useEffect(() => {
    const handleDeptUpdated = () => {
      setDepartments(getAllBusinessDepartments());
    };
    window.addEventListener('pos_departments_updated', handleDeptUpdated);
    return () => window.removeEventListener('pos_departments_updated', handleDeptUpdated);
  }, []);

  const getDeptOfCategory = useCallback((cat: Category): BusinessType => {
    if (cat.business_type) return cat.business_type;
    const n = cat.name.toLowerCase();
    if (n.includes('bbq') || n.includes('ihaw') || n.includes('barbeque')) return 'barbeque';
    if (n.includes('rice') || n.includes('bigas')) return 'rice';
    if (n.includes('gulay') || n.includes('vegetable')) return 'vegetables';
    return 'groceries';
  }, []);

  const [ricePackagingFilter, setRicePackagingFilter] = useState<RicePackagingFilter>('all');

  const deptCategories = useMemo(() => {
    // Only include categories that actually have products in this department
    const productCatIds = new Set(products.map(p => p.category_id));
    return categories.filter(c => getDeptOfCategory(c) === selectedDept && (productCatIds.has(c.id) || (c.product_count ?? 0) > 0));
  }, [categories, products, selectedDept, getDeptOfCategory]);

  const displayedProducts = useMemo(() => {
    if (selectedDept === 'rice' && ricePackagingFilter !== 'all') {
      return products.filter(p => matchRicePackaging(p.name, p.unit, (p as any).sell_by_weight, ricePackagingFilter));
    }
    return products;
  }, [products, selectedDept, ricePackagingFilter]);

  const activeDeptInfo = departments.find(d => d.id === selectedDept) || departments[0];
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);
  const [showToolsDropdown, setShowToolsDropdown] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Product | null>(null);
  const [searchInput, setSearchInput] = useState('');

  // Layout & View Switcher States - default to cards on mobile for easy touch usage
  const [viewMode, setViewMode] = useState<'cards' | 'table'>(() =>
    typeof window !== 'undefined' && window.innerWidth < 1024 ? 'cards' : 'table'
  );

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchProducts({
        page: filters.page,
        per_page: filters.per_page,
        search: filters.search || undefined,
        category_id: filters.category_id,
        item_type: filters.item_type,
        business_type: selectedDept,
      });
      await upsertProducts(res.data);
      const localAll = await getAllProducts();
      const pendingItems = localAll.filter(p => {
        if (!(p.id < 0 || (p as any).is_pending)) return false;
        const bType = p.business_type || (p.category_id ? categories.find(c => c.id === p.category_id)?.business_type : undefined);
        return (bType || 'barbeque') === selectedDept;
      });
      setProducts([...pendingItems, ...res.data]);
      setPagination(res.pagination);
    } catch {
      // Fallback to local IndexedDB
      try {
        const localAll = await getAllProducts();
        let filtered = localAll.filter(p => {
          const bType = p.business_type || (p.category_id ? categories.find(c => c.id === p.category_id)?.business_type : undefined);
          return (bType || 'barbeque') === selectedDept;
        });
        if (filters.search) {
          const q = filters.search.toLowerCase();
          filtered = filtered.filter(p => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
        }
        if (filters.category_id) {
          filtered = filtered.filter(p => p.category_id === filters.category_id);
        }
        if (filters.item_type) {
          filtered = filtered.filter(p => p.item_type === filters.item_type);
        }
        setProducts(filtered);
        setPagination({
          page: 1,
          per_page: filtered.length || 15,
          total: filtered.length,
          total_pages: 1,
        });
      } catch (localErr) {
        setError(localErr instanceof Error ? localErr.message : 'Failed to load products');
      }
    } finally {
      setLoading(false);
    }
  }, [filters, selectedDept, categories]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    fetchCategories(true)
      .then(res => setCategories(res.data))
      .catch(async () => {
        const localCats = await getAllCategories();
        setCategories(localCats);
      });
  }, []);

  // Live stock refresh from POS sales and Daily Closing adjustments
  useEffect(() => {
    const handleStockChange = () => {
      loadProducts();
    };
    window.addEventListener('pos_sale_completed', handleStockChange);
    window.addEventListener('pos_sync_completed', handleStockChange);
    window.addEventListener('pos_inventory_updated', handleStockChange);

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel('pos_channel');
      channel.onmessage = (msg) => {
        if (
          msg.data?.type === 'SALE_COMPLETED' ||
          msg.data?.type === 'SYNC_COMPLETED' ||
          msg.data?.type === 'INVENTORY_UPDATED'
        ) {
          loadProducts();
        }
      };
    } catch (_) {}

    return () => {
      window.removeEventListener('pos_sale_completed', handleStockChange);
      window.removeEventListener('pos_sync_completed', handleStockChange);
      window.removeEventListener('pos_inventory_updated', handleStockChange);
      if (channel) channel.close();
    };
  }, [loadProducts]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters(f => ({ ...f, page: 1, search: searchInput }));
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  async function handleSaveProduct(data: ProductFormData) {
    try {
      const fullData = {
        ...data,
        item_type: data.item_type || 'product',
        business_type: data.business_type || selectedDept,
        target_stock: data.target_stock ?? 20,
        unit: data.unit || 'sticks',
        // Supplies are not for sale — force selling_price to 0
        selling_price: data.item_type === 'supply' ? 0 : data.selling_price,
      };

      if (editingProduct) {
        if (editingProduct.id > 0) {
          try {
            await updateProduct(editingProduct.id, fullData);
            await saveLocalProduct({
              ...editingProduct,
              ...fullData,
              category_name: categories.find(c => c.id === data.category_id)?.name ?? editingProduct.category_name,
            });
          } catch {
            await saveLocalProduct({
              ...editingProduct,
              ...fullData,
              category_name: categories.find(c => c.id === data.category_id)?.name ?? editingProduct.category_name,
              is_pending: true,
            });
            await addPendingMutation({
              entity: 'product',
              action: 'update',
              payload: fullData,
              entityId: editingProduct.id,
            });
            setNoticeMsg('Updated offline! It will sync automatically when connected to the laptop.');
          }
        } else {
          // Editing pending offline product
          await saveLocalProduct({
            ...editingProduct,
            ...fullData,
            category_name: categories.find(c => c.id === data.category_id)?.name ?? editingProduct.category_name,
            is_pending: true,
          });
          setNoticeMsg('Updated offline! It will sync automatically when connected to the laptop.');
        }
      } else {
        // Create new product
        try {
          const res = await createProduct(fullData);
          if (res.data) {
            await saveLocalProduct({
              ...res.data,
              target_stock: fullData.target_stock,
              unit: fullData.unit,
            });
          }
        } catch {
          const tempId = -Date.now();
          const newProd: Product & { is_pending?: boolean } = {
            id: tempId,
            category_id: data.category_id,
            category_name: categories.find(c => c.id === data.category_id)?.name ?? 'General',
            name: data.name,
            sku: data.sku,
            description: data.description ?? null,
            item_type: fullData.item_type ?? 'product',
            cost_price: data.cost_price,
            selling_price: fullData.item_type === 'supply' ? 0 : data.selling_price,
            current_stock: data.current_stock ?? 0,
            initial_stock: data.initial_stock ?? data.current_stock ?? 0,
            initial_stock_date: data.initial_stock_date ?? SYSTEM_START_DATE,
            low_stock_threshold: data.low_stock_threshold ?? 5,
            target_stock: fullData.target_stock,
            unit: fullData.unit,
            supplier_id: data.supplier_id,
            supplier_name: data.supplier_name,
            image_path: data.image_path ?? null,
            is_active: data.is_active ?? true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            is_pending: true,
          };
          await saveLocalProduct(newProd);
          await addPendingMutation({
            entity: 'product',
            action: 'create',
            payload: fullData,
            tempId,
          });
          setNoticeMsg('Saved offline! It will sync automatically when connected to the laptop.');
        }
      }

      // Synchronize with OrderItems so Re-order immediately picks it up
      try {
        const allOI = await getAllOrderItems();
        const existingOI = allOI.find(oi => oi.name.toLowerCase().trim() === data.name.toLowerCase().trim());
        if (existingOI) {
          await updateOrderItem(existingOI.id, {
            supplier_id: data.supplier_id || existingOI.supplier_id,
            supplier_name: data.supplier_name || existingOI.supplier_name,
            cost_price: data.cost_price,
            target_qty: fullData.target_stock,
            min_stock: data.low_stock_threshold ?? 5,
            unit: fullData.unit,
            is_active: data.is_active ?? true,
          });
        } else if (data.supplier_name) {
          await createOrderItem({
            name: data.name,
            supplier_id: data.supplier_id || '',
            supplier_name: data.supplier_name,
            cost_price: data.cost_price,
            target_qty: fullData.target_stock,
            min_stock: data.low_stock_threshold ?? 5,
            unit: fullData.unit,
            notes: '',
            is_active: data.is_active ?? true,
          });
        }
      } catch (syncErr) {
        console.warn('OrderItem sync warning:', syncErr);
      }

      useSyncStore.getState().refreshCounts();
    } catch (err) {
      console.error('Save product error:', err);
    } finally {
      setShowForm(false);
      setEditingProduct(null);
      loadProducts();
    }
  }

  async function handleDelete() {
    if (!deleteConfirm) return;
    try {
      if (deleteConfirm.id > 0) {
        try {
          await deleteProduct(deleteConfirm.id);
          await deleteLocalProduct(deleteConfirm.id);
        } catch {
          await deleteLocalProduct(deleteConfirm.id);
          await addPendingMutation({
            entity: 'product',
            action: 'delete',
            payload: {},
            entityId: deleteConfirm.id,
          });
          setNoticeMsg('Deleted offline! It will sync automatically when connected to the laptop.');
        }
      } else {
        await deleteLocalProduct(deleteConfirm.id);
        await removeMutationByTempId(deleteConfirm.id);
      }
      useSyncStore.getState().refreshCounts();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleteConfirm(null);
      loadProducts();
    }
  }

  // Summary Metrics (tab-aware)
  const activeCount = useMemo(() => products.filter(p => p.is_active).length, [products]);
  const lowStockCount = useMemo(() => products.filter(p => p.current_stock <= p.low_stock_threshold).length, [products]);
  const supplyCount = useMemo(() => products.filter(p => p.item_type === 'supply').length, [products]);
  const productCount = useMemo(() => products.filter(p => p.item_type !== 'supply').length, [products]);
  const avgMargin = useMemo(() => {
    const sellable = products.filter(p => p.item_type !== 'supply' && Number(p.selling_price) > 0);
    if (sellable.length === 0) return 0;
    const totalMargin = sellable.reduce((sum, p) => {
      const price = Number(p.selling_price) || 0;
      const cost = Number(p.cost_price) || 0;
      return sum + (price > 0 ? ((price - cost) / price) * 100 : 0);
    }, 0);
    return (totalMargin / sellable.length).toFixed(0);
  }, [products]);

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-2.5 sm:space-y-3.5 animate-fade-in pb-16 lg:pb-0">
      {/* Header Bar */}
      <div className="flex-shrink-0 flex items-center justify-between gap-2">
        <div className="hidden lg:block">
          <h1 className="text-xl sm:text-2xl font-bold text-surface-50 tracking-tight">
            {filters.item_type === 'supply' ? '📦 Supplies & Items' : filters.item_type === 'product' ? '🛒 Products Catalog' : 'Products & Supplies'}
          </h1>
          <p className="text-surface-400 mt-0.5 text-xs sm:text-sm">
            {filters.item_type === 'supply'
              ? 'Mga sangkap, materyales, at internal na gamit'
              : filters.item_type === 'product'
              ? 'Pamamahala sa mga paninda, presyo, puhunan, at margin'
              : 'Lahat ng items — Products (ibinebenta) at Supplies (internal)'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 w-full lg:w-auto justify-end relative">
          {/* Mobile Tools Dropdown (< lg screens) */}
          <div className="lg:hidden relative">
            <button
              type="button"
              onClick={() => setShowToolsDropdown(prev => !prev)}
              className="px-2.5 py-1.5 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-200 border border-surface-700 text-xs font-semibold flex items-center gap-1 shadow-xs cursor-pointer"
            >
              <span>⚙️</span>
              <span>Gamit ▾</span>
            </button>
            {showToolsDropdown && (
              <div
                className="absolute right-0 top-full mt-1.5 w-48 bg-surface-850 border border-surface-700 rounded-xl shadow-2xl py-1 z-30 animate-fade-in"
                onClick={() => setShowToolsDropdown(false)}
              >
                {products.length > 0 && (
                  <button
                    onClick={() => exportToCSV(formatProductsForCSV(products), `products_export_${getTodayStr()}`)}
                    className="w-full text-left px-3 py-2 text-xs text-surface-200 hover:bg-surface-700/60 flex items-center gap-2 cursor-pointer"
                  >
                    <span>📤</span>
                    <span>Export CSV</span>
                  </button>
                )}
                <button
                  onClick={() => setShowImportModal(true)}
                  className="w-full text-left px-3 py-2 text-xs text-surface-200 hover:bg-surface-700/60 flex items-center gap-2 cursor-pointer"
                >
                  <span>📥</span>
                  <span>Import Excel</span>
                </button>
                <button
                  onClick={() => setShowBarcodeModal(true)}
                  className="w-full text-left px-3 py-2 text-xs text-surface-200 hover:bg-surface-700/60 flex items-center gap-2 cursor-pointer"
                >
                  <span>🏷️</span>
                  <span>Price Tags & Barcode</span>
                </button>
              </div>
            )}
          </div>

          {/* Desktop Full Action Buttons (lg: screens) */}
          <div className="hidden lg:flex items-center gap-1.5 sm:gap-2">
            {products.length > 0 && (
              <button
                onClick={() => exportToCSV(formatProductsForCSV(products), `products_export_${getTodayStr()}`)}
                className="px-2.5 sm:px-3.5 py-1.5 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-200 border border-surface-700 text-xs sm:text-sm font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 shadow-xs cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span>Export CSV</span>
              </button>
            )}
            <button
              onClick={() => setShowImportModal(true)}
              className="px-2.5 sm:px-3.5 py-1.5 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-200 border border-surface-700 text-xs sm:text-sm font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 shadow-xs cursor-pointer"
              title="Mag-import ng mga produkto mula sa Excel o CSV"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <span>📥 Import Excel</span>
            </button>
            <button
              onClick={() => setShowBarcodeModal(true)}
              className="px-2.5 sm:px-3.5 py-1.5 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-200 border border-surface-700 text-xs sm:text-sm font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 shadow-xs cursor-pointer"
              title="Mag-print ng Barcode & Price Tags para sa estante o paninda"
            >
              <span>🏷️</span>
              <span>Price Tags & Barcode</span>
            </button>
          </div>

          {/* Always Visible on Both Mobile & Desktop */}
          <button
            onClick={() => setShowDeptModal(true)}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-200 border border-surface-700 text-xs sm:text-sm font-semibold transition-all cursor-pointer whitespace-nowrap shadow-xs"
            title="Magtayo ng Bagong Negosyo"
          >
            <span>🏢</span>
            <span>+ Negosyo</span>
          </button>
          <button
            onClick={() => { setEditingProduct(null); setShowForm(true); }}
            className={`px-3 sm:px-4 py-1.5 rounded-xl text-white text-xs sm:text-sm font-semibold transition-colors shadow-xs flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
              filters.item_type === 'supply'
                ? 'bg-amber-600 hover:bg-amber-500 shadow-amber-600/20'
                : 'bg-primary-600 hover:bg-primary-500 shadow-primary-600/20'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>+ {filters.item_type === 'supply' ? 'Supply' : 'Product'}</span>
          </button>
        </div>
      </div>

      {/* ── Strict Department Ribbon (NO "Lahat" button) ── */}
      <div className="flex-shrink-0 flex items-center justify-between gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] font-bold text-surface-400 uppercase tracking-wider shrink-0 mr-1 hidden sm:inline">
            Negosyo:
          </span>
          {departments.map(dept => {
            const isActive = selectedDept === dept.id;
            return (
              <button
                key={dept.id}
                onClick={() => {
                  setSelectedDept(dept.id);
                  setRicePackagingFilter('all');
                  setFilters(f => ({ ...f, page: 1, category_id: undefined }));
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer border ${
                  isActive
                    ? `${dept.activeColor} shadow-md`
                    : 'bg-surface-800/80 hover:bg-surface-700/80 text-surface-400 hover:text-surface-200 border-surface-700/60'
                }`}
              >
                <span>{dept.icon}</span>
                <span>{dept.label}</span>
              </button>
            );
          })}
        </div>

        {/* Quick in-place Edit Business Profile Button */}
        <button
          onClick={() => {
            setDeptToEdit(activeDeptInfo);
            setShowDeptModal(true);
          }}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-surface-800/90 hover:bg-surface-700 text-surface-300 hover:text-surface-100 border border-surface-700/60 text-xs font-semibold transition-all cursor-pointer whitespace-nowrap shadow-xs shrink-0"
          title={`I-edit ang Profile ng ${activeDeptInfo?.label}`}
        >
          <span>⚙️</span>
          <span className="hidden xs:inline">Ayusin ang {activeDeptInfo?.label}</span>
        </button>
      </div>

      {/* ── Type Tabs ── */}
      <div className="flex-shrink-0">
        <div className="flex items-center gap-0 bg-surface-800/60 p-1 rounded-xl border border-surface-700/50 w-full sm:w-auto sm:inline-flex">
          {([
            { key: undefined,     label: 'All',      emoji: '📋', count: pagination.total },
            { key: 'product',     label: 'Products', emoji: '🛒', count: productCount },
            { key: 'supply',      label: 'Supplies', emoji: '📦', count: supplyCount },
          ] as { key: ItemType | undefined; label: string; emoji: string; count: number }[]).map(tab => {
            const isActive = filters.item_type === tab.key;
            return (
              <button
                key={tab.label}
                onClick={() => setFilters(f => ({ ...f, page: 1, item_type: tab.key }))}
                className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  isActive
                    ? tab.key === 'supply'
                      ? 'bg-amber-500 text-white shadow-sm shadow-amber-500/30'
                      : tab.key === 'product'
                      ? 'bg-primary-600 text-white shadow-sm shadow-primary-600/30'
                      : 'bg-surface-600 text-white shadow-sm'
                    : 'text-surface-400 hover:text-surface-200 hover:bg-surface-700/60'
                }`}
              >
                <span>{tab.emoji}</span>
                <span>{tab.label}</span>
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  isActive ? 'bg-white/20 text-white' : 'bg-surface-700 text-surface-400'
                }`}>
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Compact KPI Summary Cards */}
      <div className="flex-shrink-0 grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2">
        <div className="p-1.5 sm:p-2.5 rounded-xl bg-surface-800/90 border border-surface-700/60 shadow-xs flex items-center justify-between">
          <div className="min-w-0">
            <span className="text-[9px] sm:text-[10px] font-bold text-surface-400 uppercase tracking-wider block truncate">
              {filters.item_type === 'supply' ? 'Total Supplies' : filters.item_type === 'product' ? 'Total Products' : 'Total Items'}
            </span>
            <span className="text-xs sm:text-base font-extrabold text-surface-100 block truncate">{pagination.total} SKUs</span>
          </div>
          <span className="text-[9px] sm:text-[10px] text-surface-500 font-medium shrink-0 ml-1">{activeCount} act</span>
        </div>

        <div className="p-1.5 sm:p-2.5 rounded-xl bg-surface-800/90 border border-surface-700/60 shadow-xs flex items-center justify-between">
          <div className="min-w-0">
            <span className="text-[9px] sm:text-[10px] font-bold text-surface-400 uppercase tracking-wider block truncate">Categories</span>
            <span className="text-xs sm:text-base font-extrabold text-primary-400 block truncate">{deptCategories.length}</span>
          </div>
          <span className="text-[9px] sm:text-[10px] text-surface-500 font-medium shrink-0 ml-1">uri</span>
        </div>

        <div className="p-1.5 sm:p-2.5 rounded-xl bg-surface-800/90 border border-surface-700/60 shadow-xs flex items-center justify-between">
          <div className="min-w-0">
            <span className="text-[9px] sm:text-[10px] font-bold text-surface-400 uppercase tracking-wider block truncate">
              {filters.item_type === 'supply' ? 'Avg Cost' : 'Avg Margin'}
            </span>
            {filters.item_type === 'supply' ? (
              <span className="text-xs sm:text-base font-extrabold text-amber-400 block truncate">—</span>
            ) : (
              <span className="text-xs sm:text-base font-extrabold text-emerald-400 block truncate">{avgMargin}%</span>
            )}
          </div>
          <span className="text-[9px] sm:text-[10px] text-surface-500 font-medium shrink-0 ml-1">{filters.item_type === 'supply' ? 'cost' : 'kita'}</span>
        </div>

        <div className="p-1.5 sm:p-2.5 rounded-xl bg-surface-800/90 border border-surface-700/60 shadow-xs flex items-center justify-between">
          <div className="min-w-0">
            <span className="text-[9px] sm:text-[10px] font-bold text-surface-400 uppercase tracking-wider block truncate">Stock Alerts</span>
            <span className={`text-xs sm:text-base font-extrabold block truncate ${lowStockCount > 0 ? 'text-warning-400' : 'text-surface-300'}`}>
              {lowStockCount}
            </span>
          </div>
          <span className="text-[9px] sm:text-[10px] text-surface-500 font-medium shrink-0 ml-1">low</span>
        </div>
      </div>

      {/* Filters Row: Search & Category only (type tabs above handle type filtering) */}
      <div className="flex-shrink-0 flex items-center gap-1.5 sm:gap-2">
        <div className="relative flex-1 min-w-[130px]">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder={filters.item_type === 'supply' ? 'Search supplies...' : 'Search products...'}
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-surface-900 border border-surface-700 text-surface-100 text-xs placeholder:text-surface-500 focus:outline-none focus:border-primary-500 transition-colors"
          />
        </div>
        <select
          value={filters.category_id ?? ''}
          onChange={e => setFilters(f => ({ ...f, page: 1, category_id: e.target.value ? Number(e.target.value) : undefined }))}
          className="w-36 sm:w-52 text-xs py-1.5 px-2 rounded-lg bg-surface-800 border border-surface-700 text-surface-200 shrink-0 cursor-pointer focus:outline-none focus:border-primary-500"
        >
          <option value="">Lahat sa {activeDeptInfo?.label}</option>
          {deptCategories.map(c => (
            <option key={c.id} value={c.id}>{c.name} ({c.product_count ?? 0})</option>
          ))}
        </select>

        {/* Bigasan (Rice) Packaging Filter Dropdown - Inlined */}
        {selectedDept === 'rice' && (
          <select
            value={ricePackagingFilter}
            onChange={e => setRicePackagingFilter(e.target.value as RicePackagingFilter)}
            className="w-32 sm:w-44 text-xs py-1.5 px-2 rounded-lg bg-surface-800 border border-amber-600/60 text-amber-300 font-bold shrink-0 cursor-pointer focus:outline-none focus:border-amber-500 shadow-xs"
            title="I-filter ayon sa Sukat / Packaging"
          >
            {RICE_PACKAGING_OPTIONS.map(opt => (
              <option key={opt.key} value={opt.key}>
                {opt.icon} {opt.label}
              </option>
            ))}
          </select>
        )}
      </div>

      {noticeMsg && (
        <div className="bg-primary-500/10 border border-primary-500/30 rounded-xl p-2.5 flex items-center justify-between text-xs text-primary-300 font-medium shrink-0">
          <span>💾 {noticeMsg}</span>
          <button onClick={() => setNoticeMsg(null)} className="text-surface-400 hover:text-white ml-2 cursor-pointer">✕</button>
        </div>
      )}

      {error && (
        <div className="bg-danger-500/10 border border-danger-500/30 rounded-xl p-3 flex items-center justify-between shrink-0">
          <p className="text-danger-500 text-xs font-medium">⚠️ {error}</p>
          <button onClick={loadProducts} className="text-primary-400 text-xs hover:text-primary-300 cursor-pointer">Retry</button>
        </div>
      )}

      {/* Products Table Card with View Switcher */}
      <div className="flex-1 min-h-0 bg-surface-800/50 rounded-xl border border-surface-700/50 flex flex-col overflow-hidden shadow-sm">
        {/* Header Bar with View Switcher */}
        <div className="px-3 py-2 sm:px-4 sm:py-2.5 bg-surface-900/70 border-b border-surface-700/50 flex items-center justify-between gap-2 flex-nowrap shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-xs sm:text-sm font-bold text-surface-100 flex items-center gap-1.5 truncate">
              <span>📦</span> <span>Talaan ng mga Produkto</span>
            </h3>
            <span className="text-[10px] sm:text-xs text-surface-400 hidden sm:inline whitespace-nowrap">
              ({pagination.total} total)
            </span>
          </div>

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

        {loading ? (
          <div className="flex-1 min-h-0 flex items-center justify-center py-16">
            <div className="flex flex-col items-center gap-2">
              <div className="w-8 h-8 border-3 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
              <p className="text-xs text-surface-400">Kinukuha ang talaan ng mga produkto...</p>
            </div>
          </div>
        ) : displayedProducts.length === 0 ? (
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center py-12 text-center">
            <span className="text-3xl mb-2 block">📦</span>
            <p className="text-surface-300 font-medium text-xs sm:text-sm">Walang nahanap na produkto</p>
            <p className="text-surface-500 text-[11px] mt-0.5">{searchInput ? 'Subukan ang ibang search term' : 'Walang produkto sa napiling filter o sukat'}</p>
          </div>
        ) : (
          <>
            {/* Scrollable Container for Table or Cards */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {viewMode === 'cards' ? (
                /* Cards View - 100% Mobile Friendly */
                <div className="p-2 sm:p-2.5 space-y-1.5">
                  {displayedProducts.map(p => {
                    const unitProfit = (Number(p.selling_price) || 0) - (Number(p.cost_price) || 0);
                    const marginPct = Number(p.selling_price) > 0 ? ((unitProfit / Number(p.selling_price)) * 100).toFixed(0) : 0;
                    return (
                      <div
                        key={p.id}
                        className="p-2.5 rounded-xl bg-surface-900/40 hover:bg-surface-700/20 border border-surface-800/60 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2.5">
                          {p.image_path && isValidImageUrl(p.image_path) ? (
                            <img
                              src={p.image_path}
                              alt={p.name}
                              referrerPolicy="no-referrer"
                              className="w-12 h-12 rounded-xl object-cover border border-surface-700/60 shrink-0 shadow-xs"
                              onError={(e) => {
                                (e.currentTarget as HTMLElement).style.display = 'none';
                                const fallback = (e.currentTarget as HTMLElement).nextElementSibling;
                                if (fallback) (fallback as HTMLElement).classList.remove('hidden');
                              }}
                            />
                          ) : null}
                          <div className={`w-12 h-12 rounded-xl bg-surface-800/80 border border-surface-700/50 flex items-center justify-center text-xl shrink-0 shadow-xs ${p.image_path && isValidImageUrl(p.image_path) ? 'hidden' : ''}`}>
                            {getCategoryIcon(p.category_name)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <p className="text-surface-100 font-semibold text-xs sm:text-sm truncate">{p.name}</p>
                              {p.item_type === 'supply' ? (
                                <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">📦 Supply</span>
                              ) : (
                                <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-primary-500/15 text-primary-400 border border-primary-500/30">🛒 Product</span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-surface-400 flex-wrap">
                              <span>{p.category_name}</span>
                              <span>•</span>
                              <span className="font-mono text-surface-500">{p.sku}</span>
                              {p.supplier_name && (
                                <>
                                  <span>•</span>
                                  <span className="text-emerald-400 font-medium">🏪 {p.supplier_name}</span>
                                </>
                              )}
                              {(p.is_pending || p.id < 0) && (
                                <span className="px-1 py-0.2 rounded bg-warning-500/20 text-warning-400 text-[9px] font-semibold">
                                  ⏳ Pending
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => { setEditingProduct(p); setShowForm(true); }}
                              className="p-1 rounded-lg text-surface-300 hover:text-primary-400 bg-surface-800 hover:bg-surface-700 border border-surface-700/60 transition-colors cursor-pointer"
                              title="Edit Product"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(p)}
                              className="p-1 rounded-lg text-surface-300 hover:text-danger-500 bg-surface-800 hover:bg-surface-700 border border-surface-700/60 transition-colors cursor-pointer"
                              title="Delete Product"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-surface-800/80">
                          <div className="flex items-center gap-2">
                            {p.item_type === 'supply' ? (
                              <span className="text-[10px] text-amber-400 font-medium italic">Hindi ibinebenta</span>
                            ) : (
                              <>
                                <span className="text-xs font-bold text-emerald-400">{formatCurrency(p.selling_price)}</span>
                                {canViewCost ? (
                                  <>
                                    <span className="text-[10px] text-surface-500">Puhunan: {formatCurrency(p.cost_price)}</span>
                                    <span className={`text-[10px] font-semibold px-1 py-0.2 rounded ${
                                      unitProfit >= 0 ? 'bg-success-500/10 text-success-400' : 'bg-danger-500/10 text-danger-400'
                                    }`}>
                                      +{formatCurrency(unitProfit)} ({marginPct}%)
                                    </span>
                                  </>
                                ) : (
                                  <span className="text-[10px] text-surface-500 italic">Puhunan: ••••</span>
                                )}
                              </>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              p.current_stock === 0 ? 'bg-danger-500/20 text-danger-400' :
                              p.current_stock <= (p.low_stock_threshold || 5) ? 'bg-warning-500/20 text-warning-400' :
                              'bg-success-500/20 text-success-400'
                            }`}>
                              Stock: {p.current_stock} {p.unit || 'sticks'}
                            </span>
                            {p.target_stock !== undefined && p.target_stock > 0 && (
                              <span className="text-[10px] text-surface-400 font-medium" title="Target Par Stock">
                                (Par: {p.target_stock})
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Responsive Table View - Zero Horizontal Overflow */
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-surface-900 border-b border-surface-700/60 z-10 shadow-xs">
                    <tr>
                      <th className="px-2.5 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase whitespace-nowrap">Product</th>
                      <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-right whitespace-nowrap">Price</th>
                      <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-right whitespace-nowrap hidden sm:table-cell">Profit</th>
                      <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-right whitespace-nowrap">Stock / Par</th>
                      <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-center whitespace-nowrap hidden md:table-cell">Status</th>
                      <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase whitespace-nowrap hidden lg:table-cell">Category</th>
                      <th className="px-2 sm:px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-right whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-700/30">
                    {displayedProducts.map(p => {
                      const unitProfit = (Number(p.selling_price) || 0) - (Number(p.cost_price) || 0);
                      const marginPct = Number(p.selling_price) > 0 ? ((unitProfit / Number(p.selling_price)) * 100).toFixed(0) : 0;
                      return (
                        <tr key={p.id} className="hover:bg-surface-700/20 transition-colors">
                          <td className="px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs">
                            <div className="flex items-center gap-2">
                              {p.image_path && isValidImageUrl(p.image_path) ? (
                                <img
                                  src={p.image_path}
                                  alt={p.name}
                                  referrerPolicy="no-referrer"
                                  className="w-8 h-8 rounded-lg object-cover border border-surface-700/60 shrink-0"
                                  onError={(e) => {
                                    (e.currentTarget as HTMLElement).style.display = 'none';
                                    const fallback = (e.currentTarget as HTMLElement).nextElementSibling;
                                    if (fallback) (fallback as HTMLElement).classList.remove('hidden');
                                  }}
                                />
                              ) : null}
                              <div className={`w-8 h-8 rounded-lg bg-surface-800/80 border border-surface-700/50 flex items-center justify-center text-sm shrink-0 ${p.image_path && isValidImageUrl(p.image_path) ? 'hidden' : ''}`}>
                                {getCategoryIcon(p.category_name)}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <p className="text-surface-100 font-medium truncate">{p.name}</p>
                                  {p.item_type === 'supply' ? (
                                    <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">Supply</span>
                                  ) : (
                                    <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-primary-500/15 text-primary-400 border border-primary-500/30">Product</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-surface-500 flex-wrap">
                                  <span className="font-mono">{p.sku}</span>
                                  {p.supplier_name && (
                                    <>
                                      <span>•</span>
                                      <span className="text-emerald-400 font-medium">🏪 {p.supplier_name}</span>
                                    </>
                                  )}
                                  {(p.is_pending || p.id < 0) && (
                                    <span className="px-1 py-0.2 rounded bg-warning-500/20 text-warning-400 text-[9px] font-semibold">
                                      ⏳ Pending
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-right text-xs font-bold whitespace-nowrap">
                            {p.item_type === 'supply' ? (
                              <span className="text-amber-400/70 italic text-[10px] font-normal">—</span>
                            ) : (
                              <span className="text-emerald-400">{formatCurrency(p.selling_price)}</span>
                            )}
                          </td>
                          <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-right text-xs whitespace-nowrap hidden sm:table-cell">
                            {!canViewCost ? (
                              <span className="text-surface-500 text-[10px] italic">••••</span>
                            ) : p.item_type === 'supply' ? (
                              <span className="text-surface-500 text-[10px] italic">N/A</span>
                            ) : (
                              <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.2 rounded ${
                                unitProfit >= 0 ? 'bg-success-500/10 text-success-400' : 'bg-danger-500/10 text-danger-400'
                              }`}>
                                +{formatCurrency(unitProfit)} <span className="opacity-70">({marginPct}%)</span>
                              </span>
                            )}
                          </td>
                          <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-right whitespace-nowrap">
                            <div className="flex flex-col items-end">
                              <span className={`text-xs font-bold ${
                                p.current_stock === 0 ? 'text-danger-400' :
                                p.current_stock <= (p.low_stock_threshold || 5) ? 'text-warning-400' :
                                'text-success-400'
                              }`}>
                                {p.current_stock} <span className="text-[10px] font-normal text-surface-400">{p.unit || 'sticks'}</span>
                              </span>
                              {p.target_stock !== undefined && p.target_stock > 0 && (
                                <span className="text-[9px] text-surface-400" title="Target Par Limit">
                                  Par: {p.target_stock}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-center whitespace-nowrap hidden md:table-cell">
                            <span className={`inline-flex px-1.5 py-0.2 rounded-full text-[10px] font-medium ${
                              p.is_active ? 'bg-success-500/20 text-success-400' : 'bg-surface-600 text-surface-400'
                            }`}>
                              {p.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-xs text-surface-300 whitespace-nowrap hidden lg:table-cell">
                            <span className="px-1.5 py-0.2 rounded bg-surface-700/60 border border-surface-600/40 text-[10px]">
                              {p.category_name}
                            </span>
                          </td>
                          <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => { setEditingProduct(p); setShowForm(true); }}
                                className="p-1 rounded text-surface-400 hover:text-primary-400 hover:bg-surface-700 transition-colors cursor-pointer"
                                title="Edit Product"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(p)}
                                className="p-1 rounded text-surface-400 hover:text-danger-500 hover:bg-surface-700 transition-colors cursor-pointer"
                                title="Delete Product"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
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

      {/* Business Department Onboarding Modal */}
      {showDeptModal && (
        <BusinessDepartmentModal
          departments={departments}
          initialDeptToEdit={deptToEdit}
          onClose={() => {
            setShowDeptModal(false);
            setDeptToEdit(null);
          }}
          onUpdated={(updatedDepts, activeId) => {
            setDepartments(updatedDepts);
            if (activeId) {
              setSelectedDept(activeId);
              setFilters(f => ({ ...f, page: 1, category_id: undefined }));
            }
            setDeptToEdit(null);
            loadProducts();
          }}
        />
      )}

      {/* Product form modal */}
      {showForm && (
        <ProductFormModal
          product={editingProduct}
          categories={categories}
          departments={departments}
          existingProducts={products}
          defaultDept={selectedDept}
          getDeptOfCategory={getDeptOfCategory}
          onSave={handleSaveProduct}
          onClose={() => { setShowForm(false); setEditingProduct(null); }}
        />
      )}

      {/* Excel / CSV Import Modal */}
      {showImportModal && (
        <ProductExcelImportModal
          categories={categories}
          existingProducts={products}
          defaultDept={selectedDept}
          onClose={() => setShowImportModal(false)}
          onImportDone={() => {
            loadProducts();
            setShowImportModal(false);
          }}
        />
      )}

      {/* Barcode & Price Tag Print Modal */}
      {showBarcodeModal && (
        <BarcodeLabelModal
          products={products}
          categories={categories}
          onClose={() => setShowBarcodeModal(false)}
        />
      )}

      {/* Delete confirmation modal */}
      {deleteConfirm && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-surface-800 rounded-2xl p-5 sm:p-6 max-w-sm w-full border border-surface-700 shadow-2xl animate-fade-in max-h-[90dvh] overflow-y-auto">
            <h3 className="text-lg font-bold text-surface-100 mb-2">Delete Product?</h3>
            <p className="text-surface-400 text-sm mb-6">
              Are you sure you want to delete <strong className="text-surface-200">{deleteConfirm.name}</strong>? This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 px-4 py-2.5 rounded-xl bg-surface-700 text-surface-200 text-sm font-medium hover:bg-surface-600 transition-colors cursor-pointer">Cancel</button>
              <button onClick={handleDelete} className="flex-1 px-4 py-2.5 rounded-xl bg-danger-600 text-white text-sm font-medium hover:bg-danger-500 transition-colors cursor-pointer">Delete</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ============================================================
// Auto-generate Next SKU helper
// ============================================================

function generateNextSku(categoryId: number, categories: Category[], existingProducts: Product[]): string {
  const category = categories.find(c => c.id === categoryId);
  let prefix = 'BBQ';
  if (category) {
    const nameUpper = category.name.toUpperCase().trim();
    if (nameUpper.includes('BARBEQUE') || nameUpper.includes('BARBECUE') || nameUpper.includes('BBQ')) {
      prefix = 'BBQ';
    } else if (nameUpper.includes('DRINK') || nameUpper.includes('BEVERAGE')) {
      prefix = 'DRK';
    } else if (nameUpper.includes('SIDE') || nameUpper.includes('APPETIZER')) {
      prefix = 'SIDE';
    } else {
      const letters = nameUpper.replace(/[^A-Z]/g, '');
      prefix = letters.length >= 3 ? letters.slice(0, 3) : nameUpper.slice(0, 3) || 'ITM';
    }
  }

  // Find highest sequence number among existing products
  let maxNum = 0;
  let padLength = 5; // Default 5 digits like BBQ-00001
  for (const p of existingProducts) {
    const match = p.sku.match(new RegExp(`^${prefix}-(\\d+)`, 'i'));
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
        padLength = Math.max(padLength, match[1].length);
      }
    }
  }

  const nextNum = maxNum + 1;
  return `${prefix}-${String(nextNum).padStart(padLength, '0')}`;
}

// ============================================================
// Product Form Modal
// ============================================================

type RicePackagingType = 'per_kilo' | '5kg' | '25kg';

function detectRicePackaging(p: Product | null): RicePackagingType {
  if (!p) return 'per_kilo';
  const n = (p.name || '').toLowerCase();
  const sku = (p.sku || '').toLowerCase();
  if (n.includes('25kg') || n.includes('sako') || sku.includes('25kg')) return '25kg';
  if (n.includes('5kg') || sku.includes('5kg')) return '5kg';
  return 'per_kilo';
}

function ProductFormModal({ product, categories, departments, existingProducts, defaultDept, getDeptOfCategory, onSave, onClose }: {
  product: Product | null;
  categories: Category[];
  departments: BusinessDepartment[];
  existingProducts: Product[];
  defaultDept?: BusinessType;
  getDeptOfCategory: (cat: Category) => BusinessType;
  onSave: (data: ProductFormData) => Promise<void>;
  onClose: () => void;
}) {
  const initialCategoryId = product?.category_id ?? (categories[0]?.id ?? 0);
  const initialSku = product?.sku || generateNextSku(initialCategoryId, categories, existingProducts);
  const initialDept = product?.business_type || defaultDept || 'barbeque';

  const [form, setForm] = useState<ProductFormData>({
    name: product?.name ?? '',
    sku: initialSku,
    category_id: initialCategoryId,
    item_type: product?.item_type ?? 'product',
    description: product?.description ?? '',
    cost_price: product?.cost_price ?? 0,
    selling_price: product?.selling_price ?? 0,
    current_stock: product?.current_stock ?? 0,
    initial_stock: product?.initial_stock ?? product?.current_stock ?? 0,
    initial_stock_date: product?.initial_stock_date ?? product?.created_at?.slice(0, 10) ?? SYSTEM_START_DATE,
    low_stock_threshold: product?.low_stock_threshold ?? 5,
    target_stock: product?.target_stock ?? 20,
    business_type: initialDept,
    unit: product?.unit || (initialDept === 'rice' || initialDept === 'vegetables' ? 'kg' : (initialDept === 'groceries' ? 'pcs' : 'sticks')),
    sell_by_weight: product?.sell_by_weight ?? (initialDept === 'rice' || initialDept === 'vegetables'),
    supplier_id: product?.supplier_id ?? '',
    supplier_name: product?.supplier_name ?? '',
    image_path: product?.image_path ?? null,
    is_active: product?.is_active ?? true,
  });

  const [imagePreview, setImagePreview] = useState<string | null>(product?.image_path ?? null);
  const [imageLoading, setImageLoading] = useState(false);
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [pasteNotice, setPasteNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageFile = async (file: File | Blob) => {
    if (!file) return;
    setImageLoading(true);
    try {
      const compressed = await compressImageFile(file, { maxWidth: 280, maxHeight: 280, quality: 0.85 });
      setImagePreview(compressed);
      setForm(f => ({ ...f, image_path: compressed }));
      setPasteNotice('✓ Na-load ang larawan!');
      setTimeout(() => setPasteNotice(null), 2500);
    } catch (err) {
      console.error('Failed to compress image:', err);
      alert('Hindi ma-proseso ang larawan. Subukan ang ibang picture.');
    } finally {
      setImageLoading(false);
    }
  };

  const handleImageUrl = async (url: string) => {
    if (!url) return;
    setImageLoading(true);
    try {
      const compressed = await compressImageUrl(url, { maxWidth: 280, maxHeight: 280, quality: 0.85 });
      setImagePreview(compressed);
      setForm(f => ({ ...f, image_path: compressed }));
      setPasteNotice('✓ Na-load ang larawan!');
      setTimeout(() => setPasteNotice(null), 2500);
    } catch (err) {
      console.error('Failed to process image url:', err);
      // Fallback: if valid external URL, save directly
      if (url.startsWith('http://') || url.startsWith('https://')) {
        setImagePreview(url);
        setForm(f => ({ ...f, image_path: url }));
        setPasteNotice('✓ Na-load ang larawan mula sa link!');
        setTimeout(() => setPasteNotice(null), 2500);
      } else {
        alert('Hindi ma-load ang imahe. Subukang i-right click sa Google at piliin ang "Copy image", o i-save muna sa computer.');
      }
    } finally {
      setImageLoading(false);
    }
  };

  const handleRemoveImage = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setImagePreview(null);
    setForm(f => ({ ...f, image_path: null }));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Support Ctrl + V Paste anywhere when this modal is open
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      const isTextInput = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';

      const clipboard = e.clipboardData;
      if (!clipboard) return;

      // 1. Check for image files in clipboard (e.g. from Snipping tool, Copy image, screenshots)
      const items = clipboard.items;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            handleImageFile(file);
            return;
          }
        }
      }

      // 2. Check for HTML containing <img> (often copied from Google Images or web pages)
      const html = clipboard.getData('text/html');
      if (html) {
        const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (match && match[1]) {
          e.preventDefault();
          handleImageUrl(match[1]);
          return;
        }
      }

      // 3. Check for plain text containing an image URL (if not actively typing in an input field)
      const text = clipboard.getData('text/plain')?.trim();
      if (text && (text.startsWith('http://') || text.startsWith('https://') || text.startsWith('data:image/'))) {
        if (!isTextInput && (text.match(/\.(jpeg|jpg|png|webp|gif|svg)(\?.*)?$/i) || text.includes('gstatic.com') || text.includes('googleusercontent.com') || text.startsWith('data:image/'))) {
          e.preventDefault();
          handleImageUrl(text);
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  const isSupply = form.item_type === 'supply';
  const currentDept = form.business_type || defaultDept || 'barbeque';
  const isRice = currentDept === 'rice';
  const isVegetables = currentDept === 'vegetables';
  const isGroceries = currentDept === 'groceries';

  // Rice packaging variant selection: 'per_kilo' | '5kg' | '25kg'
  const [ricePackaging, setRicePackaging] = useState<RicePackagingType>(() => detectRicePackaging(product));

  // Multi-variant pricing and stock memory for Rice so switching radio buttons does not lose values
  const [ricePricing, setRicePricing] = useState<Record<RicePackagingType, {
    cost: number;
    selling: number;
    initialStock: number;
    currentStock: number;
  }>>(() => {
    const initPkg = detectRicePackaging(product);
    return {
      per_kilo: {
        cost: (product && initPkg === 'per_kilo') ? product.cost_price : (product?.cost_price ? Number((product.cost_price / 25).toFixed(2)) : 43),
        selling: (product && initPkg === 'per_kilo') ? product.selling_price : (product?.selling_price ? Number((product.selling_price / 25).toFixed(2)) : 54),
        initialStock: (product && initPkg === 'per_kilo') ? (product.initial_stock ?? product.current_stock ?? 50) : 50,
        currentStock: (product && initPkg === 'per_kilo') ? product.current_stock : 50,
      },
      '5kg': {
        cost: (product && initPkg === '5kg') ? product.cost_price : (product?.cost_price ? Number((product.cost_price / 5).toFixed(2)) : 214),
        selling: (product && initPkg === '5kg') ? product.selling_price : (product?.selling_price ? Number((product.selling_price / 5).toFixed(2)) : 270),
        initialStock: (product && initPkg === '5kg') ? (product.initial_stock ?? product.current_stock ?? 5) : 5,
        currentStock: (product && initPkg === '5kg') ? product.current_stock : 5,
      },
      '25kg': {
        cost: (product && initPkg === '25kg') ? product.cost_price : (product?.cost_price ? product.cost_price : 1070),
        selling: (product && initPkg === '25kg') ? product.selling_price : (product?.selling_price ? product.selling_price : 1350),
        initialStock: (product && initPkg === '25kg') ? (product.initial_stock ?? product.current_stock ?? 2) : 2,
        currentStock: (product && initPkg === '25kg') ? product.current_stock : 2,
      },
    };
  });

  // Bulto / Bundle Cost & Buying Qty calculator (especially for Groceries)
  const [bundleCost, setBundleCost] = useState<number | ''>('');
  const [bundleQty, setBundleQty] = useState<number | ''>('');

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  useEffect(() => {
    getAllSuppliers().then(s => {
      const activeSups = s.filter(sup => sup.is_active);
      setSuppliers(activeSups);

      // Auto-assign default supplier if empty and creating a new product
      if (!product && !form.supplier_id) {
        if (currentDept === 'rice') {
          const rSup = activeSups.find(sup => sup.id === 'sup-rice-bocaue' || sup.name.toLowerCase().includes('bocaue'));
          if (rSup) setForm(f => ({ ...f, supplier_id: rSup.id, supplier_name: rSup.name }));
        } else if (currentDept === 'vegetables') {
          const vSup = activeSups.find(sup => sup.id === 'sup-veg-bagsakan' || sup.name.toLowerCase().includes('bagsakan'));
          if (vSup) setForm(f => ({ ...f, supplier_id: vSup.id, supplier_name: vSup.name }));
        } else if (currentDept === 'groceries') {
          const gSup = activeSups.find(sup => sup.id === 'sup-groc-puregold' || sup.name.toLowerCase().includes('puregold'));
          if (gSup) setForm(f => ({ ...f, supplier_id: gSup.id, supplier_name: gSup.name }));
        }
      }
    }).catch(() => {});
  }, [currentDept]);

  // Handle rice packaging radio button selection
  const handleSelectRicePackaging = (pkg: RicePackagingType) => {
    setRicePackaging(pkg);
    const pData = ricePricing[pkg];
    const isWeight = pkg === 'per_kilo';
    const u = pkg === 'per_kilo' ? 'kg' : (pkg === '5kg' ? 'pack' : 'sako');
    setForm(f => ({
      ...f,
      cost_price: pData.cost,
      selling_price: pData.selling,
      initial_stock: pData.initialStock,
      current_stock: pData.currentStock,
      unit: u,
      sell_by_weight: isWeight,
    }));
  };

  // Handle department change with supplier & unit auto-defaults
  const handleDeptChange = (newDept: string) => {
    const newDeptCats = categories.filter(c => getDeptOfCategory(c) === newDept);
    const firstCatId = newDeptCats[0]?.id || 1;

    let defaultUnit = 'sticks';
    let defaultWeight = false;
    let defSupId = form.supplier_id;
    let defSupName = form.supplier_name;

    if (newDept === 'rice') {
      defaultUnit = ricePackaging === 'per_kilo' ? 'kg' : (ricePackaging === '5kg' ? 'pack' : 'sako');
      defaultWeight = ricePackaging === 'per_kilo';
      const rSup = suppliers.find(s => s.id === 'sup-rice-bocaue' || s.name.toLowerCase().includes('bocaue'));
      if (rSup) { defSupId = rSup.id; defSupName = rSup.name; }
    } else if (newDept === 'vegetables') {
      defaultUnit = 'kg';
      defaultWeight = true;
      const vSup = suppliers.find(s => s.id === 'sup-veg-bagsakan' || s.name.toLowerCase().includes('bagsakan'));
      if (vSup) { defSupId = vSup.id; defSupName = vSup.name; }
    } else if (newDept === 'groceries') {
      defaultUnit = 'pcs';
      defaultWeight = false;
      const gSup = suppliers.find(s => s.id === 'sup-groc-puregold' || s.name.toLowerCase().includes('puregold'));
      if (gSup) { defSupId = gSup.id; defSupName = gSup.name; }
    } else if (newDept === 'barbeque') {
      defaultUnit = 'sticks';
      defaultWeight = false;
      const bSup = suppliers.find(s => s.name.toLowerCase().includes('bbq'));
      if (bSup) { defSupId = bSup.id; defSupName = bSup.name; }
    }

    setForm(f => ({
      ...f,
      business_type: newDept,
      category_id: firstCatId,
      unit: defaultUnit,
      sell_by_weight: defaultWeight,
      supplier_id: defSupId,
      supplier_name: defSupName,
      sku: !product ? generateNextSku(firstCatId, categories, existingProducts) : f.sku,
    }));
  };

  // Handle vegetables unit toggle: kg vs pcs
  const handleSelectVegUnit = (unit: 'kg' | 'pcs') => {
    const isWeight = unit === 'kg';
    setForm(f => ({
      ...f,
      unit: unit,
      sell_by_weight: isWeight,
      initial_stock: isWeight ? f.initial_stock : Math.round(f.initial_stock ?? 0),
      current_stock: isWeight ? f.current_stock : Math.round(f.current_stock ?? 0),
    }));
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.sku.trim()) {
      setFormError('Product name and SKU are required.');
      return;
    }
    if (!isSupply && (form.selling_price ?? 0) <= 0) {
      setFormError('Selling price is required for Products. For internal supplies/ingredients, choose "Supply" type instead.');
      return;
    }

    let finalName = form.name.trim();
    if (isRice) {
      // Ensure the packaging variant suffix is cleanly formatted
      const base = finalName
        .replace(/\s*-\s*(per\s*kilo|kilo|5kg(\s*pack)?|25kg(\s*sako)?)/gi, '')
        .trim();
      if (ricePackaging === 'per_kilo') {
        finalName = `${base} - per Kilo`;
      } else if (ricePackaging === '5kg') {
        finalName = `${base} - 5kg Pack`;
      } else if (ricePackaging === '25kg') {
        finalName = `${base} - 25kg Sako`;
      }
    }

    setSaving(true);
    setFormError(null);
    try {
      await onSave({
        ...form,
        name: finalName,
        initial_stock: form.initial_stock ?? form.current_stock ?? 0,
        current_stock: form.current_stock ?? form.initial_stock ?? 0,
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-800 rounded-2xl p-5 sm:p-6 max-w-lg w-full border border-surface-700 shadow-2xl animate-fade-in max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-surface-100">{product ? 'Edit' : 'New'} {isSupply ? 'Supply / Item' : 'Product'}</h3>
          <button onClick={onClose} className="p-1 rounded-lg text-surface-400 hover:text-surface-200 hover:bg-surface-700">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* ── Item Type Toggle ── */}
        <div className="mb-4">
          <p className="text-xs font-medium text-surface-400 mb-2">Type / Uri</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, item_type: 'product' }))}
              className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all cursor-pointer ${
                !isSupply
                  ? 'border-primary-500 bg-primary-500/10 text-primary-300'
                  : 'border-surface-700 bg-surface-900/40 text-surface-400 hover:border-surface-600'
              }`}
            >
              <span className="text-xl">🛒</span>
              <span className="text-xs font-bold">Product</span>
              <span className="text-[10px] text-center leading-tight opacity-70">Ibinebenta sa POS<br/>May selling price</span>
            </button>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, item_type: 'supply', selling_price: 0 }))}
              className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all cursor-pointer ${
                isSupply
                  ? 'border-amber-500 bg-amber-500/10 text-amber-300'
                  : 'border-surface-700 bg-surface-900/40 text-surface-400 hover:border-surface-600'
              }`}
            >
              <span className="text-xl">📦</span>
              <span className="text-xs font-bold">Supply / Item</span>
              <span className="text-[10px] text-center leading-tight opacity-70">Hindi ibinebenta<br/>Gamit sa produksyon</span>
            </button>
          </div>
          {isSupply && (
            <p className="mt-2 text-[11px] text-amber-400/80 bg-amber-500/10 rounded-lg px-3 py-1.5 border border-amber-500/20">
              ⚠️ Ang <strong>Supply</strong> ay hindi lalabas sa POS. Ginagamit ito para sa inventory ng mga sangkap o materyales.
            </p>
          )}
        </div>

        {formError && (
          <div className="mb-4 p-3 rounded-lg bg-danger-500/10 border border-danger-500/30 text-danger-500 text-sm">{formError}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* ── Product Photo Uploader (Marites POS style with Drag & Drop + Paste + Real Live Camera) ── */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file && file.type.startsWith('image/')) {
                handleImageFile(file);
                return;
              }
              const html = e.dataTransfer.getData('text/html');
              if (html) {
                const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
                if (match && match[1]) {
                  handleImageUrl(match[1]);
                  return;
                }
              }
              const uri = e.dataTransfer.getData('text/uri-list');
              if (uri && (uri.startsWith('http://') || uri.startsWith('https://'))) {
                handleImageUrl(uri);
              }
            }}
            className={`p-3 rounded-2xl border transition-all flex items-center gap-3.5 ${
              isDragging
                ? 'bg-primary-500/15 border-primary-500 ring-2 ring-primary-500/30'
                : 'bg-surface-900/60 border-surface-700/60'
            }`}
          >
            {/* Clickable Image Box / Drop Target (Click opens file picker, Drag & Drop, Ctrl+V) */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className="relative w-20 h-20 rounded-xl bg-surface-800 border-2 border-dashed border-surface-600 hover:border-primary-500 flex items-center justify-center overflow-hidden shrink-0 group cursor-pointer shadow-inner transition-colors"
              title="I-click para pumili ng picture, o i-Paste (Ctrl+V)"
            >
              {imageLoading ? (
                <div className="w-6 h-6 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
              ) : imagePreview && isValidImageUrl(imagePreview) ? (
                <>
                  <img
                    src={imagePreview}
                    alt="Preview"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover transition-transform group-hover:scale-105"
                    onError={() => {
                      setImagePreview(null);
                      setForm(f => ({ ...f, image_path: null }));
                    }}
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-bold">
                    Palitan
                  </div>
                  <button
                    type="button"
                    onClick={handleRemoveImage}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/75 hover:bg-rose-600 text-white flex items-center justify-center text-xs cursor-pointer shadow-md transition-colors z-10"
                    title="Tanggalin ang picture"
                  >
                    ✕
                  </button>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center text-surface-400 group-hover:text-primary-400 p-1 text-center select-none">
                  <span className="text-2xl">🖼️</span>
                  <span className="text-[9px] font-bold mt-0.5">Pumili / Paste</span>
                </div>
              )}
            </div>

            {/* Instruction and Camera Action (No redundant file button!) */}
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-surface-100">Larawan ng Produkto (Product Image)</p>
                {pasteNotice && (
                  <span className="text-[10px] font-bold text-emerald-400 animate-fade-in">{pasteNotice}</span>
                )}
              </div>
              <p className="text-[11px] text-surface-400 leading-tight">
                I-click ang kahon, i-drag ang picture, o i-<strong>Paste (Ctrl + V)</strong> mula sa clipboard o Google Images.
              </p>

              {/* Only the Live Camera Action and Remove Image button */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowCameraModal(true)}
                  className="px-3 py-1.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all shadow-sm active:scale-95"
                  title="Buksan ang webcam o camera para kuhanan ng picture ang produkto"
                >
                  <span>📸</span>
                  <span>Kunan gamit ang Camera</span>
                </button>

                {imagePreview && (
                  <button
                    type="button"
                    onClick={handleRemoveImage}
                    className="px-2.5 py-1.5 rounded-xl bg-surface-800 hover:bg-rose-500/20 text-surface-400 hover:text-rose-400 border border-surface-700 text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <span>🗑️</span>
                    <span>Alisin</span>
                  </button>
                )}
              </div>

              {/* Hidden file input for box click */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) handleImageFile(file);
                }}
                className="hidden"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <FormField label="Product Name *">
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="form-input"
                placeholder={isRice ? "e.g., Buko Pandan (PREMIUM)" : isVegetables ? "e.g., Kamatis (Regular)" : "e.g., Pork BBQ (Large)"}
                required
              />
            </FormField>
            <FormField label="SKU * (Auto-generated)">
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={form.sku}
                  onChange={e => setForm(f => ({ ...f, sku: e.target.value.toUpperCase() }))}
                  className="form-input flex-1 font-mono uppercase"
                  placeholder="e.g., BBQ-00001"
                  required
                />
                {!product && (
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, sku: generateNextSku(f.category_id, categories, existingProducts) }))}
                    className="px-2.5 py-1.5 rounded-xl bg-surface-700 hover:bg-surface-600 text-surface-200 text-xs font-semibold transition-colors cursor-pointer shrink-0"
                    title="Regenerate next SKU"
                  >
                    🔄 Auto
                  </button>
                )}
              </div>
            </FormField>
          </div>

          {/* ── 2-Level Cascading Selector: Linya ng Negosyo ➔ Kategorya ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 p-3 rounded-xl bg-surface-900/60 border border-surface-700/60">
            <FormField label="Linya ng Negosyo (Business Line) *">
              <select
                value={form.business_type || defaultDept || 'barbeque'}
                onChange={e => handleDeptChange(e.target.value)}
                className="form-input font-bold text-primary-300"
              >
                {departments.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.icon} {d.label}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label="Kategorya *">
              <select
                value={form.category_id}
                onChange={e => {
                  const newCatId = Number(e.target.value);
                  setForm(f => {
                    const newSku = !product ? generateNextSku(newCatId, categories, existingProducts) : f.sku;
                    return { ...f, category_id: newCatId, sku: newSku };
                  });
                }}
                className="form-input font-medium"
              >
                {categories.filter(c => getDeptOfCategory(c) === (form.business_type || defaultDept || 'barbeque')).length === 0 ? (
                  <option value={0}>— Walang kategorya sa negosyong ito —</option>
                ) : (
                  categories
                    .filter(c => getDeptOfCategory(c) === (form.business_type || defaultDept || 'barbeque'))
                    .map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))
                )}
              </select>
            </FormField>
          </div>

          {/* Supplier Assignment Dropdown */}
          <FormField label="Supplier (Pinagkukunan / Bagsakan)">
            <select
              value={form.supplier_id ?? ''}
              onChange={e => {
                const sid = e.target.value;
                const sup = suppliers.find(s => s.id === sid);
                setForm(f => ({ ...f, supplier_id: sid, supplier_name: sup?.name ?? '' }));
              }}
              className="form-input"
            >
              <option value="">— Walang supplier / Sariling gawa —</option>
              {suppliers.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {form.supplier_name && (
              <p className="text-[11px] text-emerald-400 mt-1">✅ Supplier: {form.supplier_name}</p>
            )}
          </FormField>

          {/* ===================================================================== */}
          {/* 🍚 BIGASAN BUSINESS SPECIFIC SECTION: Radio Button (per kilo, 5kg, 25kg) */}
          {/* ===================================================================== */}
          {isRice && (
            <div className="p-3.5 rounded-xl bg-yellow-500/10 border border-yellow-500/30 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-yellow-300 uppercase tracking-wider flex items-center gap-1.5">
                  <span>🍚</span> Uri ng Pagbabalot / Packaging (Pumili):
                </span>
                <span className="text-[10px] text-yellow-400/80 bg-yellow-500/20 px-2 py-0.5 rounded-full font-semibold">
                  Bigasan Mode
                </span>
              </div>

              {/* Radio Button Options */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'per_kilo', label: 'per kilo', desc: 'Tingi / Kilo', badge: 'Decimal (kg)', icon: '⚖️' },
                  { id: '5kg', label: '5kg Pack', desc: '5 Kilo Bag', badge: 'Whole pcs', icon: '🛍️' },
                  { id: '25kg', label: '25kg Sako', desc: 'Buong Sako', badge: 'Whole pcs', icon: '🌾' },
                ].map(opt => {
                  const isSelected = ricePackaging === opt.id;
                  return (
                    <label
                      key={opt.id}
                      onClick={() => handleSelectRicePackaging(opt.id as RicePackagingType)}
                      className={`flex flex-col items-center justify-between p-2.5 rounded-xl border-2 transition-all cursor-pointer text-center ${
                        isSelected
                          ? 'border-yellow-400 bg-yellow-500/20 text-yellow-200 shadow-md shadow-yellow-500/10'
                          : 'border-surface-700 bg-surface-900/60 text-surface-400 hover:border-surface-600'
                      }`}
                    >
                      <input
                        type="radio"
                        name="rice_packaging"
                        value={opt.id}
                        checked={isSelected}
                        onChange={() => handleSelectRicePackaging(opt.id as RicePackagingType)}
                        className="sr-only"
                      />
                      <span className="text-lg mb-0.5">{opt.icon}</span>
                      <span className="text-xs font-bold text-surface-100">{opt.label}</span>
                      <span className="text-[10px] text-surface-400 leading-tight">{opt.desc}</span>
                      <span className={`text-[9px] font-semibold mt-1 px-1.5 py-0.2 rounded ${
                        isSelected ? 'bg-yellow-400/30 text-yellow-200' : 'bg-surface-800 text-surface-500'
                      }`}>
                        {opt.badge}
                      </span>
                    </label>
                  );
                })}
              </div>

              <p className="text-[11px] text-yellow-300/80 bg-surface-900/80 px-2.5 py-1.5 rounded-lg border border-yellow-500/20">
                💡 Ang <strong>{ricePackaging === 'per_kilo' ? 'per kilo (Tingi)' : ricePackaging === '5kg' ? '5kg Pack' : '25kg Sako'}</strong> ay may sariling Puhunan, Benta, at Stocks. Naka-save ang bawat packaging nang hiwalay.
              </p>
            </div>
          )}

          {/* ===================================================================== */}
          {/* 🥬 GULAYAN BUSINESS SPECIFIC SECTION: Per Unit (pcs vs kg)             */}
          {/* ===================================================================== */}
          {isVegetables && (
            <div className="p-3.5 rounded-xl bg-green-500/10 border border-green-500/30 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-green-300 uppercase tracking-wider flex items-center gap-1.5">
                  <span>🥬</span> Yunit ng Pagbenta (Per Unit):
                </span>
                <span className="text-[10px] text-green-400/80 bg-green-500/20 px-2 py-0.5 rounded-full font-semibold">
                  Gulayan Mode
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleSelectVegUnit('kg')}
                  className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border-2 transition-all cursor-pointer ${
                    form.unit === 'kg'
                      ? 'border-green-400 bg-green-500/20 text-green-200 font-bold shadow-md shadow-green-500/10'
                      : 'border-surface-700 bg-surface-900/60 text-surface-400 hover:border-surface-600'
                  }`}
                >
                  <span className="text-lg">⚖️</span>
                  <div className="text-left">
                    <div className="text-xs font-bold">Kilo (kg)</div>
                    <div className="text-[10px] opacity-75">Tinitimbang (Decimal)</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectVegUnit('pcs')}
                  className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border-2 transition-all cursor-pointer ${
                    form.unit !== 'kg'
                      ? 'border-green-400 bg-green-500/20 text-green-200 font-bold shadow-md shadow-green-500/10'
                      : 'border-surface-700 bg-surface-900/60 text-surface-400 hover:border-surface-600'
                  }`}
                >
                  <span className="text-lg">🌿</span>
                  <div className="text-left">
                    <div className="text-xs font-bold">Piraso / Tali (pcs)</div>
                    <div className="text-[10px] opacity-75">Binibilang (Whole no.)</div>
                  </div>
                </button>
              </div>

              <p className="text-[11px] text-green-300/80 bg-surface-900/80 px-2.5 py-1.5 rounded-lg border border-green-500/20">
                {form.unit === 'kg'
                  ? '⚖️ Kilo mode: Pwede ang may decimal tulad ng 0.25 kg, 0.5 kg, o 1.75 kg sa POS at Inventory.'
                  : '🌿 Piraso/Tali mode: Buong bilang lamang (1, 2, 3...) at walang decimal.'}
              </p>
            </div>
          )}

          {/* ===================================================================== */}
          {/* 📦 BULTO/PACK CALCULATOR: Cost Price (Bulto) & Buying Qty               */}
          {/* ===================================================================== */}
          {!isRice && !isVegetables && (
            <div className="p-3 rounded-xl bg-surface-900/80 border border-surface-700/60 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-surface-200 flex items-center gap-1.5">
                  <span>📦</span> Bulto / Pack Calculator (Opsyonal):
                </span>
                <span className="text-[10px] text-surface-400">
                  Auto-compute sa Cost per pc
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-surface-400 mb-1">
                    Cost Price (Bili sa Bulto / Pack)
                  </label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-500 text-xs">₱</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={bundleCost}
                      onChange={e => {
                        const val = e.target.value === '' ? '' : parseFloat(e.target.value) || 0;
                        setBundleCost(val);
                        if (val !== '' && typeof bundleQty === 'number' && bundleQty > 0) {
                          const perPc = parseFloat((val / bundleQty).toFixed(2));
                          setForm(f => ({ ...f, cost_price: perPc }));
                        }
                      }}
                      placeholder="hal. 235.00"
                      className="form-input pl-6 text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-surface-400 mb-1">
                    Buying Qty (Dami sa Bulto)
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    value={bundleQty}
                    onChange={e => {
                      const val = e.target.value === '' ? '' : parseInt(e.target.value) || 0;
                      setBundleQty(val);
                      if (val !== '' && val > 0 && typeof bundleCost === 'number' && bundleCost > 0) {
                        const perPc = parseFloat((bundleCost / val).toFixed(2));
                        setForm(f => ({
                          ...f,
                          cost_price: perPc,
                          initial_stock: f.initial_stock === 0 ? val : f.initial_stock,
                          current_stock: f.current_stock === 0 ? val : f.current_stock,
                        }));
                      }
                    }}
                    placeholder="hal. 12 pcs"
                    className="form-input text-xs"
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── Cost Price & Selling Price Inputs ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <FormField
              label={
                isRice
                  ? `Puhunan (${ricePackaging === 'per_kilo' ? 'bawat Kilo' : ricePackaging === '5kg' ? 'bawat 5kg Pack' : 'bawat 25kg Sako'}) *`
                  : isVegetables
                  ? `Puhunan (${form.unit === 'kg' ? 'bawat Kilo' : 'bawat Piraso/Tali'}) *`
                  : 'Cost per pc (Puhunan Bawat Piraso) *'
              }
              hint={
                typeof bundleCost === 'number' && typeof bundleQty === 'number' && bundleQty > 0
                  ? `₱${bundleCost} ÷ ${bundleQty} pcs`
                  : isRice && ricePackaging === 'per_kilo'
                  ? 'hal. ₱43.00'
                  : isRice && ricePackaging === '5kg'
                  ? 'hal. ₱214.00'
                  : isRice && ricePackaging === '25kg'
                  ? 'hal. ₱1,070.00'
                  : undefined
              }
            >
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.cost_price === 0 ? '' : form.cost_price}
                placeholder="0.00"
                onFocus={e => e.target.select()}
                onClick={e => (e.target as HTMLInputElement).select()}
                onChange={e => {
                  const val = e.target.value === '' ? 0 : parseFloat(e.target.value) || 0;
                  setForm(f => ({ ...f, cost_price: val }));
                  if (isRice) {
                    setRicePricing(prev => ({
                      ...prev,
                      [ricePackaging]: { ...prev[ricePackaging], cost: val },
                    }));
                  }
                }}
                className="form-input"
                required
              />
            </FormField>

            {isSupply ? (
              <FormField label="Selling Price" hint="Hindi applicable sa Supply type">
                <div className="form-input bg-surface-900/60 text-surface-500 italic text-sm flex items-center gap-2">
                  <span>🚫</span> Hindi ibinebenta
                </div>
              </FormField>
            ) : (
              <FormField
                label={
                  isRice
                    ? `Benta sa POS (${ricePackaging === 'per_kilo' ? 'bawat Kilo' : ricePackaging === '5kg' ? 'bawat 5kg Pack' : 'bawat 25kg Sako'}) *`
                    : isVegetables
                    ? `Benta sa POS (${form.unit === 'kg' ? 'bawat Kilo' : 'bawat Piraso/Tali'}) *`
                    : 'Selling Price (Benta sa POS) *'
                }
                hint={isRice && ricePackaging === 'per_kilo' ? 'hal. ₱54.00' : isRice && ricePackaging === '5kg' ? 'hal. ₱270.00' : isRice && ricePackaging === '25kg' ? 'hal. ₱1,350.00' : undefined}
              >
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={form.selling_price === 0 ? '' : form.selling_price}
                  placeholder="0.00"
                  onFocus={e => e.target.select()}
                  onClick={e => (e.target as HTMLInputElement).select()}
                  onChange={e => {
                    const val = e.target.value === '' ? 0 : parseFloat(e.target.value) || 0;
                    setForm(f => ({ ...f, selling_price: val }));
                    if (isRice) {
                      setRicePricing(prev => ({
                        ...prev,
                        [ricePackaging]: { ...prev[ricePackaging], selling: val },
                      }));
                    }
                  }}
                  className="form-input"
                  required
                />
              </FormField>
            )}
          </div>

          {/* Live Profit & Margin Indicator */}
          {!isSupply && form.selling_price > 0 && form.cost_price > 0 && (
            <div className="text-[11px] font-bold text-emerald-400 flex items-center justify-between px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
              <span className="flex items-center gap-1.5">
                <span>💰</span>
                <span>Kita bawat piraso: {formatCurrency(form.selling_price - form.cost_price)}</span>
              </span>
              <span className="bg-emerald-500/20 px-2 py-0.5 rounded-full text-emerald-300">
                +{(((form.selling_price - form.cost_price) / form.selling_price) * 100).toFixed(1)}% margin
              </span>
            </div>
          )}

          {/* ── Initial Stocks & Remaining Stocks Inputs ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 p-3 rounded-xl bg-surface-900/40 border border-surface-700/50">
            <FormField
              label={
                isRice
                  ? `Panimulang Stock (Initial - ${ricePackaging === 'per_kilo' ? 'Kilo' : ricePackaging === '5kg' ? '5kg Packs' : 'Sako'})`
                  : isVegetables
                  ? `Panimulang Stock (${form.unit === 'kg' ? 'Kilo' : 'Piraso/Tali'})`
                  : 'Panimulang Stock (Initial Stock)'
              }
              hint={
                (isRice && ricePackaging === 'per_kilo') || (isVegetables && form.unit === 'kg')
                  ? 'Decimal (hal. 25.00 o 50.00 kg)'
                  : 'Buong bilang (hal. 80 pcs o 5 sako)'
              }
            >
              <input
                type="number"
                step={(isRice && ricePackaging === 'per_kilo') || (isVegetables && form.unit === 'kg') ? "0.01" : "1"}
                min="0"
                value={form.initial_stock === 0 ? '' : (form.initial_stock ?? 0)}
                placeholder="0"
                onFocus={e => e.target.select()}
                onClick={e => (e.target as HTMLInputElement).select()}
                onChange={e => {
                  const val = e.target.value === '' ? 0 : parseFloat(e.target.value) || 0;
                  setForm(f => ({ ...f, initial_stock: val }));
                  if (isRice) {
                    setRicePricing(prev => ({
                      ...prev,
                      [ricePackaging]: { ...prev[ricePackaging], initialStock: val },
                    }));
                  }
                }}
                className="form-input"
              />
            </FormField>

            <FormField
              label={
                isRice
                  ? `Kasalukuyang Stock (Remaining - ${ricePackaging === 'per_kilo' ? 'Kilo' : ricePackaging === '5kg' ? '5kg Packs' : 'Sako'})`
                  : isVegetables
                  ? `Kasalukuyang Stock (${form.unit === 'kg' ? 'Kilo' : 'Piraso/Tali'})`
                  : 'Kasalukuyang Stock (Remaining / On-Hand)'
              }
              hint={
                (isRice && ricePackaging === 'per_kilo') || (isVegetables && form.unit === 'kg')
                  ? 'Aktwal na natira (hal. 24.50 kg)'
                  : 'Aktwal na natira (hal. 80 pcs o 4 sako)'
              }
            >
              <input
                type="number"
                step={(isRice && ricePackaging === 'per_kilo') || (isVegetables && form.unit === 'kg') ? "0.01" : "1"}
                min="0"
                value={form.current_stock === 0 ? '' : (form.current_stock ?? 0)}
                placeholder="0"
                onFocus={e => e.target.select()}
                onClick={e => (e.target as HTMLInputElement).select()}
                onChange={e => {
                  const val = e.target.value === '' ? 0 : parseFloat(e.target.value) || 0;
                  setForm(f => ({ ...f, current_stock: val }));
                  if (isRice) {
                    setRicePricing(prev => ({
                      ...prev,
                      [ricePackaging]: { ...prev[ricePackaging], currentStock: val },
                    }));
                  }
                }}
                className="form-input"
              />
            </FormField>
          </div>

          {/* Unit Selector for Groceries & Barbeque (Non-Rice, Non-Vegetables) */}
          {!isRice && !isVegetables && (
            <FormField label="Unit (Yunit ng Paninda)">
              <select
                value={form.unit || (isGroceries ? 'pcs' : 'sticks')}
                onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                className="form-input cursor-pointer"
              >
                <option value="pcs">pcs (Pirasaso / Repacked Pack)</option>
                <option value="pack">pack (Balot)</option>
                <option value="sticks">sticks (Tuhog)</option>
                <option value="bottle">bottle (Bote)</option>
                <option value="can">can / lata (Lata)</option>
                <option value="box">box (Kahon)</option>
              </select>
            </FormField>
          )}

          {/* Target Par Stock (Prep Limit) & Low Stock Warning */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <FormField label="Target Par Stock (Prep Limit / Ideal Order)">
              <input
                type="number"
                step={(isRice && ricePackaging === 'per_kilo') || (isVegetables && form.unit === 'kg') ? "0.01" : "1"}
                min="0"
                value={form.target_stock === 0 ? '' : (form.target_stock ?? 20)}
                placeholder="20"
                onFocus={e => e.target.select()}
                onClick={e => (e.target as HTMLInputElement).select()}
                onChange={e => {
                  const val = e.target.value === '' ? 0 : parseFloat(e.target.value) || 0;
                  setForm(f => ({ ...f, target_stock: val }));
                }}
                className="form-input"
                title="Ideal stock quantity for replenishment"
              />
            </FormField>

            <FormField label="Low Stock Warning Limit">
              <input
                type="number"
                step={(isRice && ricePackaging === 'per_kilo') || (isVegetables && form.unit === 'kg') ? "0.01" : "1"}
                min="0"
                value={form.low_stock_threshold === 0 ? '' : (form.low_stock_threshold ?? 5)}
                placeholder="5"
                onFocus={e => e.target.select()}
                onClick={e => (e.target as HTMLInputElement).select()}
                onChange={e => {
                  const val = e.target.value === '' ? 0 : parseFloat(e.target.value) || 0;
                  setForm(f => ({ ...f, low_stock_threshold: val }));
                }}
                className="form-input"
                title="Alert limit when stock drops"
              />
            </FormField>
          </div>

          <FormField label="Description (Opsyonal)">
            <textarea value={form.description ?? ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="form-input" rows={2} placeholder="Opsyonal na detalye o notes..." />
          </FormField>

          {/* Live Profit Preview - only show for Products */}
          {!isSupply && (
            <div className="p-3 rounded-xl bg-surface-900/60 border border-surface-700/50 flex items-center justify-between text-xs sm:text-sm">
              <span className="text-surface-400">Tantiya ng Tubo (Estimated Profit):</span>
              <span className={`font-semibold ${form.selling_price - form.cost_price >= 0 ? 'text-success-400' : 'text-danger-400'}`}>
                {formatCurrency(form.selling_price - form.cost_price)}
                {form.selling_price > 0 && ` (${(((form.selling_price - form.cost_price) / form.selling_price) * 100).toFixed(1)}% margin)`}
              </span>
            </div>
          )}

          <label className="flex items-center gap-2 cursor-pointer pt-1">
            <input type="checkbox" checked={form.is_active ?? true} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} className="w-4 h-4 rounded bg-surface-700 border-surface-600 text-primary-600 focus:ring-primary-500/50" />
            <span className="text-surface-200 text-sm">
              {isSupply ? 'Active (visible in Inventory)' : 'Active (visible in POS)'}
            </span>
          </label>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl bg-surface-700 text-surface-200 text-sm font-medium hover:bg-surface-600 transition-colors cursor-pointer">Cancel</button>
            <button
              type="submit"
              disabled={saving}
              className={`flex-1 px-4 py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-50 transition-colors cursor-pointer shadow-lg ${
                isSupply
                  ? 'bg-amber-600 hover:bg-amber-500 shadow-amber-600/20'
                  : 'bg-primary-600 hover:bg-primary-500 shadow-primary-600/20'
              }`}
            >
              {saving ? 'Saving...' : product ? `Update ${isSupply ? 'Supply' : 'Product'}` : `Create ${isSupply ? 'Supply' : 'Product'}`}
            </button>
          </div>
        </form>

        <ProductCameraCaptureModal
          isOpen={showCameraModal}
          onClose={() => setShowCameraModal(false)}
          onCapture={handleImageFile}
        />
      </div>
    </div>,
    document.body
  );
}

function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-surface-300 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-surface-400 mt-1 leading-tight">{hint}</p>}
    </div>
  );
}
