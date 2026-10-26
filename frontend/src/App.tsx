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
import { ExpensesPage } from './pages/dashboard/ExpensesPage';
import { BillsPage } from './pages/dashboard/BillsPage';
import { ReportsPage } from './pages/dashboard/ReportsPage';
import { SyncPage } from './pages/dashboard/SyncPage';
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
    const runAutoSync = async () => {
      if (isSyncing) return;
      isSyncing = true;
      try {
        const reachable = await checkServer();
        if (reachable) {
          // If there are pending sales or mutations from offline moments, auto-flush them now!
          const counts = useSyncStore.getState();
          if (counts.pendingCount > 0) {
            await performSync();
          } else {
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
    runAutoSync();

    // 2. Poll every 10 seconds in background
    const timer = setInterval(runAutoSync, 10000);

    // 3. Immediately auto-flush whenever the device reconnects to Wi-Fi / network
    const handleOnline = () => {
      runAutoSync();
    };

    // 4. Immediately sync whenever phone screen unlocks or user returns to app
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        runAutoSync();
      }
    };
    const handleFocus = () => {
      runAutoSync();
    };

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(timer);
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
    };
  }, [refreshCounts, checkServer, syncProducts, syncExpenses, performSync]);

  return (
    <Routes>
      {/* All Application Pages Wrapped in Unified AppShell */}
      <Route element={<AppShell />}>
        <Route path="/pos" element={<POSPage />} />
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
