/**
 * Rice Packaging Filter Utilities
 * Helps filter Bigasan products across Daily Closing, Reorder Sheet, Inventory, and Products by packaging:
 * - Per Kilo (Tingi / By-Weight)
 * - 5kg Pack (Naka-supot)
 * - 25kg Sako (Isang Kaban)
 */

export type RicePackagingFilter = 'all' | 'kilo' | '5kg' | '25kg';

export interface RicePackagingOption {
  key: RicePackagingFilter;
  label: string;
  shortLabel: string;
  icon: string;
}

export const RICE_PACKAGING_OPTIONS: RicePackagingOption[] = [
  { key: 'all', label: 'Lahat ng Sukat', shortLabel: 'Lahat', icon: '🌾' },
  { key: 'kilo', label: 'Per Kilo (Tingi)', shortLabel: 'Per Kilo', icon: '⚖️' },
  { key: '5kg', label: '5kg Pack (Supot)', shortLabel: '5kg Pack', icon: '🛍️' },
  { key: '25kg', label: '25kg Sako (Kaban)', shortLabel: '25kg Sako', icon: '📦' },
];

export function matchRicePackaging(
  itemName: string,
  unit?: string | null,
  sellByWeight?: boolean | null,
  filter?: RicePackagingFilter
): boolean {
  if (!filter || filter === 'all') return true;
  const lower = (itemName || '').toLowerCase();
  const unitLower = (unit || '').toLowerCase();

  const is25kg =
    lower.includes('25kg') ||
    lower.includes('25 kg') ||
    lower.includes('25-kg') ||
    lower.includes('25kilo') ||
    lower.includes('sako') ||
    unitLower === 'sako';

  const is5kg =
    !is25kg &&
    (lower.includes('5kg') ||
      lower.includes('5 kg') ||
      lower.includes('5-kg') ||
      lower.includes('5kilo') ||
      lower.includes('pack'));

  const isKilo =
    !is25kg &&
    !is5kg &&
    (sellByWeight === true ||
      unitLower === 'kg' ||
      lower.includes('per kilo') ||
      lower.includes('kilo') ||
      lower.includes('tingi'));

  if (filter === '25kg') return is25kg;
  if (filter === '5kg') return is5kg;
  if (filter === 'kilo') return isKilo;

  return true;
}

