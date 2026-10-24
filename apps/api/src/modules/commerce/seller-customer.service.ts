/**
 * Controlled customer purchase of one pilot SellerOffer.
 * Merchant checkout, Smart Basket, and WhatsApp are not called.
 * The delivery gig client is an ops user, so the shopper does not own the pickup snapshot.
 */

import {
  createCustomerSellerPurchaseSchema,
  customerSellerPaymentLabel,
  customerSellerPurchaseStatusLabel
} from "@gigflow/shared";
import { UserRole } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import { logDutsFlow } from "../../lib/flow-log.js";
import { assertWithinDeliveryRadius, estimateDeliveryFee } from "../gigs/delivery-pricing.service.js";
import { getCommercePaymentProvider } from "./payments/payment.service.js";
import { validateZimbabweMobileForEcoCash } from "./payments/zw-phone.js";
import {
  cancelSellerFulfillment,
  createSellerFulfillment,
  linkSellerFulfillmentDelivery
} from "./seller-fulfillment.service.js";
import { assertSellerMarketplaceEnabled } from "./seller.service.js";

const offerInclude = {
  seller: true,
  catalogProduct: { select: { id: true, name: true, status: true, primaryImageUrl: true, sizeLabel: true, brand: true } }
} as const;

function sellableQuantity(offer: { quantity: number; reservedQuantity: number }) {
  return offer.quantity - offer.reservedQuantity;
}

async function loadEligiblePilotOffer(offerId: string) {
  assertSellerMarketplaceEnabled();
  const offer = await prisma.sellerOffer.findUnique({ where: { id: offerId }, include: offerInclude });
  if (!offer || !offer.customerPilotEnabled) {
    throw new AppError("This item is not available.", 404, "PILOT_NOT_ENABLED");
  }
  if (offer.seller.status !== "ACTIVE") {
    throw new AppError("This item is not available.", 409, "SELLER_NOT_ACTIVE");
  }
  if (offer.status !== "ACTIVE" || offer.catalogProduct.status !== "APPROVED" || offer.priceCents < 1) {
    throw new AppError("This item is not available.", 409, "OFFER_NOT_ELIGIBLE");
  }
  return offer;
}

export async function getCustomerPilotOffer(offerId: string) {
  const offer = await loadEligiblePilotOffer(offerId);
  const sellable = sellableQuantity(offer);
  return {
    offerId: offer.id,
    catalogProductId: offer.catalogProductId,
    productName: offer.catalogProduct.name,
    brand: offer.catalogProduct.brand,
    sizeLabel: offer.catalogProduct.sizeLabel,
    imageUrl: offer.catalogProduct.primaryImageUrl,
    unitPriceCents: offer.priceCents,
    currency: offer.currency,
    sellableQuantity: Math.max(0, sellable),
    available: sellable > 0
  };
}

export function toCustomerSellerPurchase(row: {
  id: string;
  catalogProductId: string;
  productNameSnapshot: string;
  quantity: number;
  unitPriceCents: number;
  merchandiseCents: number;
  deliveryFeeCents: number;
  currency: string;
  paymentStatus: string;
  status: string;
  linkedDeliveryGig?: { status: string } | null;
}) {
  return {
    purchaseId: row.id,
    catalogProductId: row.catalogProductId,
    productName: row.productNameSnapshot,
    quantity: row.quantity,
    unitPriceCents: row.unitPriceCents,
    merchandiseCents: row.merchandiseCents,
    deliveryFeeCents: row.deliveryFeeCents,
    totalCents: row.merchandiseCents + row.deliveryFeeCents,
    currency: row.currency,
    statusLabel: customerSellerPurchaseStatusLabel({
      status: row.status,
      gigStatus: row.linkedDeliveryGig?.status ?? null
    }),
    paymentLabel: customerSellerPaymentLabel(row.paymentStatus)
  };
}

async function loadOwnedPurchase(userId: string, purchaseId: string) {
  const row = await prisma.sellerFulfillment.findFirst({
    where: { id: purchaseId, customerUserId: userId },
    include: { linkedDeliveryGig: { select: { status: true } } }
  });
  if (!row) throw new AppError("Purchase not found.", 404, "SELLER_FULFILLMENT_NOT_FOUND");
  return row;
}

export async function getCustomerSellerPurchase(userId: string, purchaseId: string) {
  return toCustomerSellerPurchase(await loadOwnedPurchase(userId, purchaseId));
}

async function sellerDeliveryOpsUserId(customerUserId: string) {
  const ops = await prisma.user.findFirst({
    where: {
      accountStatus: "ACTIVE",
      roles: { has: UserRole.ADMIN },
      id: { not: customerUserId }
    },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });
  if (!ops) {
    throw new AppError("Delivery is not available for this order yet.", 409, "DELIVERY_CLIENT_UNAVAILABLE");
  }
  return ops.id;
}

export async function dispatchSellerPurchaseDelivery(fulfillmentId: string) {
  const row = await prisma.sellerFulfillment.findUnique({
    where: { id: fulfillmentId },
    select: { id: true, customerUserId: true, linkedDeliveryGigId: true, status: true }
  });
  if (!row || row.linkedDeliveryGigId) return;
  if (row.status !== "READY_FOR_PICKUP") return;
  const opsUserId = await sellerDeliveryOpsUserId(row.customerUserId ?? fulfillmentId);
  await linkSellerFulfillmentDelivery(row.id, opsUserId);
}

async function initiateSellerEcoCash(input: {
  fulfillmentId: string;
  payerPhoneRaw: string;
  amountCents: number;
}) {
  const phone = validateZimbabweMobileForEcoCash(input.payerPhoneRaw);
  if (!phone.ok) throw new AppError(phone.reason, 400, "INVALID_PAYER_PHONE");
  const provider = getCommercePaymentProvider();
  const attempt = await prisma.sellerPaymentAttempt.create({
    data: {
      sellerFulfillmentId: input.fulfillmentId,
      provider: provider.name,
      payerPhone: phone.e164,
      amountCents: input.amountCents,
      currency: "usd",
      status: "CREATED"
    }
  });
  let initiated;
  try {
    initiated = await provider.initiatePayment({
      commerceOrderId: input.fulfillmentId,
      orderNumber: 1,
      amountCents: input.amountCents,
      currency: "usd",
      payerPhoneE164: phone.e164,
      attemptId: attempt.id,
      paymentMethod: "ECOCASH"
    });
  } catch (error) {
    await prisma.sellerPaymentAttempt.update({
      where: { id: attempt.id },
      data: { status: "FAILED", failureReason: "initiate_failed" }
    });
    const { failSellerFulfillmentPayment } = await import("./seller-fulfillment.service.js");
    await failSellerFulfillmentPayment(input.fulfillmentId);
    throw error;
  }
  const saved = await prisma.sellerPaymentAttempt.update({
    where: { id: attempt.id },
    data: {
      providerPaymentId: initiated.providerPaymentId,
      merchantReference: initiated.merchantReference ?? initiated.providerPaymentId,
      pollUrl: initiated.pollUrl ?? null,
      paynowReference: initiated.paynowReference ?? null,
      status: "PENDING",
      expiresAt: initiated.expiresAt,
      initiatedAt: new Date()
    }
  });
  logDutsFlow("SELLER_FULFILLMENT_PAYMENT", {
    sellerFulfillmentId: input.fulfillmentId,
    paymentStatus: "PENDING",
    provider: provider.name
  });
  return saved;
}

export async function createCustomerSellerPurchase(userId: string, input: unknown) {
  const parsed = createCustomerSellerPurchaseSchema.parse(input);
  const offer = await loadEligiblePilotOffer(parsed.offerId);
  if (offer.priceCents !== parsed.expectedUnitPriceCents) {
    throw new AppError("The price changed. Review the new price before paying.", 409, "PRICE_CHANGED");
  }
  if (sellableQuantity(offer) < parsed.quantity) {
    throw new AppError("This item is unavailable.", 409, "INSUFFICIENT_QUANTITY");
  }

  const estimate = await estimateDeliveryFee({
    pickup: { latitude: Number(offer.seller.pickupLatitude), longitude: Number(offer.seller.pickupLongitude) },
    dropoff: { latitude: parsed.dropoffLatitude, longitude: parsed.dropoffLongitude }
  });
  assertWithinDeliveryRadius(estimate);

  const cash = parsed.paymentMethod === "CASH";
  const created = await createSellerFulfillment(offer.sellerId, offer.id, {
    quantity: parsed.quantity,
    dropoffLabel: parsed.dropoffLabel,
    dropoffLatitude: parsed.dropoffLatitude,
    dropoffLongitude: parsed.dropoffLongitude,
    dropoffContactName: parsed.dropoffContactName,
    dropoffContactPhone: parsed.dropoffContactPhone,
    paymentMethod: cash ? "CASH" : "PREPAID"
  });
  await prisma.sellerFulfillment.update({
    where: { id: created.id },
    data: { customerUserId: userId, deliveryFeeCents: estimate.totalCents }
  });

  let providerPaymentId: string | null = null;
  if (cash) {
    try {
      await dispatchSellerPurchaseDelivery(created.id);
    } catch (error) {
      await cancelSellerFulfillment(created.id);
      throw error;
    }
  } else {
    if (!parsed.payerPhone) {
      const { failSellerFulfillmentPayment } = await import("./seller-fulfillment.service.js");
      await failSellerFulfillmentPayment(created.id);
      throw new AppError("Enter the EcoCash number for this payment.", 400, "INVALID_PAYER_PHONE");
    }
    const attempt = await initiateSellerEcoCash({
      fulfillmentId: created.id,
      payerPhoneRaw: parsed.payerPhone,
      amountCents: created.merchandiseCents + estimate.totalCents
    });
    providerPaymentId = attempt.providerPaymentId;
  }

  const purchase = await getCustomerSellerPurchase(userId, created.id);
  return { purchase, providerPaymentId };
}

export async function cancelCustomerSellerPurchase(userId: string, purchaseId: string) {
  await loadOwnedPurchase(userId, purchaseId);
  await cancelSellerFulfillment(purchaseId);
  return getCustomerSellerPurchase(userId, purchaseId);
}
