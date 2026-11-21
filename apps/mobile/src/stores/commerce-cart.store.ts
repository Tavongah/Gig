import { create } from "zustand";
import { Alert, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { cartLineIdentity, merchantCartBlockedBySellerPilot, planSellerPilotCartAdd } from "@gigflow/shared";
import { cartShopKey, cartsConflict, mergeSameShopCart, planCartClaim } from "../lib/cart-claim";
import { requestNewCartConfirm } from "../lib/web-cart-confirm";

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
  /** Set only for a controlled pilot purchase. Merchant lines omit this. */
  sellerOfferId?: string | null;
  sellableQuantity?: number | null;
  flavorOptionId?: string | null;
  flavorName?: string | null;
  flavorPreference?: "ANY" | "SPECIFIC" | null;
};

export function cartLineKey(line: Pick<CartLine, "productId" | "flavorOptionId">): string {
  return cartLineIdentity(line.productId, line.flavorOptionId);
}

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
  addOffer: (
    line: Omit<CartLine, "quantity"> & { quantity?: number },
    options?: { allowMulti?: boolean; replaceConfirmed?: boolean }
  ) => boolean;
  addSellerPilot: (line: Omit<CartLine, "quantity"> & { sellerOfferId: string; sellableQuantity: number; quantity?: number }) => boolean;
  notice: string | null;
  clearNotice: () => void;
  setQuantity: (lineKey: string, quantity: number) => void;
  remove: (lineKey: string) => void;
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
  notice: null,

  clearNotice: () => set({ notice: null }),

  addOffer: (input, options) => {
    if (merchantCartBlockedBySellerPilot(get().lines)) {
      set({ notice: "Finish your current order before adding this item." });
      return false;
    }
    if (!input.productId || !input.merchantId) return false;
    const state = get();
    if (state.merchantId && state.merchantId !== input.merchantId && !options?.allowMulti) {
      if (options?.replaceConfirmed) {
        set({
          merchantId: input.merchantId,
          merchantName: input.merchantName,
          lines: [{ ...input, quantity: input.quantity ?? 1 }],
          notice: null
        });
        return true;
      }
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
                lines: [{ ...input, quantity: input.quantity ?? 1 }],
                notice: null
              });
            }
          }
        ]
      );
      return false;
    }

    if (options?.allowMulti && state.merchantId && state.merchantId !== input.merchantId) {
      const notice = "Added ✓";
      const qty = input.quantity ?? 1;
      const key = cartLineKey(input);
      const existing = state.lines.find((l) => cartLineKey(l) === key);
      if (existing) {
        set({
          lines: state.lines.map((l) =>
            cartLineKey(l) === key
              ? { ...l, quantity: Math.min(99, l.quantity + qty), unitPriceCents: input.unitPriceCents }
              : l
          ),
          notice
        });
        return true;
      }
      set({
        lines: [...state.lines, { ...input, quantity: qty }],
        notice
      });
      return true;
    }

    const qty = input.quantity ?? 1;
    const key = cartLineKey(input);
    const existing = state.lines.find((l) => cartLineKey(l) === key);
    if (existing) {
      set({
        lines: state.lines.map((l) =>
          cartLineKey(l) === key
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

  addSellerPilot: (input) => {
    const decision = planSellerPilotCartAdd<CartLine>(get().lines, {
      ...input,
      quantity: input.quantity && input.quantity > 0 ? input.quantity : 1
    });
    if (!decision.ok) {
      set({ notice: decision.message });
      return false;
    }
    set({
      lines: decision.lines,
      merchantId: null,
      merchantName: null,
      notice: "Added ✓"
    });
    return true;
  },

  setQuantity: (lineKey, quantity) => {
    if (quantity <= 0) {
      get().remove(lineKey);
      return;
    }
    const current = get().lines.find((line) => cartLineKey(line) === lineKey);
    const cap = current?.sellerOfferId && current.sellableQuantity && current.sellableQuantity > 0
      ? current.sellableQuantity
      : 99;
    set({
      lines: get().lines.map((l) =>
        cartLineKey(l) === lineKey ? { ...l, quantity: Math.min(cap, quantity) } : l
      )
    });
  },

  remove: (lineKey) => {
    const lines = get().lines.filter((l) => cartLineKey(l) !== lineKey);
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
    const next = snapshot(useCommerceCartStore.getState());
    const saved = parseCart(await AsyncStorage.getItem(ACCOUNT_KEY(userId)));
    if (saved && cartsConflict(saved, next)) return;
    await AsyncStorage.setItem(ACCOUNT_KEY(userId), JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

type ShopCartChoice = "guest" | "saved";

/**
 * Different-shop login. Website Alert.alert does nothing, so the website uses
 * the mounted cart confirm. Dismiss or a missing host keeps the on-screen cart.
 * Native keeps the two-choice basket prompt.
 */
function chooseDifferentShopCart(guest: PersistedCart, saved: PersistedCart): Promise<ShopCartChoice | null> {
  if (Platform.OS === "web") {
    return requestNewCartConfirm().then((confirmed) => (confirmed ? "saved" : null));
  }
  return new Promise((resolve) => {
    let settled = false;
    const settle = (choice: ShopCartChoice | null) => {
      if (settled) return;
      settled = true;
      resolve(choice);
    };
    Alert.alert(
      "Which basket should we keep?",
      `Your account already has items from ${saved.merchantName ?? "another shop"}. You just added items from ${guest.merchantName ?? "a different shop"}.`,
      [
        { text: "Keep the basket I just made", onPress: () => settle("guest") },
        { text: "Keep my saved basket", onPress: () => settle("saved") }
      ],
      { cancelable: true, onDismiss: () => settle(null) }
    );
  });
}

export async function claimCartAfterLogin(userId: string): Promise<void> {
  if (!userId) return;
  const guest = snapshot(useCommerceCartStore.getState());
  const saved = parseCart(await AsyncStorage.getItem(ACCOUNT_KEY(userId)));
  const accountHasItems = Boolean(saved?.lines.length);
  const guestHasItems = Boolean(guest.lines.length);
  const plan = planCartClaim({
    guestHasItems,
    savedHasItems: accountHasItems,
    guestShopKey: cartShopKey(guest),
    savedShopKey: saved ? cartShopKey(saved) : null
  });

  const finish = async (keep: PersistedCart) => {
    useCommerceCartStore.getState().replaceCart(keep);
    try {
      await AsyncStorage.setItem(ACCOUNT_KEY(userId), JSON.stringify(keep));
    } catch {
      /* ignore */
    }
    await persistWorking(keep);
  };

  if (plan === "guest") {
    if (guestHasItems) {
      await finish(guest);
    }
    return;
  }
  if (plan === "saved") {
    if (saved) await finish(saved);
    return;
  }
  if (plan === "merge" && saved) {
    await finish(mergeSameShopCart(saved, guest));
    return;
  }
  if (!saved) return;

  const choice = await chooseDifferentShopCart(guest, saved);
  if (choice === "saved") await finish(saved);
  else if (choice === "guest") await finish(guest);
}
