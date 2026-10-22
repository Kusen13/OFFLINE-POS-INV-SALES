/**
 * Monthly Bills & ROI Tracking Types
 * Offline-first financial planning, sinking fund (daily hulugan),
 * and capital return on investment (ROI) tracking.
 */

export type BillStatus = 'PENDING' | 'PARTIALLY_FUNDED' | 'FULLY_FUNDED' | 'PAID';

export interface MonthlyBill {
  id: string; // e.g. 'bill-rent-2026-10'
  month: string; // YYYY-MM
  name: string; // e.g. 'Rent', 'Kuryente', 'Water', 'Wifi'
  daily_obligation: number; // e.g. 400
  total_target_amount: number; // e.g. 7000
  due_date?: string; // YYYY-MM-DD
  notes?: string;
  // Day-by-day allocation map: key is day number (1 to 31), value is amount allocated
  daily_allocations: Record<number, number>;
  status: BillStatus;
  paid_at?: string;
  created_at: string;
  updated_at: string;
}

export interface CapitalItem {
  id: string;
  item_name: string;
  amount: number;
  category: string; // e.g. 'Equipment', 'Stock', 'Renovation', 'Permits', 'Deposit'
  date_invested: string; // YYYY-MM-DD
  notes?: string;
}

export interface InitialCapitalConfig {
  id: string; // 'main-capital-config'
  total_capital: number; // e.g. 60000
  business_start_date: string; // e.g. '2026-10-14'
  target_roi_months: number; // e.g. 6
  notes?: string;
  items: CapitalItem[];
  updated_at: string;
}
