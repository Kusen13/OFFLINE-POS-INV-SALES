/**
 * Mutation Repository - IndexedDB operations for queued offline mutations
 */

import { getDB, type PendingMutation } from './database';
import { generateUUID } from '../utils/uuid';

export type { PendingMutation };

/**
 * Add a pending mutation to the offline queue
 */
export async function addPendingMutation(
  mutation: Omit<PendingMutation, 'id' | 'status' | 'created_at'>
): Promise<PendingMutation> {
  const db = await getDB();
  const m: PendingMutation = {
    ...mutation,
    id: generateUUID(),
    status: 'PENDING',
    created_at: new Date().toISOString(),
  };
  await db.put('pendingMutations', m);
  return m;
}

/**
 * Get all pending mutations
 */
export async function getPendingMutations(): Promise<PendingMutation[]> {
  const db = await getDB();
  const all = await db.getAll('pendingMutations');
  return all.filter(m => m.status === 'PENDING');
}

/**
 * Mark mutations as synced (removes them from queue)
 */
export async function markMutationsSynced(uuids: string[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('pendingMutations', 'readwrite');
  for (const uuid of uuids) {
    await tx.store.delete(uuid);
  }
  await tx.done;
}

/**
 * Mark mutations as failed
 */
export async function markMutationsFailed(failed: { uuid: string; error: string }[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('pendingMutations', 'readwrite');
  for (const f of failed) {
    const item = await tx.store.get(f.uuid);
    if (item) {
      item.status = 'FAILED';
      item.errorMessage = f.error;
      await tx.store.put(item);
    }
  }
  await tx.done;
}

/**
 * Remove a mutation by temp ID (used if user deletes an offline item before syncing)
 */
export async function removeMutationByTempId(tempId: number): Promise<void> {
  const db = await getDB();
  const all = await db.getAll('pendingMutations');
  const target = all.find(m => m.tempId === tempId);
  if (target) {
    await db.delete('pendingMutations', target.id);
  }
}

/**
 * Get total pending mutation count
 */
export async function getPendingMutationCount(): Promise<number> {
  const db = await getDB();
  const all = await db.getAll('pendingMutations');
  return all.filter(m => m.status === 'PENDING').length;
}
