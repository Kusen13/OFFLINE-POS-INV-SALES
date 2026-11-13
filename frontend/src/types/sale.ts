// ============================================================
// Sale Types
// ============================================================

export type SyncStatus = 'PENDING' | 'SYNCED' | 'FAILED';

export interface CartItem {
  product_id: number;
  product_name: string;
  product_sku: string;
  unit_price: number;       // price per unit (or price per kg if sell_by_weight)
  unit_cost: number;
  quantity: number;         // for by-weight: quantity = weight_kg (decimal ok)
  line_total: number;
  image_path?: string | null;
  // Per-weight tracking fields (set when sell_by_weight = true)
  sell_by_weight?: boolean; // true if this item was sold by weight
  weight_kg?: number;       // actual entered weight in kg (e.g. 1.5)
  weight_unit?: string;     // 'kg' | 'g' | 'tali' etc.
  // Wholesale / Pakyawan tracking
  is_wholesale?: boolean;   // true if wholesale/pakyawan pricing is applied
  retail_price?: number;    // original retail unit price
  wholesale_price?: number; // wholesale / reseller unit price
}

export interface SplitPaymentLine {
  method_id: number;
  method_name: string;
  amount: number;
  reference?: string | null;
}

export interface PendingSale {
  uuid: string;
  receipt_number: string;
  items: CartItem[];
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  cash_tendered: number | null;
  change_amount: number | null;
  payment_method_id: number;
  payment_method_name: string;
  payment_reference: string | null;
  split_payments?: SplitPaymentLine[] | null;
  customer_id?: number | null;
  customer_name?: string | null;
  cashier_name?: string | null;   // NEW: Cashier who processed this sale
  source_device: string;
  notes: string | null;
  sold_at: string;
  sync_status: SyncStatus;
  sync_error?: string;
  synced_at?: string;
  created_at: string;
}

export interface Sale {
  id: number;
  uuid: string;
  receipt_number: string;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  cash_tendered: number | null;
  change_amount: number | null;
  payment_method_id: number;
  payment_method_name?: string;
  payment_reference: string | null;
  customer_id?: number | null;
  customer_name?: string | null;
  cashier_name?: string | null;    // NEW: Cashier who processed this sale
  source_device: string | null;
  notes: string | null;
  sold_at: string;
  synced_at: string | null;
  created_at: string;
  item_count?: number;
  items?: SaleItem[];
}

export interface SaleItem {
  id: number;
  sale_id: number;
  product_id: number;
  product_name: string;
  product_sku: string;
  unit_price: number;
  unit_cost: number;
  quantity: number;
  line_total: number;
  image_path?: string | null;
  // Weight-based sale fields
  sell_by_weight?: boolean;
  weight_kg?: number;     // actual entered weight (e.g. 1.5)
  weight_unit?: string;   // 'kg' | 'g' | 'tali' etc.
}

export interface PaymentMethod {
  id: number;
  name: string;
  is_active: boolean;
  sort_order: number;
}
