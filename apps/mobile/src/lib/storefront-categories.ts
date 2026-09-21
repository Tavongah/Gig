import Constants from "expo-constants";
import {
  allLiveCatalogCategories,
  canPurchaseStorefrontCategory,
  comingSoonCategories,
  featuredLiveCategories,
  isAlcoholRestrictedCategory,
  matchComingSoonFromSearch,
  parseAlcoholCommerceEnabled,
  resolveStorefrontCategory,
  storefrontCategoryIcon,
  type ResolvedStorefrontCategory
} from "@gigflow/shared";
import type { StorefrontIconName } from "./storefront-ui";

export type { ResolvedStorefrontCategory };

export function isAlcoholCommerceEnabled() {
  const extra = Constants.expoConfig?.extra as { alcoholCommerceEnabled?: boolean | string } | undefined;
  return parseAlcoholCommerceEnabled(
    extra?.alcoholCommerceEnabled ?? process.env.EXPO_PUBLIC_ALCOHOL_COMMERCE_ENABLED
  );
}

export function alcoholPurchaseAllowed(category?: string | null) {
  return canPurchaseStorefrontCategory(category, isAlcoholCommerceEnabled());
}

export function categoryIonicon(name: string): StorefrontIconName {
  return storefrontCategoryIcon(name) as StorefrontIconName;
}

export function shopByCategories(catalogNames: string[]) {
  return featuredLiveCategories(catalogNames);
}

export function moreOnDutsCategories(catalogNames: string[]) {
  return comingSoonCategories(catalogNames);
}

export function headerChipCategories(catalogNames: string[], desktop: boolean) {
  const featured = featuredLiveCategories(catalogNames);
  return featured.slice(0, desktop ? 6 : 5);
}

export function liveCatalogDestinations(catalogNames: string[]) {
  return allLiveCatalogCategories(catalogNames);
}

export function destinationFor(input: string | undefined | null, catalogNames: string[] = []) {
  return resolveStorefrontCategory(input, catalogNames);
}

export function comingSoonFromQuery(q: string, catalogNames: string[] = []) {
  return matchComingSoonFromSearch(q, catalogNames);
}

export { isAlcoholRestrictedCategory, resolveStorefrontCategory };
