/**
 * Smart Basket V1 — catalog-first desired basket matching.
 * Resolves to ONE merchant / ONE cart. No multi-store. No substitutions. No AI.
 */

import { canPurchaseStorefrontCategory } from "./storefront-categories.js";
import { cartLineIdentity, merchantCanFulfillFlavor } from "./product-flavor.js";

export function parseSmartBasketEnabled(value?: string | boolean | null) {
  if (value === false) return false;
  if (value === true) return true;
  if (typeof value !== "string") return true;
  const v = value.trim().toLowerCase();
  if (!v) return true;
  return !(v === "false" || v === "0" || v === "no" || v === "off");
}

export type SmartBasketRequestedItem = {
  catalogProductId: string;
  quantity: number;
  flavorOptionId?: string | null;
  flavorPreference?: "ANY" | "SPECIFIC" | null;
  flavorName?: string | null;
};

export type SmartBasketAvailableLine = {
  catalogProductId: string;
  productId: string;
  name: string;
  sizeLabel: string | null;
  quantity: number;
  unitPriceCents: number;
  flavorOptionId?: string | null;
  flavorPreference?: "ANY" | "SPECIFIC" | null;
  flavorName?: string | null;
};

export type SmartBasketMissingReason =
  | "UNAVAILABLE"
  | "INSUFFICIENT_QUANTITY"
  | "ALCOHOL_DISABLED"
  | "NO_OFFER";

export type SmartBasketMissingLine = {
  catalogProductId: string;
  name: string;
  sizeLabel: string | null;
  quantity: number;
  reason: SmartBasketMissingReason;
};

export type SmartBasketMatch = {
  merchantId: string;
  merchantName: string;
  requestedLineCount: number;
  fulfilledLineCount: number;
  missingLineCount: number;
  coverageRatio: number;
  itemSubtotalCents: number;
  distanceKm: number | null;
  complete: boolean;
  available: SmartBasketAvailableLine[];
  missing: SmartBasketMissingLine[];
};

export type SmartBasketRankInput = Pick<
  SmartBasketMatch,
  "coverageRatio" | "distanceKm" | "itemSubtotalCents" | "merchantId"
>;

/** Existing stock semantics: available boolean. quantityApprox, when set, is a hard cap. */
export function offerQuantitySatisfied(
  requestedQty: number,
  quantityApprox: number | null | undefined
) {
  if (!Number.isFinite(requestedQty) || requestedQty < 1) return false;
  if (quantityApprox == null) return true;
  return quantityApprox >= requestedQty;
}

export function coverageRatio(fulfilledLineCount: number, requestedLineCount: number) {
  if (requestedLineCount <= 0) return 0;
  return Math.round((fulfilledLineCount / requestedLineCount) * 10000) / 10000;
}

/**
 * V1 ranking (deterministic):
 * 1. highest basket coverage
 * 2. shortest eligible distance
 * 3. lowest available basket item total
 * 4. merchant ID tie-breaker
 */
export function compareSmartBasketMatches(a: SmartBasketRankInput, b: SmartBasketRankInput) {
  if (b.coverageRatio !== a.coverageRatio) return b.coverageRatio - a.coverageRatio;
  const da = a.distanceKm == null ? Number.POSITIVE_INFINITY : a.distanceKm;
  const db = b.distanceKm == null ? Number.POSITIVE_INFINITY : b.distanceKm;
  if (da !== db) return da - db;
  if (a.itemSubtotalCents !== b.itemSubtotalCents) return a.itemSubtotalCents - b.itemSubtotalCents;
  return a.merchantId.localeCompare(b.merchantId);
}

export function rankSmartBasketMatches<T extends SmartBasketRankInput>(matches: T[]): T[] {
  return [...matches].sort(compareSmartBasketMatches);
}

export type CoverageOffer = {
  productId: string;
  name: string;
  sizeLabel: string | null;
  priceCents: number;
  quantityApprox: number | null;
  category: string | null;
  unavailableFlavorIds?: string[];
  activeFlavorIds?: string[];
};

export type CoverageCatalog = {
  name: string;
  sizeLabel: string | null;
  category: string | null;
};

export function evaluateMerchantCoverage(input: {
  requested: SmartBasketRequestedItem[];
  catalogs: Map<string, CoverageCatalog>;
  offers: Map<string, CoverageOffer>;
  alcoholEnabled: boolean;
}): { available: SmartBasketAvailableLine[]; missing: SmartBasketMissingLine[] } {
  const available: SmartBasketAvailableLine[] = [];
  const missing: SmartBasketMissingLine[] = [];

  for (const line of input.requested) {
    const catalog = input.catalogs.get(line.catalogProductId);
    const name = catalog?.name ?? "Item";
    const sizeLabel = catalog?.sizeLabel ?? null;
    const category = catalog?.category ?? null;
    const offer = input.offers.get(line.catalogProductId);

    if (!canPurchaseStorefrontCategory(category, input.alcoholEnabled)) {
      missing.push({
        catalogProductId: line.catalogProductId,
        name,
        sizeLabel,
        quantity: line.quantity,
        reason: "ALCOHOL_DISABLED"
      });
      continue;
    }

    if (!offer) {
      missing.push({
        catalogProductId: line.catalogProductId,
        name,
        sizeLabel,
        quantity: line.quantity,
        reason: catalog ? "NO_OFFER" : "UNAVAILABLE"
      });
      continue;
    }

    if (
      !merchantCanFulfillFlavor({
        flavorOptionId: line.flavorOptionId,
        flavorPreference: line.flavorPreference,
        unavailableFlavorIds: offer.unavailableFlavorIds,
        activeFlavorIds: offer.activeFlavorIds
      })
    ) {
      missing.push({
        catalogProductId: line.catalogProductId,
        name,
        sizeLabel,
        quantity: line.quantity,
        reason: "UNAVAILABLE"
      });
      continue;
    }

    if (!offerQuantitySatisfied(line.quantity, offer.quantityApprox)) {
      missing.push({
        catalogProductId: line.catalogProductId,
        name,
        sizeLabel,
        quantity: line.quantity,
        reason: "INSUFFICIENT_QUANTITY"
      });
      continue;
    }

    available.push({
      catalogProductId: line.catalogProductId,
      productId: offer.productId,
      name: offer.name,
      sizeLabel: offer.sizeLabel ?? sizeLabel,
      quantity: line.quantity,
      unitPriceCents: offer.priceCents,
      flavorOptionId: line.flavorOptionId ?? null,
      flavorPreference: line.flavorPreference ?? (line.flavorOptionId ? "SPECIFIC" : null),
      flavorName: line.flavorName ?? null
    });
  }

  return { available, missing };
}
