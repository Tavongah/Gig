/**
 * Snapshot one merchant's prices onto an unresolved checkout.
 * Does not approve, charge, notify, or create a CommerceOrder.
 * The proposal is not sent to the customer until approval handling exists.
 */
import { randomUUID } from "node:crypto";
import { CommerceCheckoutStatus, type CatalogProductStatus } from "@prisma/client";
import { distanceKmBetween, resolveSupportedPackagePricingCity } from "@gigflow/shared";
import { prisma } from "../../config/prisma.js";

const PRICEABLE_CATALOG = new Set<CatalogProductStatus>(["APPROVED", "PENDING"]);

export function quoteTtlMs(envValue = process.env.COMMERCE_CART_TTL_SECONDS): number {
  if (envValue && /^\d+$/.test(envValue)) {
    const n = Number(envValue);
    if (n >= 60 && n <= 86_400) return n * 1000;
  }
  return 45 * 60 * 1000;
}

export type ProposeMerchantQuoteResult = {
  outcome: "PROPOSED" | "UNCHANGED" | "REPRICE_REQUIRED" | "FIXTURE_EXCLUDED" | "NOT_PRICED";
  reason?: string;
  checkoutId: string;
  status: string;
  payable: false;
  quoteVersion: number;
  approvalId: string | null;
  quoteExpiresAt: string | null;
  itemsSubtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  lines: Array<{
    catalogProductId: string;
    quantity: number;
    unitPriceCents: number | null;
    sourceProductId: string | null;
    sourceMerchantId: string | null;
  }>;
};

type LineRow = {
  id: string;
  catalogProductId: string;
  quantity: number;
  unitPriceCents: number | null;
  sourceProductId: string | null;
  sourceMerchantId: string | null;
};

type CheckoutRow = {
  id: string;
  status: CommerceCheckoutStatus;
  validationFixture: boolean;
  quoteVersion: number;
  approvalId: string | null;
  quoteExpiresAt: Date | null;
  itemsSubtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  deliveryLabel: string;
  deliveryLatitude: { toString(): string } | number;
  deliveryLongitude: { toString(): string } | number;
  lines: LineRow[];
};

type Offer = {
  productId: string;
  catalogProductId: string;
  merchantId: string;
  priceCents: number;
  quantityApprox: number | null;
  merchantLat: number;
  merchantLng: number;
  merchantLabel: string;
  catalogStatus: CatalogProductStatus;
  available: boolean;
  archived: boolean;
  merchantActive: boolean;
  acceptsOrders: boolean;
  currency: string;
};

type Selection = {
  merchantId: string;
  byCatalog: Map<string, Offer>;
  merchandiseCents: number;
};

function present(
  row: CheckoutRow,
  outcome: ProposeMerchantQuoteResult["outcome"],
  reason?: string
): ProposeMerchantQuoteResult {
  return {
    outcome,
    reason,
    checkoutId: row.id,
    status: row.status,
    payable: false,
    quoteVersion: row.quoteVersion,
    approvalId: row.approvalId,
    quoteExpiresAt: row.quoteExpiresAt ? row.quoteExpiresAt.toISOString() : null,
    itemsSubtotalCents: row.itemsSubtotalCents,
    deliveryFeeCents: row.deliveryFeeCents,
    totalCents: row.totalCents,
    lines: row.lines.map((line) => ({
      catalogProductId: line.catalogProductId,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      sourceProductId: line.sourceProductId,
      sourceMerchantId: line.sourceMerchantId
    }))
  };
}

function cityFor(label: string | null | undefined, lat: number, lng: number) {
  return resolveSupportedPackagePricingCity({
    deliveryLabel: label,
    typedAddress: label,
    customerLatitude: lat,
    customerLongitude: lng
  });
}

function neededQuantities(lines: LineRow[]) {
  const needed = new Map<string, number>();
  for (const line of lines) {
    needed.set(line.catalogProductId, (needed.get(line.catalogProductId) ?? 0) + line.quantity);
  }
  return needed;
}

function offerUsable(offer: Offer, quantity: number) {
  if (!offer.available || offer.archived) return false;
  if (!offer.merchantActive || !offer.acceptsOrders) return false;
  if (!PRICEABLE_CATALOG.has(offer.catalogStatus)) return false;
  if (offer.currency.toLowerCase() !== "usd") return false;
  if (!Number.isInteger(offer.priceCents) || offer.priceCents < 1) return false;
  if (offer.quantityApprox != null && offer.quantityApprox < quantity) return false;
  return true;
}

async function loadOffers(catalogIds: string[]): Promise<Offer[]> {
  if (!catalogIds.length) return [];
  const products = await prisma.product.findMany({
    where: { catalogProductId: { in: catalogIds } },
    include: {
      merchant: true,
      catalogProduct: { select: { status: true } }
    }
  });
  return products.flatMap((product) => {
    if (!product.catalogProductId || !product.catalogProduct) return [];
    return [
      {
        productId: product.id,
        catalogProductId: product.catalogProductId,
        merchantId: product.merchantId,
        priceCents: product.priceCents,
        quantityApprox: product.quantityApprox,
        merchantLat: Number(product.merchant.latitude),
        merchantLng: Number(product.merchant.longitude),
        merchantLabel: product.merchant.locationLabel,
        catalogStatus: product.catalogProduct.status,
        available: product.available,
        archived: product.archived,
        merchantActive: product.merchant.isActive,
        acceptsOrders: product.merchant.acceptsOrders,
        currency: product.currency
      }
    ];
  });
}

function selectFullCoverageMerchant(input: {
  checkoutLat: number;
  checkoutLng: number;
  checkoutCity: NonNullable<ReturnType<typeof cityFor>>;
  lines: LineRow[];
  offers: Offer[];
}): Selection | null {
  const needed = neededQuantities(input.lines);
  const grouped = new Map<string, Offer[]>();
  for (const offer of input.offers) {
    if (cityFor(offer.merchantLabel, offer.merchantLat, offer.merchantLng) !== input.checkoutCity) continue;
    const rows = grouped.get(offer.merchantId) ?? [];
    rows.push(offer);
    grouped.set(offer.merchantId, rows);
  }

  const winners: Array<Selection & { distanceKm: number }> = [];
  for (const [merchantId, rows] of grouped) {
    const byCatalog = new Map<string, Offer>();
    let merchandiseCents = 0;
    let covers = true;
    for (const [catalogProductId, quantity] of needed) {
      const offer = rows.find(
        (row) => row.catalogProductId === catalogProductId && offerUsable(row, quantity)
      );
      if (!offer) {
        covers = false;
        break;
      }
      byCatalog.set(catalogProductId, offer);
      merchandiseCents += offer.priceCents * quantity;
    }
    if (!covers) continue;
    const sample = rows[0]!;
    winners.push({
      merchantId,
      byCatalog,
      merchandiseCents,
      distanceKm: distanceKmBetween(
        { latitude: input.checkoutLat, longitude: input.checkoutLng },
        { latitude: sample.merchantLat, longitude: sample.merchantLng }
      )
    });
  }
  winners.sort((a, b) => {
    if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
    if (a.merchandiseCents !== b.merchandiseCents) return a.merchandiseCents - b.merchandiseCents;
    return a.merchantId.localeCompare(b.merchantId);
  });
  return winners[0] ?? null;
}

async function inspectProposal(row: CheckoutRow): Promise<ProposeMerchantQuoteResult> {
  const productIds = row.lines.map((line) => line.sourceProductId).filter((id): id is string => Boolean(id));
  if (productIds.length !== row.lines.length) return present(row, "REPRICE_REQUIRED", "SOURCE_MISSING");
  const offers = await loadOffers(row.lines.map((line) => line.catalogProductId));
  const byId = new Map(offers.map((offer) => [offer.productId, offer]));
  const needed = neededQuantities(row.lines);
  for (const line of row.lines) {
    const offer = line.sourceProductId ? byId.get(line.sourceProductId) : undefined;
    const quantity = needed.get(line.catalogProductId) ?? line.quantity;
    if (!offer || !offerUsable(offer, quantity) || offer.priceCents !== line.unitPriceCents) {
      return present(row, "REPRICE_REQUIRED", "SOURCE_PRICE_CHANGED");
    }
    if (offer.merchantId !== line.sourceMerchantId) return present(row, "REPRICE_REQUIRED", "SOURCE_CHANGED");
  }
  return present(row, "UNCHANGED");
}

/**
 * Explicit entry point. Does not scan unresolved checkouts.
 * validationFixture rows are excluded by the query predicate.
 */
export async function proposeMerchantPriceForCheckout(checkoutId: string): Promise<ProposeMerchantQuoteResult> {
  const row = await prisma.commerceCheckout.findUnique({
    where: { id: checkoutId },
    include: { lines: true }
  });
  if (!row) {
    return {
      outcome: "NOT_PRICED",
      reason: "NOT_FOUND",
      checkoutId,
      status: "MISSING",
      payable: false,
      quoteVersion: 0,
      approvalId: null,
      quoteExpiresAt: null,
      itemsSubtotalCents: 0,
      deliveryFeeCents: 0,
      totalCents: 0,
      lines: []
    };
  }
  if (row.validationFixture) return present(row, "FIXTURE_EXCLUDED", "VALIDATION_FIXTURE");
  if (row.status === CommerceCheckoutStatus.PRICE_PROPOSED) return inspectProposal(row);
  if (row.status !== CommerceCheckoutStatus.AWAITING_FULFILLMENT) {
    return present(row, "NOT_PRICED", "NOT_AWAITING");
  }

  const checkoutLat = Number(row.deliveryLatitude);
  const checkoutLng = Number(row.deliveryLongitude);
  const checkoutCity = cityFor(row.deliveryLabel, checkoutLat, checkoutLng);
  if (!checkoutCity) return present(row, "NOT_PRICED", "UNSUPPORTED_CITY");

  const offers = await loadOffers([...new Set(row.lines.map((line) => line.catalogProductId))]);
  const selected = selectFullCoverageMerchant({
    checkoutLat,
    checkoutLng,
    checkoutCity,
    lines: row.lines,
    offers
  });
  if (!selected) return present(row, "NOT_PRICED", "NO_FULL_MERCHANT");

  return prisma.$transaction(async (tx) => {
    const current = await tx.commerceCheckout.findFirst({
      where: { id: checkoutId, validationFixture: false },
      include: { lines: true }
    });
    if (!current) return present(row, "FIXTURE_EXCLUDED", "VALIDATION_FIXTURE");
    if (current.status === CommerceCheckoutStatus.PRICE_PROPOSED) return inspectProposal(current);
    if (current.status !== CommerceCheckoutStatus.AWAITING_FULFILLMENT) {
      return present(current, "NOT_PRICED", "NOT_AWAITING");
    }

    const fresh = await tx.product.findMany({
      where: { id: { in: [...selected.byCatalog.values()].map((offer) => offer.productId) } },
      include: { merchant: true, catalogProduct: { select: { status: true } } }
    });
    const freshByCatalog = new Map(
      fresh.flatMap((product) => (product.catalogProductId ? [[product.catalogProductId, product] as const] : []))
    );
    const needed = neededQuantities(current.lines);
    let itemsSubtotalCents = 0;
    for (const [catalogProductId, quantity] of needed) {
      const chosen = selected.byCatalog.get(catalogProductId);
      const product = freshByCatalog.get(catalogProductId);
      if (!chosen || !product || product.id !== chosen.productId || product.priceCents !== chosen.priceCents) {
        return present(current, "NOT_PRICED", "SOURCE_CHANGED");
      }
      const still: Offer = {
        productId: product.id,
        catalogProductId,
        merchantId: product.merchantId,
        priceCents: product.priceCents,
        quantityApprox: product.quantityApprox,
        merchantLat: Number(product.merchant.latitude),
        merchantLng: Number(product.merchant.longitude),
        merchantLabel: product.merchant.locationLabel,
        catalogStatus: product.catalogProduct?.status ?? "ARCHIVED",
        available: product.available,
        archived: product.archived,
        merchantActive: product.merchant.isActive,
        acceptsOrders: product.merchant.acceptsOrders,
        currency: product.currency
      };
      if (!offerUsable(still, quantity) || product.merchantId !== selected.merchantId) {
        return present(current, "NOT_PRICED", "SOURCE_CHANGED");
      }
      itemsSubtotalCents += product.priceCents * quantity;
    }

    const now = new Date();
    const approvalId = randomUUID();
    const quoteVersion = current.quoteVersion + 1;
    const quoteExpiresAt = new Date(now.getTime() + quoteTtlMs());
    for (const line of current.lines) {
      const product = freshByCatalog.get(line.catalogProductId);
      if (!product) return present(current, "NOT_PRICED", "SOURCE_CHANGED");
      await tx.commerceCheckoutLine.update({
        where: { id: line.id },
        data: {
          unitPriceCents: product.priceCents,
          sourceProductId: product.id,
          sourceMerchantId: product.merchantId,
          quotedAt: now
        }
      });
    }
    const written = await tx.commerceCheckout.updateMany({
      where: {
        id: checkoutId,
        status: CommerceCheckoutStatus.AWAITING_FULFILLMENT,
        validationFixture: false
      },
      data: {
        status: CommerceCheckoutStatus.PRICE_PROPOSED,
        itemsSubtotalCents,
        totalCents: itemsSubtotalCents + current.deliveryFeeCents,
        quoteVersion,
        approvalId,
        quoteExpiresAt
      }
    });
    if (written.count !== 1) {
      throw new Error("Quote proposal lost the checkout status race.");
    }
    const saved = await tx.commerceCheckout.findFirstOrThrow({
      where: { id: checkoutId, validationFixture: false },
      include: { lines: true }
    });
    return present(saved, "PROPOSED");
  });
}
