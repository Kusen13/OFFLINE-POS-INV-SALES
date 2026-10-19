/**
 * CSV Export utility
 */

/**
 * Convert an array of objects to CSV string and trigger download
 */
export function exportToCSV(data: Record<string, unknown>[], filename: string): void {
  if (data.length === 0) return;

  const headers = Object.keys(data[0]);
  const csvRows: string[] = [];

  // Header row
  csvRows.push(headers.map(h => `"${h}"`).join(','));

  // Data rows
  for (const row of data) {
    const values = headers.map(h => {
      const val = row[h];
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    });
    csvRows.push(values.join(','));
  }

  const csvContent = csvRows.join('\n');
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

/**
 * Format sales data for CSV export
 */
export function formatSalesForCSV(sales: Array<{
  receipt_number: string;
  sold_at: string;
  item_count?: number;
  subtotal: number;
  discount_amount: number;
  total_amount: number;
  payment_method_name?: string;
  source_device?: string | null;
}>): Record<string, unknown>[] {
  return sales.map(s => ({
    'Receipt #': s.receipt_number,
    'Date': new Date(s.sold_at).toLocaleString(),
    'Items': s.item_count ?? 0,
    'Subtotal': s.subtotal,
    'Discount': s.discount_amount,
    'Total': s.total_amount,
    'Payment': s.payment_method_name ?? 'Cash',
    'Device': s.source_device ?? '',
  }));
}

/**
 * Format products for CSV export
 */
export function formatProductsForCSV(products: Array<{
  name: string;
  sku: string;
  category_name?: string;
  cost_price: number;
  selling_price: number;
  current_stock: number;
  low_stock_threshold: number;
  is_active: boolean;
}>): Record<string, unknown>[] {
  return products.map(p => ({
    'Name': p.name,
    'SKU': p.sku,
    'Category': p.category_name ?? '',
    'Cost Price': p.cost_price,
    'Selling Price': p.selling_price,
    'Stock': p.current_stock,
    'Low Stock Threshold': p.low_stock_threshold,
    'Active': p.is_active ? 'Yes' : 'No',
  }));
}

/**
 * Format inventory for CSV export
 */
export function formatInventoryForCSV(items: Array<{
  name: string;
  sku: string;
  category_name: string;
  current_stock: number;
  low_stock_threshold: number;
  selling_price: number;
  is_low_stock: boolean;
}>): Record<string, unknown>[] {
  return items.map(i => ({
    'Product': i.name,
    'SKU': i.sku,
    'Category': i.category_name,
    'Stock': i.current_stock,
    'Threshold': i.low_stock_threshold,
    'Price': i.selling_price,
    'Status': i.current_stock === 0 ? 'Out of Stock' : i.is_low_stock ? 'Low Stock' : 'In Stock',
  }));
}
