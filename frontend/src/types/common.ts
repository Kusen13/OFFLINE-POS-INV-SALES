// ============================================================
// Common/Shared Types
// ============================================================

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
  errors?: string[];
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    total: number;
    page: number;
    per_page: number;
    total_pages: number;
  };
}

export interface AppSettings {
  store_name: string;
  currency: string;
  currency_symbol: string;
  tax_rate: string;
  receipt_footer: string;
  low_stock_default: string;
}

export interface DashboardSummary {
  today: { transactions: number; sales: number };
  this_week: { transactions: number; sales: number };
  this_month: { transactions: number; sales: number };
  low_stock_count: number;
  total_products: number;
  pending_sync_failures: number;
}

export interface DailyReport {
  total_transactions: number;
  total_sales: number;
  total_discounts: number;
  avg_transaction: number;
  gross_profit: number;
  total_cost: number;
  date: string;
  hourly: { hour: number; transactions: number; sales: number }[];
}

export interface ProfitReport {
  date_from: string;
  date_to: string;
  total_revenue: number;
  total_cost: number;
  gross_profit: number;
  gross_margin: number;
  total_expenses: number;
  estimated_net_profit: number;
  total_transactions: number;
}
