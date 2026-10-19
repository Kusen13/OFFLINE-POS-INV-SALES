/**
 * Sync Store - manages sync state and operations
 */

import { create } from 'zustand';
import { getPendingSales, markSalesSynced, markSalesFailed, getSyncCounts, resetFailedSales } from '../../db/salesRepository';
import { replaceAllProducts, replaceAllCategories, replaceAllPaymentMethods, setLastProductSync, getLastProductSync } from '../../db/productRepository';
import { syncSalesToServer, fetchProductUpdates } from '../../api/sync';
import { checkServerHealth } from '../../api/client';

interface SyncState {
  isSyncing: boolean;
  lastSyncTime: string | null;
  serverReachable: boolean;
  pendingCount: number;
  syncedCount: number;
  failedCount: number;
  lastError: string | null;
  syncProgress: string;

  // Actions
  performSync: () => Promise<void>;
  refreshCounts: () => Promise<void>;
  checkServer: () => Promise<boolean>;
  retryFailed: () => Promise<void>;
  syncProducts: () => Promise<void>;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  isSyncing: false,
  lastSyncTime: null,
  serverReachable: false,
  pendingCount: 0,
  syncedCount: 0,
  failedCount: 0,
  lastError: null,
  syncProgress: '',

  refreshCounts: async () => {
    const counts = await getSyncCounts();
    set({
      pendingCount: counts.pending,
      syncedCount: counts.synced,
      failedCount: counts.failed,
    });
  },

  checkServer: async () => {
    const reachable = await checkServerHealth();
    set({ serverReachable: reachable });
    return reachable;
  },

  performSync: async () => {
    const state = get();
    if (state.isSyncing) return;

    set({ isSyncing: true, lastError: null, syncProgress: 'Checking server...' });

    try {
      // 1. Check server health
      const reachable = await checkServerHealth();
      set({ serverReachable: reachable });

      if (!reachable) {
        set({ 
          lastError: 'Server is not reachable. Ensure the laptop is on and both devices are on the same network.',
          isSyncing: false,
          syncProgress: '',
        });
        return;
      }

      // 2. Get pending sales
      set({ syncProgress: 'Gathering pending sales...' });
      const pendingSales = await getPendingSales();

      if (pendingSales.length === 0) {
        set({ syncProgress: 'Syncing products...' });
        // Still sync products even if no sales to send
        await get().syncProducts();
        set({ 
          isSyncing: false, 
          syncProgress: '',
          lastSyncTime: new Date().toISOString(),
        });
        await get().refreshCounts();
        return;
      }

      // 3. Send sales to server
      set({ syncProgress: `Syncing ${pendingSales.length} sale(s)...` });
      const result = await syncSalesToServer(pendingSales);

      // 4. Update local statuses based on server response
      if (result.synced.length > 0 || result.duplicates.length > 0) {
        const syncedUuids = [
          ...result.synced.map(s => s.uuid),
          ...result.duplicates.map(d => d.uuid),
        ];
        await markSalesSynced(syncedUuids);
      }

      if (result.failed.length > 0) {
        await markSalesFailed(result.failed.map(f => ({ uuid: f.uuid, error: f.error })));
      }

      // 5. Sync products from server
      set({ syncProgress: 'Syncing products...' });
      await get().syncProducts();

      // 6. Update state
      set({
        lastSyncTime: new Date().toISOString(),
        lastError: result.failed_count > 0
          ? `${result.failed_count} sale(s) failed to sync. Check sync history for details.`
          : null,
      });

      await get().refreshCounts();

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed unexpectedly';
      set({ lastError: message });
    } finally {
      set({ isSyncing: false, syncProgress: '' });
    }
  },

  retryFailed: async () => {
    const count = await resetFailedSales();
    if (count > 0) {
      await get().refreshCounts();
      await get().performSync();
    }
  },

  syncProducts: async () => {
    try {
      const lastSync = await getLastProductSync();
      const data = await fetchProductUpdates(lastSync);

      if (data.products.length > 0) {
        if (data.is_incremental) {
          // For incremental, we'd upsert, but for simplicity do full replace
          // since incremental sync of IndexedDB is complex
        }
        await replaceAllProducts(data.products);
      }

      if (data.categories.length > 0) {
        await replaceAllCategories(data.categories);
      }

      if (data.payment_methods.length > 0) {
        await replaceAllPaymentMethods(data.payment_methods);
      }

      await setLastProductSync(data.server_time);
    } catch (error) {
      console.error('Failed to sync products:', error);
      // Don't throw — product sync failure shouldn't block sale sync
    }
  },
}));
