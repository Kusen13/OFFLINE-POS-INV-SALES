import { create } from 'zustand';
import { getPendingSales, markSalesSynced, markSalesFailed, getSyncCounts, resetFailedSales, saveSale, getSaleByUuid } from '../../db/salesRepository';
import { upsertProducts, replaceAllCategories, replaceAllPaymentMethods, setLastProductSync, deleteLocalProduct, deleteLocalCategory } from '../../db/productRepository';
import { replaceAllExpenses, deleteLocalExpense } from '../../db/expenseRepository';
import { getPendingMutations, markMutationsSynced, markMutationsFailed, getPendingMutationCount } from '../../db/mutationRepository';
import { syncSalesToServer, fetchProductUpdates, syncMutationsToServer, fetchExpenseUpdates } from '../../api/sync';
import { fetchSales } from '../../api/endpoints';
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
  syncSales: () => Promise<void>;
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

      // 6. Download latest sales from server into IndexedDB (ensures phone/laptop have full sales record)
      set({ syncProgress: 'Syncing sales history...' });
      await get().syncSales();

      // 7. Update state
      set({
        lastSyncTime: new Date().toISOString(),
        lastError: null,
      });

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('pos_sync_completed'));
        try {
          const ch = new BroadcastChannel('pos_channel');
          ch.postMessage({ type: 'SYNC_COMPLETED' });
          ch.close();
        } catch (_) {}
      }

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

  syncSales: async () => {
    try {
      const salesRes = await fetchSales({ per_page: 200, with_items: true });
      if (salesRes.data && Array.isArray(salesRes.data)) {
        for (const s of salesRes.data) {
          if (!s.uuid) continue;
          const existing = await getSaleByUuid(s.uuid);
          // If not stored yet or pending, cache it locally with SYNCED status
          if (!existing) {
            await saveSale({
              uuid: s.uuid,
              receipt_number: s.receipt_number,
              items: s.items || [],
              subtotal: Number(s.subtotal) || 0,
              discount_amount: Number(s.discount_amount) || 0,
              tax_amount: Number(s.tax_amount) || 0,
              total_amount: Number(s.total_amount) || 0,
              cash_tendered: s.cash_tendered !== null && s.cash_tendered !== undefined ? Number(s.cash_tendered) : null,
              change_amount: s.change_amount !== null && s.change_amount !== undefined ? Number(s.change_amount) : null,
              payment_method_id: s.payment_method_id,
              payment_method_name: s.payment_method_name || 'Cash',
              payment_reference: s.payment_reference || null,
              source_device: s.source_device || 'server',
              notes: s.notes || null,
              sold_at: s.sold_at,
              sync_status: 'SYNCED',
              created_at: s.created_at,
            });
          }
        }
      }
    } catch (error) {
      console.warn('Failed to sync sales history:', error);
    }
  },

  syncProducts: async () => {
    try {
      // Always fetch complete fresh catalog so stocks and pricing are 100% accurate from MySQL
      const data = await fetchProductUpdates(null);

      if (data.products && data.products.length > 0) {
        await upsertProducts(data.products);
      }

      if (data.categories && data.categories.length > 0) {
        await replaceAllCategories(data.categories);
      }

      if (data.payment_methods && data.payment_methods.length > 0) {
        await replaceAllPaymentMethods(data.payment_methods);
      }

      await setLastProductSync(data.server_time);

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('pos_inventory_updated'));
        try {
          const ch = new BroadcastChannel('pos_channel');
          ch.postMessage({ type: 'INVENTORY_UPDATED' });
          ch.close();
        } catch (_) {}
      }
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
