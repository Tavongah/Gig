import type { ComponentProps } from "react";
import { useWindowDimensions } from "react-native";
import { storefrontCategoryIcon } from "@gigflow/shared";
import { RAIL_PEEK } from "./motion";

export const STOREFRONT_MAX_WIDTH = 1180;
export const STOREFRONT_DESKTOP_BP = 768;
export const STOREFRONT_GUTTER = 16;
export const STOREFRONT_GAP = 12;

export type StorefrontIconName = ComponentProps<typeof import("@expo/vector-icons").Ionicons>["name"];

export const storefrontShellStyle = {
  width: "100%" as const,
  maxWidth: STOREFRONT_MAX_WIDTH,
  alignSelf: "center" as const,
  paddingHorizontal: STOREFRONT_GUTTER
};

export function storefrontContentWidth(viewportWidth: number) {
  return Math.max(0, Math.min(viewportWidth, STOREFRONT_MAX_WIDTH) - STOREFRONT_GUTTER * 2);
}

export function storefrontColumns(viewportWidth: number) {
  if (viewportWidth >= 1440) return 5;
  if (viewportWidth >= 1024) return 4;
  if (viewportWidth >= 600) return 3;
  return 2;
}

export function storefrontRailVisible(viewportWidth: number) {
  if (viewportWidth >= 1024) return 4;
  if (viewportWidth >= 600) return 3;
  return 2;
}

export function storefrontLayout(viewportWidth: number) {
  const isDesktopNav = viewportWidth >= STOREFRONT_DESKTOP_BP;
  const gutter = STOREFRONT_GUTTER;
  const gap = STOREFRONT_GAP;
  const contentWidth = storefrontContentWidth(viewportWidth);
  const columns = storefrontColumns(viewportWidth);
  const railVisible = storefrontRailVisible(viewportWidth);
  const railPeek = Math.round(Math.min(36, Math.max(Math.round(RAIL_PEEK * 0.7), contentWidth * 0.06)));
  const railCardWidth = Math.max(
    120,
    Math.floor((contentWidth - gap * (railVisible - 1) - railPeek) / railVisible)
  );
  const railSnap = railCardWidth + gap;
  const categoryCardWidth = Math.min(112, Math.max(96, Math.round(contentWidth * 0.28)));
  return {
    width: viewportWidth,
    isDesktopNav,
    columns,
    gap,
    gutter,
    contentWidth,
    railVisible,
    railCardWidth,
    railPeek,
    railSnap,
    categoryCardWidth
  };
}

export function useStorefrontLayout() {
  const { width } = useWindowDimensions();
  return storefrontLayout(width);
}

export function productCardMeta(name: string, brand?: string | null, sizeLabel?: string | null) {
  const brandShown =
    brand && !name.toLowerCase().includes(brand.trim().toLowerCase()) ? brand.trim() : null;
  return [brandShown, sizeLabel].filter(Boolean).join(" · ");
}

export function categoryIcon(name: string): StorefrontIconName {
  return storefrontCategoryIcon(name) as StorefrontIconName;
}
