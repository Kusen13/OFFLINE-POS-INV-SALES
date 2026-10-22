// ============================================================
// Product Types
// ============================================================

export interface Category {
  id: number;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  product_count?: number;
  created_at: string;
  updated_at: string;
}

export type ItemType = 'product' | 'supply';

export interface Product {
  id: number;
  category_id: number;
  category_name?: string;
  name: string;
  sku: string;
  description: string | null;
  item_type: ItemType;          // 'product' = sellable POS item | 'supply' = internal supply/ingredient
  cost_price: number;
  selling_price: number;        // 0 for supply type items (not for sale)
  current_stock: number;
  initial_stock?: number;
  initial_stock_date?: string;
  low_stock_threshold: number;
  target_stock?: number;        // Ideal Prep / Par level (e.g. 30 sticks)
  unit?: string;                // 'sticks', 'pcs', 'bottle', 'pack'
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
  unit?: string;
  supplier_id?: string;
  supplier_name?: string;
  image_path?: string;
  is_active?: boolean;
}

