// ============================================================
// Inventory Types
// ============================================================

export type MovementType = 'STOCK_IN' | 'SALE' | 'ADJUSTMENT' | 'RETURN' | 'INITIAL';

export interface InventoryItem {
  id: number;
  name: string;
  sku: string;
  category_id: number;
  category_name: string;
  current_stock: number;
  low_stock_threshold: number;
  cost_price: number;
  selling_price: number;
  is_low_stock: boolean;
}

export interface InventoryMovement {
  id: number;
  product_id: number;
  product_name?: string;
  product_sku?: string;
  type: MovementType;
  quantity_change: number;
  stock_before: number;
  stock_after: number;
  reference_type: string | null;
  reference_id: number | null;
  notes: string | null;
  created_at: string;
}

export interface StockReceipt {
  id: number;
  receipt_ref: string | null;
  supplier: string | null;
  notes: string | null;
  total_items: number;
  received_at: string;
  created_at: string;
}

export interface Expense {
  id: number;
  category: string;
  description: string;
  amount: number;
  expense_date: string;
  created_at: string;
  updated_at: string;
}
