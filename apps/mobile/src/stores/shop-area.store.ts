import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

const AREA_KEY = "duts.shop.area";
const EXACT_KEY = "duts.shop.deliveryLocation";

export type ShoppingAreaChoice = {
  id: string;
  name: string;
};

type AreaState = {
  area: ShoppingAreaChoice | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setArea: (area: ShoppingAreaChoice) => Promise<void>;
};

export function timezoneAreaHint(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz === "Africa/Harare") return "harare";
  } catch {
    /* ignore */
  }
  return null;
}

export const useShopAreaStore = create<AreaState>((set) => ({
  area: null,
  hydrated: false,

  hydrate: async () => {
    try {
      await AsyncStorage.removeItem(EXACT_KEY);
      const raw = await AsyncStorage.getItem(AREA_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ShoppingAreaChoice;
        if (typeof parsed?.id === "string" && typeof parsed?.name === "string" && parsed.id && parsed.name) {
          set({ area: { id: parsed.id, name: parsed.name }, hydrated: true });
          return;
        }
      }
    } catch {
      /* ignore */
    }
    set({ hydrated: true });
  },

  setArea: async (area) => {
    const next = { id: area.id, name: area.name };
    set({ area: next });
    await AsyncStorage.setItem(AREA_KEY, JSON.stringify(next));
  }
}));
