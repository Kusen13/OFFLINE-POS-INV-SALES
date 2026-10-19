/**
 * Sales Repository - IndexedDB operations for offline sales
 * 
 * Every sale is stored as a complete atomic document (header + items + payment).
 * This ensures no partial sales can exist even if the app crashes mid-write.
 */

import { getDB } from './database';
import type { PendingSale } from '../types/sale';
import type { SyncStatus as SyncStatusType } from '../types/sale';

/**
 * Save a new sale to IndexedDB
 * This is an atomic write — the entire sale (header + items) is one document
 */
export async function saveSale(sale: PendingSale): Promise<void> {
  const db = await getDB();
  await db.put('pendingSales', sale);
}

/**
 * Get all pending (unsynced) sales
 */
export async function getPendingSales(): Promise<PendingSale[]> {
  const db = await getDB();
  return db.getAllFromIndex('pendingSales', 'by-status', 'PENDING');
}

/**
 * Get all sales (any status)
 */
export async function getAllSales(): Promise<PendingSale[]> {
  const db = await getDB();
  const sales = await db.getAll('pendingSales');
  // Sort by sold_at descending
  return sales.sort((a, b) => new Date(b.sold_at).getTime() - new Date(a.sold_at).getTime());
}

/**
 * Get failed sales
 */
export async function getFailedSales(): Promise<PendingSale[]> {
  const db = await getDB();
  return db.getAllFromIndex('pendingSales', 'by-status', 'FAILED');
}

/**
 * Get a specific sale by UUID
 */
export async function getSaleByUuid(uuid: string): Promise<PendingSale | undefined> {
  const db = await getDB();
  return db.get('pendingSales', uuid);
}

/**
 * Update the sync status of a sale
 */
export async function updateSaleStatus(
  uuid: string, 
  status: SyncStatusType, 
  error?: string
): Promise<void> {
  const db = await getDB();
  const sale = await db.get('pendingSales', uuid);
  if (sale) {
    sale.sync_status = status;
    if (error) sale.sync_error = error;
    if (status === 'SYNCED') sale.synced_at = new Date().toISOString();
    await db.put('pendingSales', sale);
  }
}

/**
 * Mark multiple sales as synced
 */
export async function markSalesSynced(uuids: string[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('pendingSales', 'readwrite');
  
  for (const uuid of uuids) {
    const sale = await tx.store.get(uuid);
    if (sale) {
      sale.sync_status = 'SYNCED';
      sale.synced_at = new Date().toISOString();
      await tx.store.put(sale);
    }
  }
  
  await tx.done;
}

/**
 * Mark multiple sales as failed
 */
export async function markSalesFailed(
  failures: Array<{ uuid: string; error: string }>
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('pendingSales', 'readwrite');
  
  for (const { uuid, error } of failures) {
    const sale = await tx.store.get(uuid);
    if (sale) {
      sale.sync_status = 'FAILED';
      sale.sync_error = error;
      await tx.store.put(sale);
    }
  }
  
  await tx.done;
}

/**
 * Reset failed sales back to pending for retry
 */
export async function resetFailedSales(): Promise<number> {
  const db = await getDB();
  const failed = await db.getAllFromIndex('pendingSales', 'by-status', 'FAILED');
  const tx = db.transaction('pendingSales', 'readwrite');
  
  for (const sale of failed) {
    sale.sync_status = 'PENDING';
    sale.sync_error = undefined;
    await tx.store.put(sale);
  }
  
  await tx.done;
  return failed.length;
}

/**
 * Get counts by sync status
 */
export async function getSyncCounts(): Promise<{
  pending: number;
  synced: number;
  failed: number;
  total: number;
}> {
  const db = await getDB();
  const all = await db.getAll('pendingSales');
  
  const counts = { pending: 0, synced: 0, failed: 0, total: all.length };
  for (const sale of all) {
    if (sale.sync_status === 'PENDING') counts.pending++;
    else if (sale.sync_status === 'SYNCED') counts.synced++;
    else if (sale.sync_status === 'FAILED') counts.failed++;
  }
  
  return counts;
}

/**
 * Delete synced sales older than the given number of days
 * (Cleanup to prevent IndexedDB from growing indefinitely)
 */
export async function cleanupOldSyncedSales(daysToKeep: number = 30): Promise<number> {
  const db = await getDB();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  const cutoffStr = cutoffDate.toISOString();
  
  const all = await db.getAll('pendingSales');
  const tx = db.transaction('pendingSales', 'readwrite');
  let deleted = 0;
  
  for (const sale of all) {
    if (sale.sync_status === 'SYNCED' && sale.sold_at < cutoffStr) {
      await tx.store.delete(sale.uuid);
      deleted++;
    }
  }
  
  await tx.done;
  return deleted;
}

/**
 * Generate a unique receipt number
 * Format: POS-YYYYMMDD-XXXX (e.g., POS-20261019-0001)
 */
export async function generateReceiptNumber(): Promise<string> {
  const db = await getDB();
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `POS-${dateStr}-`;
  
  // Get all sales from today to find the highest sequence
  const all = await db.getAll('pendingSales');
  const todaySales = all.filter(s => s.receipt_number.startsWith(prefix));
  
  let maxSeq = 0;
  for (const sale of todaySales) {
    const seqStr = sale.receipt_number.slice(prefix.length);
    const seq = parseInt(seqStr, 10);
    if (seq > maxSeq) maxSeq = seq;
  }
  
  const nextSeq = (maxSeq + 1).toString().padStart(4, '0');
  return `${prefix}${nextSeq}`;
}
