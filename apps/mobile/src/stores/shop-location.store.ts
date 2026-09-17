import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getCurrentCoordinates } from "../lib/location";
import { listAddresses } from "../lib/addresses-store";

const KEY = "duts.shop.deliveryLocation";

export type ShopLocation = {
  latitude: number;
  longitude: number;
  label: string;
};

type LocState = {
  location: ShopLocation | null;
  hydrated: boolean;
  hydrate: (userId?: string) => Promise<void>;
  setLocation: (loc: ShopLocation) => Promise<void>;
  useDeviceLocation: () => Promise<ShopLocation>;
  useSavedAddress: (userId: string) => Promise<ShopLocation | null>;
};

export const useShopLocationStore = create<LocState>((set, get) => ({
  location: null,
  hydrated: false,

  hydrate: async (userId) => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ShopLocation;
        if (
          typeof parsed?.latitude === "number" &&
          typeof parsed?.longitude === "number" &&
          Number.isFinite(parsed.latitude) &&
          Number.isFinite(parsed.longitude)
        ) {
          set({ location: parsed, hydrated: true });
          return;
        }
      }
    } catch {
      /* ignore */
    }

    if (userId) {
      const fromAddress = await get().useSavedAddress(userId);
      if (fromAddress) {
        set({ hydrated: true });
        return;
      }
    }

    set({ hydrated: true });
  },

  setLocation: async (loc) => {
    set({ location: loc });
    await AsyncStorage.setItem(KEY, JSON.stringify(loc));
  },

  useDeviceLocation: async () => {
    const coords = await getCurrentCoordinates();
    const loc: ShopLocation = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      label: "Current location"
    };
    await get().setLocation(loc);
    return loc;
  },

  useSavedAddress: async (userId) => {
    const addresses = await listAddresses(userId);
    const preferred = addresses.find((a) => a.isDefault) ?? addresses[0];
    if (!preferred) return null;
    if (!Number.isFinite(preferred.latitude) || !Number.isFinite(preferred.longitude)) return null;
    const loc: ShopLocation = {
      latitude: preferred.latitude,
      longitude: preferred.longitude,
      label: preferred.label || preferred.formattedAddress || "Saved address"
    };
    await get().setLocation(loc);
    return loc;
  }
}));
