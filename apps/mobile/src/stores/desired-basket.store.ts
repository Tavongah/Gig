import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { cartLineIdentity, formatFlavorCustomerLine } from "@gigflow/shared";

export type DesiredBasketLine = {
  catalogProductId: string;
  name: string;
  imageUrl: string | null;
  sizeLabel: string | null;
  quantity: number;
  /** Discovery-only nearby offer price. Never used as a cart/checkout price. */
  fromPriceCents: number | null;
  flavorOptionId?: string | null;
  flavorName?: string | null;
  flavorPreference?: "ANY" | "SPECIFIC" | null;
};

export function desiredLineKey(line: Pick<DesiredBasketLine, "catalogProductId" | "flavorOptionId">): string {
  return cartLineIdentity(line.catalogProductId, line.flavorOptionId);
}

export function desiredFlavorLabel(line: DesiredBasketLine): string | null {
  return formatFlavorCustomerLine(line.flavorPreference, line.flavorName);
}

const STORAGE_KEY = "duts.commerce.desired-basket";

type DesiredState = {
  lines: DesiredBasketLine[];
  hydrated: boolean;
  addItem: (line: Omit<DesiredBasketLine, "quantity"> & { quantity?: number }) => void;
  setQuantity: (lineKey: string, quantity: number) => void;
  remove: (lineKey: string) => void;
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
    const key = desiredLineKey(input);
    const existing = get().lines.find((l) => desiredLineKey(l) === key);
    if (existing) {
      set({
        lines: get().lines.map((l) =>
          desiredLineKey(l) === key
            ? {
                ...l,
                quantity: Math.min(99, l.quantity + qty),
                name: input.name,
                imageUrl: input.imageUrl,
                sizeLabel: input.sizeLabel,
                fromPriceCents: input.fromPriceCents,
                flavorOptionId: input.flavorOptionId ?? l.flavorOptionId,
                flavorName: input.flavorName ?? l.flavorName,
                flavorPreference: input.flavorPreference ?? l.flavorPreference
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
          flavorOptionId: input.flavorOptionId ?? null,
          flavorName: input.flavorName ?? null,
          flavorPreference: input.flavorPreference ?? null,
          quantity: qty
        }
      ]
    });
  },

  setQuantity: (lineKey, quantity) => {
    if (quantity <= 0) {
      get().remove(lineKey);
      return;
    }
    set({
      lines: get().lines.map((l) =>
        desiredLineKey(l) === lineKey ? { ...l, quantity: Math.min(99, quantity) } : l
      )
    });
  },

  remove: (lineKey) => {
    set({ lines: get().lines.filter((l) => desiredLineKey(l) !== lineKey) });
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
