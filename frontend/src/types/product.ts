// ============================================================
// Product Types
// ============================================================

export type BusinessType = 'barbeque' | 'rice' | 'groceries' | 'vegetables' | string;

export interface BusinessDepartment {
  id: BusinessType;
  name: string;
  label: string;
  icon: string;
  tagline: string;
  badgeBg: string;
  activeColor: string;
  default_unit?: string;
  sell_by_weight?: boolean;
}

export const BUSINESS_DEPARTMENTS: BusinessDepartment[] = [
  {
    id: 'barbeque',
    name: 'Barbeque',
    label: 'Barbeque',
    icon: '🍢',
    tagline: 'Ihaw-Ihaw & Cooked Meals',
    badgeBg: 'bg-surface-800 text-surface-200 border-surface-700/60',
    activeColor: 'bg-primary-600 text-white border-primary-500 shadow-sm',
    default_unit: 'sticks',
    sell_by_weight: false,
  },
  {
    id: 'rice',
    name: 'Rice',
    label: 'Bigasan',
    icon: '🍚',
    tagline: 'Kilo & Sako Bigas',
    badgeBg: 'bg-surface-800 text-surface-200 border-surface-700/60',
    activeColor: 'bg-primary-600 text-white border-primary-500 shadow-sm',
    default_unit: 'kg',
    sell_by_weight: true,
  },
  {
    id: 'groceries',
    name: 'Groceries',
    label: 'Groceries',
    icon: '🛒',
    tagline: 'Sari-Sari & Groceries',
    badgeBg: 'bg-surface-800 text-surface-200 border-surface-700/60',
    activeColor: 'bg-primary-600 text-white border-primary-500 shadow-sm',
    default_unit: 'pcs',
    sell_by_weight: false,
  },
  {
    id: 'vegetables',
    name: 'Vegetables',
    label: 'Gulayan',
    icon: '🥬',
    tagline: 'Sariwang Gulay & Rekado',
    badgeBg: 'bg-surface-800 text-surface-200 border-surface-700/60',
    activeColor: 'bg-primary-600 text-white border-primary-500 shadow-sm',
    default_unit: 'kg',
    sell_by_weight: true,
  },
];

export function getBusinessDepartment(type?: string): BusinessDepartment {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem('pos_custom_business_departments_v1') : null;
    const customList: BusinessDepartment[] = raw ? JSON.parse(raw) : [];
    const all = [...BUSINESS_DEPARTMENTS, ...customList];
    const found = all.find(d => d.id === type);
    if (found) return found;
  } catch (_) {}
  const found = BUSINESS_DEPARTMENTS.find(d => d.id === type);
  return found || BUSINESS_DEPARTMENTS[2]; // default to groceries
}

export interface Category {
  id: number;
  name: string;
  business_type?: BusinessType;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  product_count?: number;
  created_at: string;
  updated_at: string;
}

export type ItemType = 'product' | 'supply' | 'service';

/**
 * Units of measure supported by the POS.
 * - 'kg' / 'g'  : sold by weight → price = selling_price × weight_entered
 * - 'tali' / 'bundle' / 'puso' / 'pcs' / 'sticks' / 'bottle' / 'pack' : sold by count
 */
export type WeightUnit = 'kg' | 'g' | 'tali' | 'bundle' | 'puso' | 'pcs' | 'sticks' | 'bottle' | 'pack' | 'sako' | 'lata' | 'piraso';

export interface Product {
  id: number;
  category_id: number;
  category_name?: string;
  business_type?: BusinessType;
  name: string;
  sku: string;
  description: string | null;
  item_type: ItemType;          // 'product' = sellable POS item | 'supply' = internal supply/ingredient
  cost_price: number;
  selling_price: number;        // 0 for supply type items (not for sale). For 'kg' items = price per kilo.
  current_stock: number;
  initial_stock?: number;
  initial_stock_date?: string;
  low_stock_threshold: number;
  target_stock?: number;        // Ideal Prep / Par level (e.g. 30 sticks)
  unit?: string;                // WeightUnit value: 'kg', 'pcs', 'tali', 'sticks', 'bottle', etc.
  sell_by_weight?: boolean;     // true → POS will ask for weight/quantity in decimal (e.g. 1.5 kg)
  supplier_id?: string;         // UUID of linked supplier
  supplier_name?: string;       // Denormalized supplier name for quick display
  reseller_price?: number;      // Wholesale / reseller price per unit
  image_path: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductFormData {
  name: string;
  sku: string;
  category_id: number;
  business_type?: BusinessType;
  item_type: ItemType;          // 'product' | 'supply'
  description?: string;
  cost_price: number;
  selling_price: number;        // Required only for 'product' type; 0 for 'supply'
  reseller_price?: number;
  current_stock?: number;
  initial_stock?: number;
  initial_stock_date?: string;
  low_stock_threshold?: number;
  target_stock?: number;
  unit?: string;                // WeightUnit
  sell_by_weight?: boolean;     // true → POS decimal weight input
  supplier_id?: string;
  supplier_name?: string;
  image_path?: string | null;
  is_active?: boolean;
}

// ============================================================
// Category UI Mapping — emoji icons and color accents
// Key: category name (lowercase, trimmed)
// ============================================================
export const CATEGORY_ICONS: Record<string, string> = {
  'bbq': '🔥',
  'ihaw': '🔥',
  'bbq & ihaw': '🔥',
  'gulay': '🥬',
  'mga gulay': '🥬',
  'isda': '🐟',
  'isda & seafood': '🐟',
  'seafood': '🦐',
  'bigas': '🍚',
  'bigas & butil': '🍚',
  'pampalasa': '🧴',
  'pampalasa / sauce': '🧴',
  'sauce': '🧴',
  'grocery': '🏪',
  'canned goods': '🥫',
  'grocery / canned': '🥫',
  'inumin': '🥛',
  'mga inumin': '🥛',
  'drinks': '🥛',
  'pang-bahay': '🧹',
  'snacks': '🍡',
  'supplies': '📦',
  'supply': '📦',
  'default': '📦',
};

export const CATEGORY_COLORS: Record<string, string> = {
  'bbq': 'bg-orange-500/15 border-orange-500/40 text-orange-300',
  'ihaw': 'bg-orange-500/15 border-orange-500/40 text-orange-300',
  'bbq & ihaw': 'bg-orange-500/15 border-orange-500/40 text-orange-300',
  'gulay': 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300',
  'mga gulay': 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300',
  'isda': 'bg-sky-500/15 border-sky-500/40 text-sky-300',
  'isda & seafood': 'bg-sky-500/15 border-sky-500/40 text-sky-300',
  'seafood': 'bg-sky-500/15 border-sky-500/40 text-sky-300',
  'bigas': 'bg-yellow-500/15 border-yellow-500/40 text-yellow-300',
  'bigas & butil': 'bg-yellow-500/15 border-yellow-500/40 text-yellow-300',
  'pampalasa': 'bg-purple-500/15 border-purple-500/40 text-purple-300',
  'pampalasa / sauce': 'bg-purple-500/15 border-purple-500/40 text-purple-300',
  'grocery': 'bg-rose-500/15 border-rose-500/40 text-rose-300',
  'canned goods': 'bg-rose-500/15 border-rose-500/40 text-rose-300',
  'grocery / canned': 'bg-rose-500/15 border-rose-500/40 text-rose-300',
  'inumin': 'bg-blue-500/15 border-blue-500/40 text-blue-300',
  'mga inumin': 'bg-blue-500/15 border-blue-500/40 text-blue-300',
  'pang-bahay': 'bg-teal-500/15 border-teal-500/40 text-teal-300',
  'supplies': 'bg-surface-700/50 border-surface-600/40 text-surface-300',
  'default': 'bg-surface-700/50 border-surface-600/40 text-surface-300',
};

/** Resolve icon for a category by name, case-insensitive */
export function getCategoryIcon(categoryName?: string): string {
  if (!categoryName) return CATEGORY_ICONS['default'];
  const key = categoryName.toLowerCase().trim();
  return CATEGORY_ICONS[key] ?? CATEGORY_ICONS['default'];
}

/** Resolve Tailwind color classes for a category by name, case-insensitive */
export function getCategoryColor(categoryName?: string): string {
  if (!categoryName) return CATEGORY_COLORS['default'];
  const key = categoryName.toLowerCase().trim();
  return CATEGORY_COLORS[key] ?? CATEGORY_COLORS['default'];
}

