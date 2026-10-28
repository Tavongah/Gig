/**
 * Seller Marketplace V1 foundation.
 * Seller-owned inventory only — no warehouse, no customer checkout wiring.
 */
import {
  DEFAULT_MARKETPLACE_SELLER_COMMISSION_RATE,
  computeSellerCommissionCents,
  parseSellerMarketplaceEnabled
} from "@gigflow/shared";
import {
  CatalogProductStatus,
  SellerOfferStatus,
  SellerSettlementStatus,
  SellerStatus,
  type Seller,
  type SellerOffer
} from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { normalizeMerchantPhone } from "./merchant.service.js";

export function isSellerMarketplaceCustomerEnabled(): boolean {
  return parseSellerMarketplaceEnabled(env.SELLER_MARKETPLACE_ENABLED);
}

export async function getSellerCommissionRate(): Promise<number> {
  const settings = await prisma.platformSetting.findUnique({ where: { id: "default" } });
  if (!settings) return DEFAULT_MARKETPLACE_SELLER_COMMISSION_RATE;
  return Number(settings.marketplaceSellerCommissionRate);
}

function assertPickupCoordinates(lat: number, lng: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new AppError("Invalid pickup coordinates.", 400, "INVALID_PICKUP_COORDS");
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new AppError("Pickup coordinates out of range.", 400, "INVALID_PICKUP_COORDS");
  }
}

export async function createSeller(input: {
  displayName: string;
  contactName?: string;
  phone: string;
  whatsappPhone?: string;
  pickupLocationLabel: string;
  pickupLatitude: number;
  pickupLongitude: number;
  ownerUserId?: string;
  notes?: string;
  status?: SellerStatus;
}): Promise<Seller> {
  assertPickupCoordinates(input.pickupLatitude, input.pickupLongitude);
  const phone = normalizeMerchantPhone(input.phone);
  const whatsappPhone = input.whatsappPhone
    ? normalizeMerchantPhone(input.whatsappPhone)
    : null;
  const contactName = (input.contactName?.trim() || input.displayName).trim();

  if (whatsappPhone) {
    const taken = await prisma.seller.findUnique({ where: { whatsappPhone } });
    if (taken) {
      throw new AppError("A seller is already linked to this WhatsApp number.", 409, "SELLER_PHONE_TAKEN");
    }
  }

  return prisma.seller.create({
    data: {
      displayName: input.displayName.trim(),
      contactName,
      phone,
      whatsappPhone,
      pickupLocationLabel: input.pickupLocationLabel.trim(),
      pickupLatitude: input.pickupLatitude,
      pickupLongitude: input.pickupLongitude,
      ownerUserId: input.ownerUserId,
      notes: input.notes?.trim() || null,
      status: input.status ?? SellerStatus.PENDING
    }
  });
}

export async function getSeller(sellerId: string) {
  const seller = await prisma.seller.findUnique({
    where: { id: sellerId },
    include: {
      offers: { include: { catalogProduct: true }, orderBy: { createdAt: "desc" } },
      _count: { select: { settlements: true } }
    }
  });
  if (!seller) throw new AppError("Seller not found.", 404, "SELLER_NOT_FOUND");
  return seller;
}

export async function listSellers() {
  return prisma.seller.findMany({
    include: {
      _count: { select: { offers: true, settlements: true } }
    },
    orderBy: { createdAt: "desc" }
  });
}

export async function updateSeller(
  sellerId: string,
  input: {
    displayName?: string;
    contactName?: string;
    phone?: string;
    whatsappPhone?: string | null;
    pickupLocationLabel?: string;
    pickupLatitude?: number;
    pickupLongitude?: number;
    notes?: string | null;
    status?: SellerStatus;
  }
): Promise<Seller> {
  await getSeller(sellerId);
  if (input.pickupLatitude !== undefined || input.pickupLongitude !== undefined) {
    const existing = await prisma.seller.findUniqueOrThrow({ where: { id: sellerId } });
    assertPickupCoordinates(
      input.pickupLatitude ?? Number(existing.pickupLatitude),
      input.pickupLongitude ?? Number(existing.pickupLongitude)
    );
  }

  let whatsappPhone: string | null | undefined = undefined;
  if (input.whatsappPhone === null) whatsappPhone = null;
  else if (typeof input.whatsappPhone === "string") {
    whatsappPhone = normalizeMerchantPhone(input.whatsappPhone);
    const taken = await prisma.seller.findFirst({
      where: { whatsappPhone, NOT: { id: sellerId } }
    });
    if (taken) {
      throw new AppError("A seller is already linked to this WhatsApp number.", 409, "SELLER_PHONE_TAKEN");
    }
  }

  return prisma.seller.update({
    where: { id: sellerId },
    data: {
      displayName: input.displayName?.trim(),
      contactName: input.contactName?.trim(),
      phone: input.phone ? normalizeMerchantPhone(input.phone) : undefined,
      whatsappPhone,
      pickupLocationLabel: input.pickupLocationLabel?.trim(),
      pickupLatitude: input.pickupLatitude,
      pickupLongitude: input.pickupLongitude,
      notes: input.notes === undefined ? undefined : input.notes?.trim() || null,
      status: input.status
    }
  });
}

export async function setSellerStatus(sellerId: string, status: SellerStatus): Promise<Seller> {
  await getSeller(sellerId);
  return prisma.seller.update({ where: { id: sellerId }, data: { status } });
}

/**
 * Courier-facing pickup context. Customer must not receive this privately.
 */
export function sellerPickupContext(seller: Seller) {
  return {
    sellerId: seller.id,
    pickupContactName: seller.contactName,
    pickupContactPhone: seller.phone,
    pickupLocationLabel: seller.pickupLocationLabel,
    pickupLatitude: Number(seller.pickupLatitude),
    pickupLongitude: Number(seller.pickupLongitude),
    displayName: seller.displayName
  };
}

export async function createSellerOffer(input: {
  sellerId: string;
  catalogProductId: string;
  priceCents: number;
  quantityAvailable: number;
  currency?: string;
  conditionNote?: string;
  status?: SellerOfferStatus;
}): Promise<SellerOffer> {
  const seller = await prisma.seller.findUnique({ where: { id: input.sellerId } });
  if (!seller) throw new AppError("Seller not found.", 404, "SELLER_NOT_FOUND");

  const catalog = await prisma.catalogProduct.findUnique({ where: { id: input.catalogProductId } });
  if (!catalog) throw new AppError("Catalog product not found.", 404, "CATALOG_PRODUCT_NOT_FOUND");
  if (catalog.status === CatalogProductStatus.ARCHIVED || catalog.status === CatalogProductStatus.REJECTED) {
    throw new AppError("Catalog product is not offerable.", 409, "CATALOG_PRODUCT_NOT_OFFERABLE");
  }

  const existing = await prisma.sellerOffer.findUnique({
    where: {
      sellerId_catalogProductId: {
        sellerId: input.sellerId,
        catalogProductId: input.catalogProductId
      }
    }
  });
  if (existing) {
    throw new AppError("Seller already has an offer for this catalog product.", 409, "SELLER_OFFER_EXISTS");
  }

  const quantity = input.quantityAvailable;
  let status = input.status ?? SellerOfferStatus.ACTIVE;
  if (quantity <= 0) status = SellerOfferStatus.SOLD_OUT;

  return prisma.sellerOffer.create({
    data: {
      sellerId: input.sellerId,
      catalogProductId: input.catalogProductId,
      priceCents: input.priceCents,
      currency: (input.currency ?? "usd").toLowerCase(),
      quantityAvailable: quantity,
      conditionNote: input.conditionNote?.trim() || null,
      status
    }
  });
}

export async function updateSellerOffer(
  offerId: string,
  input: {
    priceCents?: number;
    quantityAvailable?: number;
    conditionNote?: string | null;
    status?: "ACTIVE" | "PAUSED";
  },
  opts?: { actorSellerId?: string }
): Promise<SellerOffer> {
  const offer = await prisma.sellerOffer.findUnique({ where: { id: offerId } });
  if (!offer) throw new AppError("Seller offer not found.", 404, "SELLER_OFFER_NOT_FOUND");
  if (opts?.actorSellerId && offer.sellerId !== opts.actorSellerId) {
    throw new AppError("Cannot modify another seller's offer.", 403, "SELLER_OFFER_FORBIDDEN");
  }

  let quantityAvailable = input.quantityAvailable;
  let status: SellerOfferStatus | undefined =
    input.status === "ACTIVE"
      ? SellerOfferStatus.ACTIVE
      : input.status === "PAUSED"
        ? SellerOfferStatus.PAUSED
        : undefined;

  if (quantityAvailable !== undefined) {
    if (quantityAvailable <= 0) {
      quantityAvailable = 0;
      status = SellerOfferStatus.SOLD_OUT;
    } else if (status === undefined && offer.status === SellerOfferStatus.SOLD_OUT) {
      status = SellerOfferStatus.ACTIVE;
    }
  }

  return prisma.sellerOffer.update({
    where: { id: offerId },
    data: {
      priceCents: input.priceCents,
      quantityAvailable,
      conditionNote:
        input.conditionNote === undefined ? undefined : input.conditionNote?.trim() || null,
      status
    }
  });
}

export async function pauseSellerOffer(offerId: string, opts?: { actorSellerId?: string }) {
  return updateSellerOffer(offerId, { status: "PAUSED" }, opts);
}

export type SellerOfferEligibility = {
  eligible: boolean;
  reason?:
    | "SELLER_NOT_ACTIVE"
    | "OFFER_PAUSED"
    | "OFFER_SOLD_OUT"
    | "INSUFFICIENT_QUANTITY"
    | "CATALOG_NOT_APPROVED"
    | "OFFER_NOT_ACTIVE";
};

export async function evaluateSellerOfferEligibility(
  offerId: string,
  quantity = 1
): Promise<SellerOfferEligibility & { offer?: SellerOffer }> {
  const offer = await prisma.sellerOffer.findUnique({
    where: { id: offerId },
    include: { seller: true, catalogProduct: true }
  });
  if (!offer) throw new AppError("Seller offer not found.", 404, "SELLER_OFFER_NOT_FOUND");

  if (offer.seller.status !== SellerStatus.ACTIVE) {
    return { eligible: false, reason: "SELLER_NOT_ACTIVE", offer };
  }
  if (offer.status === SellerOfferStatus.PAUSED) {
    return { eligible: false, reason: "OFFER_PAUSED", offer };
  }
  if (offer.status === SellerOfferStatus.SOLD_OUT || offer.quantityAvailable <= 0) {
    return { eligible: false, reason: "OFFER_SOLD_OUT", offer };
  }
  if (offer.status !== SellerOfferStatus.ACTIVE) {
    return { eligible: false, reason: "OFFER_NOT_ACTIVE", offer };
  }
  if (offer.quantityAvailable < quantity) {
    return { eligible: false, reason: "INSUFFICIENT_QUANTITY", offer };
  }
  if (offer.catalogProduct.status !== CatalogProductStatus.APPROVED) {
    return { eligible: false, reason: "CATALOG_NOT_APPROVED", offer };
  }
  return { eligible: true, offer };
}

/**
 * Record a completed seller fulfillment: decrement inventory + create settlement.
 * Not wired to customer checkout. Inventory is NOT consumed at quote/checkout open.
 */
export async function recordSellerSaleFulfillment(input: {
  sellerOfferId: string;
  quantity: number;
  paymentStatusSnapshot: "PAID" | "DUE_ON_DELIVERY" | "PENDING" | "PAYMENT_PENDING";
  deliveryFeeCents?: number;
  commerceOrderId?: string;
  notes?: string;
}) {
  const eligibility = await evaluateSellerOfferEligibility(input.sellerOfferId, input.quantity);
  if (!eligibility.eligible || !eligibility.offer) {
    throw new AppError(
      `Seller offer not eligible (${eligibility.reason ?? "UNKNOWN"}).`,
      409,
      "SELLER_OFFER_NOT_ELIGIBLE"
    );
  }

  const offer = eligibility.offer;
  const rate = await getSellerCommissionRate();
  const merchandiseCents = offer.priceCents * input.quantity;
  const { commissionCents, sellerProceedsCents } = computeSellerCommissionCents(
    merchandiseCents,
    rate
  );
  const deliveryFeeCents = input.deliveryFeeCents ?? 0;
  const settlementStatus =
    input.paymentStatusSnapshot === "PAID"
      ? SellerSettlementStatus.READY_FOR_SETTLEMENT
      : SellerSettlementStatus.PENDING_PAYMENT;

  return prisma.$transaction(async (tx) => {
    const locked = await tx.sellerOffer.findUnique({ where: { id: offer.id } });
    if (!locked || locked.quantityAvailable < input.quantity) {
      throw new AppError("Insufficient seller inventory.", 409, "SELLER_INSUFFICIENT_STOCK");
    }
    const nextQty = locked.quantityAvailable - input.quantity;
    const updatedOffer = await tx.sellerOffer.update({
      where: { id: offer.id },
      data: {
        quantityAvailable: nextQty,
        status: nextQty <= 0 ? SellerOfferStatus.SOLD_OUT : locked.status
      }
    });

    const settlement = await tx.sellerSettlement.create({
      data: {
        sellerId: offer.sellerId,
        sellerOfferId: offer.id,
        catalogProductId: offer.catalogProductId,
        quantity: input.quantity,
        merchandiseCents,
        commissionRateSnapshot: rate,
        commissionCents,
        sellerProceedsCents,
        deliveryFeeCents,
        commerceOrderId: input.commerceOrderId,
        status: settlementStatus,
        paymentStatusSnapshot: input.paymentStatusSnapshot,
        fulfilledAt: new Date(),
        notes: input.notes?.trim() || null
      }
    });

    return { offer: updatedOffer, settlement };
  });
}

/** Mark COD settlement ready once payment is confirmed collected. */
export async function confirmSellerSettlementPayment(settlementId: string) {
  const row = await prisma.sellerSettlement.findUnique({ where: { id: settlementId } });
  if (!row) throw new AppError("Seller settlement not found.", 404, "SELLER_SETTLEMENT_NOT_FOUND");
  if (row.status === SellerSettlementStatus.VOIDED) {
    throw new AppError("Settlement is voided.", 409, "SELLER_SETTLEMENT_VOIDED");
  }
  if (row.status === SellerSettlementStatus.SETTLED) {
    return row;
  }
  return prisma.sellerSettlement.update({
    where: { id: settlementId },
    data: {
      status: SellerSettlementStatus.READY_FOR_SETTLEMENT,
      paymentStatusSnapshot: "PAID"
    }
  });
}

/** Future refund/return extension point — voids settlement; does not auto-restock. */
export async function voidSellerSettlement(settlementId: string, notes?: string) {
  const row = await prisma.sellerSettlement.findUnique({ where: { id: settlementId } });
  if (!row) throw new AppError("Seller settlement not found.", 404, "SELLER_SETTLEMENT_NOT_FOUND");
  if (row.status === SellerSettlementStatus.SETTLED) {
    throw new AppError("Cannot void a settled payout.", 409, "SELLER_SETTLEMENT_ALREADY_SETTLED");
  }
  return prisma.sellerSettlement.update({
    where: { id: settlementId },
    data: {
      status: SellerSettlementStatus.VOIDED,
      voidedAt: new Date(),
      notes: notes?.trim() || row.notes
    }
  });
}

export async function listSellerOffers(sellerId: string) {
  await getSeller(sellerId);
  return prisma.sellerOffer.findMany({
    where: { sellerId },
    include: { catalogProduct: true },
    orderBy: { createdAt: "desc" }
  });
}
