import { create } from 'zustand';
import { getPendingSales, markSalesSynced, markSalesFailed, getSyncCounts, resetFailedSales } from '../../db/salesRepository';
import { replaceAllProducts, replaceAllCategories, replaceAllPaymentMethods, setLastProductSync, getLastProductSync, deleteLocalProduct, deleteLocalCategory } from '../../db/productRepository';
import { replaceAllExpenses, deleteLocalExpense } from '../../db/expenseRepository';
import { getPendingMutations, markMutationsSynced, markMutationsFailed, getPendingMutationCount } from '../../db/mutationRepository';
import { syncSalesToServer, fetchProductUpdates, syncMutationsToServer, fetchExpenseUpdates } from '../../api/sync';
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
  syncExpenses: () => Promise<void>;
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
    const mutationCount = await getPendingMutationCount();
    set({
      pendingCount: counts.pending + mutationCount,
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

      // 2. Sync pending sales
      set({ syncProgress: 'Gathering pending sales...' });
      const pendingSales = await getPendingSales();

      if (pendingSales.length > 0) {
        set({ syncProgress: `Syncing ${pendingSales.length} sale(s)...` });
        const result = await syncSalesToServer(pendingSales);

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
      }

      // 3. Sync pending mutations (expenses, products, categories)
      set({ syncProgress: 'Gathering offline changes...' });
      const pendingMutations = await getPendingMutations();

      if (pendingMutations.length > 0) {
        set({ syncProgress: `Syncing ${pendingMutations.length} offline change(s)...` });
        const mutResult = await syncMutationsToServer(pendingMutations);

        if (mutResult.processed && mutResult.processed.length > 0) {
          await markMutationsSynced(mutResult.processed.map(m => m.uuid));

          // Clean up temp negative IDs now that server has created real records
          for (const item of mutResult.processed) {
            if (item.tempId && item.tempId < 0) {
              if (item.entity === 'expense') {
                await deleteLocalExpense(item.tempId);
              } else if (item.entity === 'product') {
                await deleteLocalProduct(item.tempId);
              } else if (item.entity === 'category') {
                await deleteLocalCategory(item.tempId);
              }
            }
          }
        }

        if (mutResult.failed && mutResult.failed.length > 0) {
          await markMutationsFailed(mutResult.failed);
        }
      }

      // 4. Download latest products & categories from server
      set({ syncProgress: 'Syncing products & categories...' });
      await get().syncProducts();

      // 5. Download latest expenses from server
      set({ syncProgress: 'Syncing expenses...' });
      await get().syncExpenses();

      // 6. Update state
      set({
        lastSyncTime: new Date().toISOString(),
        lastError: null,
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

      if (data.products && data.products.length > 0) {
        await replaceAllProducts(data.products);
      }

      if (data.categories && data.categories.length > 0) {
        await replaceAllCategories(data.categories);
      }

      if (data.payment_methods && data.payment_methods.length > 0) {
        await replaceAllPaymentMethods(data.payment_methods);
      }

      await setLastProductSync(data.server_time);
    } catch (error) {
      console.error('Failed to sync products:', error);
    }
  },

  syncExpenses: async () => {
    try {
      const data = await fetchExpenseUpdates();
      if (data.expenses && Array.isArray(data.expenses)) {
        await replaceAllExpenses(data.expenses);
      }
    } catch (error) {
      console.error('Failed to sync expenses:', error);
    }
  },
}));
