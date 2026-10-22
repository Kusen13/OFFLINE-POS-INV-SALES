/**
 * OrderItem Types
 *
 * Represents items that are ORDERED/PURCHASED from suppliers.
 * These are SEPARATE from Products (which are items sold at POS).
 *
 * Example:
 *   - Product:   "Pork BBQ"      (sold at POS for ₱25)
 *   - OrderItem: "Pork BBQ Stick" (bought from BBQ Supplier for ₱15/stick)
 *   - OrderItem: "Hotdog"         (bought from Meycauayan Market for ₱8/pc)
 *   - OrderItem: "Uling"          (bought from BBQ Supplier in kilos)
 */

export interface OrderItem {
  id: string;                   // uuid
  name: string;                 // e.g. "Pork BBQ Stick", "Hotdog", "Uling"
  supplier_id: string;          // FK to Supplier.id
  supplier_name: string;        // Denormalized for display
  unit: string;                 // e.g. "sticks", "pcs", "kg", "packs", "bottle"
  cost_price: number;           // Unit cost from supplier (e.g. 15.00/stick)
  target_qty: number;           // Daily prep/target quantity (e.g. 31 sticks)
  current_stock?: number;       // Optional: remaining stock
  min_stock?: number;           // Optional: re-order trigger threshold
  notes?: string;               // Optional notes
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type OrderItemFormData = Omit<OrderItem, 'id' | 'created_at' | 'updated_at'>;
