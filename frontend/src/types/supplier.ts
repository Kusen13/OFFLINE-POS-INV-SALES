/**
 * Supplier Types
 *
 * Represents external suppliers / resellers from whom we order items.
 * Separate from Products (which are the items sold at POS).
 */

export interface Supplier {
  id: string;           // uuid
  name: string;         // e.g. "BBQ Supplier", "Palengke - Ate Rosa"
  contact_person: string; // e.g. "Juan dela Cruz"
  phone: string;        // e.g. "09XX-XXX-XXXX"
  address: string;      // e.g. "Brgy. Sta. Cruz, Marikina"
  email?: string;
  notes?: string;       // e.g. "Every morning, 7am delivery"
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type SupplierFormData = Omit<Supplier, 'id' | 'created_at' | 'updated_at'>;
