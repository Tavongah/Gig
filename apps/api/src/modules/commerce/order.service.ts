import {
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
import { commerceCustomerStatusCopy } from "@gigflow/shared";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import { logDutsFlow } from "../../lib/flow-log.js";
import { createDelivery } from "../gigs/delivery.service.js";
import { estimateDeliveryFee } from "../gigs/delivery-pricing.service.js";
import { getMarketplaceSettings, type BasketLine } from "./merchant.service.js";
import { normalizePhoneNumber } from "../auth/access.service.js";
import { broadcastGigOffer } from "../realtime/realtime.service.js";
import {
  assertCommercePaymentMethodAllowed,
  getMerchantResponseTimeoutSeconds,
  paymentStatusForMethod,
  resolveCommercePaymentMethod
} from "./payment-mode.js";

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

const WA_AVATAR =
  "https://api.dicebear.com/9.x/shapes/svg?seed=duts-whatsapp";

/** Lightweight WhatsApp shopper identity — no app install required. */
export async function ensureWhatsAppCustomer(phone: string, displayName?: string) {
  const phoneNormalized = normalizePhoneNumber(phone);
  const existing = await prisma.user.findUnique({ where: { phoneNumber: phoneNormalized } });
  if (existing) return existing;

  const email = `wa_${phoneNormalized.replace(/\D/g, "")}@whatsapp.duts.local`;
  const byEmail = await prisma.user.findUnique({ where: { email } });
  if (byEmail) {
    return prisma.user.update({
      where: { id: byEmail.id },
      data: {
        phoneNumber: phoneNormalized,
        phoneVerified: true,
        emailVerified: true,
        profileCompleted: true,
        avatarUrl: byEmail.avatarUrl ?? WA_AVATAR
      }
    });
  }

  return prisma.user.create({
    data: {
      email,
      phoneNumber: phoneNormalized,
      fullName: displayName?.trim() || `WhatsApp ${phoneNormalized.slice(-4)}`,
      phoneVerified: true,
      emailVerified: true,
      profileCompleted: true,
      avatarUrl: WA_AVATAR,
      roles: ["CLIENT"],
      defaultRole: "CLIENT",
      accountStatus: "ACTIVE",
      country: "ZW",
      city: "Harare",
      region: "Harare"
    }
  });
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
  const delivery = await estimateDeliveryFee({
    pickup: {
      latitude: input.merchantLat,
      longitude: input.merchantLng
    },
    dropoff: {
      latitude: input.customerLat,
      longitude: input.customerLng
    }
  });
  const deliveryFeeCents = delivery.totalCents;
  const serviceFeeCents = settings.serviceFeeCents;
  const totalCents = subtotalCents + deliveryFeeCents + serviceFeeCents;
  return { subtotalCents, deliveryFeeCents, serviceFeeCents, totalCents, currency: "usd" as const };
}

export async function createConfirmedCommerceOrder(input: {
  customerId: string;
  merchantId: string;
  lines: BasketLine[];
  deliveryLabel: string;
  deliveryLatitude: number;
  deliveryLongitude: number;
  customerWhatsAppPhone?: string;
  paymentMethod?: CommercePaymentMethod | string;
  paymentStatus?: CommercePaymentStatus;
}) {
  if (input.lines.length === 0) {
    throw new AppError("Basket is empty.", 400, "EMPTY_BASKET");
  }
  const paymentMethod = resolveCommercePaymentMethod(input.paymentMethod);
  assertCommercePaymentMethodAllowed(paymentMethod);
  const paymentStatus = input.paymentStatus ?? paymentStatusForMethod(paymentMethod);

  const merchant = await prisma.merchant.findUniqueOrThrow({ where: { id: input.merchantId } });
  if (!merchant.isActive || !merchant.acceptsOrders) {
    throw new AppError("This shop is not accepting orders right now.", 409, "MERCHANT_CLOSED");
  }

  const priceChanges: Array<{ name: string; oldCents: number; newCents: number }> = [];
  const unavailable: string[] = [];
  const refreshedLines: BasketLine[] = [];

  for (const line of input.lines) {
    const product = await prisma.product.findFirst({
      where: { id: line.productId, merchantId: input.merchantId, archived: false }
    });
    if (!product || !product.available) {
      unavailable.push(line.productName);
      continue;
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
  const totals = await quoteBasketTotals({
    merchantLat: Number(merchant.latitude),
    merchantLng: Number(merchant.longitude),
    customerLat: input.deliveryLatitude,
    customerLng: input.deliveryLongitude,
    lines
  });

  const merchantRespondBy = new Date(Date.now() + getMerchantResponseTimeoutSeconds() * 1000);

  const order = await prisma.commerceOrder.create({
    data: {
      customerId: input.customerId,
      merchantId: input.merchantId,
      status: CommerceOrderStatus.MERCHANT_PENDING,
      paymentStatus,
      paymentMethod,
      orderSource: OrderSource.WHATSAPP,
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
      confirmedAt: new Date(),
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
    include: { items: true, merchant: true, customer: true }
  });

  logDutsFlow("COMMERCE_ORDER_CONFIRMED", {
    gigId: undefined,
    userId: input.customerId,
    userRole: "CLIENT",
    orderId: order.id,
    orderNumber: order.orderNumber,
    merchantId: merchant.id,
    totalCents: order.totalCents,
    paymentMethod,
    paymentStatus
  });

  return order;
}

export async function merchantAcceptOrder(merchantId: string, orderIdOrNumber: string | number) {
  const order = await findMerchantOrder(merchantId, orderIdOrNumber);
  if (order.status !== CommerceOrderStatus.MERCHANT_PENDING) {
    throw new AppError("Order is not awaiting merchant acceptance.", 409, "INVALID_ORDER_STATE");
  }
  const updated = await prisma.commerceOrder.update({
    where: { id: order.id },
    data: {
      status: CommerceOrderStatus.MERCHANT_ACCEPTED,
      merchantAcceptedAt: new Date()
    },
    include: { items: true, merchant: true, customer: true }
  });
  logDutsFlow("COMMERCE_MERCHANT_ACCEPTED", {
    userId: order.customerId,
    orderId: order.id,
    orderNumber: order.orderNumber
  });
  return updated;
}

export async function merchantRejectOrder(merchantId: string, orderIdOrNumber: string | number) {
  const order = await findMerchantOrder(merchantId, orderIdOrNumber);
  if (
    order.status !== CommerceOrderStatus.MERCHANT_PENDING &&
    order.status !== CommerceOrderStatus.MERCHANT_ACCEPTED
  ) {
    throw new AppError("Order cannot be rejected in its current state.", 409, "INVALID_ORDER_STATE");
  }
  const updated = await prisma.commerceOrder.update({
    where: { id: order.id },
    data: { status: CommerceOrderStatus.MERCHANT_REJECTED, cancelledAt: new Date() },
    include: { items: true, merchant: true, customer: true }
  });
  logDutsFlow("COMMERCE_MERCHANT_REJECTED", {
    userId: order.customerId,
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

  const customer = order.customer;
  const merchant = order.merchant;
  const summary = order.items.map((i) => `${i.quantity}× ${i.productNameSnapshot}`).join(", ");

  const deliveryResult = await createDelivery(
    customer.id,
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
        contactName: merchant.contactName,
        contactPhone: merchant.phone,
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
        contactName: customer.fullName,
        contactPhone: order.customerWhatsAppPhone || customer.phoneNumber || merchant.phone,
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

  const gigId = (deliveryResult.delivery as { id: string }).id;

  const updated = await prisma.commerceOrder.update({
    where: { id: order.id },
    data: {
      status: CommerceOrderStatus.READY_FOR_PICKUP,
      readyAt: new Date(),
      linkedDeliveryGigId: gigId
    },
    include: { items: true, merchant: true, customer: true, linkedDeliveryGig: true }
  });

  // Link must exist before opening courier matching (openMarketplace checks commerceOrder).
  if (!deliveryResult.idempotentReplay) {
    await openMarketplaceDeliveryForCouriers(gigId, io);
  }

  logDutsFlow("COMMERCE_READY_FOR_PICKUP", {
    gigId,
    userId: customer.id,
    orderId: order.id,
    orderNumber: order.orderNumber
  });

  return { order: updated, delivery: deliveryResult };
}

/** Expire MERCHANT_PENDING orders past merchantRespondBy. */
export async function expireStaleMerchantPendingOrders(): Promise<number> {
  const now = new Date();
  const stale = await prisma.commerceOrder.findMany({
    where: {
      status: CommerceOrderStatus.MERCHANT_PENDING,
      merchantRespondBy: { lt: now }
    },
    include: { merchant: true, customer: true }
  });

  let count = 0;
  for (const order of stale) {
    await prisma.commerceOrder.update({
      where: { id: order.id },
      data: { status: CommerceOrderStatus.CANCELLED, cancelledAt: now, notes: "merchant_timeout" }
    });
    logDutsFlow("COMMERCE_MERCHANT_TIMEOUT", {
      orderId: order.id,
      orderNumber: order.orderNumber,
      userId: order.customerId,
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
  const asNum = typeof orderIdOrNumber === "number" ? orderIdOrNumber : Number(orderIdOrNumber);
  const order = await prisma.commerceOrder.findFirst({
    where: {
      merchantId,
      OR: [
        { id: String(orderIdOrNumber) },
        ...(Number.isFinite(asNum) ? [{ orderNumber: asNum }] : [])
      ]
    },
    include: { items: true, merchant: true, customer: true, linkedDeliveryGig: true }
  });
  if (!order) throw new AppError("Order not found.", 404, "ORDER_NOT_FOUND");
  return order;
}

export async function getCustomerActiveOrder(customerId: string) {
  return prisma.commerceOrder.findFirst({
    where: {
      customerId,
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
    deliveryLine = "Waiting for a courier to accept the job.";
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
      userId: order.customerId,
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
