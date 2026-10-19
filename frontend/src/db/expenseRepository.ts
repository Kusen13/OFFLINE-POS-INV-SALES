/**
 * Expense Repository - IndexedDB operations for cached expenses
 */

import { getDB } from './database';
import type { Expense } from '../types/inventory';

/**
 * Replace all cached expenses with fresh data from server
 */
export async function replaceAllExpenses(expenses: Expense[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('expenses', 'readwrite');
  
  // Keep pending offline items (negative IDs)
  const allCurrent = await tx.store.getAll();
  const pendingOffline = allCurrent.filter(e => e.id < 0 || (e as any).is_pending);

  await tx.store.clear();
  for (const exp of expenses) {
    await tx.store.put(exp);
  }
  for (const pending of pendingOffline) {
    await tx.store.put(pending);
  }
  await tx.done;
}

/**
 * Get all cached expenses sorted by date descending
 */
export async function getAllExpenses(): Promise<(Expense & { is_pending?: boolean })[]> {
  const db = await getDB();
  const all = await db.getAll('expenses');
  return all.sort((a, b) => new Date(b.expense_date).getTime() - new Date(a.expense_date).getTime() || b.id - a.id);
}

/**
 * Save or update a single expense locally in IndexedDB
 */
export async function saveLocalExpense(expense: Expense & { is_pending?: boolean }): Promise<void> {
  const db = await getDB();
  await db.put('expenses', expense);
}

/**
 * Delete an expense locally in IndexedDB
 */
export async function deleteLocalExpense(id: number): Promise<void> {
  const db = await getDB();
  await db.delete('expenses', id);
}
