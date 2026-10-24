/**
 * Seller Marketplace V1 foundation.
 *
 * CatalogProduct stays canonical. SellerOffer is a second supply row beside Product
 * (the merchant offer). This module does not create catalog products, merchants,
 * commerce orders, deliveries, or payouts.
 *
 * Quantity drops only in commitSellerFulfillment, which is the simulated successful
 * fulfillment point. Opening checkout is not implemented here and must not call it.
 * Customer fulfillment stays behind SELLER_MARKETPLACE_ENABLED (default off).
 */

import {
  commitSellerFulfillmentSchema,
  createSellerOfferSchema,
  createSellerSchema,
  parseSellerMarketplaceEnabled,
  splitSellerMerchandiseCents,
  updateSellerOfferSchema,
  updateSellerSchema
} from "@gigflow/shared";
import {
  CommercePaymentStatus,
  Prisma,
  type Seller,
  type SellerOffer,
  type SellerOfferStatus
} from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import { assertValidMerchantCoordinates } from "./merchant-onboarding.service.js";
import { normalizeMerchantPhone } from "./merchant.service.js";
import { commitUnreservedOfferQuantity } from "./seller-inventory.js";

const offerInclude = {
  catalogProduct: { select: { id: true, name: true, status: true } }
} as const;

type OfferWithCatalog = SellerOffer & {
  catalogProduct: { id: string; name: string; status: string };
};

export function sellerMarketplaceEnabled() {
  return parseSellerMarketplaceEnabled(process.env.SELLER_MARKETPLACE_ENABLED);
}

export function assertSellerMarketplaceEnabled() {
  if (!sellerMarketplaceEnabled()) {
    throw new AppError("Seller marketplace fulfillment is not enabled.", 404, "FEATURE_DISABLED");
  }
}

function isUniqueConflict(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code: string }).code === "P2002");
}

export function presentSeller(seller: Seller) {
  return {
    id: seller.id,
    ownerUserId: seller.ownerUserId,
    displayName: seller.displayName,
    phone: seller.phone,
    whatsappPhone: seller.whatsappPhone,
    pickupLocationLabel: seller.pickupLocationLabel,
    pickupLatitude: Number(seller.pickupLatitude),
    pickupLongitude: Number(seller.pickupLongitude),
    pickupContactName: seller.pickupContactName,
    status: seller.status,
    notes: seller.notes,
    createdAt: seller.createdAt,
    updatedAt: seller.updatedAt
  };
}

export function presentSellerOffer(offer: OfferWithCatalog) {
  return {
    id: offer.id,
    sellerId: offer.sellerId,
    catalogProductId: offer.catalogProductId,
    catalogName: offer.catalogProduct.name,
    catalogStatus: offer.catalogProduct.status,
    priceCents: offer.priceCents,
    quantity: offer.quantity,
    reservedQuantity: offer.reservedQuantity,
    customerPilotEnabled: offer.customerPilotEnabled,
    currency: offer.currency,
    status: offer.status,
    createdAt: offer.createdAt,
    updatedAt: offer.updatedAt
  };
}

/** Customer projection. Pickup and seller contact stay off this object. */
export function toCustomerSellerOffer(offer: {
  id: string;
  catalogProductId: string;
  priceCents: number;
  currency: string;
  quantity: number;
  status: SellerOfferStatus;
}) {
  return {
    offerId: offer.id,
    catalogProductId: offer.catalogProductId,
    priceCents: offer.priceCents,
    currency: offer.currency,
    quantity: offer.quantity,
    status: offer.status
  };
}

async function readSellerCommission(db: Prisma.TransactionClient | typeof prisma = prisma) {
  const settings = await db.platformSetting.findUnique({ where: { id: "default" } });
  if (!settings) {
    throw new AppError("Seller commission is not configured.", 409, "SELLER_COMMISSION_UNCONFIGURED");
  }
  const rate = Number(settings.marketplaceSellerCommissionRate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new AppError("Seller commission is not configured.", 409, "SELLER_COMMISSION_UNCONFIGURED");
  }
  return { rate, decimal: settings.marketplaceSellerCommissionRate };
}

/** Rate copied onto a seller fulfillment. Callers must store it; do not reread it at settlement. */
export async function readSellerCommissionForFulfillment(
  db: Prisma.TransactionClient | typeof prisma = prisma
) {
  return readSellerCommission(db);
}

export async function getSellerCommissionRate() {
  const { rate } = await readSellerCommission();
  return rate;
}

/** Updates only the seller rate. Merchant commission is not written. */
export async function setSellerCommissionRate(rate: number) {
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new AppError("Seller commission rate must be between 0 and 1.", 400, "INVALID_COMMISSION_RATE");
  }
  const existing = await prisma.platformSetting.findUnique({ where: { id: "default" } });
  if (!existing) {
    throw new AppError("Seller commission is not configured.", 409, "SELLER_COMMISSION_UNCONFIGURED");
  }
  const updated = await prisma.platformSetting.update({
    where: { id: "default" },
    data: { marketplaceSellerCommissionRate: new Prisma.Decimal(rate.toFixed(3)) }
  });
  return {
    sellerCommissionRate: Number(updated.marketplaceSellerCommissionRate),
    merchantCommissionRate: Number(updated.marketplaceMerchantCommissionRate)
  };
}

async function requireOwnerUser(ownerUserId?: string | null) {
  if (!ownerUserId) return;
  const user = await prisma.user.findUnique({ where: { id: ownerUserId }, select: { id: true } });
  if (!user) throw new AppError("User not found.", 404, "USER_NOT_FOUND");
}

function optionalPhone(phone?: string | null) {
  if (phone == null || phone.trim() === "") return null;
  return normalizeMerchantPhone(phone);
}

export async function createSeller(input: unknown) {
  const parsed = createSellerSchema.parse(input);
  assertValidMerchantCoordinates(parsed.pickupLatitude, parsed.pickupLongitude);
  await requireOwnerUser(parsed.ownerUserId);
  const phone = normalizeMerchantPhone(parsed.phone);
  const whatsappPhone = optionalPhone(parsed.whatsappPhone);
  try {
    const seller = await prisma.seller.create({
      data: {
        displayName: parsed.displayName.trim(),
        phone,
        whatsappPhone,
        pickupLocationLabel: parsed.pickupLocationLabel.trim(),
        pickupLatitude: parsed.pickupLatitude,
        pickupLongitude: parsed.pickupLongitude,
        pickupContactName: parsed.pickupContactName.trim(),
        ownerUserId: parsed.ownerUserId ?? null,
        notes: parsed.notes?.trim() || null,
        status: parsed.status ?? "PENDING"
      }
    });
    return presentSeller(seller);
  } catch (error) {
    if (isUniqueConflict(error)) {
      throw new AppError("A seller is already linked to this WhatsApp number.", 409, "SELLER_PHONE_TAKEN");
    }
    throw error;
  }
}

export async function updateSeller(sellerId: string, input: unknown) {
  const parsed = updateSellerSchema.parse(input);
  const existing = await prisma.seller.findUnique({ where: { id: sellerId } });
  if (!existing) throw new AppError("Seller not found.", 404, "SELLER_NOT_FOUND");

  const latitude = parsed.pickupLatitude ?? Number(existing.pickupLatitude);
  const longitude = parsed.pickupLongitude ?? Number(existing.pickupLongitude);
  if (parsed.pickupLatitude !== undefined || parsed.pickupLongitude !== undefined) {
    assertValidMerchantCoordinates(latitude, longitude);
  }
  if (parsed.ownerUserId) await requireOwnerUser(parsed.ownerUserId);

  try {
    const seller = await prisma.seller.update({
      where: { id: sellerId },
      data: {
        ...(parsed.displayName !== undefined ? { displayName: parsed.displayName.trim() } : {}),
        ...(parsed.phone !== undefined ? { phone: normalizeMerchantPhone(parsed.phone) } : {}),
        ...(parsed.whatsappPhone !== undefined ? { whatsappPhone: optionalPhone(parsed.whatsappPhone) } : {}),
        ...(parsed.pickupLocationLabel !== undefined
          ? { pickupLocationLabel: parsed.pickupLocationLabel.trim() }
          : {}),
        ...(parsed.pickupLatitude !== undefined ? { pickupLatitude: parsed.pickupLatitude } : {}),
        ...(parsed.pickupLongitude !== undefined ? { pickupLongitude: parsed.pickupLongitude } : {}),
        ...(parsed.pickupContactName !== undefined
          ? { pickupContactName: parsed.pickupContactName.trim() }
          : {}),
        ...(parsed.ownerUserId !== undefined ? { ownerUserId: parsed.ownerUserId } : {}),
        ...(parsed.notes !== undefined ? { notes: parsed.notes?.trim() || null } : {}),
        ...(parsed.status !== undefined ? { status: parsed.status } : {})
      }
    });
    return presentSeller(seller);
  } catch (error) {
    if (isUniqueConflict(error)) {
      throw new AppError("A seller is already linked to this WhatsApp number.", 409, "SELLER_PHONE_TAKEN");
    }
    throw error;
  }
}

export async function getSeller(sellerId: string) {
  const seller = await prisma.seller.findUnique({
    where: { id: sellerId },
    include: { offers: { include: offerInclude, orderBy: { createdAt: "asc" } } }
  });
  if (!seller) throw new AppError("Seller not found.", 404, "SELLER_NOT_FOUND");
  return { ...presentSeller(seller), offers: seller.offers.map(presentSellerOffer) };
}

export async function listSellers() {
  const sellers = await prisma.seller.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  return sellers.map(presentSeller);
}

function deriveOfferStatus(input: {
  requested: "ACTIVE" | "PAUSED" | undefined;
  quantity: number;
  sellerStatus: string;
  catalogStatus: string;
  current: SellerOfferStatus | null;
}): SellerOfferStatus {
  if (input.quantity <= 0) return "SOLD_OUT";
  const fallback = input.current === "ACTIVE" ? "ACTIVE" : "PAUSED";
  const requested = input.requested ?? fallback;
  if (requested === "PAUSED") return "PAUSED";
  if (input.sellerStatus !== "ACTIVE") {
    throw new AppError("Activate the seller before publishing an offer.", 409, "SELLER_NOT_ACTIVE");
  }
  if (input.catalogStatus !== "APPROVED") {
    throw new AppError("Catalog product is not approved.", 409, "CATALOG_NOT_APPROVED");
  }
  return "ACTIVE";
}

async function loadOfferForSeller(sellerId: string, offerId: string) {
  const offer = await prisma.sellerOffer.findFirst({
    where: { id: offerId, sellerId },
    include: offerInclude
  });
  if (!offer) throw new AppError("Seller offer not found.", 404, "SELLER_OFFER_NOT_FOUND");
  return offer;
}

export async function createSellerOffer(sellerId: string, input: unknown) {
  const parsed = createSellerOfferSchema.parse(input);
  const seller = await prisma.seller.findUnique({ where: { id: sellerId } });
  if (!seller) throw new AppError("Seller not found.", 404, "SELLER_NOT_FOUND");
  const catalog = await prisma.catalogProduct.findUnique({
    where: { id: parsed.catalogProductId },
    select: { id: true, status: true }
  });
  if (!catalog) throw new AppError("Catalog product not found.", 404, "CATALOG_PRODUCT_NOT_FOUND");
  if (catalog.status === "REJECTED" || catalog.status === "ARCHIVED") {
    throw new AppError("This catalog product cannot be offered.", 409, "CATALOG_NOT_OFFERABLE");
  }

  const status = deriveOfferStatus({
    requested: parsed.status,
    quantity: parsed.quantity,
    sellerStatus: seller.status,
    catalogStatus: catalog.status,
    current: null
  });

  const duplicate = await prisma.sellerOffer.findUnique({
    where: { sellerId_catalogProductId: { sellerId, catalogProductId: catalog.id } },
    select: { id: true }
  });
  if (duplicate) {
    throw new AppError("This seller already offers that catalog product.", 409, "SELLER_OFFER_EXISTS");
  }

  try {
    const offer = await prisma.sellerOffer.create({
      data: {
        sellerId,
        catalogProductId: catalog.id,
        priceCents: parsed.priceCents,
        quantity: parsed.quantity,
        currency: parsed.currency.toLowerCase(),
        status
      },
      include: offerInclude
    });
    return presentSellerOffer(offer);
  } catch (error) {
    if (isUniqueConflict(error)) {
      throw new AppError("This seller already offers that catalog product.", 409, "SELLER_OFFER_EXISTS");
    }
    throw error;
  }
}

export async function updateSellerOffer(sellerId: string, offerId: string, input: unknown) {
  const parsed = updateSellerOfferSchema.parse(input);
  const offer = await loadOfferForSeller(sellerId, offerId);
  const seller = await prisma.seller.findUnique({ where: { id: sellerId } });
  if (!seller) throw new AppError("Seller not found.", 404, "SELLER_NOT_FOUND");
  const quantity = parsed.quantity ?? offer.quantity;
  const status = deriveOfferStatus({
    requested: parsed.status,
    quantity,
    sellerStatus: seller.status,
    catalogStatus: offer.catalogProduct.status,
    current: offer.status
  });
  const updated = await prisma.sellerOffer.update({
    where: { id: offer.id },
    data: {
      ...(parsed.priceCents !== undefined ? { priceCents: parsed.priceCents } : {}),
      ...(parsed.customerPilotEnabled !== undefined
        ? { customerPilotEnabled: parsed.customerPilotEnabled }
        : {}),
      quantity,
      status
    },
    include: offerInclude
  });
  return presentSellerOffer(updated);
}

export async function pauseSellerOffer(sellerId: string, offerId: string) {
  const offer = await loadOfferForSeller(sellerId, offerId);
  if (offer.quantity <= 0) {
    const updated = await prisma.sellerOffer.update({
      where: { id: offer.id },
      data: { status: "SOLD_OUT" },
      include: offerInclude
    });
    return presentSellerOffer(updated);
  }
  const updated = await prisma.sellerOffer.update({
    where: { id: offer.id },
    data: { status: "PAUSED" },
    include: offerInclude
  });
  return presentSellerOffer(updated);
}

export async function listSellerOffers(sellerId: string) {
  const seller = await prisma.seller.findUnique({ where: { id: sellerId }, select: { id: true } });
  if (!seller) throw new AppError("Seller not found.", 404, "SELLER_NOT_FOUND");
  const offers = await prisma.sellerOffer.findMany({
    where: { sellerId },
    include: offerInclude,
    orderBy: { createdAt: "asc" }
  });
  return offers.map(presentSellerOffer);
}

export async function listSellerLedger(sellerId: string) {
  const seller = await prisma.seller.findUnique({ where: { id: sellerId }, select: { id: true } });
  if (!seller) throw new AppError("Seller not found.", 404, "SELLER_NOT_FOUND");
  return prisma.sellerLedgerEntry.findMany({
    where: { sellerId },
    orderBy: { createdAt: "asc" }
  });
}

/**
 * Courier pickup facts. Not a customer payload and not a delivery gig.
 * Live courier assignment stays on the existing merchant delivery path.
 */
export async function sellerPickupForCourier(sellerId: string) {
  const seller = await prisma.seller.findUnique({ where: { id: sellerId } });
  if (!seller) throw new AppError("Seller not found.", 404, "SELLER_NOT_FOUND");
  return {
    sellerId: seller.id,
    pickupContactName: seller.pickupContactName,
    pickupContactPhone: seller.phone,
    pickupLocationLabel: seller.pickupLocationLabel,
    pickupLatitude: Number(seller.pickupLatitude),
    pickupLongitude: Number(seller.pickupLongitude)
  };
}

/** Internal purchasable list. Empty while the feature flag is off. Not used by Smart Basket. */
export async function listPurchasableSellerOffers(input: { catalogProductId: string; quantity: number }) {
  if (!sellerMarketplaceEnabled()) return [];
  const quantity = Math.floor(input.quantity);
  if (!Number.isInteger(quantity) || quantity < 1) return [];
  const offers = await prisma.sellerOffer.findMany({
    where: {
      catalogProductId: input.catalogProductId,
      status: "ACTIVE",
      seller: { status: "ACTIVE" },
      catalogProduct: { status: "APPROVED" }
    },
    orderBy: [{ priceCents: "asc" }, { id: "asc" }]
  });
  return offers
    .filter((offer) => offer.quantity - offer.reservedQuantity >= quantity)
    .map((offer) =>
      toCustomerSellerOffer({
        ...offer,
        quantity: offer.quantity - offer.reservedQuantity
      })
    );
}

/**
 * Successful seller fulfillment.
 * Inventory is decremented here, not when a checkout is opened.
 * PAID → settlement ACCRUED (recognized, not paid out).
 * DUE_ON_DELIVERY → inventory still drops, settlement stays AWAITING_COLLECTION.
 */
export async function commitSellerFulfillment(sellerId: string, offerId: string, input: unknown) {
  assertSellerMarketplaceEnabled();
  const parsed = commitSellerFulfillmentSchema.parse(input);
  if (
    parsed.paymentStatus !== CommercePaymentStatus.PAID &&
    parsed.paymentStatus !== CommercePaymentStatus.DUE_ON_DELIVERY
  ) {
    throw new AppError("Payment is not in a seller-settlement state.", 409, "INVALID_PAYMENT_STATE");
  }

  return prisma.$transaction(async (tx) => {
    const offer = await tx.sellerOffer.findFirst({
      where: { id: offerId, sellerId },
      include: { seller: true, catalogProduct: { select: { id: true, name: true, status: true } } }
    });
    if (!offer) throw new AppError("Seller offer not found.", 404, "SELLER_OFFER_NOT_FOUND");
    if (offer.seller.status !== "ACTIVE") {
      throw new AppError("Seller is not allowed to fulfill.", 409, "SELLER_NOT_ACTIVE");
    }
    if (offer.status !== "ACTIVE") {
      throw new AppError("Seller offer is not eligible.", 409, "OFFER_NOT_ELIGIBLE");
    }
    if (offer.catalogProduct.status !== "APPROVED") {
      throw new AppError("Catalog product is not approved.", 409, "CATALOG_NOT_APPROVED");
    }
    if (offer.quantity - offer.reservedQuantity < parsed.quantity) {
      throw new AppError("Not enough seller quantity.", 409, "INSUFFICIENT_QUANTITY");
    }

    const decremented = await commitUnreservedOfferQuantity(tx, offer.id, parsed.quantity);
    if (decremented !== 1) {
      throw new AppError("Not enough seller quantity.", 409, "INSUFFICIENT_QUANTITY");
    }

    const sellerNow = await tx.seller.findUnique({ where: { id: sellerId }, select: { status: true } });
    const catalogNow = await tx.catalogProduct.findUnique({
      where: { id: offer.catalogProductId },
      select: { status: true, name: true }
    });
    if (sellerNow?.status !== "ACTIVE" || catalogNow?.status !== "APPROVED") {
      throw new AppError("Seller offer is not eligible.", 409, "OFFER_NOT_ELIGIBLE");
    }

    const next = await tx.sellerOffer.findUniqueOrThrow({ where: { id: offer.id } });
    if (next.quantity < 0) {
      throw new AppError("Not enough seller quantity.", 409, "INSUFFICIENT_QUANTITY");
    }
    if (next.quantity === 0) {
      await tx.sellerOffer.update({ where: { id: offer.id }, data: { status: "SOLD_OUT" } });
    }

    const merchandiseCents = next.priceCents * parsed.quantity;
    if (!Number.isSafeInteger(merchandiseCents)) {
      throw new AppError("Merchandise amount is invalid.", 400, "INVALID_MERCHANDISE_CENTS");
    }
    const commission = await readSellerCommission(tx);
    let split;
    try {
      split = splitSellerMerchandiseCents(merchandiseCents, commission.rate);
    } catch {
      throw new AppError("Seller commission is not configured.", 409, "SELLER_COMMISSION_UNCONFIGURED");
    }

    const settlementStatus =
      parsed.paymentStatus === CommercePaymentStatus.PAID ? "ACCRUED" : "AWAITING_COLLECTION";

    const entry = await tx.sellerLedgerEntry.create({
      data: {
        sellerId,
        sellerOfferId: offer.id,
        catalogProductId: offer.catalogProductId,
        productNameSnapshot: catalogNow.name,
        kind: "SALE",
        quantity: parsed.quantity,
        unitPriceCents: next.priceCents,
        merchandiseCents: split.merchandiseCents,
        commissionRate: commission.decimal,
        commissionCents: split.commissionCents,
        sellerProceedsCents: split.sellerProceedsCents,
        deliveryFeeCents: parsed.deliveryFeeCents,
        paymentStatus: parsed.paymentStatus,
        settlementStatus,
        reference: parsed.reference ?? null
      }
    });

    const saved = await tx.sellerOffer.findUniqueOrThrow({
      where: { id: offer.id },
      include: offerInclude
    });
    return { offer: presentSellerOffer(saved), entry };
  });
}
