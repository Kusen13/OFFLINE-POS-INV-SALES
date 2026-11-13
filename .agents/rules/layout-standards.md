# Marites POS Centralized Layout Rules & Standards

## 1. Core Design Philosophy
Layouts must be ultra-compact, high-density, professional, and clean—modeled after **Marites POS**. Information should be scannable at a glance on **any device (especially mobile viewports like iPhone 11 / 414px)** without unnecessary scrolling, bloated spacing, cut-off components, or information overload.

---

## 2. Rule 1: Pure Table First (No Bulky Cards in Management & Reconciliation Views)
- **Applicable Views**: Daily Closing (`/closing`), Price Management (`/prices`), Inventory Audit (`/inventory`), Sales Logs (`/sync`), Ledgers (`/customers`), and Reports (`/reports`).
- **Standard**:
  - Always use **pure, responsive tables** that adapt to mobile viewports without cutting off essential columns.
  - **Do NOT use bulky product cards** that consume 200–250px vertical height for a single item.
  - Users must be able to view and compare 10–25 items at once on any screen size.
  - Column headers must be concise, single-line, uppercase, and sticky (`sticky top-0 bg-surface-900 z-10`).

---

## 3. Rule 2: Full Viewport Utilization (Zero Dead Space)
- **Vertical Stretch**:
  - Every page container must use `flex-1 min-h-0 flex flex-col`.
  - The main table card must stretch and occupy all remaining vertical space (`flex-1 min-h-0 flex flex-col`).
  - Table rows scroll internally inside `overflow-y-auto` while headers remain fixed at the top and pagination / summaries remain pinned at the bottom edge.
- **Horizontal Adaptation**:
  - On mobile, streamline columns so they fit within the viewport (~360–414px) without horizontal clipping.

---

## 4. Rule 3: Consolidated Minimalist Toolbars (Max 2 Slim Rows, Zero Cut-offs)
- **Do not stack 4–7 separate cards and toolbars.**
- **Standard 2-Row Stack**:
  1. **Row 1 (Header & Primary Actions)**:
     - Left: Date Selector + Status Badge (`Draft` / `Closed`) + Auto-save indicator.
     - Right: Primary Action Buttons (`Save`, `Finalize` / `Re-open`) + `⋯` (More Actions menu).
     - **No Clutter Buttons**: Avoid bulky refresh (`🔄`) buttons on the main bar. Place secondary actions (Re-order Sheet, Print Thermal Z-Slip, Copy Summary, Recalculate) cleanly inside the `⋯` dropdown.
  2. **Row 2 (Category & Integrated Metric Ribbon)**:
     - Left: Compact Category dropdown (`📦 Barbeque (7) ▾`).
     - Center: Live inline KPI summary: `Sales: ₱0.00 • Profit: ₱0.00`.
     - Right: Single interactive Drawer Toggle Pill: `[✓ Kaha ▼]` (or `[-₱50 Kaha ▼]`).
     - When toggled, the 4-step drawer panel (with `🧮 Bilangan ng Kaha`) expands directly beneath Row 2.

---

## 5. Rule 4: Column Consolidation for Zero-Cutoff on Mobile
- To prevent columns from spilling off-screen on devices like iPhone 11 (414px), consolidate secondary metadata into existing columns:
  1. **Product Column Consolidation**:
     - Line 1: **Product Name** (bold, truncated on mobile if needed).
     - Line 2: Price & Previous Stock in distinct typography: `<span class="text-amber-400 font-bold">₱25.00</span> • <span class="text-surface-400">16 prev</span>`.
     - This eliminates separate standalone `PRICE` and `PREV` columns, saving ~100px.
  2. **Outcome Column Consolidation**:
     - Line 1: **Revenue** (bold text-surface-200, e.g. `₱400.00`).
     - Line 2: **Gross Profit** (emerald-400 font-semibold text-[10px], e.g. `+₱150.00`).
     - This merges `REVENUE` and `PROFIT` into a single `TOTAL` column.
  3. **Total Columns Target**: Maintain 7 to 8 columns max so all vital inputs (`ORD`, `PREP`, `SOLD`, `TRAY`, `SPOIL`, `DISC`, `TOTAL`) fit completely on mobile at first glance.

---

## 6. Rule 5: High-Density Table Cell Inputs
- Cell inputs (for counts, quantities, ordered, sold, spoilage) must be compact and centered:
  - Height: `h-7` (28px).
  - Width: `w-9` to `w-12` (36–48px) depending on decimals.
  - Font: `font-bold text-xs text-center`.
  - Styling: `rounded bg-surface-800 border border-surface-600 focus:outline-none focus:border-primary-400`.
  - Auto-select on focus/click for rapid data entry.

---

## 7. Rule 6: Clean Integer Sanitation (No `.0000` Trailing Decimals)
- Quantities for countable items (sticks, packs, bottles, cans) must never display database floating-point strings like `16.0000` or `5.000`.
- Always wrap quantities with `safeQty(val, isWeight)`:
  - If stick/retail: displays clean integers (`16`, `5`, `0`).
  - If weight (kg): displays 3 decimals (`2.500`).
