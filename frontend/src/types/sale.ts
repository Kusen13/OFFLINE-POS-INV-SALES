// ============================================================
// Sale Types
// ============================================================

export type SyncStatus = 'PENDING' | 'SYNCED' | 'FAILED';

export interface CartItem {
  product_id: number;
  product_name: string;
  product_sku: string;
  unit_price: number;
  unit_cost: number;
  quantity: number;
  line_total: number;
  image_path?: string | null;
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
}

export interface PaymentMethod {
  id: number;
  name: string;
  is_active: boolean;
  sort_order: number;
}
