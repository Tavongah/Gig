import {
  catalogSearchHaystack,
  commerceShopUiStatusLabel,
  expandSearchTerms,
  normalizeProductSearchName,
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

export type BrowseGeo = { areaId: string } | { lat: number; lng: number };

async function merchantsForBrowse(geo: BrowseGeo) {
  if ("areaId" in geo) {
    return findMerchantsInShoppingArea(geo.areaId);
  }
  return findNearbyMerchants(geo.lat, geo.lng);
}

const PLACEHOLDER_IMAGE = null;

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

function presentCatalogCard(input: {
  catalogProductId: string | null;
  productId: string;
  name: string;
  brand: string | null;
  sizeLabel: string | null;
  category: string | null;
  description: string | null;
  imageUrl: string | null;
  fromPriceCents: number;
  currency: string;
  offerCount: number;
}) {
  return {
    catalogProductId: input.catalogProductId,
    /** Representative offer id for quick-add when only one nearby offer exists. */
    productId: input.productId,
    name: input.name,
    brand: input.brand,
    sizeLabel: input.sizeLabel,
    category: input.category,
    description: input.description,
    imageUrl: browserAccessibleMediaUrl(input.imageUrl) ?? PLACEHOLDER_IMAGE,
    fromPriceCents: input.fromPriceCents,
    currency: input.currency,
    offerCount: input.offerCount
  };
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

export async function browseNearbyProducts(input: BrowseGeo & {
  q?: string;
  category?: string;
  limit?: number;
}) {
  const limit = Math.min(input.limit ?? 40, 80);
  const nearby = await merchantsForBrowse(input);
  if (nearby.length === 0) {
    return { products: [] as ReturnType<typeof presentCatalogCard>[], shopsNearby: 0 };
  }

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

  const q = normalizeProductSearchName(input.q ?? "");
  const terms = q ? expandSearchTerms(q) : [];
  const categoryFilter = input.category?.trim().toLowerCase();

  type Acc = {
    key: string;
    catalogProductId: string | null;
    productId: string;
    name: string;
    brand: string | null;
    sizeLabel: string | null;
    category: string | null;
    description: string | null;
    imageUrl: string | null;
    fromPriceCents: number;
    currency: string;
    offerCount: number;
    score: number;
  };

  const byKey = new Map<string, Acc>();

  for (const product of products) {
    if (!product.merchant.isActive || !product.merchant.acceptsOrders) continue;
    if (!offerEligible(product)) continue;

    const cat = product.catalogProduct;
    const name = cat?.name ?? product.name;
    const brand = cat?.brand ?? null;
    const sizeLabel = cat?.sizeLabel ?? product.unit ?? null;
    const category = cat?.category ?? product.category ?? null;
    const description = cat?.description ?? product.description ?? null;
    const imageUrl = browserAccessibleMediaUrl(cat?.primaryImageUrl ?? product.imageUrl ?? null);
    const key = cat?.id ?? `offer:${product.id}`;

    if (categoryFilter && !(category ?? "").toLowerCase().includes(categoryFilter)) {
      continue;
    }

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
        if (hay === t || normalizeProductSearchName(name) === t) score += 100;
        else if (hay.includes(t)) score += 40;
      }
      if (score <= 0) continue;
    }

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        key,
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
        offerCount: 1,
        score
      });
    } else {
      existing.offerCount += 1;
      existing.score = Math.max(existing.score, score);
      if (product.priceCents < existing.fromPriceCents) {
        existing.fromPriceCents = product.priceCents;
        existing.productId = product.id;
      }
      if (!existing.imageUrl && imageUrl) existing.imageUrl = imageUrl;
    }
  }

  const productsOut = [...byKey.values()]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((row) =>
      presentCatalogCard({
        catalogProductId: row.catalogProductId,
        productId: row.productId,
        name: row.name,
        brand: row.brand,
        sizeLabel: row.sizeLabel,
        category: row.category,
        description: row.description,
        imageUrl: row.imageUrl,
        fromPriceCents: row.fromPriceCents,
        currency: row.currency,
        offerCount: row.offerCount
      })
    );

  return { products: productsOut, shopsNearby: nearby.length };
}

export async function listBrowseCategories(geo: BrowseGeo) {
  const { products } = await browseNearbyProducts({ ...geo, limit: 200 });
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

export async function getProductDetailNear(input: BrowseGeo & {
  catalogProductId?: string;
  productId?: string;
}) {
  const nearby = await merchantsForBrowse(input);
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

  const offers = await prisma.product.findMany({
    where: catalogId
      ? {
          catalogProductId: catalogId,
          merchantId: { in: [...merchantById.keys()] },
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

  const name = catalog?.name ?? seedProduct?.name ?? "Product";
  const imageUrl = browserAccessibleMediaUrl(catalog?.primaryImageUrl ?? seedProduct?.imageUrl ?? null);

  return {
    product: {
      catalogProductId: catalog?.id ?? null,
      name,
      brand: catalog?.brand ?? null,
      sizeLabel: catalog?.sizeLabel ?? seedProduct?.unit ?? null,
      category: catalog?.category ?? seedProduct?.category ?? null,
      description: catalog?.description ?? seedProduct?.description ?? null,
      imageUrl
    },
    offers: eligibleOffers,
    fromPriceCents: eligibleOffers[0]?.priceCents ?? null
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
        card: presentCatalogCard({
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
          offerCount: 1
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
  for (const line of input.lines) {
    const product = byId.get(line.productId);
    if (!product || !offerEligible(product)) {
      unavailable.push(product?.catalogProduct?.name ?? product?.name ?? "An item");
      continue;
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
    throw new AppError("This shop is not accepting orders right now.", 409, "MERCHANT_CLOSED");
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
    throw new AppError("This shop is not available near your delivery location.", 409, "SHOP_NOT_NEARBY");
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
