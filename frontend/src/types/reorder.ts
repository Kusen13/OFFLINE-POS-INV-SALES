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
  category_name?: string;
  target_stock: number;         // Prep / Target limit (e.g. 31 sticks)
  prev_stock?: number;          // Prev. Stocks kahapon / natira sa tray
  sold_qty?: number;            // (Legacy/Optional)
  unsold_qty?: number;          // (Legacy/Optional)
  supplier_id?: string;         // UUID of the supplier for this item
  supplier_name?: string;       // Denormalized: e.g. "BBQ Supplier (Saog)"
  suggested_qty: number;        // Math.max(0, target_stock - prev_stock)
  order_qty: number;            // Actual quantity to order (editable)
  reseller_price: number;       // Unit cost from supplier (e.g. 15.00)
  total_cost: number;           // order_qty * reseller_price
  unit?: string;                // 'sticks', 'pcs', 'packs', 'bottles'
  notes?: string;
}

export interface ReorderSheet {
  id: string;                   // 'reorder-YYYY-MM-DD'
  order_date: string;           // YYYY-MM-DD (target date of order)
  based_on_date: string;        // YYYY-MM-DD (date of previous day's closing)
  status: 'DRAFT' | 'ORDERED' | 'LOCKED' | 'RECEIVED';
  supplier_name: string;
  items: ReorderItem[];
  total_quantity: number;
  total_cost: number;
  notes?: string;
  received_at?: string;
  created_at: string;
  updated_at: string;
}
