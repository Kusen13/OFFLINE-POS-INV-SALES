/**
 * Monthly Bills & Initial Capital ROI Repository
 * Offline-first persistence with localStorage & IndexedDB fallback,
 * pre-seeded with the user's real business data from the spreadsheet.
 */

import type { MonthlyBill, InitialCapitalConfig } from '../types/bills';
import { getAllDailyClosings } from './closingRepository';
import { api } from '../api/client';

const BILLS_STORAGE_KEY = 'pos_monthly_bills_v1';
const CAPITAL_STORAGE_KEY = 'pos_capital_config_v1';

// Seed data from October 2026 sheet
const SEED_BILLS_OCTOBER: MonthlyBill[] = [
  {
    id: 'bill-rent-2026-10',
    month: '2026-10',
    name: 'Rent',
    daily_obligation: 400,
    total_target_amount: 7000,
    due_date: '2026-10-31',
    daily_allocations: { 14: 400, 15: 400 },
    status: 'PARTIALLY_FUNDED',
    notes: 'Pwesto monthly lease',
    created_at: '2026-10-14T00:00:00.000Z',
    updated_at: '2026-10-15T00:00:00.000Z',
  },
  {
    id: 'bill-kuryente-2026-10',
    month: '2026-10',
    name: 'Kuryente',
    daily_obligation: 300,
    total_target_amount: 4237,
    due_date: '2026-10-31',
    daily_allocations: { 14: 300, 15: 300 },
    status: 'PARTIALLY_FUNDED',
    notes: 'Meralco electricity bill',
    created_at: '2026-10-14T00:00:00.000Z',
    updated_at: '2026-10-15T00:00:00.000Z',
  },
  {
    id: 'bill-water-2026-10',
    month: '2026-10',
    name: 'Water',
    daily_obligation: 100,
    total_target_amount: 1600,
    due_date: '2026-10-31',
    daily_allocations: { 14: 100, 15: 100 },
    status: 'PARTIALLY_FUNDED',
    notes: 'Maynilad / Manila Water',
    created_at: '2026-10-14T00:00:00.000Z',
    updated_at: '2026-10-15T00:00:00.000Z',
  },
  {
    id: 'bill-wifi-2026-10',
    month: '2026-10',
    name: 'Wifi',
    daily_obligation: 100,
    total_target_amount: 1600,
    due_date: '2026-10-31',
    daily_allocations: { 14: 100, 15: 100 },
    status: 'PARTIALLY_FUNDED',
    notes: 'Internet connection',
    created_at: '2026-10-14T00:00:00.000Z',
    updated_at: '2026-10-15T00:00:00.000Z',
  },
];

const DEFAULT_CAPITAL_CONFIG: InitialCapitalConfig = {
  id: 'main-capital-config',
  total_capital: 50000,
  business_start_date: '2026-10-19',
  target_roi_months: 6,
  notes: 'Initial Capital Investment for Ihaw-Ihaw business setup',
  items: [
    {
      id: 'cap-1',
      item_name: 'Chest Freezer & Chiller',
      amount: 18000,
      category: 'Equipment',
      date_invested: '2026-10-10',
      notes: 'Palamigan ng karne at ihawin',
    },
    {
      id: 'cap-2',
      item_name: 'Stainless BBQ Grill & Exhaust Fan',
      amount: 12000,
      category: 'Equipment',
      date_invested: '2026-10-11',
      notes: 'Ihawan set at smoke hood',
    },
    {
      id: 'cap-3',
      item_name: 'Location Advance & Security Deposit',
      amount: 10000,
      category: 'Deposit',
      date_invested: '2026-10-08',
      notes: '1 month advance + 1 month deposit',
    },
    {
      id: 'cap-4',
      item_name: 'Paunang Meat Stock & Marinade supplies',
      amount: 6000,
      category: 'Stock',
      date_invested: '2026-10-13',
      notes: 'Initial wholesale batch',
    },
    {
      id: 'cap-5',
      item_name: 'Lighting, Tables, Signboard & Tongs',
      amount: 4000,
      category: 'Renovation',
      date_invested: '2026-10-12',
      notes: 'Kagamitan sa pwesto',
    },
  ],
  updated_at: new Date().toISOString(),
};

/**
 * Get all monthly bills from storage.
 */
export async function getAllMonthlyBills(): Promise<MonthlyBill[]> {
  const raw = localStorage.getItem(BILLS_STORAGE_KEY);
  if (!raw) {
    // Seed initial data
    localStorage.setItem(BILLS_STORAGE_KEY, JSON.stringify(SEED_BILLS_OCTOBER));
    return SEED_BILLS_OCTOBER;
  }
  try {
    return JSON.parse(raw) as MonthlyBill[];
  } catch {
    return SEED_BILLS_OCTOBER;
  }
}

/**
 * Get bills for a specific month (YYYY-MM).
 */
export async function getBillsByMonth(month: string): Promise<MonthlyBill[]> {
  const all = await getAllMonthlyBills();
  const filtered = all.filter(b => b.month === month);

  // If month has no bills yet, we can clone standard templates from previous month
  if (filtered.length === 0 && month !== '2026-10') {
    const octBills = all.filter(b => b.month === '2026-10');
    if (octBills.length > 0) {
      const cloned: MonthlyBill[] = octBills.map(b => ({
        ...b,
        id: `bill-${b.name.toLowerCase()}-${month}`,
        month,
        daily_allocations: {},
        status: 'PENDING',
        paid_at: undefined,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
      for (const bill of cloned) {
        await saveMonthlyBill(bill);
      }
      return cloned;
    }
  }

  return filtered;
}

/**
 * Save or update a monthly bill.
 */
export async function saveMonthlyBill(bill: MonthlyBill): Promise<void> {
  const all = await getAllMonthlyBills();
  const idx = all.findIndex(b => b.id === bill.id);

  // Recalculate status based on collections
  const totalCollected = Object.values(bill.daily_allocations || {}).reduce((s, a) => s + (Number(a) || 0), 0);
  let status: MonthlyBill['status'] = bill.status;
  if (bill.status !== 'PAID') {
    if (totalCollected >= bill.total_target_amount && bill.total_target_amount > 0) {
      status = 'FULLY_FUNDED';
    } else if (totalCollected > 0) {
      status = 'PARTIALLY_FUNDED';
    } else {
      status = 'PENDING';
    }
  }

  const updatedBill: MonthlyBill = {
    ...bill,
    status,
    updated_at: new Date().toISOString(),
  };

  if (idx >= 0) {
    all[idx] = updatedBill;
  } else {
    all.push(updatedBill);
  }

  localStorage.setItem(BILLS_STORAGE_KEY, JSON.stringify(all));

  // Sync to MySQL API if online
  try {
    if (typeof navigator === 'undefined' || navigator.onLine) {
      await api.post('/bills', updatedBill);
    }
  } catch {}
}

/**
 * Delete a monthly bill.
 */
export async function deleteMonthlyBill(id: string): Promise<void> {
  const all = await getAllMonthlyBills();
  const filtered = all.filter(b => b.id !== id);
  localStorage.setItem(BILLS_STORAGE_KEY, JSON.stringify(filtered));

  try {
    if (typeof navigator === 'undefined' || navigator.onLine) {
      await api.delete(`/bills/${id}`);
    }
  } catch {}
}

/**
 * Update daily allocation for a bill.
 */
export async function updateDailyAllocation(billId: string, day: number, amount: number): Promise<MonthlyBill> {
  const all = await getAllMonthlyBills();
  const bill = all.find(b => b.id === billId);
  if (!bill) throw new Error('Bill not found: ' + billId);

  const cleanAmount = Math.max(0, Number(amount) || 0);
  const updatedAllocations = { ...bill.daily_allocations };
  if (cleanAmount === 0) {
    delete updatedAllocations[day];
  } else {
    updatedAllocations[day] = cleanAmount;
  }

  bill.daily_allocations = updatedAllocations;
  await saveMonthlyBill(bill);
  return bill;
}

/**
 * Automatically allocate the daily obligation for all bills of a month on a given day.
 */
export async function autoAllocateDay(month: string, day: number): Promise<MonthlyBill[]> {
  const bills = await getBillsByMonth(month);
  for (const b of bills) {
    const allocations = { ...b.daily_allocations };
    allocations[day] = b.daily_obligation;
    b.daily_allocations = allocations;
    await saveMonthlyBill(b);
  }
  return getBillsByMonth(month);
}

/**
 * Get total daily bill allocations for a specific date (YYYY-MM-DD).
 */
export async function getDailyBillsTotalForDate(dateStr: string): Promise<number> {
  const month = dateStr.slice(0, 7); // YYYY-MM
  const day = parseInt(dateStr.slice(8, 10), 10);
  const bills = await getBillsByMonth(month);
  return bills.reduce((sum, b) => sum + (b.daily_allocations[day] || 0), 0);
}

/**
 * Get the initial capital config.
 */
export async function getInitialCapitalConfig(): Promise<InitialCapitalConfig> {
  const raw = localStorage.getItem(CAPITAL_STORAGE_KEY);
  if (!raw) {
    localStorage.setItem(CAPITAL_STORAGE_KEY, JSON.stringify(DEFAULT_CAPITAL_CONFIG));
    return DEFAULT_CAPITAL_CONFIG;
  }
  try {
    return JSON.parse(raw) as InitialCapitalConfig;
  } catch {
    return DEFAULT_CAPITAL_CONFIG;
  }
}

/**
 * Save initial capital config.
 */
export async function saveInitialCapitalConfig(config: InitialCapitalConfig): Promise<void> {
  const cleanConfig = {
    ...config,
    updated_at: new Date().toISOString(),
  };
  localStorage.setItem(CAPITAL_STORAGE_KEY, JSON.stringify(cleanConfig));
}

/**
 * Calculate Return on Investment (ROI) analytics in real time.
 */
export async function calculateROIData() {
  const config = await getInitialCapitalConfig();
  const allClosings = await getAllDailyClosings();

  // Net Profit earned across all closed shifts
  const totalNetProfit = allClosings.reduce((sum, c) => {
    const net = c.total_gross_profit - c.total_spoilage_loss;
    return sum + net;
  }, 0);

  const initialCapital = config.total_capital || 0;
  const remainingCapital = Math.max(0, initialCapital - totalNetProfit);
  const roiPercent = initialCapital > 0 ? Math.min(100, Math.round((totalNetProfit / initialCapital) * 1000) / 10) : 100;

  // Average daily net profit to project days remaining to break even
  const validDays = allClosings.filter(c => (c.total_gross_profit - c.total_spoilage_loss) > 0);
  const avgDailyProfit = validDays.length > 0 ? (totalNetProfit / validDays.length) : 0;
  const estimatedDaysToBreakEven = (avgDailyProfit > 0 && remainingCapital > 0) ? Math.ceil(remainingCapital / avgDailyProfit) : 0;

  return {
    initialCapital,
    totalNetProfit,
    remainingCapital,
    roiPercent,
    avgDailyProfit,
    estimatedDaysToBreakEven,
    items: config.items || [],
    startDate: config.business_start_date,
    closingsCount: allClosings.length,
  };
}
