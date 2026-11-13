export interface NavItem {
  path: string;
  label: string;
  icon: string;
  desc?: string;
  group?: 'SALES' | 'OPERATIONS' | 'CATALOG' | 'FINANCE' | 'SYSTEM';
  hideFromSidebar?: boolean;
  ownerOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  // ── 1. Sales & POS ──────────────────────────────────────────
  { path: '/pos',       label: 'Point of Sale',          icon: '🛒', desc: 'Punch orders & cash checkout', group: 'SALES' },
  { path: '/customers', label: 'Credit & Receivables',   icon: '👥', desc: 'Suki accounts & debt collection', group: 'SALES' },
  { path: '/sales',     label: 'Sales History',          icon: '🧾', desc: 'Transaction records & receipts', group: 'SALES' },

  // ── 2. Daily Operations ──────────────────────────────────────
  { path: '/closing',   label: 'Daily Closing',          icon: '⚖️', desc: 'Cash count & shift balancing', group: 'OPERATIONS' },
  { path: '/reorder',   label: 'Re-order Sheet',         icon: '📋', desc: 'Daily stock replenishment', group: 'OPERATIONS', ownerOnly: true },

  // ── 3. Catalog & Inventory ───────────────────────────────────
  { path: '/products',  label: 'Products & Pricing',     icon: '🏷️', desc: 'Product catalog & margins', group: 'CATALOG', ownerOnly: true },
  { path: '/inventory', label: 'Inventory & Stock',      icon: '📦', desc: 'Stock levels & adjustments', group: 'CATALOG', ownerOnly: true },
  { path: '/suppliers', label: 'Suppliers',              icon: '🚚', desc: 'Vendors & suppliers directory', group: 'CATALOG', ownerOnly: true },
  { path: '/prices',    label: 'Price Update',           icon: '💲', desc: 'Bulk price editor', group: 'CATALOG', hideFromSidebar: true, ownerOnly: true },
  { path: '/categories',label: 'Categories',             icon: '🗂️', desc: 'Menu grouping & sorting', group: 'CATALOG', hideFromSidebar: true, ownerOnly: true },

  // ── 4. Finance & Reports ─────────────────────────────────────
  { path: '/dashboard', label: 'Dashboard',              icon: '📊', desc: 'Overview, analytics & charts', group: 'FINANCE', ownerOnly: true },
  { path: '/reports',   label: 'Financial Reports',      icon: '📈', desc: 'Income statement & profit', group: 'FINANCE', ownerOnly: true },
  { path: '/expenses',  label: 'Expenses',               icon: '💸', desc: 'Store opex & petty cash logs', group: 'FINANCE', ownerOnly: true },
  { path: '/bills',     label: 'Bills & Allocation',     icon: '🎯', desc: 'Operating bills & capital fund', group: 'FINANCE', ownerOnly: true },

  // ── 5. System ────────────────────────────────────────────────
  { path: '/sync',      label: 'Sync Center',            icon: '🔄', desc: 'Offline queue & server status', group: 'SYSTEM' },
  { path: '/settings',  label: 'Settings',               icon: '⚙️', desc: 'Store information & preferences', group: 'SYSTEM', ownerOnly: true },
];

export const NAV_GROUPS = [
  { key: 'SALES' as const,      label: 'Sales & POS',          icon: '🛍️' },
  { key: 'OPERATIONS' as const, label: 'Daily Operations',     icon: '🏬' },
  { key: 'CATALOG' as const,    label: 'Catalog & Inventory',  icon: '🗃️' },
  { key: 'FINANCE' as const,    label: 'Finance & Reports',    icon: '💰' },
  { key: 'SYSTEM' as const,     label: 'System & Settings',    icon: '🖥️' },
];

