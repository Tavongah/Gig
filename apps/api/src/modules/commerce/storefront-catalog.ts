import {
  STOREFRONT_CATALOG_PAGE_SIZE,
  STOREFRONT_CATALOG_PAGE_SIZE_MAX,
  catalogSearchHaystack,
  expandSearchTerms,
  isPublicStorefrontCatalogProduct,
  normalizeProductSearchName,
  type StorefrontProductCard
} from "@gigflow/shared";
import { browserAccessibleMediaUrl } from "../../lib/catalog-media.js";

export type StorefrontAcc = {
  catalogProductId: string | null;
  productId: string | null;
  name: string;
  brand: string | null;
  sizeLabel: string | null;
  category: string | null;
  description: string | null;
  imageUrl: string | null;
  fromPriceCents: number | null;
  currency: string | null;
  merchantOfferCount: number;
  purchasable: boolean;
  score: number;
};

export function clampStorefrontPage(limit?: number, offset?: number) {
  const pageSize = Math.min(
    Math.max(1, Math.floor(limit ?? STOREFRONT_CATALOG_PAGE_SIZE) || STOREFRONT_CATALOG_PAGE_SIZE),
    STOREFRONT_CATALOG_PAGE_SIZE_MAX
  );
  const pageOffset = Math.max(0, Math.floor(offset ?? 0) || 0);
  return { limit: pageSize, offset: pageOffset };
}

export function storefrontSearchTerms(q?: string) {
  const normalized = normalizeProductSearchName(q ?? "");
  return normalized ? expandSearchTerms(normalized) : [];
}

export function storefrontCategoryNeedle(category?: string) {
  const needle = category?.trim().toLowerCase();
  return needle || undefined;
}

export function matchesStorefrontCategory(category: string | null | undefined, needle?: string) {
  if (!needle) return true;
  return (category ?? "").trim().toLowerCase().includes(needle);
}

export function scoreStorefrontSearch(input: {
  name: string;
  brand: string | null;
  sizeLabel: string | null;
  category: string | null;
  barcode?: string | null;
  terms: string[];
}) {
  if (!input.terms.length) return 1;
  const hay = catalogSearchHaystack({
    name: input.name,
    brand: input.brand,
    sizeLabel: input.sizeLabel,
    category: input.category,
    barcode: input.barcode
  });
  let score = 0;
  for (const t of input.terms) {
    if (!t) continue;
    if (hay === t || normalizeProductSearchName(input.name) === t) score += 100;
    else if (hay.includes(t)) score += 40;
  }
  return score;
}

export function compareStorefrontRows(a: StorefrontAcc, b: StorefrontAcc) {
  if (b.score !== a.score) return b.score - a.score;
  const aImg = a.imageUrl ? 1 : 0;
  const bImg = b.imageUrl ? 1 : 0;
  if (bImg !== aImg) return bImg - aImg;
  return a.name.localeCompare(b.name);
}

export function presentStorefrontCard(input: StorefrontAcc): StorefrontProductCard {
  const purchasable =
    input.purchasable && Boolean(input.productId) && input.fromPriceCents != null && input.merchantOfferCount > 0;
  return {
    catalogProductId: input.catalogProductId,
    productId: purchasable ? input.productId : null,
    name: input.name,
    brand: input.brand,
    sizeLabel: input.sizeLabel,
    category: input.category,
    description: input.description,
    imageUrl: browserAccessibleMediaUrl(input.imageUrl),
    purchasable,
    fromPriceCents: purchasable ? input.fromPriceCents : null,
    currency: purchasable ? input.currency ?? "usd" : null,
    merchantOfferCount: purchasable ? input.merchantOfferCount : 0,
    offerCount: purchasable ? input.merchantOfferCount : 0
  };
}

export function catalogOnlyAcc(input: {
  id: string;
  name: string;
  brand: string | null;
  sizeLabel: string | null;
  category: string | null;
  description: string | null;
  primaryImageUrl: string | null;
  barcode?: string | null;
  terms: string[];
}): StorefrontAcc | null {
  if (!isPublicStorefrontCatalogProduct({ id: input.id, status: "APPROVED" })) return null;
  const score = scoreStorefrontSearch({
    name: input.name,
    brand: input.brand,
    sizeLabel: input.sizeLabel,
    category: input.category,
    barcode: input.barcode,
    terms: input.terms
  });
  if (input.terms.length && score <= 0) return null;
  return {
    catalogProductId: input.id,
    productId: null,
    name: input.name,
    brand: input.brand,
    sizeLabel: input.sizeLabel,
    category: input.category,
    description: input.description,
    imageUrl: browserAccessibleMediaUrl(input.primaryImageUrl),
    fromPriceCents: null,
    currency: null,
    merchantOfferCount: 0,
    purchasable: false,
    score
  };
}

export function paginateStorefront(rows: StorefrontAcc[], limit: number, offset: number) {
  const sorted = [...rows].sort(compareStorefrontRows);
  const total = sorted.length;
  const slice = sorted.slice(offset, offset + limit);
  return {
    products: slice.map(presentStorefrontCard),
    total,
    offset,
    limit,
    hasMore: offset + slice.length < total
  };
}
