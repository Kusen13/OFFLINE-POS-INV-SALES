/**
 * Sync API - endpoints for mobile-server synchronization
 */

import { api } from './client';
import type { SyncResult, SyncProductsResponse, SyncStatus } from '../types/sync';
import type { PendingSale } from '../types/sale';

/**
 * Send batch of pending sales to the server
 */
export async function syncSalesToServer(sales: PendingSale[]): Promise<SyncResult> {
  const response = await api.post<{ success: boolean; data: SyncResult }>(
    '/sync/sales',
    { sales },
    30000 // 30 second timeout for batch operations
  );
  return response.data;
}

/**
 * Fetch product catalog updates from server
 * @param since - ISO timestamp for incremental sync (optional)
 */
export async function fetchProductUpdates(since?: string | null): Promise<SyncProductsResponse> {
  const params = since ? `?since=${encodeURIComponent(since)}` : '';
  const response = await api.get<{ success: boolean; data: SyncProductsResponse }>(
    `/sync/products${params}`
  );
  return response.data;
}

/**
 * Get sync status from server
 */
export async function fetchSyncStatus(): Promise<SyncStatus> {
  const response = await api.get<{ success: boolean; data: SyncStatus }>('/sync/status');
  return response.data;
}
