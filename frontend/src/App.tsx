import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { AppShell } from './components/layout/AppShell';
import { POSPage } from './pages/pos/POSPage';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { ProductsPage } from './pages/dashboard/ProductsPage';
import { CategoriesPage } from './pages/dashboard/CategoriesPage';
import { InventoryPage } from './pages/dashboard/InventoryPage';
import { SuppliersPage } from './pages/dashboard/SuppliersPage';
import { DailyClosingPage } from './pages/dashboard/DailyClosingPage';
import { ReorderPage } from './pages/dashboard/ReorderPage';
import { SalesHistoryPage } from './pages/dashboard/SalesHistoryPage';
import { CustomersPage } from './pages/dashboard/CustomersPage';
import { ExpensesPage } from './pages/dashboard/ExpensesPage';
import { BillsPage } from './pages/dashboard/BillsPage';
import { ReportsPage } from './pages/dashboard/ReportsPage';
import { SyncPage } from './pages/dashboard/SyncPage';
import { PricePage } from './pages/dashboard/PricePage';
import { SettingsPage } from './pages/dashboard/SettingsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { useSyncStore } from './features/sync/syncStore';
import { seedDefaultData } from './db/seedData';
import { clearFailedSales } from './db/salesRepository';
import { clearFailedMutations } from './db/mutationRepository';

function App() {
  const refreshCounts = useSyncStore(s => s.refreshCounts);
  const checkServer = useSyncStore(s => s.checkServer);
  const syncProducts = useSyncStore(s => s.syncProducts);
  const syncExpenses = useSyncStore(s => s.syncExpenses);
  const performSync = useSyncStore(s => s.performSync);

  // Periodic background auto-sync + auto-prime offline IndexedDB cache
  useEffect(() => {
    // Seed default suppliers + order items on first run (non-blocking)
    seedDefaultData().catch(() => {});

    // Automatically purge any stuck failed sales or mutations from earlier test attempts
    Promise.all([
      clearFailedSales(),
      clearFailedMutations(),
    ]).then(([s, m]) => {
      if (s > 0 || m > 0) {
        refreshCounts();
      }
    }).catch(() => {});

    let isSyncing = false;
    let lastAutoSyncAt = 0;

    const runAutoSync = async (force = false) => {
      const now = Date.now();
      // Throttle: don't auto-sync if one ran less than 30 seconds ago unless forced
      if (!force && now - lastAutoSyncAt < 30000) return;
      if (isSyncing) return;

      isSyncing = true;
      lastAutoSyncAt = now;
      try {
        const reachable = await checkServer();
        if (reachable) {
          // If there are pending sales or mutations from offline moments, auto-flush them now!
          const counts = useSyncStore.getState();
          if (counts.pendingCount > 0) {
            await performSync();
          } else {
            // Periodic background catalog refresh
            await syncProducts();
            await syncExpenses();
          }
          await refreshCounts();
        }
      } catch (_) {
        // Silently skip if offline or connection hiccup
      } finally {
        isSyncing = false;
      }
    };

    // 1. Initial run on mount
    refreshCounts();
    runAutoSync(true);

    // 2. Poll every 60 seconds in background (safe, non-glitchy interval)
    const timer = setInterval(() => runAutoSync(false), 60000);

    // 3. Auto-flush when device reconnects to Wi-Fi / network
    const handleOnline = () => {
      runAutoSync(true);
    };

    // 4. Check on screen unlock or returning to app (throttled)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        runAutoSync(false);
      }
    };

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(timer);
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refreshCounts, checkServer, syncProducts, syncExpenses, performSync]);

  return (
    <Routes>
      {/* All Application Pages Wrapped in Unified AppShell */}
      <Route element={<AppShell />}>
        <Route path="/pos" element={<POSPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/categories" element={<CategoriesPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/closing" element={<DailyClosingPage />} />
        <Route path="/reorder" element={<ReorderPage />} />
        <Route path="/sales" element={<SalesHistoryPage />} />
        <Route path="/expenses" element={<ExpensesPage />} />
        <Route path="/bills" element={<BillsPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/prices" element={<PricePage />} />
        <Route path="/sync" element={<SyncPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>

      {/* Default redirect - mobile goes to POS, desktop to dashboard */}
      <Route path="/" element={<SmartRedirect />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

/**
 * Redirect based on screen size:
 * Mobile/tablet → POS, Desktop → Dashboard
 */
function SmartRedirect() {
  const isMobile = window.innerWidth < 1024;
  return <Navigate to={isMobile ? '/pos' : '/dashboard'} replace />;
}

export default App;
