import {
  cartLineIdentity,
  coverageRatio,
  evaluateMerchantCoverage,
  isPublicStorefrontCatalogProduct,
  parseAlcoholCommerceEnabled,
  parseSmartBasketEnabled,
  rankSmartBasketMatches,
  type CoverageCatalog,
  type CoverageOffer,
  type SmartBasketMatch,
  type SmartBasketRequestedItem
} from "@gigflow/shared";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import {
  merchantsForBrowse,
  offerEligible,
  quoteCart,
  type BrowseGeo
} from "./customer-commerce.service.js";
import { coverageFlavorMaps } from "./flavor.service.js";

export function assertSmartBasketEnabled() {
  if (!parseSmartBasketEnabled(process.env.SMART_BASKET_ENABLED)) {
    throw new AppError("This shopping option isn't available right now.", 404, "FEATURE_DISABLED");
  }
}

export function normalizeDesiredItems(items: SmartBasketRequestedItem[]): SmartBasketRequestedItem[] {
  const byKey = new Map<string, SmartBasketRequestedItem>();
  for (const item of items) {
    const id = item.catalogProductId?.trim();
    if (!id) continue;
    const qty = Math.max(1, Math.min(99, Math.floor(item.quantity || 1)));
    const flavorOptionId = item.flavorOptionId?.trim() || null;
    const flavorPreference = item.flavorPreference ?? (flavorOptionId ? "SPECIFIC" : null);
    const key = cartLineIdentity(id, flavorOptionId);
    const existing = byKey.get(key);
    if (existing) {
      existing.quantity = Math.min(99, existing.quantity + qty);
      continue;
    }
    byKey.set(key, {
      catalogProductId: id,
      quantity: qty,
      flavorOptionId,
      flavorPreference,
      flavorName: item.flavorName ?? null
    });
  }
  return [...byKey.values()];
}

function browseGeoFromInput(input: {
  lat?: number;
  lng?: number;
  areaId?: string;
}): BrowseGeo | undefined {
  if (input.areaId) return { areaId: input.areaId };
  if (input.lat != null && input.lng != null) return { lat: input.lat, lng: input.lng };
  return undefined;
}

export async function matchSmartBasket(input: {
  lat?: number;
  lng?: number;
  areaId?: string;
  items: SmartBasketRequestedItem[];
}) {
  assertSmartBasketEnabled();
  const requested = normalizeDesiredItems(input.items);
  if (!requested.length) throw new AppError("Basket is empty.", 400, "EMPTY_BASKET");

  const geo = browseGeoFromInput(input);
  if (!geo) {
    throw new AppError("Set a shopping area or delivery location to find a shop.", 400, "LOCATION_REQUIRED");
  }

  const exact = !("areaId" in geo);
  const catalogIds = requested.map((r) => r.catalogProductId);
  const catalogs = await prisma.catalogProduct.findMany({
    where: { id: { in: catalogIds } },
    select: { id: true, name: true, sizeLabel: true, category: true, status: true }
  });
  const catalogById = new Map(catalogs.map((c) => [c.id, c]));

  const alcoholEnabled = parseAlcoholCommerceEnabled(process.env.ALCOHOL_COMMERCE_ENABLED);
  const nearby = await merchantsForBrowse(geo);
  const requestedLineCount = requested.length;

  if (!nearby.length) {
    return {
      requestedLines: requestedLineCount,
      locationMode: exact ? ("exact" as const) : ("discovery" as const),
      matches: [] as SmartBasketMatch[]
    };
  }

  const merchantIds = nearby.map((n) => n.merchant.id);
  const products = await prisma.product.findMany({
    where: {
      merchantId: { in: merchantIds },
      catalogProductId: { in: catalogIds },
      archived: false,
      available: true
    },
    include: {
      catalogProduct: true,
      merchant: { select: { id: true, name: true, isActive: true, acceptsOrders: true } }
    }
  });

  type OfferRow = (typeof products)[number];
  const offersByMerchant = new Map<string, Map<string, OfferRow>>();
  for (const product of products) {
    if (!product.catalogProductId) continue;
    if (!product.merchant.isActive || !product.merchant.acceptsOrders) continue;
    if (!offerEligible(product)) continue;
    const cat = product.catalogProduct;
    if (cat && !isPublicStorefrontCatalogProduct(cat)) continue;

    let byCatalog = offersByMerchant.get(product.merchantId);
    if (!byCatalog) {
      byCatalog = new Map();
      offersByMerchant.set(product.merchantId, byCatalog);
    }
    const existing = byCatalog.get(product.catalogProductId);
    if (!existing || product.priceCents < existing.priceCents) {
      byCatalog.set(product.catalogProductId, product);
    }
  }

  const catalogMeta = new Map<string, CoverageCatalog>();
  for (const [id, catalog] of catalogById) {
    catalogMeta.set(id, {
      name: catalog.name,
      sizeLabel: catalog.sizeLabel,
      category: catalog.category
    });
  }

  const flavorMaps = await coverageFlavorMaps(products.map((p) => p.id));

  const matches: SmartBasketMatch[] = [];
  for (const { merchant, distanceKm } of nearby) {
    if (!merchant.isActive || !merchant.acceptsOrders) continue;
    const offers = offersByMerchant.get(merchant.id);
    const offerMap = new Map<string, CoverageOffer>();
    for (const [catalogId, product] of offers ?? []) {
      offerMap.set(catalogId, {
        productId: product.id,
        name: product.catalogProduct?.name ?? product.name,
        sizeLabel: product.catalogProduct?.sizeLabel ?? product.unit ?? null,
        priceCents: product.priceCents,
        quantityApprox: product.quantityApprox,
        category: product.catalogProduct?.category ?? product.category ?? null,
        unavailableFlavorIds: flavorMaps.unavailable.get(product.id),
        activeFlavorIds: flavorMaps.active.get(product.id)
      });
    }
    const { available, missing } = evaluateMerchantCoverage({
      requested,
      catalogs: catalogMeta,
      offers: offerMap,
      alcoholEnabled
    });

    if (!available.length) continue;

    const fulfilledLineCount = available.length;
    const missingLineCount = missing.length;
    matches.push({
      merchantId: merchant.id,
      merchantName: merchant.name,
      requestedLineCount,
      fulfilledLineCount,
      missingLineCount,
      coverageRatio: coverageRatio(fulfilledLineCount, requestedLineCount),
      itemSubtotalCents: available.reduce((sum, row) => sum + row.unitPriceCents * row.quantity, 0),
      distanceKm: Math.round(distanceKm * 10) / 10,
      complete: missingLineCount === 0,
      available,
      missing
    });
  }

  return {
    requestedLines: requestedLineCount,
    locationMode: exact ? ("exact" as const) : ("discovery" as const),
    matches: rankSmartBasketMatches(matches)
  };
}

export async function selectSmartBasket(input: {
  merchantId: string;
  items: SmartBasketRequestedItem[];
  lat?: number;
  lng?: number;
  areaId?: string;
  deferDelivery?: boolean;
  acceptPartial?: boolean;
  expectedFulfilledLines?: number;
}) {
  const result = await matchSmartBasket(input);
  const match = result.matches.find((row) => row.merchantId === input.merchantId) ?? null;
  if (!match) {
    return {
      changed: true as const,
      requestedLines: result.requestedLines,
      locationMode: result.locationMode,
      match: null,
      quote: null,
      cartLines: [] as Array<{
        productId: string;
        catalogProductId: string;
        name: string;
        sizeLabel: string | null;
        quantity: number;
        unitPriceCents: number;
        merchantId: string;
        merchantName: string;
        flavorOptionId?: string | null;
        flavorPreference?: "ANY" | "SPECIFIC" | null;
      }>
    };
  }

  const expected = input.expectedFulfilledLines;
  const changed =
    (expected != null && expected !== match.fulfilledLineCount) ||
    (!input.acceptPartial && !match.complete);

  if (changed) {
    return {
      changed: true as const,
      requestedLines: result.requestedLines,
      locationMode: result.locationMode,
      match,
      quote: null,
      cartLines: [] as Array<{
        productId: string;
        catalogProductId: string;
        name: string;
        sizeLabel: string | null;
        quantity: number;
        unitPriceCents: number;
        merchantId: string;
        merchantName: string;
        flavorOptionId?: string | null;
        flavorPreference?: "ANY" | "SPECIFIC" | null;
      }>
    };
  }

  const lines = match.available.map((row) => ({
    productId: row.productId,
    quantity: row.quantity,
    flavorOptionId: row.flavorOptionId ?? null,
    flavorPreference: row.flavorPreference ?? null
  }));

  try {
    const quote = await quoteCart({
      lat: input.lat,
      lng: input.lng,
      deferDelivery: input.deferDelivery || Boolean(input.areaId),
      lines,
      preferredMerchantId: input.merchantId
    });

    if (quote.merchant.id !== input.merchantId) {
      throw new AppError("This shop can't fulfill these items right now.", 409, "BASKET_NO_MATCH");
    }

    const availableByProduct = new Map(match.available.map((row) => [row.productId, row]));
    const cartLines = quote.lines.map((line) => {
      const mapped = availableByProduct.get(line.productId);
      return {
        productId: line.productId,
        catalogProductId: mapped?.catalogProductId ?? "",
        name: mapped?.name ?? line.productName,
        sizeLabel: mapped?.sizeLabel ?? null,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        merchantId: quote.merchant.id,
        merchantName: quote.merchant.name,
        flavorOptionId: line.flavorOptionId ?? mapped?.flavorOptionId ?? null,
        flavorPreference: line.flavorPreference ?? mapped?.flavorPreference ?? null,
        flavorName: line.flavorName ?? mapped?.flavorName ?? null
      };
    });

    return {
      changed: false as const,
      requestedLines: result.requestedLines,
      locationMode: result.locationMode,
      match,
      quote,
      cartLines
    };
  } catch (err) {
    const code = err instanceof AppError ? err.code : undefined;
    if (code === "PRODUCT_UNAVAILABLE" || code === "MERCHANT_CLOSED" || code === "SHOP_NOT_NEARBY") {
      const rematch = await matchSmartBasket(input);
      const next = rematch.matches.find((row) => row.merchantId === input.merchantId) ?? null;
      return {
        changed: true as const,
        requestedLines: rematch.requestedLines,
        locationMode: rematch.locationMode,
        match: next,
        quote: null,
        cartLines: []
      };
    }
    throw err;
  }
}
