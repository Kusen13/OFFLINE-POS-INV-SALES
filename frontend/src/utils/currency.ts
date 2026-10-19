/**
 * Currency formatting utilities
 */

const DEFAULT_CURRENCY = '₱';

/**
 * Format a number as currency
 */
export function formatCurrency(amount: number, symbol: string = DEFAULT_CURRENCY): string {
  return `${symbol}${amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/**
 * Parse a currency string to number
 */
export function parseCurrency(value: string): number {
  const cleaned = value.replace(/[^0-9.-]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}
