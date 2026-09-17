import { create } from "zustand";
import { Alert } from "react-native";

export type CartLine = {
  productId: string;
  catalogProductId: string | null;
  name: string;
  imageUrl: string | null;
  sizeLabel: string | null;
  unitPriceCents: number;
  quantity: number;
  merchantId: string;
  merchantName: string;
};

type CartState = {
  lines: CartLine[];
  merchantId: string | null;
  merchantName: string | null;
  addOffer: (line: Omit<CartLine, "quantity"> & { quantity?: number }) => boolean;
  setQuantity: (productId: string, quantity: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
  itemCount: () => number;
  subtotalCents: () => number;
};

export const useCommerceCartStore = create<CartState>((set, get) => ({
  lines: [],
  merchantId: null,
  merchantName: null,

  addOffer: (input) => {
    const state = get();
    if (state.merchantId && state.merchantId !== input.merchantId) {
      Alert.alert(
        "Different shop",
        "This item is from another shop. Starting a new basket will replace your current basket.",
        [
          { text: "Keep current basket", style: "cancel" },
          {
            text: "Continue",
            style: "destructive",
            onPress: () => {
              set({
                merchantId: input.merchantId,
                merchantName: input.merchantName,
                lines: [{ ...input, quantity: input.quantity ?? 1 }]
              });
            }
          }
        ]
      );
      return false;
    }

    const qty = input.quantity ?? 1;
    const existing = state.lines.find((l) => l.productId === input.productId);
    if (existing) {
      set({
        lines: state.lines.map((l) =>
          l.productId === input.productId
            ? { ...l, quantity: Math.min(99, l.quantity + qty), unitPriceCents: input.unitPriceCents }
            : l
        ),
        merchantId: input.merchantId,
        merchantName: input.merchantName
      });
      return true;
    }

    set({
      merchantId: input.merchantId,
      merchantName: input.merchantName,
      lines: [...state.lines, { ...input, quantity: qty }]
    });
    return true;
  },

  setQuantity: (productId, quantity) => {
    if (quantity <= 0) {
      get().remove(productId);
      return;
    }
    set({
      lines: get().lines.map((l) =>
        l.productId === productId ? { ...l, quantity: Math.min(99, quantity) } : l
      )
    });
  },

  remove: (productId) => {
    const lines = get().lines.filter((l) => l.productId !== productId);
    set({
      lines,
      merchantId: lines[0]?.merchantId ?? null,
      merchantName: lines[0]?.merchantName ?? null
    });
  },

  clear: () => set({ lines: [], merchantId: null, merchantName: null }),

  itemCount: () => get().lines.reduce((s, l) => s + l.quantity, 0),
  subtotalCents: () => get().lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0)
}));
