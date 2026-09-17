import { create } from "zustand";
import { Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

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

export type PersistedCart = {
  lines: CartLine[];
  merchantId: string | null;
  merchantName: string | null;
};

const WORKING_KEY = "duts.commerce.cart";
const ACCOUNT_KEY = (userId: string) => `duts.account.cart.${userId}`;

type CartState = {
  lines: CartLine[];
  merchantId: string | null;
  merchantName: string | null;
  hydrated: boolean;
  pendingCheckout: boolean;
  addOffer: (line: Omit<CartLine, "quantity"> & { quantity?: number }) => boolean;
  setQuantity: (productId: string, quantity: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
  replaceCart: (cart: PersistedCart) => void;
  setPendingCheckout: (value: boolean) => void;
  itemCount: () => number;
  subtotalCents: () => number;
};

function snapshot(state: Pick<CartState, "lines" | "merchantId" | "merchantName">): PersistedCart {
  return {
    lines: state.lines,
    merchantId: state.merchantId,
    merchantName: state.merchantName
  };
}

async function persistWorking(cart: PersistedCart): Promise<void> {
  try {
    await AsyncStorage.setItem(WORKING_KEY, JSON.stringify(cart));
  } catch {
    /* ignore */
  }
}

function parseCart(raw: string | null): PersistedCart | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedCart;
    if (!Array.isArray(parsed?.lines)) return null;
    return {
      lines: parsed.lines.filter(
        (l) => l && typeof l.productId === "string" && typeof l.quantity === "number" && l.quantity > 0
      ),
      merchantId: parsed.merchantId ?? parsed.lines[0]?.merchantId ?? null,
      merchantName: parsed.merchantName ?? parsed.lines[0]?.merchantName ?? null
    };
  } catch {
    return null;
  }
}

export const useCommerceCartStore = create<CartState>((set, get) => ({
  lines: [],
  merchantId: null,
  merchantName: null,
  hydrated: false,
  pendingCheckout: false,

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

  replaceCart: (cart) =>
    set({
      lines: cart.lines,
      merchantId: cart.merchantId,
      merchantName: cart.merchantName
    }),

  setPendingCheckout: (pendingCheckout) => set({ pendingCheckout }),

  itemCount: () => get().lines.reduce((s, l) => s + l.quantity, 0),
  subtotalCents: () => get().lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0)
}));

useCommerceCartStore.subscribe((state) => {
  if (!state.hydrated) return;
  void persistWorking(snapshot(state));
});

export async function hydrateCommerceCart(): Promise<void> {
  if (useCommerceCartStore.getState().hydrated) return;
  const parsed = parseCart(await AsyncStorage.getItem(WORKING_KEY));
  useCommerceCartStore.setState({
    ...(parsed ?? { lines: [], merchantId: null, merchantName: null }),
    hydrated: true
  });
}

export async function saveAccountCartSnapshot(userId: string): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(ACCOUNT_KEY(userId), JSON.stringify(snapshot(useCommerceCartStore.getState())));
  } catch {
    /* ignore */
  }
}

export async function claimCartAfterLogin(userId: string): Promise<void> {
  if (!userId) return;
  const guest = snapshot(useCommerceCartStore.getState());
  const saved = parseCart(await AsyncStorage.getItem(ACCOUNT_KEY(userId)));
  const accountHasItems = Boolean(saved?.lines.length);
  const guestHasItems = Boolean(guest.lines.length);
  const conflict =
    guestHasItems &&
    accountHasItems &&
    Boolean(guest.merchantId) &&
    Boolean(saved?.merchantId) &&
    guest.merchantId !== saved!.merchantId;

  const finish = async (keep: PersistedCart) => {
    useCommerceCartStore.getState().replaceCart(keep);
    await saveAccountCartSnapshot(userId);
    await persistWorking(keep);
  };

  if (!conflict) {
    if (guestHasItems) {
      await finish(guest);
      return;
    }
    if (saved) await finish(saved);
    return;
  }

  Alert.alert(
    "Which basket should we keep?",
    `Your account already has items from ${saved!.merchantName ?? "another shop"}. You just added items from ${guest.merchantName ?? "a different shop"}.`,
    [
      {
        text: "Keep the basket I just made",
        onPress: () => {
          void finish(guest);
        }
      },
      {
        text: "Keep my saved basket",
        onPress: () => {
          void finish(saved!);
        }
      }
    ]
  );
}
