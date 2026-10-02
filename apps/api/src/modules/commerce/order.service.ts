import {
  CommerceCheckoutStatus,
  CommerceOrderStatus,
  CommercePaymentMethod,
  CommercePaymentStatus,
  GigStatus,
  OrderSource,
  PackageCategory,
  PaymentLifecycle,
  PaymentStatus
} from "@prisma/client";
import type { Server } from "socket.io";
import {
  canPurchaseStorefrontCategory,
  commerceCustomerStatusCopy,
  distanceKmBetween,
  FULFILLMENT_NOTE,
  addFulfillmentNote,
  hasFulfillmentNote,
  isAssistedFulfillment,
  parseAlcoholCommerceEnabled,
  parseMerchantFulfillmentRef
} from "@gigflow/shared";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import { logDutsFlow } from "../../lib/flow-log.js";
import { getSocketServer } from "../../lib/socket.js";
import { createDelivery } from "../gigs/delivery.service.js";
import { getMarketplaceSettings, type BasketLine } from "./merchant.service.js";
import { quotePilotCommerceDelivery } from "./pilot-delivery.service.js";
import { normalizePhoneNumber } from "../auth/access.service.js";
import { normalizeMerchantPhone } from "./merchant.service.js";
import { broadcastGigOffer } from "../realtime/realtime.service.js";
import {
  assertCommercePaymentMethodAllowed,
  getCourierRematchIntervalSeconds,
  getFulfillmentAttentionMinutes,
  getMerchantResponseTimeoutSeconds,
  isGuaranteedOrderIntakeEnabled,
  paymentStatusForMethod,
  resolveCommercePaymentMethod
} from "./payment-mode.js";
import {
  resolveCommerceCustomerForOrder,
  resolveDeliveryClientUserId,
  ensureWhatsAppCommerceCustomer
} from "./commerce-customer.service.js";

/** True when value looks like a usable E.164 contact for delivery schema (min 7 chars). */
export function isUsableDeliveryContactPhone(raw: string | null | undefined): boolean {
  if (!raw?.trim()) return false;
  try {
    const n = normalizeMerchantPhone(raw);
    return n.length >= 7 && n.length <= 24 && /^\+[1-9]\d{6,22}$/.test(n);
  } catch {
    return false;
  }
}

/**
 * Pickup = shop. Prefer Merchant.phone, else Merchant.whatsappPhone.
 * Never invent numbers; never use customer phone.
 */
export function resolveMerchantPickupContactPhone(merchant: {
  phone?: string | null;
  whatsappPhone?: string | null;
}): string {
  for (const raw of [merchant.phone, merchant.whatsappPhone]) {
    if (!raw?.trim()) continue;
    try {
      const n = normalizeMerchantPhone(raw);
      if (n.length >= 7 && n.length <= 24 && /^\+[1-9]\d{6,22}$/.test(n)) return n;
    } catch {
      /* try next */
    }
  }
  throw new AppError(
    "Shop contact phone is missing or invalid.",
    409,
    "DELIVERY_CONTACT_INVALID"
  );
}

/**
 * Dropoff = customer WhatsApp / CommerceCustomer contact.
 * Never use merchant phone or invent numbers.
 */
export function resolveCustomerDropoffContactPhone(input: {
  customerWhatsAppPhone?: string | null;
  commerceWhatsappPhone?: string | null;
  commercePrimaryPhone?: string | null;
  linkedUserPhone?: string | null;
}): string {
  for (const raw of [
    input.customerWhatsAppPhone,
    input.commerceWhatsappPhone,
    input.commercePrimaryPhone,
    input.linkedUserPhone
  ]) {
    if (!raw?.trim()) continue;
    try {
      const n = normalizePhoneNumber(raw.trim());
      if (n.length >= 7 && n.length <= 24 && /^\+[1-9]\d{6,22}$/.test(n)) return n;
    } catch {
      /* try next */
    }
  }
  throw new AppError(
    "Customer contact phone is missing or invalid.",
    409,
    "DELIVERY_CONTACT_INVALID"
  );
}

/** Mark marketplace-linked delivery as paid (fee on CommerceOrder) and open courier matching. */
export async function openMarketplaceDeliveryForCouriers(gigId: string, io: Server): Promise<void> {
  const gig = await prisma.gig.findUnique({
    where: { id: gigId },
    include: { serviceCategory: true, payment: true, commerceOrder: true }
  });
  if (!gig?.payment || !gig.commerceOrder) return;

  await prisma.gig.update({
    where: { id: gigId },
    data: {
      status: GigStatus.SEARCHING_FOR_WORKER,
      paymentStatus: PaymentLifecycle.PAYMENT_AUTHORIZED,
      authorizedAt: new Date()
    }
  });
  await prisma.payment.update({
    where: { id: gig.payment.id },
    data: { status: PaymentStatus.AUTHORIZED }
  });

  await broadcastGigOffer(io, {
    gigId: gig.id,
    title: gig.title,
    serviceCategoryId: gig.serviceCategoryId,
    serviceCategoryName: gig.serviceCategory.name,
    latitude: Number(gig.latitude),
    longitude: Number(gig.longitude),
    city: gig.city,
    region: gig.region,
    size: gig.size,
    totalCents: gig.totalCents,
    workerPayoutCents: gig.workerPayoutCents,
    startsAt: gig.startsAt.toISOString(),
    urgency: gig.urgency,
    estimatedHours: Number(gig.estimatedHours),
    fulfillmentType: gig.fulfillmentType
  });
}

/** @deprecated Use ensureWhatsAppCommerceCustomer — no longer creates User accounts. */
export async function ensureWhatsAppCustomer(phone: string, displayName?: string) {
  return ensureWhatsAppCommerceCustomer(phone, displayName);
}

export async function quoteBasketTotals(input: {
  merchantLat: number;
  merchantLng: number;
  customerLat: number;
  customerLng: number;
  lines: BasketLine[];
}) {
  const settings = await getMarketplaceSettings();
  const subtotalCents = input.lines.reduce((s, l) => s + l.lineTotalCents, 0);
  const routeDistanceKm = distanceKmBetween(
    { latitude: input.merchantLat, longitude: input.merchantLng },
    { latitude: input.customerLat, longitude: input.customerLng }
  );
  const delivery = await quotePilotCommerceDelivery({
    routeDistanceKm,
    lines: input.lines
  });
  const deliveryFeeCents = delivery.deliveryFeeCents;
  const serviceFeeCents = settings.serviceFeeCents;
  const totalCents = subtotalCents + deliveryFeeCents + serviceFeeCents;
  return { subtotalCents, deliveryFeeCents, serviceFeeCents, totalCents, currency: "usd" as const };
}

export async function createConfirmedCommerceOrder(input: {
  /** Authenticated app User id (optional for WhatsApp / guest). */
  customerId?: string;
  /** Preferred commerce identity id. */
  commerceCustomerId?: string;
  merchantId: string;
  lines: BasketLine[];
  deliveryLabel: string;
  deliveryLatitude: number;
  deliveryLongitude: number;
  customerWhatsAppPhone?: string;
  paymentMethod?: CommercePaymentMethod | string;
  paymentStatus?: CommercePaymentStatus;
  orderSource?: OrderSource;
  checkoutId?: string;
  fulfillmentLabel?: string;
  /** When set, skip per-shop delivery quoting (child fulfillments of a parent checkout). */
  totals?: {
    subtotalCents: number;
    deliveryFeeCents: number;
    serviceFeeCents: number;
    totalCents: number;
    currency?: "usd";
  };
}) {
  if (input.lines.length === 0) {
    throw new AppError("Basket is empty.", 400, "EMPTY_BASKET");
  }
  const paymentMethod = resolveCommercePaymentMethod(input.paymentMethod);
  assertCommercePaymentMethodAllowed(paymentMethod);
  const paymentStatus = input.paymentStatus ?? paymentStatusForMethod(paymentMethod);

  const identity = await resolveCommerceCustomerForOrder({
    commerceCustomerId: input.commerceCustomerId,
    customerId: input.customerId
  });
  const customerId = identity.customerId;
  const commerceCustomerId = identity.commerceCustomerId;
  const orderSource = input.orderSource ?? OrderSource.WHATSAPP;

  const merchant = await prisma.merchant.findUniqueOrThrow({ where: { id: input.merchantId } });
  if (!merchant.isActive || !merchant.acceptsOrders) {
    throw new AppError("This shop is not available right now.", 409, "MERCHANT_CLOSED");
  }

  const priceChanges: Array<{ name: string; oldCents: number; newCents: number }> = [];
  const unavailable: string[] = [];
  const refreshedLines: BasketLine[] = [];

  const alcoholEnabled = parseAlcoholCommerceEnabled(process.env.ALCOHOL_COMMERCE_ENABLED);
  for (const line of input.lines) {
    const product = await prisma.product.findFirst({
      where: { id: line.productId, merchantId: input.merchantId, archived: false },
      include: { catalogProduct: { select: { category: true } } }
    });
    if (!product || !product.available) {
      unavailable.push(line.productName);
      continue;
    }
    if (!canPurchaseStorefrontCategory(product.catalogProduct?.category ?? product.category, alcoholEnabled)) {
      throw new AppError("Alcohol ordering isn't available yet.", 409, "ALCOHOL_DISABLED");
    }
    if (product.priceCents !== line.unitPriceCents) {
      priceChanges.push({
        name: product.name,
        oldCents: line.unitPriceCents,
        newCents: product.priceCents
      });
      refreshedLines.push({
        ...line,
        productName: product.name,
        unitPriceCents: product.priceCents,
        lineTotalCents: product.priceCents * line.quantity
      });
      continue;
    }
    refreshedLines.push({
      ...line,
      productName: product.name,
      unitPriceCents: product.priceCents,
      lineTotalCents: product.priceCents * line.quantity
    });
  }

  if (unavailable.length > 0) {
    throw new AppError(
      `${unavailable.join(", ")} is out of stock. Want to remove it or choose another?`,
      409,
      "PRODUCT_UNAVAILABLE",
      Object.fromEntries(unavailable.map((u, i) => [`item${i}`, u]))
    );
  }

  if (priceChanges.length > 0) {
    const detail = priceChanges
      .map(
        (c) =>
          `${c.name}: $${(c.oldCents / 100).toFixed(2)} → $${(c.newCents / 100).toFixed(2)}`
      )
      .join("; ");
    throw new AppError(
      `One price changed since your quote. ${detail}`,
      409,
      "PRICE_CHANGED",
      {
        changes: detail,
        lines: JSON.stringify(refreshedLines)
      }
    );
  }

  const lines = refreshedLines;
  const totals = input.totals
    ? {
        subtotalCents: input.totals.subtotalCents,
        deliveryFeeCents: input.totals.deliveryFeeCents,
        serviceFeeCents: input.totals.serviceFeeCents,
        totalCents: input.totals.totalCents,
        currency: "usd" as const
      }
    : await quoteBasketTotals({
        merchantLat: Number(merchant.latitude),
        merchantLng: Number(merchant.longitude),
        customerLat: input.deliveryLatitude,
        customerLng: input.deliveryLongitude,
        lines
      });

  const isMobileMoney =
    paymentMethod === CommercePaymentMethod.ECOCASH ||
    paymentMethod === CommercePaymentMethod.ONEMONEY;
  // Mobile money: hold merchant notify until provider webhook marks PAID.
  const status = isMobileMoney
    ? CommerceOrderStatus.CUSTOMER_CONFIRMED
    : CommerceOrderStatus.MERCHANT_PENDING;
  const merchantRespondBy = isMobileMoney
    ? null
    : new Date(Date.now() + getMerchantResponseTimeoutSeconds() * 1000);
  const confirmedAt = isMobileMoney ? null : new Date();

  const order = await prisma.commerceOrder.create({
    data: {
      customerId,
      commerceCustomerId,
      merchantId: input.merchantId,
      checkoutId: input.checkoutId ?? null,
      fulfillmentLabel: input.fulfillmentLabel ?? null,
      status,
      paymentStatus,
      paymentMethod,
      orderSource,
      subtotalCents: totals.subtotalCents,
      deliveryFeeCents: totals.deliveryFeeCents,
      serviceFeeCents: totals.serviceFeeCents,
      totalCents: totals.totalCents,
      currency: totals.currency,
      deliveryLabel: input.deliveryLabel,
      deliveryLatitude: input.deliveryLatitude,
      deliveryLongitude: input.deliveryLongitude,
      customerWhatsAppPhone: input.customerWhatsAppPhone
        ? normalizePhoneNumber(input.customerWhatsAppPhone)
        : null,
      confirmedAt,
      merchantRespondBy,
      items: {
        create: lines.map((l) => ({
          productId: l.productId,
          productNameSnapshot: l.productName,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          lineTotalCents: l.lineTotalCents
        }))
      }
    },
    include: { items: true, merchant: true, customer: true, commerceCustomer: true }
  });

  logDutsFlow("COMMERCE_ORDER_CONFIRMED", {
    gigId: undefined,
    userId: customerId ?? undefined,
    userRole: "CLIENT",
    orderId: order.id,
    orderNumber: order.orderNumber,
    merchantId: merchant.id,
    totalCents: order.totalCents,
    paymentMethod,
    paymentStatus,
    commerceCustomerId
  });

  return order;
}

export async function merchantAcceptOrder(merchantId: string, orderIdOrNumber: string | number) {
  const order = await findMerchantOrder(merchantId, orderIdOrNumber);
  if (order.status === CommerceOrderStatus.MERCHANT_PENDING) {
    const updated = await prisma.commerceOrder.update({
      where: { id: order.id },
      data: {
        status: CommerceOrderStatus.MERCHANT_ACCEPTED,
        merchantAcceptedAt: new Date()
      },
      include: { items: true, merchant: true, customer: true }
    });
    logDutsFlow("COMMERCE_MERCHANT_ACCEPTED", {
      userId: order.customerId ?? undefined,
      orderId: order.id,
      orderNumber: order.orderNumber
    });
    return updated;
  }

  const assistedLate =
    isGuaranteedOrderIntakeEnabled() &&
    isAssistedFulfillment(order.notes) &&
    !order.merchantAcceptedAt &&
    (order.status === CommerceOrderStatus.READY_FOR_PICKUP ||
      order.status === CommerceOrderStatus.COURIER_ASSIGNED);
  if (assistedLate) {
    const updated = await prisma.commerceOrder.update({
      where: { id: order.id },
      data: { merchantAcceptedAt: new Date() },
      include: { items: true, merchant: true, customer: true }
    });
    logDutsFlow("COMMERCE_MERCHANT_ACCEPTED", {
      userId: order.customerId ?? undefined,
      orderId: order.id,
      orderNumber: order.orderNumber,
      reason: "late_accept_after_assist"
    });
    return updated;
  }

  throw new AppError("Order is not awaiting merchant acceptance.", 409, "INVALID_ORDER_STATE");
}

export async function merchantRejectOrder(merchantId: string, orderIdOrNumber: string | number) {
  const order = await findMerchantOrder(merchantId, orderIdOrNumber);
  const assistedOpen =
    isGuaranteedOrderIntakeEnabled() &&
    isAssistedFulfillment(order.notes) &&
    (order.status === CommerceOrderStatus.READY_FOR_PICKUP ||
      order.status === CommerceOrderStatus.COURIER_ASSIGNED);
  if (
    order.status !== CommerceOrderStatus.MERCHANT_PENDING &&
    order.status !== CommerceOrderStatus.MERCHANT_ACCEPTED &&
    !assistedOpen
  ) {
    throw new AppError("Order cannot be rejected in its current state.", 409, "INVALID_ORDER_STATE");
  }
  const notes = isGuaranteedOrderIntakeEnabled()
    ? addFulfillmentNote(
        addFulfillmentNote(order.notes, FULFILLMENT_NOTE.MERCHANT_REJECTED),
        FULFILLMENT_NOTE.NEEDS_ATTENTION
      )
    : order.notes;
  const updated = await prisma.commerceOrder.update({
    where: { id: order.id },
    data: {
      status: CommerceOrderStatus.MERCHANT_REJECTED,
      cancelledAt: order.checkoutId ? null : new Date(),
      ...(notes != null ? { notes } : {})
    },
    include: { items: true, merchant: true, customer: true }
  });
  if (order.checkoutId) {
    const { markCheckoutNeedsAttention } = await import("./multi-shop-checkout.service.js");
    await markCheckoutNeedsAttention(order.checkoutId, FULFILLMENT_NOTE.MERCHANT_REJECTED);
  }
  logDutsFlow("COMMERCE_MERCHANT_REJECTED", {
    userId: order.customerId ?? undefined,
    orderId: order.id,
    orderNumber: order.orderNumber,
    merchantId
  });
  return updated;
}

export async function merchantMarkItemUnavailable(
  merchantId: string,
  orderIdOrNumber: string | number,
  productQuery: string
) {
  const order = await findMerchantOrder(merchantId, orderIdOrNumber);
  if (
    order.status !== CommerceOrderStatus.MERCHANT_PENDING &&
    order.status !== CommerceOrderStatus.MERCHANT_ACCEPTED
  ) {
    throw new AppError("Cannot change items in this order state.", 409, "INVALID_ORDER_STATE");
  }
  const item = order.items.find((i) =>
    i.productNameSnapshot.toLowerCase().includes(productQuery.toLowerCase())
  );
  if (!item) throw new AppError("Item not found on this order.", 404, "ORDER_ITEM_NOT_FOUND");

  await prisma.commerceOrderItem.update({
    where: { id: item.id },
    data: { unavailableMarked: true }
  });

  if (item.productId) {
    await prisma.product.updateMany({
      where: { id: item.productId, merchantId },
      data: { available: false }
    });
  }

  return prisma.commerceOrder.findUniqueOrThrow({
    where: { id: order.id },
    include: { items: true, merchant: true, customer: true }
  });
}

async function linkCommerceOrderDelivery(
  order: Awaited<ReturnType<typeof findMerchantOrder>>,
  io: Server
) {
  const customer = order.customer;
  const commerceCustomer = order.commerceCustomer;
  const merchant = order.merchant;
  const summary = order.items.map((i) => `${i.quantity}× ${i.productNameSnapshot}`).join(", ");

  const deliveryClientId = await resolveDeliveryClientUserId(
    commerceCustomer ?? { userId: customer?.id ?? null }
  );
  const contactName = commerceCustomer?.displayName || customer?.fullName || "Customer";
  const pickupContactPhone = resolveMerchantPickupContactPhone(merchant);
  const dropoffContactPhone = resolveCustomerDropoffContactPhone({
    customerWhatsAppPhone: order.customerWhatsAppPhone,
    commerceWhatsappPhone: commerceCustomer?.whatsappPhone,
    commercePrimaryPhone: commerceCustomer?.primaryPhone,
    linkedUserPhone: customer?.phoneNumber
  });
  const pickupContactName = (merchant.contactName?.trim() || merchant.name).slice(0, 80);

  try {
    return await createDelivery(
      deliveryClientId,
      {
        pickup: {
          latitude: Number(merchant.latitude),
          longitude: Number(merchant.longitude),
          formattedAddress: `${merchant.name}, ${merchant.locationLabel}`,
          addressLine1: merchant.locationLabel,
          city: "Harare",
          region: "Harare",
          postalCode: "0000",
          country: "ZW",
          contactName: pickupContactName,
          contactPhone: pickupContactPhone,
          instructions: `Marketplace order #${order.orderNumber}`
        },
        dropoff: {
          latitude: Number(order.deliveryLatitude),
          longitude: Number(order.deliveryLongitude),
          formattedAddress: order.deliveryLabel,
          addressLine1: order.deliveryLabel,
          city: "Harare",
          region: "Harare",
          postalCode: "0000",
          country: "ZW",
          contactName,
          contactPhone: dropoffContactPhone,
          instructions: `DUTS shop order #${order.orderNumber}`
        },
        package: {
          category: PackageCategory.GROCERIES,
          description: `Order #${order.orderNumber}: ${summary}`.slice(0, 240),
          size: "SMALL",
          notes: `Commerce order ${order.id}`
        },
        prohibitedItemsAck: true,
        orderSource: "WHATSAPP"
      },
      io,
      {
        idempotencyKey: `commerce-order-${order.id}`,
        orderSource: "WHATSAPP",
        bypassClientPostGate: true,
        marketplaceCommerceOrderId: order.id
      }
    );
  } catch (error) {
    logDutsFlow("COMMERCE_READY_DELIVERY_FAILED", {
      orderId: order.id,
      orderNumber: order.orderNumber,
      merchantId: order.merchantId,
      reason: error instanceof Error ? error.name : "unknown"
    });
    if (error instanceof AppError) throw error;
    throw new AppError("Could not start delivery for this order.", 502, "DELIVERY_CREATE_FAILED");
  }
}

function tryGetSocketServer(): Server | null {
  try {
    return getSocketServer();
  } catch {
    return null;
  }
}

export async function merchantMarkReadyForPickup(
  merchantId: string,
  orderIdOrNumber: string | number,
  io: Server
) {
  const order = await findMerchantOrder(merchantId, orderIdOrNumber);

  // Idempotent: READY (or later) with an existing linked gig must not create a second delivery.
  if (
    order.linkedDeliveryGigId &&
    (order.status === CommerceOrderStatus.READY_FOR_PICKUP ||
      order.status === CommerceOrderStatus.COURIER_ASSIGNED ||
      order.status === CommerceOrderStatus.PICKED_UP ||
      order.status === CommerceOrderStatus.OUT_FOR_DELIVERY ||
      order.status === CommerceOrderStatus.DELIVERED)
  ) {
    logDutsFlow("COMMERCE_READY_IDEMPOTENT", {
      gigId: order.linkedDeliveryGigId,
      orderId: order.id,
      orderNumber: order.orderNumber
    });
    return {
      order,
      delivery: {
        delivery: order.linkedDeliveryGig,
        secrets: null,
        idempotentReplay: true
      }
    };
  }

  if (order.status !== CommerceOrderStatus.MERCHANT_ACCEPTED) {
    throw new AppError("Accept the order before marking it ready.", 409, "INVALID_ORDER_STATE");
  }
  if (order.items.some((i) => i.unavailableMarked)) {
    throw new AppError(
      "Resolve unavailable items before marking ready (customer must confirm changes).",
      409,
      "UNAVAILABLE_ITEMS_PENDING"
    );
  }

  if (order.checkoutId) {
    const updated = await prisma.commerceOrder.update({
      where: { id: order.id },
      data: {
        status: CommerceOrderStatus.READY_FOR_PICKUP,
        readyAt: new Date()
      },
      include: { items: true, merchant: true, customer: true, commerceCustomer: true, linkedDeliveryGig: true }
    });
    const { ensureCombinedCheckoutDelivery } = await import("./multi-shop-checkout.service.js");
    const deliveryResult = await ensureCombinedCheckoutDelivery(order.checkoutId, io);
    logDutsFlow("COMMERCE_READY_FOR_PICKUP", {
      gigId: (deliveryResult.delivery as { id?: string } | null)?.id,
      orderId: updated.id,
      orderNumber: updated.orderNumber,
      checkoutId: order.checkoutId
    });
    return { order: updated, delivery: deliveryResult };
  }

  const deliveryResult = await linkCommerceOrderDelivery(order, io);
  const gigId = (deliveryResult.delivery as { id: string }).id;

  const updated = await prisma.commerceOrder.update({
    where: { id: order.id },
    data: {
      status: CommerceOrderStatus.READY_FOR_PICKUP,
      readyAt: new Date(),
      linkedDeliveryGigId: gigId
    },
    include: { items: true, merchant: true, customer: true, commerceCustomer: true, linkedDeliveryGig: true }
  });

  if (!deliveryResult.idempotentReplay) {
    await openMarketplaceDeliveryForCouriers(gigId, io);
  }

  logDutsFlow("COMMERCE_READY_FOR_PICKUP", {
    gigId,
    userId: order.customer?.id ?? order.commerceCustomer?.id ?? undefined,
    orderId: order.id,
    orderNumber: order.orderNumber
  });

  return { order: updated, delivery: deliveryResult };
}

/** Expire MERCHANT_PENDING orders past merchantRespondBy. */
export async function expireStaleMerchantPendingOrders(io?: Server): Promise<number> {
  const now = new Date();
  const stale = await prisma.commerceOrder.findMany({
    where: {
      status: CommerceOrderStatus.MERCHANT_PENDING,
      merchantRespondBy: { lt: now }
    },
    include: { merchant: true, customer: true, commerceCustomer: true, items: true, linkedDeliveryGig: true, checkout: true }
  });

  let count = 0;
  const guaranteed = isGuaranteedOrderIntakeEnabled();
  for (const order of stale) {
    if (guaranteed || order.checkoutId) {
      await startAssistedFulfillmentForOrder(order.id, io);
      count += 1;
      continue;
    }
    await prisma.commerceOrder.update({
      where: { id: order.id },
      data: { status: CommerceOrderStatus.CANCELLED, cancelledAt: now, notes: "merchant_timeout" }
    });
    logDutsFlow("COMMERCE_MERCHANT_TIMEOUT", {
      orderId: order.id,
      orderNumber: order.orderNumber,
      userId: order.customerId ?? undefined,
      merchantId: order.merchantId
    });
    if (order.customerWhatsAppPhone) {
      try {
        const { notifyCustomerStatus } = await import("../whatsapp/merchant-handler.js");
        await notifyCustomerStatus(
          order.customerWhatsAppPhone,
          `Order #${order.orderNumber}: ${order.merchant.name} did not respond in time. Your order was cancelled — you can place a new one anytime.`
        );
      } catch {
        /* non-blocking */
      }
    }
    count += 1;
  }
  return count;
}

async function startAssistedFulfillmentForOrder(orderId: string, io?: Server): Promise<void> {
  const order = await prisma.commerceOrder.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      merchant: true,
      customer: true,
      commerceCustomer: true,
      linkedDeliveryGig: true,
      checkout: true
    }
  });
  if (!order || order.status !== CommerceOrderStatus.MERCHANT_PENDING) return;

  const alreadyAssisted = isAssistedFulfillment(order.notes);

  logDutsFlow("COMMERCE_MERCHANT_TIMEOUT", {
    orderId: order.id,
    orderNumber: order.orderNumber,
    userId: order.customerId ?? undefined,
    merchantId: order.merchantId,
    reason: "assisted_fulfillment"
  });

  if (order.linkedDeliveryGigId) {
    await prisma.commerceOrder.update({
      where: { id: order.id },
      data: {
        status: CommerceOrderStatus.READY_FOR_PICKUP,
        readyAt: order.readyAt ?? new Date(),
        notes: addFulfillmentNote(order.notes, FULFILLMENT_NOTE.ASSISTED)
      }
    });
    logDutsFlow("COMMERCE_ASSISTED_FULFILLMENT_STARTED", {
      gigId: order.linkedDeliveryGigId,
      orderId: order.id,
      orderNumber: order.orderNumber
    });
    await notifyAssistedCustomer(order.customerWhatsAppPhone, "slow", !alreadyAssisted);
    return;
  }

  if (order.checkoutId) {
    await prisma.commerceOrder.update({
      where: { id: order.id },
      data: {
        status: CommerceOrderStatus.READY_FOR_PICKUP,
        readyAt: order.readyAt ?? new Date(),
        notes: addFulfillmentNote(order.notes, FULFILLMENT_NOTE.ASSISTED)
      }
    });
    const socket = io ?? tryGetSocketServer();
    if (socket) {
      try {
        const { ensureCombinedCheckoutDelivery } = await import("./multi-shop-checkout.service.js");
        await ensureCombinedCheckoutDelivery(order.checkoutId, socket);
      } catch {
        await prisma.commerceCheckout.update({
          where: { id: order.checkoutId },
          data: {
            notes: addFulfillmentNote(order.notes, FULFILLMENT_NOTE.NEEDS_ATTENTION)
          }
        });
      }
    }
    logDutsFlow("COMMERCE_ASSISTED_FULFILLMENT_STARTED", {
      orderId: order.id,
      orderNumber: order.orderNumber,
      checkoutId: order.checkoutId,
      reason: "child_silent"
    });
    await notifyAssistedCustomer(order.customerWhatsAppPhone, "slow", !alreadyAssisted);
    return;
  }

  const socket = io ?? tryGetSocketServer();
  if (!socket) {
    await prisma.commerceOrder.update({
      where: { id: order.id },
      data: {
        notes: addFulfillmentNote(
          addFulfillmentNote(order.notes, FULFILLMENT_NOTE.ASSISTED),
          FULFILLMENT_NOTE.NEEDS_ATTENTION
        )
      }
    });
    logDutsFlow("COMMERCE_ASSISTED_FULFILLMENT_STARTED", {
      orderId: order.id,
      orderNumber: order.orderNumber,
      reason: "socket_unavailable"
    });
    return;
  }

  try {
    const deliveryResult = await linkCommerceOrderDelivery(order, socket);
    const gigId = (deliveryResult.delivery as { id: string }).id;
    await prisma.commerceOrder.update({
      where: { id: order.id },
      data: {
        status: CommerceOrderStatus.READY_FOR_PICKUP,
        readyAt: new Date(),
        linkedDeliveryGigId: gigId,
        notes: addFulfillmentNote(order.notes, FULFILLMENT_NOTE.ASSISTED)
      }
    });
    if (!deliveryResult.idempotentReplay) {
      await openMarketplaceDeliveryForCouriers(gigId, socket);
    }
    logDutsFlow("COMMERCE_ASSISTED_FULFILLMENT_STARTED", {
      gigId,
      orderId: order.id,
      orderNumber: order.orderNumber
    });
    await notifyAssistedCustomer(order.customerWhatsAppPhone, "slow", !alreadyAssisted);
  } catch {
    await prisma.commerceOrder.update({
      where: { id: order.id },
      data: {
        notes: addFulfillmentNote(
          addFulfillmentNote(order.notes, FULFILLMENT_NOTE.ASSISTED),
          FULFILLMENT_NOTE.NEEDS_ATTENTION
        )
      }
    });
    logDutsFlow("COMMERCE_ASSISTED_FULFILLMENT_STARTED", {
      orderId: order.id,
      orderNumber: order.orderNumber,
      reason: "delivery_create_deferred"
    });
  }
}

async function notifyAssistedCustomer(
  phone: string | null | undefined,
  kind: "slow" | "finding" | "problem",
  send = true
): Promise<void> {
  if (!send || !phone) return;
  try {
    const { notifyCustomerStatus } = await import("../whatsapp/merchant-handler.js");
    const { formatCustomerMerchantSlow, formatCustomerFindingCourier, formatCustomerFulfillmentProblem } =
      await import("../whatsapp/copy.js");
    const body =
      kind === "finding"
        ? formatCustomerFindingCourier()
        : kind === "problem"
          ? formatCustomerFulfillmentProblem()
          : formatCustomerMerchantSlow();
    await notifyCustomerStatus(phone, body);
  } catch {
    /* non-blocking */
  }
}

export async function rematchWaitingCommerceCouriers(io?: Server): Promise<number> {
  if (!isGuaranteedOrderIntakeEnabled()) return 0;
  const socket = io ?? tryGetSocketServer();
  if (!socket) return 0;

  const staleBefore = new Date(Date.now() - getCourierRematchIntervalSeconds() * 1000);
  const waiting = await prisma.commerceOrder.findMany({
    where: {
      status: CommerceOrderStatus.READY_FOR_PICKUP,
      linkedDeliveryGigId: { not: null },
      linkedDeliveryGig: {
        status: { in: [GigStatus.SEARCHING_FOR_WORKER, GigStatus.POSTED] },
        assignedWorkerId: null,
        updatedAt: { lt: staleBefore }
      }
    },
    include: { linkedDeliveryGig: true }
  });

  let count = 0;
  for (const order of waiting) {
    if (hasFulfillmentNote(order.notes, FULFILLMENT_NOTE.PICKUP_PROBLEM)) continue;
    if (hasFulfillmentNote(order.notes, FULFILLMENT_NOTE.MERCHANT_REJECTED)) continue;
    const gigId = order.linkedDeliveryGigId;
    if (!gigId) continue;
    const firstWait = !hasFulfillmentNote(order.notes, FULFILLMENT_NOTE.COURIER_SEARCH_WAITING);
    await openMarketplaceDeliveryForCouriers(gigId, socket);
    await prisma.commerceOrder.update({
      where: { id: order.id },
      data: {
        notes: addFulfillmentNote(order.notes, FULFILLMENT_NOTE.COURIER_SEARCH_WAITING)
      }
    });
    logDutsFlow("COMMERCE_COURIER_SEARCH_WAITING", {
      gigId,
      orderId: order.id,
      orderNumber: order.orderNumber
    });
    if (firstWait) await notifyAssistedCustomer(order.customerWhatsAppPhone, "finding");
    count += 1;
  }
  return count;
}

export async function flagLongWaitCommerceOrders(): Promise<number> {
  if (!isGuaranteedOrderIntakeEnabled()) return 0;
  const cutoff = new Date(Date.now() - getFulfillmentAttentionMinutes() * 60 * 1000);
  const waiting = await prisma.commerceOrder.findMany({
    where: {
      status: {
        in: [
          CommerceOrderStatus.MERCHANT_PENDING,
          CommerceOrderStatus.MERCHANT_ACCEPTED,
          CommerceOrderStatus.READY_FOR_PICKUP
        ]
      },
      confirmedAt: { lt: cutoff }
    },
    include: { linkedDeliveryGig: { select: { assignedWorkerId: true, status: true } } }
  });

  let count = 0;
  for (const order of waiting) {
    if (hasFulfillmentNote(order.notes, FULFILLMENT_NOTE.NEEDS_ATTENTION)) continue;
    const courierAssigned = Boolean(order.linkedDeliveryGig?.assignedWorkerId);
    if (courierAssigned) continue;
    await prisma.commerceOrder.update({
      where: { id: order.id },
      data: { notes: addFulfillmentNote(order.notes, FULFILLMENT_NOTE.NEEDS_ATTENTION) }
    });
    logDutsFlow("COMMERCE_FULFILLMENT_NEEDS_ATTENTION", {
      orderId: order.id,
      orderNumber: order.orderNumber
    });
    count += 1;
  }
  return count;
}

export async function runGuaranteedOrderIntakeJobs(io?: Server): Promise<void> {
  await expireStaleMerchantPendingOrders(io);
  await rematchWaitingCommerceCouriers(io);
  await flagLongWaitCommerceOrders();
}

export async function listMerchantActiveOrders(merchantId: string) {
  return prisma.commerceOrder.findMany({
    where: {
      merchantId,
      status: {
        in: [
          CommerceOrderStatus.MERCHANT_PENDING,
          CommerceOrderStatus.MERCHANT_ACCEPTED,
          CommerceOrderStatus.READY_FOR_PICKUP,
          CommerceOrderStatus.COURIER_ASSIGNED,
          CommerceOrderStatus.PICKED_UP,
          CommerceOrderStatus.OUT_FOR_DELIVERY
        ]
      }
    },
    include: { items: true, customer: true },
    orderBy: { createdAt: "desc" }
  });
}

export async function findMerchantOrder(merchantId: string, orderIdOrNumber: string | number) {
  const raw = String(orderIdOrNumber).trim();
  const fulfillment = parseMerchantFulfillmentRef(raw);
  const asNum = typeof orderIdOrNumber === "number" ? orderIdOrNumber : Number(orderIdOrNumber);
  const order = await prisma.commerceOrder.findFirst({
    where: {
      merchantId,
      OR: [
        { id: raw },
        ...(fulfillment
          ? [
              {
                fulfillmentLabel: fulfillment.label,
                checkout: { checkoutNumber: fulfillment.checkoutNumber }
              }
            ]
          : []),
        ...(Number.isFinite(asNum) ? [{ orderNumber: asNum }] : [])
      ]
    },
    include: {
      items: true,
      merchant: true,
      customer: true,
      commerceCustomer: true,
      linkedDeliveryGig: true,
      checkout: true
    }
  });
  if (!order) throw new AppError("Order not found.", 404, "ORDER_NOT_FOUND");
  return order;
}

export async function getCustomerActiveOrder(commerceCustomerId: string) {
  return prisma.commerceOrder.findFirst({
    where: {
      commerceCustomerId,
      status: {
        notIn: [
          CommerceOrderStatus.DELIVERED,
          CommerceOrderStatus.CANCELLED,
          CommerceOrderStatus.MERCHANT_REJECTED,
          CommerceOrderStatus.PAYMENT_FAILED,
          CommerceOrderStatus.DRAFT
        ]
      }
    },
    include: {
      items: true,
      merchant: true,
      linkedDeliveryGig: {
        include: { assignments: { include: { worker: true } } }
      }
    },
    orderBy: { createdAt: "desc" }
  });
}

export function formatOrderTrackMessage(order: Awaited<ReturnType<typeof getCustomerActiveOrder>>): string {
  if (!order) return "You don't have an active DUTS order right now. Tell me what you'd like to buy.";
  const courier = order.linkedDeliveryGig?.assignments?.[0]?.worker;
  const status = commerceCustomerStatusCopy(order.status as never);
  const gigStatus = order.linkedDeliveryGig?.status;
  let deliveryLine: string | null = null;
  if (order.status === CommerceOrderStatus.READY_FOR_PICKUP && !courier) {
    deliveryLine = "We're finding a courier. Delivery may take longer than usual.";
  } else if (gigStatus === GigStatus.WORKER_EN_ROUTE || gigStatus === GigStatus.WORKER_ARRIVED) {
    deliveryLine = "Courier is collecting from the shop.";
  } else if (
    gigStatus === GigStatus.PACKAGE_COLLECTED ||
    gigStatus === GigStatus.EN_ROUTE_TO_DROPOFF
  ) {
    deliveryLine = "Your order is on the way.";
  } else if (gigStatus === GigStatus.ARRIVED_AT_DROPOFF) {
    deliveryLine = "Courier has arrived.";
  }

  return [
    status,
    `Order #${order.orderNumber}`,
    `Shop: ${order.merchant.name}`,
    courier ? `Courier: ${courier.fullName}` : null,
    deliveryLine,
    `Items: $${(order.subtotalCents / 100).toFixed(2)} · Total: $${(order.totalCents / 100).toFixed(2)}`
  ]
    .filter(Boolean)
    .join("\n");
}

/** Sync commerce order when linked delivery gig status changes. */
export async function syncCommerceOrderFromGig(gigId: string, gigStatus: GigStatus): Promise<void> {
  const checkout = await prisma.commerceCheckout.findFirst({
    where: { linkedDeliveryGigId: gigId },
    include: { orders: true, pickupStops: true }
  });
  if (checkout) {
    if (gigStatus === GigStatus.WORKER_ASSIGNED || gigStatus === GigStatus.WORKER_SELECTED) {
      await prisma.commerceCheckout.update({
        where: { id: checkout.id },
        data: {
          status:
            checkout.status === CommerceCheckoutStatus.NEEDS_ATTENTION
              ? CommerceCheckoutStatus.NEEDS_ATTENTION
              : CommerceCheckoutStatus.FULFILLING
        }
      });
      await prisma.commerceOrder.updateMany({
        where: {
          checkoutId: checkout.id,
          status: {
            in: [CommerceOrderStatus.READY_FOR_PICKUP, CommerceOrderStatus.MERCHANT_ACCEPTED]
          }
        },
        data: { status: CommerceOrderStatus.COURIER_ASSIGNED }
      });
    } else if (gigStatus === GigStatus.PACKAGE_COLLECTED || gigStatus === GigStatus.EN_ROUTE_TO_DROPOFF || gigStatus === GigStatus.ARRIVED_AT_DROPOFF) {
      await prisma.commerceCheckout.update({
        where: { id: checkout.id },
        data: { status: CommerceCheckoutStatus.OUT_FOR_DELIVERY }
      });
    } else if (gigStatus === GigStatus.COMPLETED || gigStatus === GigStatus.WAITING_CUSTOMER_CONFIRMATION) {
      await prisma.commerceCheckout.update({
        where: { id: checkout.id },
        data: { status: CommerceCheckoutStatus.DELIVERED, deliveredAt: new Date() }
      });
      await prisma.commerceOrder.updateMany({
        where: { checkoutId: checkout.id, status: { not: CommerceOrderStatus.MERCHANT_REJECTED } },
        data: { status: CommerceOrderStatus.DELIVERED, deliveredAt: new Date() }
      });
    } else if (gigStatus === GigStatus.CANCELLED) {
      const collected = checkout.pickupStops.some((s) => s.status === "COLLECTED");
      if (collected) {
        const { markCheckoutNeedsAttention } = await import("./multi-shop-checkout.service.js");
        await markCheckoutNeedsAttention(checkout.id);
      } else {
        await prisma.commerceCheckout.update({
          where: { id: checkout.id },
          data: { status: CommerceCheckoutStatus.CANCELLED, cancelledAt: new Date() }
        });
      }
    }
    return;
  }

  const order = await prisma.commerceOrder.findFirst({ where: { linkedDeliveryGigId: gigId } });
  if (!order) return;

  let next: CommerceOrderStatus | null = null;
  if (gigStatus === GigStatus.WORKER_ASSIGNED || gigStatus === GigStatus.WORKER_SELECTED) {
    next = CommerceOrderStatus.COURIER_ASSIGNED;
  } else if (
    gigStatus === GigStatus.SEARCHING_FOR_WORKER ||
    gigStatus === GigStatus.POSTED
  ) {
    // Courier rematch before pickup — do not claim a courier is assigned.
    if (
      order.status === CommerceOrderStatus.COURIER_ASSIGNED ||
      order.status === CommerceOrderStatus.READY_FOR_PICKUP
    ) {
      next = CommerceOrderStatus.READY_FOR_PICKUP;
    }
  } else if (
    gigStatus === GigStatus.WORKER_EN_ROUTE ||
    gigStatus === GigStatus.WORKER_ARRIVED ||
    gigStatus === GigStatus.PACKAGE_COLLECTED
  ) {
    next = CommerceOrderStatus.PICKED_UP;
  } else if (
    gigStatus === GigStatus.EN_ROUTE_TO_DROPOFF ||
    gigStatus === GigStatus.ARRIVED_AT_DROPOFF
  ) {
    next = CommerceOrderStatus.OUT_FOR_DELIVERY;
  } else if (
    gigStatus === GigStatus.COMPLETED ||
    gigStatus === GigStatus.WAITING_CUSTOMER_CONFIRMATION
  ) {
    next = CommerceOrderStatus.DELIVERED;
  } else if (gigStatus === GigStatus.CANCELLED) {
    next = CommerceOrderStatus.CANCELLED;
  }

  if (!next || next === order.status) return;

  await prisma.commerceOrder.update({
    where: { id: order.id },
    data: {
      status: next,
      ...(next === CommerceOrderStatus.DELIVERED ? { deliveredAt: new Date() } : {}),
      ...(next === CommerceOrderStatus.CANCELLED ? { cancelledAt: new Date() } : {})
    }
  });

  if (next === CommerceOrderStatus.COURIER_ASSIGNED && order.customerWhatsAppPhone) {
    if (hasFulfillmentNote(order.notes, FULFILLMENT_NOTE.COURIER_SEARCH_WAITING)) {
      logDutsFlow("COMMERCE_COURIER_ASSIGNED_AFTER_WAIT", {
        gigId,
        orderId: order.id,
        orderNumber: order.orderNumber
      });
    }
    try {
      const { notifyCustomerStatus } = await import("../whatsapp/merchant-handler.js");
      await notifyCustomerStatus(
        order.customerWhatsAppPhone,
        `A courier is on the way for order #${order.orderNumber}.`
      );
    } catch {
      /* non-blocking */
    }
  }

  if (next === CommerceOrderStatus.READY_FOR_PICKUP && order.status === CommerceOrderStatus.COURIER_ASSIGNED) {
    if (order.customerWhatsAppPhone) {
      try {
        const { notifyCustomerStatus } = await import("../whatsapp/merchant-handler.js");
        await notifyCustomerStatus(
          order.customerWhatsAppPhone,
          `We're finding another courier for order #${order.orderNumber}.`
        );
      } catch {
        /* non-blocking */
      }
    }
  }

  if (next === CommerceOrderStatus.DELIVERED) {
    logDutsFlow("COMMERCE_DELIVERED", {
      gigId,
      userId: order.customerId ?? undefined,
      orderId: order.id,
      orderNumber: order.orderNumber
    });
  }
}

export function formatOrderSummaryWhatsApp(order: {
  orderNumber: number;
  merchant: { name: string };
  items: Array<{ quantity: number; productNameSnapshot: string; lineTotalCents: number }>;
  subtotalCents: number;
  deliveryFeeCents: number;
  serviceFeeCents: number;
  totalCents: number;
  deliveryLabel: string;
}): string {
  const lines = order.items.map(
    (i) =>
      `${i.quantity} × ${i.productNameSnapshot} — $${(i.lineTotalCents / 100).toFixed(2)}`
  );
  return [
    "Your order:",
    ...lines.map((l) => `• ${l}`),
    "",
    `Shop: ${order.merchant.name}`,
    `Items: $${(order.subtotalCents / 100).toFixed(2)}`,
    `Delivery: $${(order.deliveryFeeCents / 100).toFixed(2)}`,
    order.serviceFeeCents > 0 ? `Service fee: $${(order.serviceFeeCents / 100).toFixed(2)}` : null,
    `Total: $${(order.totalCents / 100).toFixed(2)}`,
    `Deliver to: ${order.deliveryLabel}`,
    "",
    `Order #${order.orderNumber}`
  ]
    .filter((x) => x !== null)
    .join("\n");
}
