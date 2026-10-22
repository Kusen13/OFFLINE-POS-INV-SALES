export interface NavItem {
  path: string;
  label: string;
  icon: string;
  desc: string;
}

export const NAV_ITEMS: NavItem[] = [
  { path: '/pos', label: 'Point of Sale (POS)', icon: '🛒', desc: 'Punch orders & cash checkout' },
  { path: '/dashboard', label: 'Dashboard', icon: '📊', desc: 'Overview, analytics & charts' },
  { path: '/products', label: 'Products', icon: '📦', desc: 'Manage catalog & pricing' },
  { path: '/categories', label: 'Categories', icon: '🏷️', desc: 'Menu grouping & sorting' },
  { path: '/inventory', label: 'Inventory', icon: '📋', desc: 'Stock levels & adjustments' },
  { path: '/suppliers', label: 'Suppliers', icon: '🏪', desc: 'Listahan ng mga tinitindahan' },
  { path: '/closing', label: 'Daily Closing', icon: '⚖️', desc: 'Balancing ng benta, ihaw, at kaha' },
  { path: '/reorder', label: 'BBQ Re-order', icon: '🍢', desc: 'Araw-araw na pag-order batay sa natira' },
  { path: '/sales', label: 'Sales History', icon: '💰', desc: 'Receipts & transactions' },
  { path: '/expenses', label: 'Expenses', icon: '💸', desc: 'Track operational costs' },
  { path: '/bills', label: 'Bills & ROI', icon: '🎯', desc: 'Sinking fund para sa bills at puhunan' },
  { path: '/reports', label: 'Reports (P&L)', icon: '📈', desc: 'Income statement & net profit' },
  { path: '/sync', label: 'Sync Center', icon: '🔄', desc: 'Cloud/laptop synchronization' },
  { path: '/settings', label: 'Settings', icon: '⚙️', desc: 'Store info & preferences' },
];
