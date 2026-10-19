/**
 * Cart Store - Zustand state management for POS cart
 */

import { create } from 'zustand';
import type { CartItem } from '../../types/sale';
import type { Product } from '../../types/product';

interface CartState {
  items: CartItem[];
  
  // Actions
  addItem: (product: Product, quantity?: number) => void;
  removeItem: (productId: number) => void;
  updateQuantity: (productId: number, quantity: number) => void;
  incrementItem: (productId: number) => void;
  decrementItem: (productId: number) => void;
  clearCart: () => void;
  
  // Computed
  getItemCount: () => number;
  getSubtotal: () => number;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],

  addItem: (product: Product, quantity: number = 1) => {
    set((state) => {
      const existing = state.items.find(i => i.product_id === product.id);
      
      if (existing) {
        return {
          items: state.items.map(i =>
            i.product_id === product.id
              ? { 
                  ...i, 
                  quantity: i.quantity + quantity,
                  line_total: (i.quantity + quantity) * i.unit_price,
                }
              : i
          ),
        };
      }

      const newItem: CartItem = {
        product_id: product.id,
        product_name: product.name,
        product_sku: product.sku,
        unit_price: product.selling_price,
        unit_cost: product.cost_price,
        quantity,
        line_total: quantity * product.selling_price,
        image_path: product.image_path,
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
          ? { ...i, quantity, line_total: quantity * i.unit_price }
          : i
      ),
    }));
  },

  incrementItem: (productId: number) => {
    set((state) => ({
      items: state.items.map(i =>
        i.product_id === productId
          ? { ...i, quantity: i.quantity + 1, line_total: (i.quantity + 1) * i.unit_price }
          : i
      ),
    }));
  },

  decrementItem: (productId: number) => {
    const item = get().items.find(i => i.product_id === productId);
    if (item && item.quantity <= 1) {
      get().removeItem(productId);
    } else {
      set((state) => ({
        items: state.items.map(i =>
          i.product_id === productId
            ? { ...i, quantity: i.quantity - 1, line_total: (i.quantity - 1) * i.unit_price }
            : i
        ),
      }));
    }
  },

  clearCart: () => set({ items: [] }),

  getItemCount: () => {
    return get().items.reduce((sum, i) => sum + i.quantity, 0);
  },

  getSubtotal: () => {
    return get().items.reduce((sum, i) => sum + i.line_total, 0);
  },
}));
