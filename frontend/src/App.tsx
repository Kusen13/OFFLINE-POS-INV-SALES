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

function App() {
  const refreshCounts = useSyncStore(s => s.refreshCounts);
  const checkServer = useSyncStore(s => s.checkServer);
  const syncProducts = useSyncStore(s => s.syncProducts);
  const syncExpenses = useSyncStore(s => s.syncExpenses);

  // Periodic background auto-sync + auto-prime offline IndexedDB cache
  useEffect(() => {
    // Seed default suppliers + order items on first run (non-blocking)
    seedDefaultData().catch(() => {});

    let isSyncing = false;
    const runAutoSync = async () => {
      if (isSyncing) return;
      isSyncing = true;
      try {
        const reachable = await checkServer();
        if (reachable) {
          await syncProducts();
          await syncExpenses();
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

    // 2. Poll every 12 seconds in background
    const timer = setInterval(runAutoSync, 12000);

    // 3. Immediately sync whenever phone screen unlocks or user returns to app
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        runAutoSync();
      }
    };
    const handleFocus = () => {
      runAutoSync();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
    };
  }, [refreshCounts, checkServer, syncProducts, syncExpenses]);

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
