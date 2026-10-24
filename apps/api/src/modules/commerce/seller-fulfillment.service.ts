/**
 * Seller fulfillment pilot.
 *
 * This is not a CommerceOrder and not a Merchant. Customer cart, Smart Basket,
 * WhatsApp, and merchant delivery creation are not called.
 * A normal DeliveryGig is created from the seller pickup snapshot when dispatch
 * is allowed. Inventory is reserved at creation and committed once when delivery
 * is recorded. Seller proceeds are written once, from the rate snapshotted here.
 *
 * Every entry point fails closed while SELLER_MARKETPLACE_ENABLED is off.
 */

import {
  confirmSellerFulfillmentPaymentSchema,
  createSellerFulfillmentSchema,
  sellerFulfillmentAttentionSchema,
  splitSellerMerchandiseCents
} from "@gigflow/shared";
import { CommercePaymentStatus, GigStatus, type Prisma, type SellerFulfillment } from "@prisma/client";
import type { Server } from "socket.io";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import { logDutsFlow } from "../../lib/flow-log.js";
import { normalizeMerchantPhone } from "./merchant.service.js";
import {
  commitReservedOfferQuantity,
  releaseOfferQuantity,
  reserveOfferQuantity
} from "./seller-inventory.js";
import { assertSellerMarketplaceEnabled, readSellerCommissionForFulfillment } from "./seller.service.js";

const COLLECTED_GIG_STATUSES = new Set<GigStatus>([
  GigStatus.PACKAGE_COLLECTED,
  GigStatus.EN_ROUTE_TO_DROPOFF,
  GigStatus.ARRIVED_AT_DROPOFF,
  GigStatus.COMPLETED
]);

function logSeller(
  event:
    | "SELLER_FULFILLMENT_RESERVED"
    | "SELLER_FULFILLMENT_PAYMENT"
    | "SELLER_FULFILLMENT_RELEASED"
    | "SELLER_FULFILLMENT_DELIVERY_LINKED"
    | "SELLER_FULFILLMENT_COMMITTED"
    | "SELLER_FULFILLMENT_NEEDS_ATTENTION",
  fields: Record<string, string | number | boolean | null | undefined>
) {
  logDutsFlow(event, fields);
}

export function toCustomerSellerFulfillment(row: {
  id: string;
  catalogProductId: string;
  productNameSnapshot: string;
  quantity: number;
  unitPriceCents: number;
  merchandiseCents: number;
  currency: string;
  paymentStatus: string;
  status: string;
  deliveryFeeCents: number;
}) {
  return {
    fulfillmentId: row.id,
    catalogProductId: row.catalogProductId,
    productName: row.productNameSnapshot,
    quantity: row.quantity,
    unitPriceCents: row.unitPriceCents,
    merchandiseCents: row.merchandiseCents,
    deliveryFeeCents: row.deliveryFeeCents,
    currency: row.currency,
    paymentStatus: row.paymentStatus,
    status: row.status
  };
}

function presentFulfillment(
  row: SellerFulfillment & {
    seller?: { pickupLocationLabel: string; pickupContactName: string; phone: string };
    linkedDeliveryGig?: { id: string; status: GigStatus; formattedAddress: string | null } | null;
    ledgerEntry?: { id: string; settlementStatus: string; commissionCents: number; sellerProceedsCents: number } | null;
  }
) {
  return {
    id: row.id,
    sellerId: row.sellerId,
    sellerOfferId: row.sellerOfferId,
    catalogProductId: row.catalogProductId,
    productNameSnapshot: row.productNameSnapshot,
    sellerNameSnapshot: row.sellerNameSnapshot,
    quantity: row.quantity,
    unitPriceCents: row.unitPriceCents,
    merchandiseCents: row.merchandiseCents,
    commissionRate: Number(row.commissionRate),
    commissionCents: row.commissionCents,
    sellerProceedsCents: row.sellerProceedsCents,
    deliveryFeeCents: row.deliveryFeeCents,
    currency: row.currency,
    paymentStatus: row.paymentStatus,
    paymentReference: row.paymentReference,
    status: row.status,
    linkedDeliveryGigId: row.linkedDeliveryGigId,
    deliveryStatus: row.linkedDeliveryGig?.status ?? null,
    pickupLabel: row.seller?.pickupLocationLabel ?? null,
    pickupContactName: row.seller?.pickupContactName ?? null,
    reservationReleasedAt: row.reservationReleasedAt,
    inventoryCommittedAt: row.inventoryCommittedAt,
    dropoffLabel: row.dropoffLabel,
    needsAttentionReason: row.needsAttentionReason,
    settlementStatus: row.ledgerEntry?.settlementStatus ?? null,
    customerView: toCustomerSellerFulfillment(row)
  };
}

async function loadFulfillment(id: string) {
  const row = await prisma.sellerFulfillment.findUnique({
    where: { id },
    include: {
      seller: { select: { pickupLocationLabel: true, pickupContactName: true, phone: true, status: true } },
      linkedDeliveryGig: { select: { id: true, status: true, formattedAddress: true, pickupVerifiedAt: true } },
      ledgerEntry: {
        select: { id: true, settlementStatus: true, commissionCents: true, sellerProceedsCents: true, deliveryFeeCents: true }
      }
    }
  });
  if (!row) throw new AppError("Seller fulfillment not found.", 404, "SELLER_FULFILLMENT_NOT_FOUND");
  return row;
}

function pickupReady(seller: {
  pickupLocationLabel: string;
  pickupContactName: string;
  phone: string;
  pickupLatitude: { toString(): string } | number;
  pickupLongitude: { toString(): string } | number;
}) {
  const lat = Number(seller.pickupLatitude);
  const lng = Number(seller.pickupLongitude);
  return (
    seller.pickupLocationLabel.trim().length >= 2 &&
    seller.pickupContactName.trim().length >= 2 &&
    seller.phone.trim().length >= 7 &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001)
  );
}

export async function createSellerFulfillment(sellerId: string, offerId: string, input: unknown) {
  assertSellerMarketplaceEnabled();
  const parsed = createSellerFulfillmentSchema.parse(input);
  if (parsed.idempotencyKey) {
    const existing = await prisma.sellerFulfillment.findUnique({ where: { idempotencyKey: parsed.idempotencyKey } });
    if (existing) {
      if (existing.sellerId !== sellerId || existing.sellerOfferId !== offerId) {
        throw new AppError("Idempotency key belongs to another fulfillment.", 409, "IDEMPOTENCY_CONFLICT");
      }
      return presentFulfillment(await loadFulfillment(existing.id));
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    if (parsed.idempotencyKey) {
      const existing = await tx.sellerFulfillment.findUnique({ where: { idempotencyKey: parsed.idempotencyKey } });
      if (existing) return existing;
    }
    const offer = await tx.sellerOffer.findFirst({
      where: { id: offerId, sellerId },
      include: {
        seller: true,
        catalogProduct: { select: { id: true, name: true, status: true } }
      }
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
    if (offer.priceCents < 1) {
      throw new AppError("Seller price is not valid.", 409, "INVALID_PRICE");
    }
    if (!pickupReady(offer.seller)) {
      throw new AppError("Seller pickup information is incomplete.", 409, "PICKUP_INCOMPLETE");
    }

    const merchandiseCents = offer.priceCents * parsed.quantity;
    if (!Number.isSafeInteger(merchandiseCents)) {
      throw new AppError("Merchandise amount is invalid.", 400, "INVALID_MERCHANDISE_CENTS");
    }
    const commission = await readSellerCommissionForFulfillment(tx);
    let split;
    try {
      split = splitSellerMerchandiseCents(merchandiseCents, commission.rate);
    } catch {
      throw new AppError("Seller commission is not configured.", 409, "SELLER_COMMISSION_UNCONFIGURED");
    }

    const reserved = await reserveOfferQuantity(tx, offer.id, parsed.quantity);
    if (reserved !== 1) {
      throw new AppError("Not enough seller quantity.", 409, "INSUFFICIENT_QUANTITY");
    }

    const cash = parsed.paymentMethod === "CASH";
    return tx.sellerFulfillment.create({
      data: {
        sellerId,
        sellerOfferId: offer.id,
        catalogProductId: offer.catalogProductId,
        productNameSnapshot: offer.catalogProduct.name,
        sellerNameSnapshot: offer.seller.displayName,
        quantity: parsed.quantity,
        unitPriceCents: offer.priceCents,
        merchandiseCents: split.merchandiseCents,
        commissionRate: commission.decimal,
        commissionCents: split.commissionCents,
        sellerProceedsCents: split.sellerProceedsCents,
        deliveryFeeCents: 0,
        currency: offer.currency,
        paymentStatus: cash ? CommercePaymentStatus.DUE_ON_DELIVERY : CommercePaymentStatus.PENDING,
        status: cash ? "READY_FOR_PICKUP" : "PAYMENT_PENDING",
        idempotencyKey: parsed.idempotencyKey ?? null,
        dropoffLabel: parsed.dropoffLabel.trim(),
        dropoffLatitude: parsed.dropoffLatitude,
        dropoffLongitude: parsed.dropoffLongitude,
        dropoffContactName: parsed.dropoffContactName.trim(),
        dropoffContactPhone: normalizeMerchantPhone(parsed.dropoffContactPhone)
      }
    });
  });

  logSeller("SELLER_FULFILLMENT_RESERVED", {
    sellerFulfillmentId: created.id,
    sellerOfferId: created.sellerOfferId,
    paymentStatus: created.paymentStatus,
    quantity: created.quantity
  });
  return presentFulfillment(await loadFulfillment(created.id));
}

export async function confirmSellerFulfillmentPayment(fulfillmentId: string, input: unknown) {
  assertSellerMarketplaceEnabled();
  const parsed = confirmSellerFulfillmentPaymentSchema.parse(input);
  let changed = false;
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.sellerFulfillment.findUnique({ where: { id: fulfillmentId } });
    if (!row) throw new AppError("Seller fulfillment not found.", 404, "SELLER_FULFILLMENT_NOT_FOUND");
    if (row.paymentStatus === CommercePaymentStatus.PAID) return row;
    if (row.status !== "PAYMENT_PENDING" || row.inventoryCommittedAt || row.reservationReleasedAt) {
      throw new AppError("Payment can no longer be confirmed.", 409, "INVALID_PAYMENT_STATE");
    }
    changed = true;
    return tx.sellerFulfillment.update({
      where: { id: row.id },
      data: {
        paymentStatus: CommercePaymentStatus.PAID,
        paymentReference: parsed.paymentReference,
        status: "READY_FOR_PICKUP"
      }
    });
  });
  if (changed) {
    logSeller("SELLER_FULFILLMENT_PAYMENT", {
      sellerFulfillmentId: updated.id,
      sellerOfferId: updated.sellerOfferId,
      paymentStatus: updated.paymentStatus
    });
  }
  return presentFulfillment(await loadFulfillment(updated.id));
}

async function releaseOpenReservation(tx: Prisma.TransactionClient, row: SellerFulfillment) {
  if (row.inventoryCommittedAt) {
    throw new AppError("Inventory is already committed.", 409, "ALREADY_COMMITTED");
  }
  if (row.reservationReleasedAt) return;
  const released = await releaseOfferQuantity(tx, row.sellerOfferId, row.quantity);
  if (released !== 1) {
    throw new AppError("Reservation could not be released.", 409, "RESERVATION_STATE");
  }
}

export async function failSellerFulfillmentPayment(fulfillmentId: string) {
  assertSellerMarketplaceEnabled();
  let changed = false;
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.sellerFulfillment.findUnique({ where: { id: fulfillmentId } });
    if (!row) throw new AppError("Seller fulfillment not found.", 404, "SELLER_FULFILLMENT_NOT_FOUND");
    if (row.status === "PAYMENT_FAILED") return row;
    changed = true;
    if (row.paymentStatus === CommercePaymentStatus.PAID || row.paymentStatus === CommercePaymentStatus.DUE_ON_DELIVERY) {
      throw new AppError("Payment can no longer be failed.", 409, "INVALID_PAYMENT_STATE");
    }
    await releaseOpenReservation(tx, row);
    return tx.sellerFulfillment.update({
      where: { id: row.id },
      data: { status: "PAYMENT_FAILED", paymentStatus: CommercePaymentStatus.PAYMENT_FAILED, reservationReleasedAt: new Date() }
    });
  });
  if (changed) {
    logSeller("SELLER_FULFILLMENT_RELEASED", {
      sellerFulfillmentId: updated.id,
      sellerOfferId: updated.sellerOfferId,
      paymentStatus: updated.paymentStatus
    });
  }
  return presentFulfillment(await loadFulfillment(updated.id));
}

async function gigCollected(gigId: string | null) {
  if (!gigId) return false;
  const gig = await prisma.gig.findUnique({
    where: { id: gigId },
    select: { status: true, pickupVerifiedAt: true }
  });
  if (!gig) return false;
  return Boolean(gig.pickupVerifiedAt) || COLLECTED_GIG_STATUSES.has(gig.status);
}

export async function cancelSellerFulfillment(fulfillmentId: string) {
  assertSellerMarketplaceEnabled();
  if (await gigCollected((await loadFulfillment(fulfillmentId)).linkedDeliveryGigId)) {
    return markSellerFulfillmentNeedsAttention(fulfillmentId, {
      reason: "Cancellation requested after pickup. Goods were already collected."
    });
  }
  let changed = false;
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.sellerFulfillment.findUnique({ where: { id: fulfillmentId } });
    if (!row) throw new AppError("Seller fulfillment not found.", 404, "SELLER_FULFILLMENT_NOT_FOUND");
    if (row.status === "CANCELLED") return row;
    changed = true;
    if (row.inventoryCommittedAt || row.status === "DELIVERED") {
      throw new AppError("Delivered seller fulfillment cannot be cancelled.", 409, "ALREADY_COMMITTED");
    }
    await releaseOpenReservation(tx, row);
    if (row.linkedDeliveryGigId) {
      const gig = await tx.gig.findUnique({
        where: { id: row.linkedDeliveryGigId },
        select: { status: true, assignedWorkerId: true, pickupVerifiedAt: true }
      });
      if (gig && !gig.assignedWorkerId && !gig.pickupVerifiedAt && gig.status === GigStatus.POSTED) {
        await tx.gig.update({
          where: { id: row.linkedDeliveryGigId },
          data: { status: GigStatus.CANCELLED, cancelledAt: new Date(), cancellationReason: "Seller fulfillment cancelled before pickup" }
        });
      }
    }
    return tx.sellerFulfillment.update({
      where: { id: row.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        reservationReleasedAt: row.reservationReleasedAt ?? new Date()
      }
    });
  });
  if (changed) {
    logSeller("SELLER_FULFILLMENT_RELEASED", {
      sellerFulfillmentId: updated.id,
      sellerOfferId: updated.sellerOfferId,
      paymentStatus: updated.paymentStatus
    });
  }
  return presentFulfillment(await loadFulfillment(updated.id));
}

export async function markSellerFulfillmentNeedsAttention(fulfillmentId: string, input: unknown) {
  assertSellerMarketplaceEnabled();
  const parsed = sellerFulfillmentAttentionSchema.parse(input);
  const collected = await gigCollected((await loadFulfillment(fulfillmentId)).linkedDeliveryGigId);
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.sellerFulfillment.findUnique({ where: { id: fulfillmentId } });
    if (!row) throw new AppError("Seller fulfillment not found.", 404, "SELLER_FULFILLMENT_NOT_FOUND");
    if (row.status === "DELIVERED" || row.inventoryCommittedAt) {
      throw new AppError("Delivered seller fulfillment cannot be replaced.", 409, "ALREADY_COMMITTED");
    }
    if (!collected) await releaseOpenReservation(tx, row);
    return tx.sellerFulfillment.update({
      where: { id: row.id },
      data: {
        status: "NEEDS_ATTENTION",
        needsAttentionReason: parsed.reason,
        reservationReleasedAt: collected ? row.reservationReleasedAt : row.reservationReleasedAt ?? new Date()
      }
    });
  });
  logSeller("SELLER_FULFILLMENT_NEEDS_ATTENTION", {
    sellerFulfillmentId: updated.id,
    sellerOfferId: updated.sellerOfferId,
    paymentStatus: updated.paymentStatus
  });
  return presentFulfillment(await loadFulfillment(updated.id));
}

function socketOrStub(): Server {
  return { to: () => ({ emit: () => undefined, to: () => ({ emit: () => undefined }) }) } as unknown as Server;
}

export async function linkSellerFulfillmentDelivery(fulfillmentId: string, actingUserId: string) {
  assertSellerMarketplaceEnabled();
  const existing = await loadFulfillment(fulfillmentId);
  if (existing.linkedDeliveryGigId && existing.linkedDeliveryGig) {
    return deliveryLinkView(existing);
  }
  if (existing.paymentStatus !== CommercePaymentStatus.PAID && existing.paymentStatus !== CommercePaymentStatus.DUE_ON_DELIVERY) {
    throw new AppError("Payment is not ready for seller pickup.", 409, "INVALID_PAYMENT_STATE");
  }
  if (existing.status !== "READY_FOR_PICKUP" || existing.reservationReleasedAt || existing.inventoryCommittedAt) {
    throw new AppError("Seller fulfillment is not ready for pickup.", 409, "OFFER_NOT_ELIGIBLE");
  }

  const seller = await prisma.seller.findUnique({ where: { id: existing.sellerId } });
  if (!seller || !pickupReady(seller)) {
    throw new AppError("Seller pickup information is incomplete.", 409, "PICKUP_INCOMPLETE");
  }

  const { createDelivery } = await import("../gigs/delivery.service.js");
  const itemSummary = `${existing.quantity}× ${existing.productNameSnapshot}`.slice(0, 240);
  const created = await createDelivery(
    actingUserId,
    {
      pickup: {
        latitude: Number(seller.pickupLatitude),
        longitude: Number(seller.pickupLongitude),
        formattedAddress: seller.pickupLocationLabel,
        addressLine1: seller.pickupLocationLabel.slice(0, 150),
        city: "Harare",
        region: "Harare",
        country: "ZW",
        contactName: seller.pickupContactName,
        contactPhone: seller.phone,
        instructions: `Seller pickup · ${seller.displayName}`.slice(0, 500)
      },
      dropoff: {
        latitude: Number(existing.dropoffLatitude),
        longitude: Number(existing.dropoffLongitude),
        formattedAddress: existing.dropoffLabel,
        addressLine1: existing.dropoffLabel.slice(0, 150),
        city: "Harare",
        region: "Harare",
        country: "ZW",
        contactName: existing.dropoffContactName,
        contactPhone: existing.dropoffContactPhone,
        instructions: `DUTS delivery · ${existing.productNameSnapshot}`.slice(0, 500)
      },
      package: {
        category: "SMALL_PARCEL",
        description: itemSummary,
        size: "SMALL",
        notes: `seller-fulfillment ${existing.id}`
      },
      prohibitedItemsAck: true,
      orderSource: "APP"
    },
    socketOrStub(),
    {
      idempotencyKey: `seller-fulfillment-${existing.id}`,
      orderSource: "APP",
      bypassClientPostGate: true,
      skipMarketplaceBroadcast: false
    }
  );

  const gigId = (created.delivery as { id?: string }).id;
  if (!gigId) throw new AppError("Could not start delivery for this seller fulfillment.", 502, "DELIVERY_CREATE_FAILED");
  const gig = await prisma.gig.findUniqueOrThrow({
    where: { id: gigId },
    select: { id: true, totalCents: true, status: true, formattedAddress: true, pickupContactName: true }
  });
  const saved = await prisma.sellerFulfillment.update({
    where: { id: existing.id },
    data: { linkedDeliveryGigId: gig.id, deliveryFeeCents: gig.totalCents }
  });
  logSeller("SELLER_FULFILLMENT_DELIVERY_LINKED", {
    sellerFulfillmentId: saved.id,
    sellerOfferId: saved.sellerOfferId,
    gigId: gig.id,
    paymentStatus: saved.paymentStatus,
    deliveryFeeCents: gig.totalCents
  });
  return deliveryLinkView(await loadFulfillment(saved.id));
}

function deliveryLinkView(row: Awaited<ReturnType<typeof loadFulfillment>>) {
  return {
    fulfillment: presentFulfillment(row),
    delivery: {
      gigId: row.linkedDeliveryGigId,
      status: row.linkedDeliveryGig?.status ?? null,
      pickupLabel: row.seller.pickupLocationLabel,
      pickupContactName: row.seller.pickupContactName,
      dropoffLabel: row.dropoffLabel,
      itemSummary: `${row.quantity}× ${row.productNameSnapshot}`,
      deliveryFeeCents: row.deliveryFeeCents
    }
  };
}

export async function completeSellerFulfillment(fulfillmentId: string) {
  assertSellerMarketplaceEnabled();
  let changed = false;
  const completed = await prisma.$transaction(async (tx) => {
    const row = await tx.sellerFulfillment.findUnique({
      where: { id: fulfillmentId },
      include: { ledgerEntry: true }
    });
    if (!row) throw new AppError("Seller fulfillment not found.", 404, "SELLER_FULFILLMENT_NOT_FOUND");
    if (row.inventoryCommittedAt && row.ledgerEntry) return row;
    changed = true;
    if (!row.linkedDeliveryGigId) {
      throw new AppError("Seller pickup delivery is not linked.", 409, "DELIVERY_NOT_LINKED");
    }
    const gig = await tx.gig.findUnique({
      where: { id: row.linkedDeliveryGigId },
      select: { status: true }
    });
    if (gig?.status !== GigStatus.COMPLETED) {
      throw new AppError("Seller delivery is not complete.", 409, "DELIVERY_NOT_COMPLETE");
    }
    if (row.reservationReleasedAt || row.status === "CANCELLED" || row.status === "PAYMENT_FAILED" || row.status === "NEEDS_ATTENTION") {
      throw new AppError("Seller fulfillment is not eligible to complete.", 409, "OFFER_NOT_ELIGIBLE");
    }
    if (row.paymentStatus !== CommercePaymentStatus.PAID && row.paymentStatus !== CommercePaymentStatus.DUE_ON_DELIVERY) {
      throw new AppError("Payment is not ready for settlement.", 409, "INVALID_PAYMENT_STATE");
    }

    const committed = await commitReservedOfferQuantity(tx, row.sellerOfferId, row.quantity);
    if (committed !== 1) {
      const again = await tx.sellerFulfillment.findUnique({ where: { id: row.id }, include: { ledgerEntry: true } });
      if (again?.inventoryCommittedAt && again.ledgerEntry) {
        changed = false;
        return again;
      }
      throw new AppError("Not enough seller quantity.", 409, "INSUFFICIENT_QUANTITY");
    }

    const next = await tx.sellerOffer.findUniqueOrThrow({ where: { id: row.sellerOfferId } });
    if (next.quantity < 0 || next.reservedQuantity < 0 || next.reservedQuantity > next.quantity) {
      throw new AppError("Not enough seller quantity.", 409, "INSUFFICIENT_QUANTITY");
    }
    if (next.quantity === 0) {
      await tx.sellerOffer.update({ where: { id: next.id }, data: { status: "SOLD_OUT" } });
    }

    const settlementStatus = row.paymentStatus === CommercePaymentStatus.PAID ? "ACCRUED" : "AWAITING_COLLECTION";
    const entry = await tx.sellerLedgerEntry.create({
      data: {
        sellerId: row.sellerId,
        sellerOfferId: row.sellerOfferId,
        sellerFulfillmentId: row.id,
        catalogProductId: row.catalogProductId,
        productNameSnapshot: row.productNameSnapshot,
        kind: "SALE",
        quantity: row.quantity,
        unitPriceCents: row.unitPriceCents,
        merchandiseCents: row.merchandiseCents,
        commissionRate: row.commissionRate,
        commissionCents: row.commissionCents,
        sellerProceedsCents: row.sellerProceedsCents,
        deliveryFeeCents: row.deliveryFeeCents,
        paymentStatus: row.paymentStatus,
        settlementStatus,
        reference: row.id
      }
    });
    return tx.sellerFulfillment.update({
      where: { id: row.id },
      data: { status: "DELIVERED", inventoryCommittedAt: new Date(), deliveredAt: new Date() },
      include: { ledgerEntry: true }
    }).then((saved) => ({ ...saved, ledgerEntry: entry }));
  });

  if (changed) {
    logSeller("SELLER_FULFILLMENT_COMMITTED", {
      sellerFulfillmentId: completed.id,
      sellerOfferId: completed.sellerOfferId,
      gigId: completed.linkedDeliveryGigId ?? undefined,
      paymentStatus: completed.paymentStatus
    });
  }
  return presentFulfillment(await loadFulfillment(completed.id));
}

export async function confirmSellerCodCollection(fulfillmentId: string) {
  assertSellerMarketplaceEnabled();
  let changed = false;
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.sellerFulfillment.findUnique({
      where: { id: fulfillmentId },
      include: { ledgerEntry: true }
    });
    if (!row) throw new AppError("Seller fulfillment not found.", 404, "SELLER_FULFILLMENT_NOT_FOUND");
    if (!row.ledgerEntry || !row.inventoryCommittedAt) {
      throw new AppError("Delivery is not complete.", 409, "DELIVERY_NOT_COMPLETE");
    }
    if (row.ledgerEntry.settlementStatus === "ACCRUED" && row.paymentStatus === CommercePaymentStatus.PAID) {
      return row;
    }
    changed = true;
    if (row.paymentStatus !== CommercePaymentStatus.DUE_ON_DELIVERY || row.ledgerEntry.settlementStatus !== "AWAITING_COLLECTION") {
      throw new AppError("Collection is not pending.", 409, "INVALID_PAYMENT_STATE");
    }
    await tx.sellerLedgerEntry.update({
      where: { id: row.ledgerEntry.id },
      data: { settlementStatus: "ACCRUED", paymentStatus: CommercePaymentStatus.PAID }
    });
    return tx.sellerFulfillment.update({
      where: { id: row.id },
      data: { paymentStatus: CommercePaymentStatus.PAID }
    });
  });
  if (changed) {
    logSeller("SELLER_FULFILLMENT_PAYMENT", {
      sellerFulfillmentId: updated.id,
      sellerOfferId: updated.sellerOfferId,
      paymentStatus: updated.paymentStatus
    });
  }
  return presentFulfillment(await loadFulfillment(updated.id));
}

export async function getSellerFulfillment(fulfillmentId: string) {
  assertSellerMarketplaceEnabled();
  return presentFulfillment(await loadFulfillment(fulfillmentId));
}

export async function listSellerFulfillments(sellerId: string) {
  assertSellerMarketplaceEnabled();
  const seller = await prisma.seller.findUnique({ where: { id: sellerId }, select: { id: true } });
  if (!seller) throw new AppError("Seller not found.", 404, "SELLER_NOT_FOUND");
  const rows = await prisma.sellerFulfillment.findMany({
    where: { sellerId },
    include: {
      seller: { select: { pickupLocationLabel: true, pickupContactName: true, phone: true } },
      linkedDeliveryGig: { select: { id: true, status: true, formattedAddress: true } },
      ledgerEntry: { select: { id: true, settlementStatus: true, commissionCents: true, sellerProceedsCents: true } }
    },
    orderBy: { createdAt: "asc" }
  });
  return rows.map(presentFulfillment);
}
