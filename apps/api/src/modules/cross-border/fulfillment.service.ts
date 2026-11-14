import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import { type RequestStatus, assertIntegerCents, canTransition } from "./domain.js";
import { crossBorderEnabled } from "./flag.js";
import { changeCrossBorderStatus } from "./request.service.js";

export async function recordCrossBorderPurchase(input: {
  requestId: string;
  actorId: string;
  retailerOrderReference: string;
  purchaseAmountCents: number;
  purchaseCurrency: string;
  purchaseDate: string;
  receiptReference: string;
  saReceivingNote?: string | null;
}) {
  if (!crossBorderEnabled()) throw new AppError("South African shopping is not available yet.", 404, "CROSS_BORDER_DISABLED");
  try {
    assertIntegerCents(input.purchaseAmountCents, "purchase");
  } catch {
    throw new AppError("Enter the purchase amount in whole cents.", 400, "INVALID_CENTS");
  }
  if (!input.retailerOrderReference.trim() || !input.receiptReference.trim()) {
    throw new AppError("Record the retailer order number and a receipt reference.", 400, "PURCHASE_DETAILS");
  }
  if (input.purchaseCurrency.trim().toUpperCase() !== "ZAR" && input.purchaseCurrency.trim().toUpperCase() !== "USD") {
    throw new AppError("Record the purchase currency as ZAR or USD.", 400, "PURCHASE_CURRENCY");
  }
  const purchaseDate = new Date(input.purchaseDate);
  if (Number.isNaN(purchaseDate.getTime())) throw new AppError("Enter the purchase date.", 400, "PURCHASE_DATE");
  const request = await prisma.crossBorderRequest.findUnique({ where: { id: input.requestId } });
  if (!request) throw new AppError("Shopping request not found.", 404, "REQUEST_NOT_FOUND");
  if (request.status !== "READY_TO_PURCHASE") {
    throw new AppError("Record a purchase only after payment is verified.", 409, "PURCHASE_BEFORE_PAYMENT");
  }
  await prisma.crossBorderShipment.upsert({
    where: { requestId: request.id },
    create: {
      requestId: request.id,
      retailerOrderReference: input.retailerOrderReference.trim(),
      purchaseAmountCents: input.purchaseAmountCents,
      purchaseCurrency: input.purchaseCurrency.trim().toUpperCase(),
      purchaseDate,
      receiptReference: input.receiptReference.trim(),
      saReceivingNote: input.saReceivingNote ?? null
    },
    update: {
      retailerOrderReference: input.retailerOrderReference.trim(),
      purchaseAmountCents: input.purchaseAmountCents,
      purchaseCurrency: input.purchaseCurrency.trim().toUpperCase(),
      purchaseDate,
      receiptReference: input.receiptReference.trim(),
      saReceivingNote: input.saReceivingNote ?? null
    }
  });
  return changeCrossBorderStatus({
    requestId: request.id,
    to: "PURCHASED",
    actorId: input.actorId,
    action: "purchase_recorded"
  });
}

export async function recordCrossBorderShipment(input: {
  requestId: string;
  actorId: string;
  to: RequestStatus;
  retailerTrackingNumber?: string | null;
  shippingProvider?: string | null;
  trackingNumber?: string | null;
  customsNote?: string | null;
  saReceivingNote?: string | null;
}) {
  if (!crossBorderEnabled()) throw new AppError("South African shopping is not available yet.", 404, "CROSS_BORDER_DISABLED");
  const request = await prisma.crossBorderRequest.findUnique({ where: { id: input.requestId } });
  if (!request) throw new AppError("Shopping request not found.", 404, "REQUEST_NOT_FOUND");
  if (!canTransition(request.status as RequestStatus, input.to)) {
    throw new AppError("That delivery update is not allowed.", 409, "CROSS_BORDER_TRANSITION");
  }
  await prisma.crossBorderShipment.upsert({
    where: { requestId: request.id },
    create: {
      requestId: request.id,
      retailerTrackingNumber: input.retailerTrackingNumber ?? null,
      shippingProvider: input.shippingProvider ?? null,
      trackingNumber: input.trackingNumber ?? null,
      customsNote: input.customsNote ?? null,
      saReceivingNote: input.saReceivingNote ?? null,
      shipmentStatus: input.to
    },
    update: {
      retailerTrackingNumber: input.retailerTrackingNumber ?? undefined,
      shippingProvider: input.shippingProvider ?? undefined,
      trackingNumber: input.trackingNumber ?? undefined,
      customsNote: input.customsNote ?? undefined,
      saReceivingNote: input.saReceivingNote ?? undefined,
      shipmentStatus: input.to
    }
  });
  return changeCrossBorderStatus({
    requestId: request.id,
    to: input.to,
    actorId: input.actorId,
    action: "shipment_updated"
  });
}
