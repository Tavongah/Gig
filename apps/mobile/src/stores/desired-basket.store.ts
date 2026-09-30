import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type DesiredBasketLine = {
  catalogProductId: string;
  name: string;
  imageUrl: string | null;
  sizeLabel: string | null;
  quantity: number;
  /** Discovery-only nearby offer price. Never used as a cart/checkout price. */
  fromPriceCents: number | null;
};

const STORAGE_KEY = "duts.commerce.desired-basket";

type DesiredState = {
  lines: DesiredBasketLine[];
  hydrated: boolean;
  addItem: (line: Omit<DesiredBasketLine, "quantity"> & { quantity?: number }) => void;
  setQuantity: (catalogProductId: string, quantity: number) => void;
  remove: (catalogProductId: string) => void;
  removeMany: (catalogProductIds: string[]) => void;
  clear: () => void;
  itemCount: () => number;
};

async function persist(lines: DesiredBasketLine[]) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ lines }));
  } catch {
    /* ignore */
  }
}

function parseLines(raw: string | null): DesiredBasketLine[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { lines?: DesiredBasketLine[] };
    if (!Array.isArray(parsed?.lines)) return [];
    return parsed.lines.filter(
      (l) =>
        l &&
        typeof l.catalogProductId === "string" &&
        typeof l.name === "string" &&
        typeof l.quantity === "number" &&
        l.quantity > 0
    );
  } catch {
    return [];
  }
}

export const useDesiredBasketStore = create<DesiredState>((set, get) => ({
  lines: [],
  hydrated: false,

  addItem: (input) => {
    if (!input.catalogProductId) return;
    const qty = Math.max(1, Math.min(99, input.quantity ?? 1));
    const existing = get().lines.find((l) => l.catalogProductId === input.catalogProductId);
    if (existing) {
      set({
        lines: get().lines.map((l) =>
          l.catalogProductId === input.catalogProductId
            ? {
                ...l,
                quantity: Math.min(99, l.quantity + qty),
                name: input.name,
                imageUrl: input.imageUrl,
                sizeLabel: input.sizeLabel,
                fromPriceCents: input.fromPriceCents
              }
            : l
        )
      });
      return;
    }
    set({
      lines: [
        ...get().lines,
        {
          catalogProductId: input.catalogProductId,
          name: input.name,
          imageUrl: input.imageUrl,
          sizeLabel: input.sizeLabel,
          fromPriceCents: input.fromPriceCents,
          quantity: qty
        }
      ]
    });
  },

  setQuantity: (catalogProductId, quantity) => {
    if (quantity <= 0) {
      get().remove(catalogProductId);
      return;
    }
    set({
      lines: get().lines.map((l) =>
        l.catalogProductId === catalogProductId ? { ...l, quantity: Math.min(99, quantity) } : l
      )
    });
  },

  remove: (catalogProductId) => {
    set({ lines: get().lines.filter((l) => l.catalogProductId !== catalogProductId) });
  },

  removeMany: (catalogProductIds) => {
    const drop = new Set(catalogProductIds);
    set({ lines: get().lines.filter((l) => !drop.has(l.catalogProductId)) });
  },

  clear: () => set({ lines: [] }),

  itemCount: () => get().lines.reduce((s, l) => s + l.quantity, 0)
}));

useDesiredBasketStore.subscribe((state) => {
  if (!state.hydrated) return;
  void persist(state.lines);
});

export async function hydrateDesiredBasket(): Promise<void> {
  if (useDesiredBasketStore.getState().hydrated) return;
  const lines = parseLines(await AsyncStorage.getItem(STORAGE_KEY));
  useDesiredBasketStore.setState({ lines, hydrated: true });
}
