/**
 * Products API - CRUD operations
 */

import { api } from './client';
import type { Product, Category, ProductFormData } from '../types/product';
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
}): Promise<PaginatedResponse<Product>> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.per_page) searchParams.set('per_page', String(params.per_page));
  if (params?.search) searchParams.set('search', params.search);
  if (params?.category_id) searchParams.set('category_id', String(params.category_id));
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
}): Promise<PaginatedResponse<import('../types/sale').Sale>> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.per_page) searchParams.set('per_page', String(params.per_page));
  if (params?.date_from) searchParams.set('date_from', params.date_from);
  if (params?.date_to) searchParams.set('date_to', params.date_to);
  if (params?.payment_method_id) searchParams.set('payment_method_id', String(params.payment_method_id));
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
  return api.post('/inventory/movements', data);
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
