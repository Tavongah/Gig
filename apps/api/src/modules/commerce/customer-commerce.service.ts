import {
  CATALOG_PRODUCT_SCAN_LIMIT,
  STOREFRONT_SHOW_APPROVED_CATALOG_WITHOUT_OFFERS,
  UNRESOLVED_LEGACY_CATALOG_PRODUCT_IDS,
  canPurchaseStorefrontCategory,
  catalogSearchHaystack,
  commerceShopUiStatusLabel,
  expandSearchTerms,
  isPublicStorefrontCatalogProduct,
  normalizeProductSearchName,
  parseAlcoholCommerceEnabled,
  type CommerceOrderStatus
} from "@gigflow/shared";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import {
  buildOneStoreBasket,
  findNearbyMerchants,
  listMerchantProducts,
  type BasketLine
} from "./merchant.service.js";
import { findMerchantsInShoppingArea } from "./shopping-areas.js";
import { createConfirmedCommerceOrder, quoteBasketTotals } from "./order.service.js";
import { ensureAppCommerceCustomer } from "./commerce-customer.service.js";
import type { CommercePaymentMethod, OrderSource } from "@prisma/client";
import { browserAccessibleMediaUrl } from "../../lib/catalog-media.js";
import {
  catalogOnlyAcc,
  clampStorefrontPage,
  matchesStorefrontCategory,
  paginateStorefront,
  presentStorefrontCard,
  scoreStorefrontSearch,
  storefrontCategoryNeedle,
  storefrontSearchTerms,
  type StorefrontAcc
} from "./storefront-catalog.js";

export type BrowseGeo = { areaId: string } | { lat: number; lng: number };

const unresolvedLegacyIds = [...UNRESOLVED_LEGACY_CATALOG_PRODUCT_IDS];

async function merchantsForBrowse(geo?: BrowseGeo | null) {
  if (!geo) return [];
  if ("areaId" in geo) {
    return findMerchantsInShoppingArea(geo.areaId);
  }
  return findNearbyMerchants(geo.lat, geo.lng);
}

function offerEligible(product: {
  available: boolean;
  archived: boolean;
  catalogProduct?: { status: string; submittedByMerchantId: string | null } | null;
  merchantId: string;
}) {
  if (!product.available || product.archived) return false;
  const cat = product.catalogProduct;
  if (!cat) return true;
  if (cat.status === "ARCHIVED" || cat.status === "REJECTED") return false;
  if (cat.status === "PENDING" && cat.submittedByMerchantId !== product.merchantId) return false;
  return true;
}

export async function browseNearbyShops(geo: BrowseGeo) {
  const nearby = await merchantsForBrowse(geo);
  return {
    shops: nearby.map(({ merchant, distanceKm }) => ({
      id: merchant.id,
      name: merchant.name,
      category: merchant.category,
      locationLabel: merchant.locationLabel,
      distanceKm: Math.round(distanceKm * 10) / 10,
      logoUrl: merchant.logoUrl,
      openingHours: merchant.openingHours
    }))
  };
}

async function collectNearbyOffers(input: {
  geo?: BrowseGeo | null;
  terms: string[];
  categoryFilter?: string;
}) {
  const nearby = await merchantsForBrowse(input.geo);
  const byCatalogId = new Map<string, StorefrontAcc>();
  const unlinked: StorefrontAcc[] = [];
  if (nearby.length === 0) return { nearby, byCatalogId, unlinked };

  const merchantIds = nearby.map((n) => n.merchant.id);
  const products = await prisma.product.findMany({
    where: {
      merchantId: { in: merchantIds },
      archived: false,
      available: true
    },
    include: {
      catalogProduct: true,
      merchant: { select: { id: true, name: true, isActive: true, acceptsOrders: true } }
    },
    take: 500
  });

  for (const product of products) {
    if (!product.merchant.isActive || !product.merchant.acceptsOrders) continue;
    if (!offerEligible(product)) continue;

    const cat = product.catalogProduct;
    if (cat && !isPublicStorefrontCatalogProduct(cat)) continue;

    const name = cat?.name ?? product.name;
    const brand = cat?.brand ?? null;
    const sizeLabel = cat?.sizeLabel ?? product.unit ?? null;
    const category = cat?.category ?? product.category ?? null;
    const description = cat?.description ?? product.description ?? null;
    const imageUrl = browserAccessibleMediaUrl(cat?.primaryImageUrl ?? product.imageUrl ?? null);

    if (!matchesStorefrontCategory(category, input.categoryFilter)) continue;

    const score = scoreStorefrontSearch({
      name,
      brand,
      sizeLabel,
      category,
      barcode: cat?.barcode,
      terms: input.terms
    });
    if (input.terms.length && score <= 0) continue;

    const acc: StorefrontAcc = {
      catalogProductId: cat?.id ?? null,
      productId: product.id,
      name,
      brand,
      sizeLabel,
      category,
      description,
      imageUrl,
      fromPriceCents: product.priceCents,
      currency: product.currency,
      merchantOfferCount: 1,
      purchasable: true,
      score
    };

    if (!cat?.id) {
      unlinked.push(acc);
      continue;
    }

    const existing = byCatalogId.get(cat.id);
    if (!existing) {
      byCatalogId.set(cat.id, acc);
    } else {
      existing.merchantOfferCount += 1;
      existing.score = Math.max(existing.score, score);
      if (product.priceCents < (existing.fromPriceCents ?? Number.POSITIVE_INFINITY)) {
        existing.fromPriceCents = product.priceCents;
        existing.productId = product.id;
        existing.currency = product.currency;
      }
      if (!existing.imageUrl && imageUrl) existing.imageUrl = imageUrl;
    }
  }

  return { nearby, byCatalogId, unlinked };
}

export async function browseNearbyProducts(input: {
  areaId?: string;
  lat?: number;
  lng?: number;
  q?: string;
  category?: string;
  limit?: number;
  offset?: number;
}) {
  const { limit, offset } = clampStorefrontPage(input.limit, input.offset);
  const geo: BrowseGeo | undefined = input.areaId
    ? { areaId: input.areaId }
    : input.lat != null && input.lng != null
      ? { lat: input.lat, lng: input.lng }
      : undefined;
  const terms = storefrontSearchTerms(input.q);
  const categoryFilter = storefrontCategoryNeedle(input.category);
  const { nearby, byCatalogId, unlinked } = await collectNearbyOffers({ geo, terms, categoryFilter });

  if (!STOREFRONT_SHOW_APPROVED_CATALOG_WITHOUT_OFFERS) {
    const rows = [...byCatalogId.values(), ...unlinked];
    return { ...paginateStorefront(rows, limit, offset), shopsNearby: nearby.length };
  }

  const catalogRows = await prisma.catalogProduct.findMany({
    where: {
      status: "APPROVED",
      id: { notIn: unresolvedLegacyIds }
    },
    take: CATALOG_PRODUCT_SCAN_LIMIT
  });

  const byKey = new Map<string, StorefrontAcc>();
  for (const cat of catalogRows) {
    if (!matchesStorefrontCategory(cat.category, categoryFilter)) continue;
    const catalogAcc = catalogOnlyAcc({
      id: cat.id,
      name: cat.name,
      brand: cat.brand,
      sizeLabel: cat.sizeLabel,
      category: cat.category,
      description: cat.description,
      primaryImageUrl: cat.primaryImageUrl,
      barcode: cat.barcode,
      terms
    });
    if (!catalogAcc) continue;
    const offer = byCatalogId.get(cat.id);
    byKey.set(
      cat.id,
      offer
        ? {
            ...offer,
            name: cat.name,
            brand: cat.brand,
            sizeLabel: cat.sizeLabel,
            category: cat.category,
            description: cat.description,
            imageUrl: catalogAcc.imageUrl ?? offer.imageUrl,
            score: Math.max(offer.score, catalogAcc.score)
          }
        : catalogAcc
    );
  }

  for (const row of unlinked) {
    byKey.set(`offer:${row.productId}`, row);
  }

  return { ...paginateStorefront([...byKey.values()], limit, offset), shopsNearby: nearby.length };
}

export async function listBrowseCategories(_geo?: BrowseGeo | null) {
  if (!STOREFRONT_SHOW_APPROVED_CATALOG_WITHOUT_OFFERS) {
    const browseInput = _geo
      ? "areaId" in _geo
        ? { areaId: _geo.areaId }
        : { lat: _geo.lat, lng: _geo.lng }
      : {};
    const { products } = await browseNearbyProducts({ ...browseInput, limit: 48, offset: 0 });
    const counts = new Map<string, number>();
    for (const p of products) {
      const cat = (p.category || "Other").trim() || "Other";
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    const categories = [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return { categories };
  }

  const groups = await prisma.catalogProduct.groupBy({
    by: ["category"],
    where: { status: "APPROVED", id: { notIn: unresolvedLegacyIds } },
    _count: { _all: true }
  });
  const categories = groups
    .map((g) => ({ name: (g.category || "Other").trim() || "Other", count: g._count._all }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { categories };
}

export async function getProductDetailNear(input: {
  areaId?: string;
  lat?: number;
  lng?: number;
  catalogProductId?: string;
  productId?: string;
}) {
  const geo: BrowseGeo | undefined = input.areaId
    ? { areaId: input.areaId }
    : input.lat != null && input.lng != null
      ? { lat: input.lat, lng: input.lng }
      : undefined;
  const nearby = await merchantsForBrowse(geo);
  const merchantById = new Map(nearby.map((n) => [n.merchant.id, n]));

  let catalogId = input.catalogProductId ?? null;
  let seedProduct = null as Awaited<ReturnType<typeof prisma.product.findUnique>>;

  if (input.productId) {
    seedProduct = await prisma.product.findUnique({
      where: { id: input.productId },
      include: { catalogProduct: true }
    });
    if (!seedProduct) throw new AppError("Product not found.", 404, "PRODUCT_NOT_FOUND");
    catalogId = seedProduct.catalogProductId ?? catalogId;
  }

  const catalog = catalogId
    ? await prisma.catalogProduct.findUnique({ where: { id: catalogId } })
    : null;

  if (catalog && !isPublicStorefrontCatalogProduct(catalog)) {
    const shopOfferOk = Boolean(seedProduct && offerEligible(seedProduct));
    if (!shopOfferOk) {
      throw new AppError("Product not found.", 404, "PRODUCT_NOT_FOUND");
    }
  }
  if (!catalog && !seedProduct) {
    throw new AppError("Product not found.", 404, "PRODUCT_NOT_FOUND");
  }

  const merchantIds = [...merchantById.keys()];
  const offers =
    merchantIds.length === 0
      ? []
      : await prisma.product.findMany({
          where: catalogId
            ? {
                catalogProductId: catalogId,
                merchantId: { in: merchantIds },
                archived: false,
                available: true
              }
            : {
                id: input.productId,
                archived: false,
                available: true
              },
          include: {
            merchant: true,
            catalogProduct: true
          },
          orderBy: { priceCents: "asc" }
        });

  const eligibleOffers = offers
    .filter((o) => offerEligible(o) && merchantById.has(o.merchantId))
    .filter((o) => !o.catalogProduct || isPublicStorefrontCatalogProduct(o.catalogProduct) || Boolean(input.productId))
    .map((o) => {
      const dist = merchantById.get(o.merchantId)!;
      return {
        productId: o.id,
        merchantId: o.merchantId,
        merchantName: o.merchant.name,
        distanceKm: Math.round(dist.distanceKm * 10) / 10,
        priceCents: o.priceCents,
        currency: o.currency,
        available: o.available
      };
    })
    .sort((a, b) => a.priceCents - b.priceCents || a.distanceKm - b.distanceKm);

  const publicCatalog = catalog && isPublicStorefrontCatalogProduct(catalog) ? catalog : null;
  const name = publicCatalog?.name ?? seedProduct?.name ?? "Product";
  const imageUrl = browserAccessibleMediaUrl(publicCatalog?.primaryImageUrl ?? seedProduct?.imageUrl ?? null);
  const category = publicCatalog?.category ?? seedProduct?.category ?? null;
  const alcoholOk = canPurchaseStorefrontCategory(
    category,
    parseAlcoholCommerceEnabled(process.env.ALCOHOL_COMMERCE_ENABLED)
  );
  const purchasable = alcoholOk && eligibleOffers.length > 0;

  return {
    product: {
      catalogProductId: publicCatalog?.id ?? catalog?.id ?? null,
      name,
      brand: publicCatalog?.brand ?? null,
      sizeLabel: publicCatalog?.sizeLabel ?? seedProduct?.unit ?? null,
      category,
      description: publicCatalog?.description ?? seedProduct?.description ?? null,
      imageUrl
    },
    offers: purchasable ? eligibleOffers : [],
    purchasable,
    fromPriceCents: purchasable ? eligibleOffers[0]?.priceCents ?? null : null
  };
}

export async function getShopCatalog(input: BrowseGeo & {
  merchantId: string;
  q?: string;
}) {
  const nearby = await merchantsForBrowse(input);
  const hit = nearby.find((n) => n.merchant.id === input.merchantId);
  if (!hit) {
    throw new AppError("This shop is not available near your location.", 404, "SHOP_NOT_NEARBY");
  }

  const products = await listMerchantProducts(input.merchantId, false);
  const withCatalog = await prisma.product.findMany({
    where: { id: { in: products.map((p) => p.id) } },
    include: { catalogProduct: true }
  });

  const q = normalizeProductSearchName(input.q ?? "");
  const terms = q ? expandSearchTerms(q) : [];

  const items = withCatalog
    .filter((p) => offerEligible(p))
    .map((p) => {
      const cat = p.catalogProduct;
      const name = cat?.name ?? p.name;
      const brand = cat?.brand ?? null;
      const sizeLabel = cat?.sizeLabel ?? p.unit ?? null;
      const category = cat?.category ?? p.category ?? null;
      let score = 1;
      if (terms.length) {
        const hay = catalogSearchHaystack({
          name,
          brand,
          sizeLabel,
          category,
          barcode: cat?.barcode
        });
        score = 0;
        for (const t of terms) {
          if (!t) continue;
          if (hay.includes(t)) score += 40;
          if (normalizeProductSearchName(name) === t) score += 100;
        }
      }
      return {
        score,
        card: presentStorefrontCard({
          catalogProductId: cat?.id ?? null,
          productId: p.id,
          name,
          brand,
          sizeLabel,
          category,
          description: cat?.description ?? p.description ?? null,
          imageUrl: browserAccessibleMediaUrl(cat?.primaryImageUrl ?? p.imageUrl ?? null),
          fromPriceCents: p.priceCents,
          currency: p.currency,
          merchantOfferCount: 1,
          purchasable: true,
          score
        })
      };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.card.name.localeCompare(b.card.name))
    .map((row) => row.card);

  return {
    shop: {
      id: hit.merchant.id,
      name: hit.merchant.name,
      category: hit.merchant.category,
      locationLabel: hit.merchant.locationLabel,
      distanceKm: Math.round(hit.distanceKm * 10) / 10,
      openingHours: hit.merchant.openingHours,
      logoUrl: hit.merchant.logoUrl
    },
    products: items
  };
}

export async function quoteCart(input: {
  lat?: number;
  lng?: number;
  deferDelivery?: boolean;
  lines: Array<{ productId: string; quantity: number }>;
  preferredMerchantId?: string;
}) {
  if (!input.lines.length) throw new AppError("Basket is empty.", 400, "EMPTY_BASKET");

  const products = await prisma.product.findMany({
    where: { id: { in: input.lines.map((l) => l.productId) } },
    include: { merchant: true, catalogProduct: true }
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const merchantIds = new Set<string>();
  const basketLines: BasketLine[] = [];
  const unavailable: string[] = [];
  const alcoholEnabled = parseAlcoholCommerceEnabled(process.env.ALCOHOL_COMMERCE_ENABLED);
  for (const line of input.lines) {
    const product = byId.get(line.productId);
    if (!product || !offerEligible(product)) {
      unavailable.push(product?.catalogProduct?.name ?? product?.name ?? "An item");
      continue;
    }
    const category = product.catalogProduct?.category ?? product.category;
    if (!canPurchaseStorefrontCategory(category, alcoholEnabled)) {
      throw new AppError("Alcohol ordering isn't available yet.", 409, "ALCOHOL_DISABLED");
    }
    merchantIds.add(product.merchantId);
    const qty = Math.max(1, Math.min(99, Math.floor(line.quantity)));
    basketLines.push({
      productId: product.id,
      productName: product.catalogProduct?.name ?? product.name,
      quantity: qty,
      unitPriceCents: product.priceCents,
      lineTotalCents: product.priceCents * qty,
      merchantId: product.merchantId
    });
  }

  if (unavailable.length) {
    const names = [...new Set(unavailable)];
    throw new AppError(
      names.length === 1 ? `${names[0]} is unavailable.` : `${names.join(", ")} are unavailable.`,
      409,
      "PRODUCT_UNAVAILABLE",
      { unavailable: names.join(", ") }
    );
  }

  if (merchantIds.size > 1) {
    throw new AppError(
      "Your basket has items from more than one shop. Keep one shop per order.",
      409,
      "MULTI_STORE_BASKET"
    );
  }

  const merchantId = [...merchantIds][0]!;
  const merchant = products.find((p) => p.merchantId === merchantId)?.merchant;
  if (!merchant || !merchant.isActive || !merchant.acceptsOrders) {
    throw new AppError("This shop is not available right now.", 409, "MERCHANT_CLOSED");
  }

  if (input.deferDelivery) {
    const subtotalCents = basketLines.reduce((sum, line) => sum + line.lineTotalCents, 0);
    return {
      merchant: {
        id: merchant.id,
        name: merchant.name,
        distanceKm: null as number | null
      },
      lines: basketLines,
      subtotalCents,
      deliveryFeeCents: 0,
      serviceFeeCents: 0,
      totalCents: subtotalCents,
      currency: "usd" as const,
      deliveryQuoteStatus: "deferred" as const
    };
  }

  if (input.lat == null || input.lng == null) {
    throw new AppError("Delivery location is required to calculate delivery.", 400, "LOCATION_REQUIRED");
  }

  const nearby = await findNearbyMerchants(input.lat, input.lng);
  const dist = nearby.find((n) => n.merchant.id === merchantId);
  if (!dist) {
    throw new AppError("We can't deliver from this shop to that location yet.", 409, "SHOP_NOT_NEARBY");
  }

  const totals = await quoteBasketTotals({
    merchantLat: Number(merchant.latitude),
    merchantLng: Number(merchant.longitude),
    customerLat: input.lat,
    customerLng: input.lng,
    lines: basketLines
  });

  return {
    merchant: {
      id: merchant.id,
      name: merchant.name,
      distanceKm: Math.round(dist.distanceKm * 10) / 10
    },
    lines: basketLines,
    ...totals,
    deliveryQuoteStatus: "final" as const
  };
}

export async function checkoutCart(input: {
  userId: string;
  lat: number;
  lng: number;
  deliveryLabel: string;
  lines: Array<{ productId: string; quantity: number }>;
  paymentMethod?: string;
  customerPhone?: string;
}) {
  const quote = await quoteCart({
    lat: input.lat,
    lng: input.lng,
    lines: input.lines
  });

  const commerceCustomer = await ensureAppCommerceCustomer(input.userId);

  const order = await createConfirmedCommerceOrder({
    customerId: input.userId,
    commerceCustomerId: commerceCustomer.id,
    merchantId: quote.merchant.id,
    lines: quote.lines,
    deliveryLabel: input.deliveryLabel.trim() || "Delivery location",
    deliveryLatitude: input.lat,
    deliveryLongitude: input.lng,
    customerWhatsAppPhone: input.customerPhone,
    paymentMethod: (input.paymentMethod as CommercePaymentMethod | undefined) ?? "CASH",
    orderSource: "APP" as OrderSource
  });

  return {
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      statusLabel: commerceShopUiStatusLabel(order.status as CommerceOrderStatus),
      totalCents: order.totalCents,
      currency: order.currency,
      merchantName: quote.merchant.name,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod
    }
  };
}

export async function listCustomerCommerceOrders(userId: string) {
  const orders = await prisma.commerceOrder.findMany({
    where: { customerId: userId },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: {
      merchant: { select: { id: true, name: true } },
      items: true
    }
  });

  return {
    orders: orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      statusLabel: commerceShopUiStatusLabel(o.status as CommerceOrderStatus),
      totalCents: o.totalCents,
      currency: o.currency,
      merchantName: o.merchant.name,
      itemCount: o.items.reduce((s, i) => s + i.quantity, 0),
      createdAt: o.createdAt,
      paymentStatus: o.paymentStatus
    }))
  };
}

export async function getCustomerCommerceOrder(userId: string, orderId: string) {
  const order = await prisma.commerceOrder.findFirst({
    where: { id: orderId, customerId: userId },
    include: {
      merchant: { select: { id: true, name: true, locationLabel: true } },
      items: true,
      linkedDeliveryGig: { select: { id: true, status: true } }
    }
  });
  if (!order) throw new AppError("Order not found.", 404, "ORDER_NOT_FOUND");

  return {
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      statusLabel: commerceShopUiStatusLabel(
        order.status as CommerceOrderStatus,
        order.linkedDeliveryGig?.status ?? null
      ),
      totalCents: order.totalCents,
      subtotalCents: order.subtotalCents,
      deliveryFeeCents: order.deliveryFeeCents,
      serviceFeeCents: order.serviceFeeCents,
      currency: order.currency,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      merchant: order.merchant,
      deliveryLabel: order.deliveryLabel,
      items: order.items.map((i) => ({
        name: i.productNameSnapshot,
        quantity: i.quantity,
        unitPriceCents: i.unitPriceCents,
        lineTotalCents: i.lineTotalCents
      })),
      deliveryStatus: order.linkedDeliveryGig?.status ?? null
    }
  };
}

/** Text-query basket helper for WhatsApp-parity flows (optional). */
export async function quoteTextBasket(input: {
  lat: number;
  lng: number;
  items: Array<{ query: string; quantity: number }>;
  preferredMerchantId?: string;
}) {
  const basket = await buildOneStoreBasket(input.lat, input.lng, input.items, {
    preferredMerchantId: input.preferredMerchantId
  });
  if (!basket.ok) {
    return { ok: false as const, missing: basket.missing };
  }
  const totals = await quoteBasketTotals({
    merchantLat: Number(basket.merchant.latitude),
    merchantLng: Number(basket.merchant.longitude),
    customerLat: input.lat,
    customerLng: input.lng,
    lines: basket.lines
  });
  return {
    ok: true as const,
    merchant: {
      id: basket.merchant.id,
      name: basket.merchant.name,
      distanceKm: Math.round(basket.distanceKm * 10) / 10
    },
    lines: basket.lines,
    ...totals,
    switchedFromPreferred: basket.switchedFromPreferred
  };
}
