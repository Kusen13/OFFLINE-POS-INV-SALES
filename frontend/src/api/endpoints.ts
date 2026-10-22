/**
 * Products API - CRUD operations
 */

import { api } from './client';
import type { Product, Category, ProductFormData, ItemType } from '../types/product';
import type { ApiResponse, PaginatedResponse } from '../types/common';
import type { PaymentMethod } from '../types/sale';

// ============================================================
// Products
// ============================================================

export async function fetchProducts(params?: {
  page?: number;
  per_page?: number;
  search?: string;
  category_id?: number;
  item_type?: ItemType;
}): Promise<PaginatedResponse<Product>> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.per_page) searchParams.set('per_page', String(params.per_page));
  if (params?.search) searchParams.set('search', params.search);
  if (params?.category_id) searchParams.set('category_id', String(params.category_id));
  if (params?.item_type) searchParams.set('item_type', params.item_type);
  const qs = searchParams.toString();
  return api.get<PaginatedResponse<Product>>(`/products${qs ? '?' + qs : ''}`);
}

export async function fetchProduct(id: number): Promise<ApiResponse<Product>> {
  return api.get<ApiResponse<Product>>(`/products/${id}`);
}

export async function createProduct(data: ProductFormData): Promise<ApiResponse<Product>> {
  return api.post<ApiResponse<Product>>('/products', data);
}

export async function updateProduct(id: number, data: Partial<ProductFormData>): Promise<ApiResponse<Product>> {
  return api.put<ApiResponse<Product>>(`/products/${id}`, data);
}

export async function deleteProduct(id: number): Promise<ApiResponse<{ message: string }>> {
  return api.delete<ApiResponse<{ message: string }>>(`/products/${id}`);
}

export async function fetchLowStockProducts(): Promise<ApiResponse<Product[]>> {
  return api.get<ApiResponse<Product[]>>('/products/low-stock');
}

// ============================================================
// Categories
// ============================================================

export async function fetchCategories(withCounts = false): Promise<ApiResponse<Category[]>> {
  return api.get<ApiResponse<Category[]>>(`/categories${withCounts ? '?with_counts=1' : ''}`);
}

export async function createCategory(data: { name: string; description?: string; sort_order?: number }): Promise<ApiResponse<Category>> {
  return api.post<ApiResponse<Category>>('/categories', data);
}

export async function updateCategory(id: number, data: Partial<{ name: string; description: string; sort_order: number; is_active: boolean }>): Promise<ApiResponse<Category>> {
  return api.put<ApiResponse<Category>>(`/categories/${id}`, data);
}

export async function deleteCategory(id: number): Promise<ApiResponse<{ message: string }>> {
  return api.delete<ApiResponse<{ message: string }>>(`/categories/${id}`);
}

// ============================================================
// Payment Methods
// ============================================================

export async function fetchPaymentMethods(): Promise<ApiResponse<PaymentMethod[]>> {
  return api.get<ApiResponse<PaymentMethod[]>>('/payment-methods');
}

// ============================================================
// Sales
// ============================================================

export async function fetchSales(params?: {
  page?: number;
  per_page?: number;
  date_from?: string;
  date_to?: string;
  payment_method_id?: number;
  with_items?: boolean;
}): Promise<PaginatedResponse<import('../types/sale').Sale>> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.per_page) searchParams.set('per_page', String(params.per_page));
  if (params?.date_from) searchParams.set('date_from', params.date_from);
  if (params?.date_to) searchParams.set('date_to', params.date_to);
  if (params?.payment_method_id) searchParams.set('payment_method_id', String(params.payment_method_id));
  if (params?.with_items) searchParams.set('with_items', '1');
  const qs = searchParams.toString();
  return api.get(`/sales${qs ? '?' + qs : ''}`);
}

export async function fetchSaleDetail(id: number): Promise<ApiResponse<import('../types/sale').Sale>> {
  return api.get(`/sales/${id}`);
}

// ============================================================
// Reports
// ============================================================

export async function fetchDashboardSummary(): Promise<ApiResponse<import('../types/common').DashboardSummary>> {
  return api.get('/reports/summary');
}

export async function fetchDailyReport(date?: string): Promise<ApiResponse<import('../types/common').DailyReport>> {
  const qs = date ? `?date=${date}` : '';
  return api.get(`/reports/daily${qs}`);
}

// ============================================================
// Inventory
// ============================================================

export async function fetchInventory(params?: {
  page?: number;
  per_page?: number;
  low_stock_only?: boolean;
  category_id?: number;
}): Promise<PaginatedResponse<import('../types/inventory').InventoryItem>> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.per_page) searchParams.set('per_page', String(params.per_page));
  if (params?.low_stock_only) searchParams.set('low_stock_only', '1');
  if (params?.category_id) searchParams.set('category_id', String(params.category_id));
  const qs = searchParams.toString();
  return api.get(`/inventory${qs ? '?' + qs : ''}`);
}

export async function createStockAdjustment(data: {
  product_id: number;
  type: string;
  quantity: number;
  notes?: string;
}): Promise<ApiResponse<{ message: string }>> {
  return api.post('/inventory/movements', {
    product_id: data.product_id,
    type: data.type,
    quantity_change: data.quantity,
    notes: data.notes,
  });
}

export async function fetchInventoryMovements(params?: {
  page?: number;
  per_page?: number;
  product_id?: number;
  type?: string;
}): Promise<PaginatedResponse<import('../types/inventory').InventoryMovement>> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.per_page) searchParams.set('per_page', String(params.per_page));
  if (params?.product_id) searchParams.set('product_id', String(params.product_id));
  if (params?.type) searchParams.set('type', params.type);
  const qs = searchParams.toString();
  return api.get(`/inventory/movements${qs ? '?' + qs : ''}`);
}

export async function fetchProfitReport(dateFrom?: string, dateTo?: string): Promise<ApiResponse<{
  date_from: string;
  date_to: string;
  total_revenue: number;
  total_cost: number;
  gross_profit: number;
  gross_margin: number;
  total_expenses: number;
  estimated_net_profit: number;
  total_transactions: number;
}>> {
  const params = new URLSearchParams();
  if (dateFrom) params.set('date_from', dateFrom);
  if (dateTo) params.set('date_to', dateTo);
  const qs = params.toString();
  return api.get(`/reports/profit${qs ? '?' + qs : ''}`);
}

export async function fetchMonthlySalesReport(month?: string): Promise<ApiResponse<{
  month: string;
  total_transactions: number;
  total_sales: number;
  total_discounts: number;
  daily: { date: string; transactions: number; sales: number }[];
}>> {
  const qs = month ? `?month=${month}` : '';
  return api.get(`/reports/monthly${qs}`);
}

// ============================================================
// Expenses
// ============================================================

export async function fetchExpenses(params?: {
  page?: number;
  per_page?: number;
  date_from?: string;
  date_to?: string;
  category?: string;
}): Promise<PaginatedResponse<import('../types/inventory').Expense>> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.per_page) searchParams.set('per_page', String(params.per_page));
  if (params?.date_from) searchParams.set('date_from', params.date_from);
  if (params?.date_to) searchParams.set('date_to', params.date_to);
  if (params?.category) searchParams.set('category', params.category);
  const qs = searchParams.toString();
  return api.get(`/expenses${qs ? '?' + qs : ''}`);
}

export async function createExpense(data: {
  category: string;
  description: string;
  amount: number;
  expense_date: string;
}): Promise<ApiResponse<import('../types/inventory').Expense>> {
  return api.post('/expenses', data);
}

export async function updateExpense(id: number, data: Partial<{
  category: string;
  description: string;
  amount: number;
  expense_date: string;
}>): Promise<ApiResponse<import('../types/inventory').Expense>> {
  return api.put(`/expenses/${id}`, data);
}

export async function deleteExpense(id: number): Promise<ApiResponse<{ message: string }>> {
  return api.delete(`/expenses/${id}`);
}

// ============================================================
// Settings
// ============================================================

export async function fetchSettings(): Promise<ApiResponse<import('../types/common').AppSettings>> {
  return api.get('/settings');
}

export async function updateSetting(key: string, value: string): Promise<ApiResponse<{ message: string }>> {
  return api.put(`/settings/${key}`, { value });
}

// ============================================================
// Daily Closings & Shift Balancing
// ============================================================

export async function fetchDailyClosingByDate(date: string): Promise<ApiResponse<import('../types/closing').DailyClosing>> {
  return api.get(`/daily-closings?date=${date}`);
}

export async function fetchAllDailyClosings(): Promise<ApiResponse<import('../types/closing').DailyClosing[]>> {
  return api.get('/daily-closings');
}

export async function saveDailyClosingApi(closing: import('../types/closing').DailyClosing): Promise<ApiResponse<import('../types/closing').DailyClosing>> {
  return api.post('/daily-closings', closing);
}

export async function deleteDailyClosingApi(id: string): Promise<ApiResponse<{ message: string }>> {
  return api.delete(`/daily-closings/${id}`);
}

