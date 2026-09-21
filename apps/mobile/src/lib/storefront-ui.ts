import type { ComponentProps } from "react";
import { useWindowDimensions } from "react-native";
import { storefrontCategoryIcon } from "@gigflow/shared";

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

export function categoryIcon(name: string): StorefrontIconName {
  return storefrontCategoryIcon(name) as StorefrontIconName;
}
