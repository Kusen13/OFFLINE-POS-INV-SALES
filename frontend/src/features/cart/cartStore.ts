/**
 * Cart Store - Zustand state management for POS cart
 * Supports integer-quantity items (BBQ sticks, grocery items) and by-weight decimal items (gulay, isda, bigas).
 * Now supports Retail vs Wholesale / Pakyawan 1-tap toggling!
 */

import { create } from 'zustand';
import type { CartItem } from '../../types/sale';
import type { Product } from '../../types/product';

export interface ParkedCart {
  id: string;
  parkedAt: string;
  items: CartItem[];
  customerName?: string;
  customerId?: number | null;
  total: number;
  itemCount: number;
  note?: string;
}

interface CartState {
  items: CartItem[];
  isWholesaleMode: boolean;
  parkedCarts: ParkedCart[];

  // Mode toggles
  setWholesaleMode: (isWholesale: boolean) => void;
  toggleWholesaleMode: () => void;
  toggleItemWholesale: (productId: number) => void;

  // Custom / Open Item
  addCustomItem: (name: string, price: number, quantity?: number) => void;

  // Park / Hold Cart
  parkCurrentCart: (customerName?: string, customerId?: number | null, note?: string) => boolean;
  recallParkedCart: (id: string) => void;
  removeParkedCart: (id: string) => void;

  // Standard per-piece actions
  addItem: (product: Product, quantity?: number) => void;
  /** Add a by-weight item: weightKg is the entered decimal weight (e.g. 1.5 kg) */
  addItemByWeight: (product: Product, weightKg: number) => void;
  removeItem: (productId: number) => void;
  updateQuantity: (productId: number, quantity: number) => void;
  incrementItem: (productId: number) => void;
  decrementItem: (productId: number) => void;
  clearCart: () => void;

  // Computed
  getItemCount: () => number;
  getSubtotal: () => number;
}

function loadParkedCartsFromStorage(): ParkedCart[] {
  try {
    const raw = localStorage.getItem('pos_parked_carts');
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function saveParkedCartsToStorage(carts: ParkedCart[]) {
  try {
    localStorage.setItem('pos_parked_carts', JSON.stringify(carts));
  } catch (_) {}
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  isWholesaleMode: false,
  parkedCarts: loadParkedCartsFromStorage(),

  addCustomItem: (name: string, price: number, quantity: number = 1) => {
    const customId = -Math.floor(Date.now() + Math.random() * 1000);
    const lineTotal = parseFloat((quantity * price).toFixed(2));
    const newItem: CartItem = {
      product_id: customId,
      product_name: name.trim() || 'Custom Item',
      product_sku: 'CUSTOM',
      unit_price: price,
      unit_cost: 0,
      quantity,
      line_total: lineTotal,
      sell_by_weight: false,
      is_wholesale: false,
      retail_price: price,
      wholesale_price: price,
    };
    set(state => ({ items: [...state.items, newItem] }));
  },

  parkCurrentCart: (customerName?: string, customerId?: number | null, note?: string) => {
    const state = get();
    if (state.items.length === 0) return false;
    const newParked: ParkedCart = {
      id: 'PARK-' + Date.now().toString(36).toUpperCase(),
      parkedAt: new Date().toISOString(),
      items: [...state.items],
      customerName,
      customerId,
      total: state.getSubtotal(),
      itemCount: state.getItemCount(),
      note,
    };
    const updated = [newParked, ...state.parkedCarts];
    saveParkedCartsToStorage(updated);
    set({ items: [], parkedCarts: updated });
    return true;
  },

  recallParkedCart: (id: string) => {
    const state = get();
    const target = state.parkedCarts.find(c => c.id === id);
    if (!target) return;
    const updated = state.parkedCarts.filter(c => c.id !== id);
    saveParkedCartsToStorage(updated);
    set({ items: target.items, parkedCarts: updated });
  },

  removeParkedCart: (id: string) => {
    const state = get();
    const updated = state.parkedCarts.filter(c => c.id !== id);
    saveParkedCartsToStorage(updated);
    set({ parkedCarts: updated });
  },

  setWholesaleMode: (isWholesale: boolean) => {
    set((state) => {
      const newItems = state.items.map(item => {
        if (!item.wholesale_price || item.wholesale_price === item.retail_price) return item;
        const newUnitPrice = isWholesale ? item.wholesale_price : (item.retail_price ?? item.unit_price);
        return {
          ...item,
          is_wholesale: isWholesale,
          unit_price: newUnitPrice,
          line_total: parseFloat((item.quantity * newUnitPrice).toFixed(2)),
        };
      });
      return { isWholesaleMode: isWholesale, items: newItems };
    });
  },

  toggleWholesaleMode: () => {
    get().setWholesaleMode(!get().isWholesaleMode);
  },

  toggleItemWholesale: (productId: number) => {
    set((state) => ({
      items: state.items.map(item => {
        if (item.product_id !== productId) return item;
        if (!item.wholesale_price || item.wholesale_price === item.retail_price) return item;
        const willBeWholesale = !item.is_wholesale;
        const newUnitPrice = willBeWholesale ? item.wholesale_price : (item.retail_price ?? item.unit_price);
        return {
          ...item,
          is_wholesale: willBeWholesale,
          unit_price: newUnitPrice,
          line_total: parseFloat((item.quantity * newUnitPrice).toFixed(2)),
        };
      }),
    }));
  },

  addItem: (product: Product, quantity: number = 1) => {
    set((state) => {
      const hasWholesalePrice = !!product.reseller_price && product.reseller_price > 0;
      const isWholesale = state.isWholesaleMode && hasWholesalePrice;
      const unitPrice = isWholesale ? (product.reseller_price ?? product.selling_price) : product.selling_price;
      const existing = state.items.find(i => i.product_id === product.id);

      if (existing) {
        const newQty = existing.quantity + quantity;
        return {
          items: state.items.map(i =>
            i.product_id === product.id
              ? {
                  ...i,
                  quantity: newQty,
                  line_total: parseFloat((newQty * i.unit_price).toFixed(2)),
                }
              : i
          ),
        };
      }

      const newItem: CartItem = {
        product_id: product.id,
        product_name: product.name,
        product_sku: product.sku,
        unit_price: unitPrice,
        unit_cost: product.cost_price,
        quantity,
        line_total: parseFloat((quantity * unitPrice).toFixed(2)),
        image_path: product.image_path,
        sell_by_weight: false,
        is_wholesale: isWholesale,
        retail_price: product.selling_price,
        wholesale_price: hasWholesalePrice ? product.reseller_price : product.selling_price,
      };

      return { items: [...state.items, newItem] };
    });
  },

  addItemByWeight: (product: Product, weightKg: number) => {
    // For by-weight items: quantity = weightKg, unit_price = price per kg
    const unit = product.unit || 'kg';

    set((state) => {
      const hasWholesalePrice = !!product.reseller_price && product.reseller_price > 0;
      const isWholesale = state.isWholesaleMode && hasWholesalePrice;
      const unitPrice = isWholesale ? (product.reseller_price ?? product.selling_price) : product.selling_price;
      const lineTotal = parseFloat((weightKg * unitPrice).toFixed(2));

      // Replace existing entry (re-weigh overwrites previous weight for same product)
      const existing = state.items.find(i => i.product_id === product.id);
      if (existing) {
        return {
          items: state.items.map(i =>
            i.product_id === product.id
              ? {
                  ...i,
                  quantity: weightKg,
                  weight_kg: weightKg,
                  line_total: lineTotal,
                }
              : i
          ),
        };
      }

      const newItem: CartItem = {
        product_id: product.id,
        product_name: product.name,
        product_sku: product.sku,
        unit_price: unitPrice,
        unit_cost: product.cost_price,
        quantity: weightKg,       // decimal allowed
        line_total: lineTotal,
        image_path: product.image_path,
        sell_by_weight: true,
        weight_kg: weightKg,
        weight_unit: unit,
        is_wholesale: isWholesale,
        retail_price: product.selling_price,
        wholesale_price: hasWholesalePrice ? product.reseller_price : product.selling_price,
      };

      return { items: [...state.items, newItem] };
    });
  },

  removeItem: (productId: number) => {
    set((state) => ({
      items: state.items.filter(i => i.product_id !== productId),
    }));
  },

  updateQuantity: (productId: number, quantity: number) => {
    if (quantity <= 0) {
      get().removeItem(productId);
      return;
    }
    set((state) => ({
      items: state.items.map(i =>
        i.product_id === productId
          ? {
              ...i,
              quantity,
              line_total: parseFloat((quantity * i.unit_price).toFixed(2)),
              // For weight items, keep weight_kg in sync
              weight_kg: i.sell_by_weight ? quantity : i.weight_kg,
            }
          : i
      ),
    }));
  },

  incrementItem: (productId: number) => {
    set((state) => ({
      items: state.items.map(i =>
        i.product_id === productId && !i.sell_by_weight
          ? {
              ...i,
              quantity: i.quantity + 1,
              line_total: parseFloat(((i.quantity + 1) * i.unit_price).toFixed(2)),
            }
          : i
      ),
    }));
  },

  decrementItem: (productId: number) => {
    const item = get().items.find(i => i.product_id === productId);
    if (!item) return;
    if (item.sell_by_weight || item.quantity <= 1) {
      get().removeItem(productId);
    } else {
      set((state) => ({
        items: state.items.map(i =>
          i.product_id === productId
            ? {
                ...i,
                quantity: i.quantity - 1,
                line_total: parseFloat(((i.quantity - 1) * i.unit_price).toFixed(2)),
              }
            : i
        ),
      }));
    }
  },

  clearCart: () => set({ items: [] }),

  getItemCount: () => {
    // For by-weight items, count as 1 line item (not weight)
    return get().items.length;
  },

  getSubtotal: () => {
    return get().items.reduce((sum, i) => sum + i.line_total, 0);
  },
}));
