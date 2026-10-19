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

export interface Product {
  id: number;
  category_id: number;
  category_name?: string;
  name: string;
  sku: string;
  description: string | null;
  cost_price: number;
  selling_price: number;
  current_stock: number;
  low_stock_threshold: number;
  image_path: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductFormData {
  name: string;
  sku: string;
  category_id: number;
  description?: string;
  cost_price: number;
  selling_price: number;
  current_stock?: number;
  low_stock_threshold?: number;
  image_path?: string;
  is_active?: boolean;
}
