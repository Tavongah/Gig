import type { ComponentProps } from "react";
import { useWindowDimensions } from "react-native";

export const STOREFRONT_MAX_WIDTH = 1180;
export const STOREFRONT_DESKTOP_BP = 768;
export const STOREFRONT_GAP = 16;

export type StorefrontIconName = ComponentProps<typeof import("@expo/vector-icons").Ionicons>["name"];

export function useStorefrontLayout() {
  const { width } = useWindowDimensions();
  const isDesktopNav = width >= STOREFRONT_DESKTOP_BP;
  const columns = width >= 1440 ? 5 : width >= 1024 ? 4 : width >= 768 ? 3 : 2;
  return { width, isDesktopNav, columns, gap: STOREFRONT_GAP };
}

export function productCardMeta(name: string, brand?: string | null, sizeLabel?: string | null) {
  const brandShown =
    brand && !name.toLowerCase().includes(brand.trim().toLowerCase()) ? brand.trim() : null;
  return [brandShown, sizeLabel].filter(Boolean).join(" · ");
}

const CATEGORY_ICONS: Array<{ match: string; icon: StorefrontIconName }> = [
  { match: "drink", icon: "water-outline" },
  { match: "juice", icon: "wine-outline" },
  { match: "water", icon: "water-outline" },
  { match: "grocery", icon: "basket-outline" },
  { match: "snack", icon: "fast-food-outline" },
  { match: "dairy", icon: "nutrition-outline" },
  { match: "household", icon: "home-outline" },
  { match: "personal", icon: "sparkles-outline" },
  { match: "breakfast", icon: "sunny-outline" },
  { match: "staple", icon: "leaf-outline" },
  { match: "vegetable", icon: "leaf-outline" },
  { match: "fruit", icon: "nutrition-outline" },
  { match: "baby", icon: "heart-outline" },
  { match: "biscuit", icon: "cafe-outline" },
  { match: "chicken", icon: "restaurant-outline" },
  { match: "meat", icon: "restaurant-outline" },
  { match: "beef", icon: "restaurant-outline" },
  { match: "pork", icon: "restaurant-outline" },
  { match: "laundry", icon: "shirt-outline" },
  { match: "cleaning", icon: "sparkles-outline" },
  { match: "bread", icon: "nutrition-outline" },
  { match: "cooking", icon: "flame-outline" }
];

export function categoryIcon(name: string): StorefrontIconName {
  const hay = name.toLowerCase();
  return CATEGORY_ICONS.find((row) => hay.includes(row.match))?.icon ?? "grid-outline";
}
