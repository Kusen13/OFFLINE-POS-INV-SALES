/**
 * Re-order Sheet Types
 * 
 * Used for daily BBQ and supplies replenishment based on
 * yesterday's unsold stocks vs target daily par limits.
 */

export interface ReorderItem {
  product_id: number;
  product_name: string;
  sku: string;
  category_id?: number;
  category_name?: string;
  item_type?: 'product' | 'supply' | 'service';
  business_type?: string;
  target_stock: number;         // Prep / Target Par limit (e.g. 31 sticks, 5.0 kg, or 24 pcs)
  prev_stock?: number;          // Prev. Stocks kahapon / natirang display
  current_stock?: number;       // Current inventory stock
  min_stock_level?: number;     // Low-stock alert threshold (for retail/drinks)
  sell_by_weight?: boolean;     // true = gulay/bigas sold by kg (supports decimals)
  sold_qty?: number;            // (Legacy/Optional)
  unsold_qty?: number;          // (Legacy/Optional)
  supplier_id?: string;         // UUID of the supplier for this item
  supplier_name?: string;       // Denormalized: e.g. "BBQ Supplier (Saog)"
  suggested_qty: number;        // Auto-calculated replenishment needed
  order_qty: number;            // Actual quantity to order (editable)
  reseller_price: number;       // Unit cost from supplier (e.g. 15.00)
  total_cost: number;           // order_qty * reseller_price
  unit?: string;                // 'sticks', 'kg', 'pcs', 'packs', 'bottle', etc.
  notes?: string;
}

export interface ReorderSheet {
  id: string;                   // 'reorder-YYYY-MM-DD'
  order_date: string;           // YYYY-MM-DD (target date of order)
  based_on_date: string;        // YYYY-MM-DD (date of previous day's closing)
  status: 'DRAFT' | 'ORDERED' | 'LOCKED' | 'RECEIVED';
  dept_status?: Record<string, 'DRAFT' | 'ORDERED' | 'LOCKED' | 'RECEIVED'>;
  dept_received_at?: Record<string, string>;
  supplier_name: string;
  items: ReorderItem[];
  total_quantity: number;
  total_cost: number;
  notes?: string;
  received_at?: string;
  created_at: string;
  updated_at: string;
}
