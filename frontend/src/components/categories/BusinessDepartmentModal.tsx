/**
 * Enterprise Business Setup Wizard & Management Hub
 * 
 * 3-in-1 Guided Onboarding & Full In-Place Editing:
 * - Mode 'wizard': Step 1 (Profile) -> Step 2 (Categories) -> Step 3 (Products) -> Launch
 * - Mode 'edit': In-place editing of existing business profile (Name, Icon, Theme Color, Default Unit, Scale Mode)
 * - Mode 'list': Complete overview with [ ✏️ Edit ] and [ 🗑️ Delete ] actions
 * 
 * Guarantees:
 * - NO hardcoding: dynamically stores and syncs custom and edited business lines
 * - Safe updates: Editing a business never deletes or breaks linked categories and products
 */

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { BusinessDepartment, BusinessType } from '../../types/product';
import { getDepartmentTheme, saveCustomBusinessDepartment, deleteCustomBusinessDepartment } from '../../utils/businessStorage';
import { createCategory, createProduct } from '../../api/endpoints';
import { saveLocalCategory, saveLocalProduct } from '../../db/productRepository';
import { addPendingMutation } from '../../db/mutationRepository';
import { useSyncStore } from '../../features/sync/syncStore';

const EMOJI_OPTIONS = ['🍢', '🍚', '🛒', '🥬', '☕', '🥖', '🥩', '🧋', '🍳', '🐟', '🥤', '💊', '🍧', '🍗', '🥪', '🧼', '🍰', '🚗', '💧', '🧺', '🌾', '🍗', '🍺'];

const COLOR_OPTIONS: { id: string; label: string; bg: string }[] = [
  { id: 'emerald', label: 'Emerald Green', bg: 'bg-emerald-600' },
  { id: 'amber',   label: 'Amber Orange',  bg: 'bg-amber-600' },
  { id: 'rose',    label: 'Rose Red',      bg: 'bg-rose-600' },
  { id: 'sky',     label: 'Sky Blue',      bg: 'bg-sky-600' },
  { id: 'indigo',  label: 'Indigo Blue',   bg: 'bg-indigo-600' },
  { id: 'violet',  label: 'Violet Purple', bg: 'bg-violet-600' },
];

interface IndustryTemplate {
  name: string;
  icon: string;
  color: string;
  unit: string;
  sellByWeight: boolean;
  categories: string[];
  initialProducts: { name: string; categoryName: string; cost: number; price: number; stock: number }[];
}

const INDUSTRY_TEMPLATES: Record<string, IndustryTemplate> = {
  cafe: {
    name: 'Kapehan & Drinks',
    icon: '☕',
    color: 'amber',
    unit: 'cup',
    sellByWeight: false,
    categories: ['Hot Coffee', 'Iced & Cold Brew', 'Pastries & Snacks'],
    initialProducts: [
      { name: 'Brewed Hot Coffee', categoryName: 'Hot Coffee', cost: 15, price: 45, stock: 50 },
      { name: 'Iced Caramel Macchiato', categoryName: 'Iced & Cold Brew', cost: 35, price: 85, stock: 40 },
    ],
  },
  bakery: {
    name: 'Bakery & Pastry',
    icon: '🥖',
    color: 'amber',
    unit: 'pcs',
    sellByWeight: false,
    categories: ['Pandesal & Breads', 'Cakes & Pastries', 'Cookies & Biscuits'],
    initialProducts: [
      { name: 'Pandesal (Bag of 10)', categoryName: 'Pandesal & Breads', cost: 15, price: 25, stock: 60 },
      { name: 'Ensaymada Especial', categoryName: 'Cakes & Pastries', cost: 12, price: 25, stock: 30 },
    ],
  },
  meat: {
    name: 'Meat & Poultry',
    icon: '🥩',
    color: 'rose',
    unit: 'kg',
    sellByWeight: true,
    categories: ['Baboy (Pork Cuts)', 'Manok (Chicken)', 'Baka (Beef)'],
    initialProducts: [
      { name: 'Pork Liempo (Fresh)', categoryName: 'Baboy (Pork Cuts)', cost: 280, price: 340, stock: 25 },
      { name: 'Chicken Breast Fillet', categoryName: 'Manok (Chicken)', cost: 180, price: 230, stock: 30 },
    ],
  },
  water: {
    name: 'Water Station',
    icon: '💧',
    color: 'sky',
    unit: 'container',
    sellByWeight: false,
    categories: ['Purified Water', 'Alkaline Water', 'Mineral Bottles'],
    initialProducts: [
      { name: '5-Gallon Slim Refill', categoryName: 'Purified Water', cost: 8, price: 30, stock: 100 },
      { name: '5-Gallon Round Dispenser Refill', categoryName: 'Purified Water', cost: 8, price: 35, stock: 80 },
    ],
  },
  services: {
    name: 'Carwash & Detailing',
    icon: '🚗',
    color: 'indigo',
    unit: 'service',
    sellByWeight: false,
    categories: ['Body Wash', 'Interior Cleaning', 'Engine & Wax'],
    initialProducts: [
      { name: 'Standard Body Wash (Sedan)', categoryName: 'Body Wash', cost: 30, price: 120, stock: 999 },
      { name: 'Full Detailing + Wax', categoryName: 'Engine & Wax', cost: 120, price: 450, stock: 999 },
    ],
  },
};

function detectThemeFromBadge(badgeBg?: string): string {
  if (!badgeBg) return 'amber';
  if (badgeBg.includes('rose')) return 'rose';
  if (badgeBg.includes('sky')) return 'sky';
  if (badgeBg.includes('indigo')) return 'indigo';
  if (badgeBg.includes('violet')) return 'violet';
  if (badgeBg.includes('emerald') || badgeBg.includes('green')) return 'emerald';
  return 'amber';
}

export function BusinessDepartmentModal({
  departments,
  initialDeptToEdit,
  onClose,
  onUpdated,
}: {
  departments: BusinessDepartment[];
  initialDeptToEdit?: BusinessDepartment | null;
  onClose: () => void;
  onUpdated: (newDepts: BusinessDepartment[], activeId?: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<'wizard' | 'edit' | 'list'>('wizard');
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Business Profile Form States (Used for both Wizard & Edit)
  const [editingDeptId, setEditingDeptId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [icon, setIcon] = useState('☕');
  const [tagline, setTagline] = useState('');
  const [colorTheme, setColorTheme] = useState('amber');
  const [defaultUnit, setDefaultUnit] = useState('pcs');
  const [sellByWeight, setSellByWeight] = useState(false);

  // Wizard Step 2: Categories
  const [categoryNames, setCategoryNames] = useState<string[]>(['Pangunahing Kategorya']);
  const [newCatInput, setNewCatInput] = useState('');

  // Wizard Step 3: Products
  interface DraftProduct {
    name: string;
    categoryName: string;
    cost: number;
    price: number;
    stock: number;
  }
  const [draftProducts, setDraftProducts] = useState<DraftProduct[]>([]);
  const [newProdName, setNewProdName] = useState('');
  const [newProdCat, setNewProdCat] = useState('');
  const [newProdCost, setNewProdCost] = useState<number>(0);
  const [newProdPrice, setNewProdPrice] = useState<number>(0);
  const [newProdStock, setNewProdStock] = useState<number>(10);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baseDeptIds = ['barbeque', 'rice', 'groceries', 'vegetables'];

  // Handle direct edit if initialDeptToEdit is passed
  useEffect(() => {
    if (initialDeptToEdit) {
      startEditingDept(initialDeptToEdit);
    }
  }, [initialDeptToEdit]);

  function startEditingDept(dept: BusinessDepartment) {
    setEditingDeptId(dept.id);
    setLabel(dept.label || dept.name);
    setIcon(dept.icon || '🏢');
    setTagline(dept.tagline || '');
    setDefaultUnit(dept.default_unit || 'pcs');
    setSellByWeight(!!dept.sell_by_weight);
    setColorTheme(detectThemeFromBadge(dept.badgeBg));
    setError(null);
    setActiveTab('edit');
  }

  // Save changes to an existing department
  function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingDeptId) return;
    const cleanLabel = label.trim();
    if (!cleanLabel) {
      setError('Pakilagay ang pangalan ng Negosyo.');
      return;
    }

    const theme = getDepartmentTheme(colorTheme);
    const existing = departments.find(d => d.id === editingDeptId);

    const updatedDept: BusinessDepartment = {
      id: editingDeptId,
      name: cleanLabel,
      label: cleanLabel,
      icon,
      tagline: tagline.trim() || existing?.tagline || `${cleanLabel} line of products`,
      badgeBg: theme.badgeBg,
      activeColor: theme.activeColor,
      default_unit: defaultUnit,
      sell_by_weight: sellByWeight,
    };

    const updated = saveCustomBusinessDepartment(updatedDept);
    onUpdated(updated, editingDeptId);
    setActiveTab('list');
    setEditingDeptId(null);
  }

  // Apply Industry Template in Wizard
  function applyTemplate(key: string) {
    const t = INDUSTRY_TEMPLATES[key];
    if (!t) return;
    setLabel(t.name);
    setIcon(t.icon);
    setColorTheme(t.color);
    setDefaultUnit(t.unit);
    setSellByWeight(t.sellByWeight);
    setTagline(`${t.name} line of products & services`);
    setCategoryNames([...t.categories]);
    setDraftProducts(t.initialProducts.map(p => ({ ...p })));
    if (t.categories[0]) setNewProdCat(t.categories[0]);
  }

  // Category management in Wizard Step 2
  function addCategory() {
    const trimmed = newCatInput.trim();
    if (!trimmed) return;
    if (categoryNames.includes(trimmed)) {
      setError('Umiiral na ang kategoryang ito.');
      return;
    }
    setCategoryNames([...categoryNames, trimmed]);
    setNewCatInput('');
    setError(null);
  }

  function removeCategory(index: number) {
    const catToRemove = categoryNames[index];
    setCategoryNames(categoryNames.filter((_, i) => i !== index));
    setDraftProducts(draftProducts.filter(p => p.categoryName !== catToRemove));
  }

  // Product management in Wizard Step 3
  function addDraftProduct() {
    const name = newProdName.trim();
    if (!name) {
      setError('Pakilagay ang pangalan ng produkto.');
      return;
    }
    const cat = newProdCat || categoryNames[0] || 'General';
    setDraftProducts([
      ...draftProducts,
      {
        name,
        categoryName: cat,
        cost: Number(newProdCost) || 0,
        price: Number(newProdPrice) || 0,
        stock: Number(newProdStock) || 0,
      },
    ]);
    setNewProdName('');
    setNewProdCost(0);
    setNewProdPrice(0);
    setNewProdStock(10);
    setError(null);
  }

  function removeDraftProduct(index: number) {
    setDraftProducts(draftProducts.filter((_, i) => i !== index));
  }

  // Complete Atomic Setup & Launch from Wizard
  async function handleLaunch() {
    setError(null);
    const cleanLabel = label.trim();
    if (!cleanLabel) {
      setError('Pakilagay ang pangalan ng Negosyo.');
      setStep(1);
      return;
    }

    const slug = cleanLabel.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 30);
    const existing = departments.find(d => d.id === slug);
    if (existing) {
      setError(`May umiiral nang negosyo na may ID na "${slug}". Pakibago ang pangalan.`);
      setStep(1);
      return;
    }

    setSaving(true);
    try {
      const theme = getDepartmentTheme(colorTheme);

      // 1. Save Business Department
      const newDept: BusinessDepartment = {
        id: slug,
        name: cleanLabel,
        label: cleanLabel,
        icon,
        tagline: tagline.trim() || `${cleanLabel} line of products`,
        badgeBg: theme.badgeBg,
        activeColor: theme.activeColor,
        default_unit: defaultUnit,
        sell_by_weight: sellByWeight,
      };

      const updatedDepts = saveCustomBusinessDepartment(newDept);

      // 2. Create Categories bound to this business
      const catMap = new Map<string, number>();
      const catsToCreate = categoryNames.length > 0 ? categoryNames : ['General'];

      for (let i = 0; i < catsToCreate.length; i++) {
        const catName = catsToCreate[i];
        try {
          const res = await createCategory({
            name: `${cleanLabel} - ${catName}`,
            business_type: slug,
            description: `Category for ${cleanLabel}`,
            sort_order: i + 1,
          });
          if (res.data) {
            await saveLocalCategory(res.data);
            catMap.set(catName, res.data.id);
          }
        } catch {
          const tempId = -(Date.now() + i * 10);
          const offlineCat = {
            id: tempId,
            name: `${cleanLabel} - ${catName}`,
            business_type: slug as BusinessType,
            description: `Category for ${cleanLabel}`,
            sort_order: i + 1,
            is_active: true,
            product_count: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            is_pending: true,
          };
          await saveLocalCategory(offlineCat);
          await addPendingMutation({
            entity: 'category',
            action: 'create',
            payload: { name: offlineCat.name, business_type: slug, sort_order: i + 1 },
            tempId,
          });
          catMap.set(catName, tempId);
        }
      }

      // 3. Create Draft Products bound to these categories
      for (let j = 0; j < draftProducts.length; j++) {
        const dp = draftProducts[j];
        const catId = catMap.get(dp.categoryName) || Array.from(catMap.values())[0] || 1;
        const prefix = slug.toUpperCase().slice(0, 3) || 'ITM';
        const sku = `${prefix}-${String(j + 1).padStart(5, '0')}`;

        const prodData = {
          name: dp.name,
          sku,
          category_id: catId,
          business_type: slug as BusinessType,
          item_type: 'product' as const,
          cost_price: dp.cost,
          selling_price: dp.price,
          current_stock: dp.stock,
          initial_stock: dp.stock,
          unit: defaultUnit,
          sell_by_weight: sellByWeight,
          low_stock_threshold: 5,
          target_stock: 20,
          is_active: true,
        };

        try {
          const res = await createProduct(prodData);
          if (res.data) {
            await saveLocalProduct({ ...res.data, business_type: slug as BusinessType });
          }
        } catch {
          const tempProdId = -(Date.now() + 100 + j);
          const offlineProd = {
            id: tempProdId,
            ...prodData,
            category_name: dp.categoryName,
            description: null,
            image_path: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            is_pending: true,
          };
          await saveLocalProduct(offlineProd);
          await addPendingMutation({
            entity: 'product',
            action: 'create',
            payload: prodData,
            tempId: tempProdId,
          });
        }
      }

      useSyncStore.getState().refreshCounts();
      onUpdated(updatedDepts, slug);
      onClose();
    } catch (err) {
      console.error('Launch business line error:', err);
      setError(err instanceof Error ? err.message : 'Nabigong ilunsad ang bagong linya ng negosyo.');
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(id: string) {
    if (baseDeptIds.includes(id)) {
      alert('Hindi maaaring tanggalin ang mga built-in default business lines.');
      return;
    }
    if (confirm('Sigurado ka bang nais mong tanggalin ang Business Department na ito?')) {
      const updated = deleteCustomBusinessDepartment(id);
      onUpdated(updated);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-3 sm:p-4 backdrop-blur-xs animate-fade-in">
      <div className="w-full max-w-2xl bg-surface-850 rounded-2xl border border-surface-700/80 shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        
        {/* Header */}
        <div className="px-4 py-3 border-b border-surface-700/70 flex items-center justify-between shrink-0 bg-surface-900">
          <div className="flex items-center gap-2">
            <span className="text-xl">🏢</span>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-surface-50">
                {activeTab === 'edit'
                  ? `Pamahalaan ang Negosyo: ${label || editingDeptId}`
                  : 'Enterprise Business Hub & Onboarding'}
              </h2>
              <p className="text-[11px] text-surface-400">
                {activeTab === 'edit'
                  ? 'I-edit ang Profile, Icon, Kulay, at Unit nang ligtas'
                  : 'Pagtatag ng Negosyo, Kategorya, at Panimulang Produkto'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-surface-800 p-0.5 rounded-lg border border-surface-700/60 text-xs font-semibold">
              <button
                type="button"
                onClick={() => {
                  setEditingDeptId(null);
                  setActiveTab('wizard');
                  setStep(1);
                  setLabel('');
                  setIcon('☕');
                  setCategoryNames(['Pangunahing Kategorya']);
                  setDraftProducts([]);
                }}
                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                  activeTab === 'wizard' ? 'bg-primary-600 text-white shadow-xs' : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                + Setup Wizard
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('list')}
                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                  activeTab === 'list' || activeTab === 'edit' ? 'bg-primary-600 text-white shadow-xs' : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                Listahan ({departments.length})
              </button>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-surface-400 hover:text-surface-200 hover:bg-surface-750 transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-4 mt-3 p-2.5 rounded-xl bg-danger-500/10 border border-danger-500/30 text-xs text-danger-400 flex items-center justify-between shrink-0">
            <span>⚠️ {error}</span>
            <button onClick={() => setError(null)} className="text-surface-400 hover:text-white ml-2">✕</button>
          </div>
        )}

        {/* ── MODE 1: 3-IN-1 SETUP WIZARD ── */}
        {activeTab === 'wizard' ? (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Step Progress Ribbon */}
            <div className="px-4 py-2.5 bg-surface-900/60 border-b border-surface-700/50 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-1.5 sm:gap-3 w-full">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-xl text-xs font-bold transition-all ${
                    step === 1 ? 'bg-primary-600 text-white shadow-sm' : 'bg-surface-800 text-surface-400 hover:text-surface-200'
                  }`}
                >
                  <span className="w-4 h-4 rounded-full bg-white/20 text-[10px] flex items-center justify-center">1</span>
                  <span>Profile</span>
                </button>
                <span className="text-surface-600">→</span>
                <button
                  type="button"
                  onClick={() => {
                    if (!label.trim()) { setError('Pakilagay ang pangalan sa Step 1.'); return; }
                    setError(null);
                    setStep(2);
                  }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-xl text-xs font-bold transition-all ${
                    step === 2 ? 'bg-primary-600 text-white shadow-sm' : 'bg-surface-800 text-surface-400 hover:text-surface-200'
                  }`}
                >
                  <span className="w-4 h-4 rounded-full bg-white/20 text-[10px] flex items-center justify-center">2</span>
                  <span>Kategorya ({categoryNames.length})</span>
                </button>
                <span className="text-surface-600">→</span>
                <button
                  type="button"
                  onClick={() => {
                    if (!label.trim()) { setError('Pakilagay ang pangalan sa Step 1.'); return; }
                    setError(null);
                    setStep(3);
                  }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-xl text-xs font-bold transition-all ${
                    step === 3 ? 'bg-primary-600 text-white shadow-sm' : 'bg-surface-800 text-surface-400 hover:text-surface-200'
                  }`}
                >
                  <span className="w-4 h-4 rounded-full bg-white/20 text-[10px] flex items-center justify-center">3</span>
                  <span>Produkto ({draftProducts.length})</span>
                </button>
              </div>
            </div>

            {/* Step Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              
              {/* ── STEP 1: BUSINESS PROFILE ── */}
              {step === 1 && (
                <div className="space-y-4 animate-fade-in">
                  <div>
                    <span className="block text-[11px] font-bold text-surface-400 uppercase tracking-wider mb-1.5">
                      1-Click Industry Templates (Piliin para ma-prefill):
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                      {Object.entries(INDUSTRY_TEMPLATES).map(([key, t]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => applyTemplate(key)}
                          className="flex items-center gap-2 p-2 rounded-xl bg-surface-800 hover:bg-surface-750 border border-surface-700/60 text-left transition-all cursor-pointer group"
                        >
                          <span className="text-xl group-hover:scale-110 transition-transform">{t.icon}</span>
                          <div className="min-w-0">
                            <span className="block text-xs font-bold text-surface-200 truncate">{t.name}</span>
                            <span className="block text-[10px] text-surface-500">{t.categories.length} categories</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-bold text-surface-300 mb-1">
                        Pangalan ng Negosyo *
                      </label>
                      <input
                        type="text"
                        value={label}
                        onChange={e => setLabel(e.target.value)}
                        placeholder="e.g. Kapehan, Bakery, Laundry, Carwash"
                        className="w-full px-3 py-2 rounded-xl bg-surface-900 border border-surface-700 text-surface-100 text-xs font-semibold focus:outline-none focus:border-primary-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-surface-300 mb-1">
                        Default Unit
                      </label>
                      <select
                        value={defaultUnit}
                        onChange={e => setDefaultUnit(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-surface-900 border border-surface-700 text-surface-100 text-xs font-semibold focus:outline-none focus:border-primary-500"
                      >
                        <option value="pcs">pcs (piraso)</option>
                        <option value="cup">cup (inumin)</option>
                        <option value="kg">kg (kilo)</option>
                        <option value="serving">serving (plato)</option>
                        <option value="container">container (galon)</option>
                        <option value="service">service (serbisyo)</option>
                      </select>
                    </div>
                  </div>

                  {/* Icon Selector */}
                  <div>
                    <label className="block text-xs font-bold text-surface-300 mb-1">
                      Emoji Icon Picker
                    </label>
                    <div className="flex items-center gap-1.5 flex-wrap p-2 rounded-xl bg-surface-900 border border-surface-700/60 max-h-28 overflow-y-auto">
                      {EMOJI_OPTIONS.map(e => (
                        <button
                          key={e}
                          type="button"
                          onClick={() => setIcon(e)}
                          className={`w-9 h-9 rounded-lg text-lg flex items-center justify-center transition-all cursor-pointer ${
                            icon === e
                              ? 'bg-primary-600 text-white scale-110 shadow-xs'
                              : 'bg-surface-800 hover:bg-surface-700 text-surface-200'
                          }`}
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Color Theme Selector */}
                  <div>
                    <label className="block text-xs font-bold text-surface-300 mb-1">
                      Kulay ng Tema (Visual Accent)
                    </label>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      {COLOR_OPTIONS.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setColorTheme(c.id)}
                          className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                            colorTheme === c.id
                              ? 'border-white text-white shadow-xs'
                              : 'border-surface-700 bg-surface-900 text-surface-400 hover:border-surface-600'
                          }`}
                        >
                          <span className={`w-3.5 h-3.5 rounded-full ${c.bg}`} />
                          <span className="truncate">{c.label.split(' ')[0]}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Sell by Weight Toggle */}
                  <label className="flex items-center gap-2 p-2.5 rounded-xl bg-surface-900 border border-surface-700/70 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sellByWeight}
                      onChange={e => setSellByWeight(e.target.checked)}
                      className="w-4 h-4 rounded text-primary-600 focus:ring-0"
                    />
                    <div>
                      <span className="block text-xs font-bold text-surface-200">
                        ⚖️ Timbangan / Sold by Weight Mode
                      </span>
                      <span className="block text-[11px] text-surface-500">
                        Awtomatikong bubukas ang decimal scale modal sa POS tuwing ibinebenta ang paninda
                      </span>
                    </div>
                  </label>
                </div>
              )}

              {/* ── STEP 2: CATEGORY BUILDER ── */}
              {step === 2 && (
                <div className="space-y-3 animate-fade-in">
                  <div className="p-3 rounded-xl bg-surface-900 border border-surface-700/60">
                    <span className="text-xs font-bold text-surface-200 flex items-center gap-1.5">
                      <span>{icon}</span> <span>Kategorya sa ilalim ng {label || 'Negosyo'}</span>
                    </span>
                    <p className="text-[11px] text-surface-400 mt-0.5">
                      Lahat ng kategoryang ilalagay dito ay 100% naka-lock at hiwalay sa ibang negosyo.
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newCatInput}
                      onChange={e => setNewCatInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCategory(); } }}
                      placeholder="Pangalan ng bagong kategorya (hal. Hot Drinks, Cakes)..."
                      className="flex-1 px-3 py-2 rounded-xl bg-surface-900 border border-surface-700 text-surface-100 text-xs font-medium focus:outline-none focus:border-primary-500"
                    />
                    <button
                      type="button"
                      onClick={addCategory}
                      className="px-3.5 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold transition-all shrink-0 cursor-pointer"
                    >
                      + Idagdag
                    </button>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    {categoryNames.length === 0 ? (
                      <p className="text-center py-6 text-xs text-surface-500 italic">
                        Wala pang kategoryang nakalagay. Mag-type sa itaas o pumili ng template sa Step 1.
                      </p>
                    ) : (
                      categoryNames.map((cat, idx) => (
                        <div
                          key={cat}
                          className="flex items-center justify-between p-2.5 rounded-xl bg-surface-900 border border-surface-700/50 text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-md bg-surface-800 text-[10px] font-mono text-surface-400 flex items-center justify-center font-bold">
                              {idx + 1}
                            </span>
                            <span className="font-bold text-surface-100">{cat}</span>
                            <span className="text-[10px] text-surface-500">({label || 'Bagong Negosyo'})</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeCategory(idx)}
                            className="p-1 rounded text-surface-400 hover:text-danger-400 hover:bg-surface-800 transition-colors cursor-pointer"
                            title="Tanggalin ang kategorya"
                          >
                            ✕
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* ── STEP 3: INITIAL PRODUCTS ── */}
              {step === 3 && (
                <div className="space-y-3 animate-fade-in">
                  <div className="p-3 rounded-xl bg-surface-900 border border-surface-700/60">
                    <span className="text-xs font-bold text-surface-200 flex items-center gap-1.5">
                      <span>📦</span> <span>Panimulang Produkto (Optional pero Mabilis)</span>
                    </span>
                    <p className="text-[11px] text-surface-400 mt-0.5">
                      Maaari ka nang maglagay ng mga unang paninda ngayon para may laman agad ang POS at Inventory mo.
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-surface-900 border border-surface-700/70 space-y-2.5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-bold text-surface-400 uppercase mb-1">Pangalan ng Produkto</label>
                        <input
                          type="text"
                          value={newProdName}
                          onChange={e => setNewProdName(e.target.value)}
                          placeholder="e.g. Iced Caramel Latte"
                          className="w-full px-2.5 py-1.5 rounded-lg bg-surface-800 border border-surface-700 text-surface-100 text-xs font-semibold focus:outline-none focus:border-primary-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-surface-400 uppercase mb-1">Kategorya</label>
                        <select
                          value={newProdCat || categoryNames[0] || ''}
                          onChange={e => setNewProdCat(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg bg-surface-800 border border-surface-700 text-surface-100 text-xs font-semibold focus:outline-none focus:border-primary-500"
                        >
                          {categoryNames.map(c => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[10px] font-bold text-surface-400 uppercase mb-1">Puhunan (₱)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={newProdCost || ''}
                          onChange={e => setNewProdCost(parseFloat(e.target.value) || 0)}
                          placeholder="0.00"
                          className="w-full px-2.5 py-1.5 rounded-lg bg-surface-800 border border-surface-700 text-surface-100 text-xs font-semibold focus:outline-none focus:border-primary-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-surface-400 uppercase mb-1">Presyo / SRP (₱)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={newProdPrice || ''}
                          onChange={e => setNewProdPrice(parseFloat(e.target.value) || 0)}
                          placeholder="0.00"
                          className="w-full px-2.5 py-1.5 rounded-lg bg-surface-800 border border-surface-700 text-surface-100 text-xs font-bold text-emerald-400 focus:outline-none focus:border-primary-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-surface-400 uppercase mb-1">Stock ({defaultUnit})</label>
                        <input
                          type="number"
                          min="0"
                          value={newProdStock || ''}
                          onChange={e => setNewProdStock(parseInt(e.target.value) || 0)}
                          placeholder="10"
                          className="w-full px-2.5 py-1.5 rounded-lg bg-surface-800 border border-surface-700 text-surface-100 text-xs font-semibold focus:outline-none focus:border-primary-500"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={addDraftProduct}
                        className="px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold transition-all cursor-pointer"
                      >
                        + Isama sa Listahan
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    {draftProducts.map((p, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2.5 rounded-xl bg-surface-900 border border-surface-700/50 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-surface-100 truncate">{p.name}</span>
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-surface-800 text-primary-400 border border-surface-700">
                              {p.categoryName}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-[11px] text-surface-400 mt-0.5">
                            <span>Cost: <b className="text-surface-300">₱{p.cost}</b></span>
                            <span>SRP: <b className="text-emerald-400">₱{p.price}</b></span>
                            <span>Stock: <b className="text-surface-200">{p.stock} {defaultUnit}</b></span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeDraftProduct(idx)}
                          className="p-1 rounded text-surface-400 hover:text-danger-400 ml-2"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Step Navigation & Action Footer */}
            <div className="p-3 bg-surface-900 border-t border-surface-700/70 flex items-center justify-between shrink-0">
              {step > 1 ? (
                <button
                  type="button"
                  onClick={() => setStep((step - 1) as any)}
                  className="px-3 py-1.5 rounded-xl bg-surface-800 hover:bg-surface-750 text-surface-300 text-xs font-semibold cursor-pointer"
                >
                  ← Bumalik
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 rounded-xl bg-surface-800 hover:bg-surface-750 text-surface-400 text-xs font-semibold cursor-pointer"
                >
                  Kanselahin
                </button>
              )}

              <div className="flex items-center gap-2">
                {step < 3 ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (!label.trim()) { setError('Pakilagay ang pangalan sa Step 1.'); return; }
                      setError(null);
                      setStep((step + 1) as any);
                    }}
                    className="px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold transition-all cursor-pointer shadow-xs"
                  >
                    Susunod: {step === 1 ? 'Mga Kategorya →' : 'Mga Produkto →'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleLaunch}
                    disabled={saving || !label.trim()}
                    className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold transition-all cursor-pointer shadow-md shadow-emerald-600/30 disabled:opacity-40"
                  >
                    {saving ? '⏳ Inilulunsad ang Negosyo...' : '🚀 I-save at Ilunsad ang Negosyo'}
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : activeTab === 'edit' ? (
          /* ── MODE 2: IN-PLACE EDIT BUSINESS PROFILE ── */
          <form onSubmit={handleSaveEdit} className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="p-3 rounded-xl bg-surface-900 border border-amber-500/30 flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                    <span>✏️</span> <span>I-edit ang Profile ng Negosyo: {label || editingDeptId}</span>
                  </span>
                  <p className="text-[11px] text-surface-400 mt-0.5">
                    Ligtas itong i-update. Ang mga kategorya at produkto sa loob nito ay mananatiling buo at hindi mawawala.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-surface-300 mb-1">
                    Pangalan ng Negosyo *
                  </label>
                  <input
                    type="text"
                    value={label}
                    onChange={e => setLabel(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-surface-900 border border-surface-700 text-surface-100 text-xs font-semibold focus:outline-none focus:border-primary-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-surface-300 mb-1">
                    Default Unit
                  </label>
                  <select
                    value={defaultUnit}
                    onChange={e => setDefaultUnit(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-surface-900 border border-surface-700 text-surface-100 text-xs font-semibold focus:outline-none focus:border-primary-500"
                  >
                    <option value="pcs">pcs (piraso)</option>
                    <option value="cup">cup (inumin)</option>
                    <option value="kg">kg (kilo)</option>
                    <option value="serving">serving (plato)</option>
                    <option value="container">container (galon)</option>
                    <option value="service">service (serbisyo)</option>
                  </select>
                </div>
              </div>

              {/* Tagline */}
              <div>
                <label className="block text-xs font-bold text-surface-300 mb-1">
                  Tagline / Maikling Deskripsyon
                </label>
                <input
                  type="text"
                  value={tagline}
                  onChange={e => setTagline(e.target.value)}
                  placeholder="e.g. Sariwang Kape at Tinapay Araw-Araw"
                  className="w-full px-3 py-2 rounded-xl bg-surface-900 border border-surface-700 text-surface-100 text-xs font-medium focus:outline-none focus:border-primary-500"
                />
              </div>

              {/* Icon Picker */}
              <div>
                <label className="block text-xs font-bold text-surface-300 mb-1">
                  Palitan ang Emoji Icon
                </label>
                <div className="flex items-center gap-1.5 flex-wrap p-2 rounded-xl bg-surface-900 border border-surface-700/60 max-h-28 overflow-y-auto">
                  {EMOJI_OPTIONS.map(e => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => setIcon(e)}
                      className={`w-9 h-9 rounded-lg text-lg flex items-center justify-center transition-all cursor-pointer ${
                        icon === e
                          ? 'bg-primary-600 text-white scale-110 shadow-xs'
                          : 'bg-surface-800 hover:bg-surface-700 text-surface-200'
                      }`}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>

              {/* Color Theme */}
              <div>
                <label className="block text-xs font-bold text-surface-300 mb-1">
                  Kulay ng Tema (Ribbon & Accent)
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {COLOR_OPTIONS.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setColorTheme(c.id)}
                      className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                        colorTheme === c.id
                          ? 'border-white text-white shadow-xs'
                          : 'border-surface-700 bg-surface-900 text-surface-400 hover:border-surface-600'
                      }`}
                    >
                      <span className={`w-3.5 h-3.5 rounded-full ${c.bg}`} />
                      <span className="truncate">{c.label.split(' ')[0]}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Sell by Weight Toggle */}
              <label className="flex items-center gap-2 p-2.5 rounded-xl bg-surface-900 border border-surface-700/70 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sellByWeight}
                  onChange={e => setSellByWeight(e.target.checked)}
                  className="w-4 h-4 rounded text-primary-600 focus:ring-0"
                />
                <div>
                  <span className="block text-xs font-bold text-surface-200">
                    ⚖️ Timbangan / Sold by Weight Mode
                  </span>
                  <span className="block text-[11px] text-surface-500">
                    Bubuksan ang decimal weight input modal sa POS tuwing ibinebenta ang paninda
                  </span>
                </div>
              </label>
            </div>

            <div className="p-3 bg-surface-900 border-t border-surface-700/70 flex items-center justify-between shrink-0">
              <button
                type="button"
                onClick={() => setActiveTab('list')}
                className="px-3 py-1.5 rounded-xl bg-surface-800 hover:bg-surface-750 text-surface-400 text-xs font-semibold cursor-pointer"
              >
                Kanselahin
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold transition-all cursor-pointer shadow-md shadow-primary-600/30"
              >
                💾 I-save ang mga Pagbabago
              </button>
            </div>
          </form>
        ) : (
          /* ── MODE 3: EXISTING BUSINESS LIST WITH EDIT/DELETE ACTIONS ── */
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-surface-400">
                Lahat ng aktibong Negosyo sa inyong POS & Inventory system:
              </p>
              <button
                type="button"
                onClick={() => {
                  setEditingDeptId(null);
                  setActiveTab('wizard');
                  setStep(1);
                  setLabel('');
                }}
                className="px-2.5 py-1 rounded-lg bg-primary-600/20 text-primary-300 border border-primary-500/30 text-xs font-bold hover:bg-primary-600 hover:text-white transition-all cursor-pointer"
              >
                + Magtayo ng Bagong Negosyo
              </button>
            </div>

            <div className="space-y-2">
              {departments.map(d => {
                const isBase = baseDeptIds.includes(d.id);
                return (
                  <div
                    key={d.id}
                    className="p-3 rounded-xl bg-surface-900 border border-surface-700/60 flex items-center justify-between gap-3 group hover:border-surface-600 transition-all"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-2xl">{d.icon}</span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-surface-100 text-xs">{d.label}</span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${d.badgeBg}`}>
                            {d.id}
                          </span>
                          {isBase && (
                            <span className="text-[10px] text-surface-500 font-medium bg-surface-800 px-1.5 py-0.2 rounded">
                              Built-in
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-surface-400 truncate block mt-0.5">
                          {d.tagline} • Unit: <b className="text-surface-300">{d.default_unit || 'pcs'}</b>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => startEditingDept(d)}
                        className="px-2.5 py-1 rounded-lg bg-surface-800 hover:bg-surface-700 text-surface-200 border border-surface-700 text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1"
                        title="I-edit ang Profile ng Negosyo"
                      >
                        <span>✏️</span>
                        <span>I-edit</span>
                      </button>

                      {!isBase && (
                        <button
                          type="button"
                          onClick={() => handleDelete(d.id)}
                          className="px-2.5 py-1 rounded-lg bg-danger-500/10 hover:bg-danger-500/20 text-danger-400 border border-danger-500/30 text-xs font-semibold transition-colors cursor-pointer"
                          title="Tanggalin ang Negosyo"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
