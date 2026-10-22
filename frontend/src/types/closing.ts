export interface DailyClosingItem {
  product_id: number;
  product_name: string;
  sku: string;
  unit_cost: number;
  selling_price: number;
  prev_stock: number;         // Opening / leftover from yesterday
  received_qty: number;       // Stock-in today
  prepared_qty: number;       // prev_stock + received_qty
  sold_qty: number;           // Sold through POS
  unsold_qty: number;         // Physical count at closing
  spoilage_qty: number;       // Burned / damaged / expired
  discrepancy: number;        // (sold_qty + unsold_qty + spoilage_qty) - prepared_qty
  spoilage_loss: number;      // spoilage_qty * selling_price (retail opportunity loss)
  actual_revenue: number;     // sold_qty * selling_price
  cogs: number;               // sold_qty * unit_cost
  gross_profit: number;       // actual_revenue - cogs
}

export interface DailyClosing {
  id: string; // e.g. 'closing-2026-10-19'
  date: string; // YYYY-MM-DD
  status: 'DRAFT' | 'FINALIZED';
  items: DailyClosingItem[];
  total_prepared: number;
  total_sold: number;
  total_unsold: number;
  total_spoilage: number;
  total_spoilage_loss: number;
  total_revenue: number;
  total_cogs: number;
  total_gross_profit: number;
  // Cash Drawer & On-Hand Reconciliation
  opening_cash?: number;          // Hawak na pera kahapon / panimulang barya sa kaha
  cash_sales?: number;            // Aktwal na pumasok na cash benta ngayong araw
  cash_expenses?: number;         // Binayarang cash expenses/OPEX ngayong araw
  bills_allocation?: number;      // Itinabing hulog para sa Monthly Bills
  expected_cash_on_hand?: number; // opening_cash + cash_sales - cash_expenses - bills_allocation
  actual_cash_on_hand?: number;   // Aktwal na binilang na cash sa kaha bago magsara
  cash_discrepancy?: number;      // actual_cash_on_hand - expected_cash_on_hand
  notes?: string;
  finalized_at?: string;
  created_at: string;
}
