import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { AppShell } from './components/layout/AppShell';
import { POSPage } from './pages/pos/POSPage';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { ProductsPage } from './pages/dashboard/ProductsPage';
import { CategoriesPage } from './pages/dashboard/CategoriesPage';
import { InventoryPage } from './pages/dashboard/InventoryPage';
import { SalesHistoryPage } from './pages/dashboard/SalesHistoryPage';
import { ExpensesPage } from './pages/dashboard/ExpensesPage';
import { SyncPage } from './pages/dashboard/SyncPage';
import { SettingsPage } from './pages/dashboard/SettingsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { useSyncStore } from './features/sync/syncStore';

function App() {
  const refreshCounts = useSyncStore(s => s.refreshCounts);

  // Load sync counts on app start
  useEffect(() => {
    refreshCounts();
  }, [refreshCounts]);

  return (
    <Routes>
      {/* POS - Main mobile ordering interface */}
      <Route path="/pos" element={<POSPage />} />

      {/* Dashboard - Wrapped in AppShell layout */}
      <Route element={<AppShell />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/categories" element={<CategoriesPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/sales" element={<SalesHistoryPage />} />
        <Route path="/expenses" element={<ExpensesPage />} />
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
