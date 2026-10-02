/**
 * DUTS 3-shop checkout orchestration.
 *
 * Parent CommerceCheckout + child CommerceOrders (one merchant each).
 * Combined Gig is created once and linked to the parent, not to each child.
 * One-shop and flag-off paths never enter this module for writes.
 */

import { createHash } from "node:crypto";
import {
  CommerceCheckoutStatus,
  CommerceOrderStatus,
  CommercePaymentMethod,
  CommercePaymentStatus,
  PackageCategory,
  Prisma,
  type OrderSource
} from "@prisma/client";
import type { Server } from "socket.io";
import {
  evaluateCombinedRoute,
  fulfillmentLabelAt,
  FULFILLMENT_NOTE,
  addFulfillmentNote,
  generateDeliveryPin,
  merchantFulfillmentRef,
  parseMaxShopsPerCheckout,
  parseMultiShopMaxExtraRouteKm,
  parseMultiShopMaxExtraRouteRatio,
  parseMultiShopMaxPickupRouteKm,
  type CombinedRouteResult,
  type MultiShopAllocation
} from "@gigflow/shared";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import { logDutsFlow } from "../../lib/flow-log.js";
import { getDeliveryPricingConfig } from "../gigs/delivery-pricing.service.js";
import { findNearbyMerchants, getMarketplaceSettings, type BasketLine } from "./merchant.service.js";
import { quotePilotCommerceDelivery } from "./pilot-delivery.service.js";
import { createConfirmedCommerceOrder, openMarketplaceDeliveryForCouriers } from "./order.service.js";
import { resolveDeliveryClientUserId } from "./commerce-customer.service.js";
import { isMultiShopCheckoutEnabled } from "./payment-mode.js";

export function getMultiShopRuntimeConfig() {
  return {
    enabled: isMultiShopCheckoutEnabled(),
    maxShops: parseMaxShopsPerCheckout(process.env.MAX_SHOPS_PER_CHECKOUT ?? process.env.MULTI_SHOP_MAX_SHOPS),
    maxPickupRouteKm: parseMultiShopMaxPickupRouteKm(process.env.MULTI_SHOP_MAX_PICKUP_ROUTE_KM),
    maxExtraRouteKm: parseMultiShopMaxExtraRouteKm(process.env.MULTI_SHOP_MAX_EXTRA_ROUTE_KM),
    maxExtraRouteRatio: parseMultiShopMaxExtraRouteRatio(process.env.MULTI_SHOP_MAX_EXTRA_ROUTE_RATIO)
  };
}

export function checkoutIdempotencyKey(input: {
  userId: string;
  lat: number;
  lng: number;
  paymentMethod: string;
  lines: Array<{ productId: string; quantity: number }>;
}): string {
  const packed = [
    input.userId,
    input.lat.toFixed(5),
    input.lng.toFixed(5),
    input.paymentMethod,
    [...input.lines]
      .map((l) => `${l.productId}:${l.quantity}`)
      .sort()
      .join(",")
  ].join("|");
  return `msco-${createHash("sha256").update(packed).digest("hex").slice(0, 32)}`;
}

function stopPinScope(gigId: string, commerceOrderId: string): string {
  return `${gigId}:stop:${commerceOrderId}`;
}

export async function evaluateShopsForCombinedRoute(input: {
  merchantIds: string[];
  lat: number;
  lng: number;
}): Promise<{
  route: CombinedRouteResult;
  merchants: Array<{
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    distanceKm: number;
  }>;
}> {
  const cfg = getMultiShopRuntimeConfig();
  const unique = [...new Set(input.merchantIds)];
  if (unique.length === 0) {
    throw new AppError("Basket is empty.", 400, "EMPTY_BASKET");
  }
  if (unique.length > cfg.maxShops) {
    throw new AppError(
      "Your delivery already includes 3 shops. Remove a shop before adding this item.",
      409,
      "SHOP_LIMIT_REACHED"
    );
  }

  const nearby = await findNearbyMerchants(input.lat, input.lng);
  const merchants = [];
  for (const id of unique) {
    const hit = nearby.find((n) => n.merchant.id === id);
    if (!hit) {
      throw new AppError(
        "This shop is too far from the shops already in your delivery. You can place it as a separate order.",
        409,
        "ROUTE_NOT_ELIGIBLE"
      );
    }
    if (!hit.merchant.isActive || !hit.merchant.acceptsOrders) {
      throw new AppError("This shop is not available right now.", 409, "MERCHANT_CLOSED");
    }
    merchants.push({
      id: hit.merchant.id,
      name: hit.merchant.name,
      latitude: Number(hit.merchant.latitude),
      longitude: Number(hit.merchant.longitude),
      distanceKm: Math.round(hit.distanceKm * 10) / 10
    });
  }

  const pricing = await getDeliveryPricingConfig();
  const route = evaluateCombinedRoute({
    pickups: merchants.map((m) => ({
      id: m.id,
      latitude: m.latitude,
      longitude: m.longitude
    })),
    customer: { latitude: input.lat, longitude: input.lng },
    limits: {
      maxPickupRouteKm: cfg.maxPickupRouteKm,
      maxExtraRouteKm: cfg.maxExtraRouteKm,
      maxExtraRouteRatio: cfg.maxExtraRouteRatio,
      maxDeliveryKm: pricing.maxDistanceKm
    }
  });

  if (!route.eligible) {
    throw new AppError(
      "This shop is too far from the shops already in your delivery. You can place it as a separate order.",
      409,
      "ROUTE_NOT_ELIGIBLE"
    );
  }

  return { route, merchants };
}

export async function canJoinShop(input: {
  lat: number;
  lng: number;
  currentMerchantIds: string[];
  newMerchantId: string;
}): Promise<{
  ok: true;
  shopCount: number;
  message: string | null;
}> {
  const cfg = getMultiShopRuntimeConfig();
  if (!cfg.enabled) {
    throw new AppError(
      "Your basket has items from more than one shop. Keep one shop per order.",
      409,
      "MULTI_STORE_BASKET"
    );
  }
  const current = [...new Set(input.currentMerchantIds.filter(Boolean))];
  if (current.includes(input.newMerchantId)) {
    return { ok: true, shopCount: current.length || 1, message: null };
  }
  const next = [...current, input.newMerchantId];
  if (next.length > cfg.maxShops) {
    throw new AppError(
      "Your delivery already includes 3 shops. Remove a shop before adding this item.",
      409,
      "SHOP_LIMIT_REACHED"
    );
  }
  await evaluateShopsForCombinedRoute({
    merchantIds: next,
    lat: input.lat,
    lng: input.lng
  });
  const shopCount = next.length;
  return {
    ok: true,
    shopCount,
    message:
      shopCount > 1 ? `Your delivery now includes ${shopCount} nearby shops.` : null
  };
}

export async function quoteCombinedCart(input: {
  lat: number;
  lng: number;
  lines: BasketLine[];
  merchantIds: string[];
}) {
  const { route, merchants } = await evaluateShopsForCombinedRoute({
    merchantIds: input.merchantIds,
    lat: input.lat,
    lng: input.lng
  });

  const settings = await getMarketplaceSettings();
  const shops = merchants
    .slice()
    .sort((a, b) => route.orderedIds.indexOf(a.id) - route.orderedIds.indexOf(b.id))
    .map((m) => {
      const shopLines = input.lines.filter((l) => l.merchantId === m.id);
      const itemsSubtotalCents = shopLines.reduce((s, l) => s + l.lineTotalCents, 0);
      return {
        id: m.id,
        name: m.name,
        distanceKm: m.distanceKm,
        itemsSubtotalCents,
        itemCount: shopLines.reduce((s, l) => s + l.quantity, 0)
      };
    });

  const subtotalCents = input.lines.reduce((s, l) => s + l.lineTotalCents, 0);
  const delivery = await quotePilotCommerceDelivery({
    routeDistanceKm: route.routeKm,
    lines: input.lines
  });
  const deliveryFeeCents = delivery.deliveryFeeCents;
  const serviceFeeCents = settings.serviceFeeCents;
  const totalCents = subtotalCents + deliveryFeeCents + serviceFeeCents;
  const first = shops[0]!;

  return {
    merchant: {
      id: first.id,
      name: shops.length === 1 ? first.name : `${shops.length} shops`,
      distanceKm: first.distanceKm
    },
    merchants: shops,
    shopCount: shops.length,
    pickupMerchantIds: route.orderedIds,
    routeKm: route.routeKm,
    lines: input.lines,
    subtotalCents,
    deliveryFeeCents,
    serviceFeeCents,
    totalCents,
    currency: "usd" as const,
    deliveryQuoteStatus: "final" as const
  };
}

export async function createMultiShopCheckout(input: {
  userId: string;
  lat: number;
  lng: number;
  deliveryLabel: string;
  lines: BasketLine[];
  paymentMethod: CommercePaymentMethod;
  paymentStatus: CommercePaymentStatus;
  orderSource: OrderSource;
  customerPhone?: string;
  commerceCustomerId: string;
  quote: Awaited<ReturnType<typeof quoteCombinedCart>>;
}) {
  const key = checkoutIdempotencyKey({
    userId: input.userId,
    lat: input.lat,
    lng: input.lng,
    paymentMethod: input.paymentMethod,
    lines: input.lines.map((l) => ({ productId: l.productId, quantity: l.quantity }))
  });

  const existing = await prisma.commerceCheckout.findUnique({
    where: { idempotencyKey: key },
    include: { orders: { include: { merchant: { select: { name: true } } } } }
  });
  if (existing) {
    return existing;
  }

  const isMobileMoney =
    input.paymentMethod === CommercePaymentMethod.ECOCASH ||
    input.paymentMethod === CommercePaymentMethod.ONEMONEY;
  const parentStatus = isMobileMoney
    ? CommerceCheckoutStatus.PAYMENT_PENDING
    : CommerceCheckoutStatus.CONFIRMED;
  const childStatus = isMobileMoney
    ? CommerceOrderStatus.CUSTOMER_CONFIRMED
    : CommerceOrderStatus.MERCHANT_PENDING;
  const merchantRespondBy = isMobileMoney
    ? null
    : new Date(Date.now() + Number(process.env.COMMERCE_MERCHANT_TIMEOUT_SECONDS || 900) * 1000);
  const confirmedAt = isMobileMoney ? null : new Date();

  const orderedMerchantIds = input.quote.pickupMerchantIds;
  const grouped = orderedMerchantIds.map((merchantId, idx) => ({
    merchantId,
    label: fulfillmentLabelAt(idx),
    lines: input.lines.filter((l) => l.merchantId === merchantId)
  }));

  const parent = await prisma.commerceCheckout.create({
    data: {
      customerId: input.userId,
      commerceCustomerId: input.commerceCustomerId,
      status: parentStatus,
      paymentStatus: input.paymentStatus,
      paymentMethod: input.paymentMethod,
      orderSource: input.orderSource,
      itemsSubtotalCents: input.quote.subtotalCents,
      deliveryFeeCents: input.quote.deliveryFeeCents,
      serviceFeeCents: input.quote.serviceFeeCents,
      totalCents: input.quote.totalCents,
      currency: "usd",
      deliveryLabel: input.deliveryLabel,
      deliveryLatitude: input.lat,
      deliveryLongitude: input.lng,
      customerWhatsAppPhone: input.customerPhone ?? null,
      pickupSequence: [],
      allocations: { merchants: [], deliveryFeeCents: input.quote.deliveryFeeCents } as unknown as Prisma.InputJsonValue,
      idempotencyKey: key,
      confirmedAt,
      notes: null
    }
  });

  try {
    const createdOrders: Array<{ id: string; merchantId: string; label: string; itemsCents: number }> = [];
    for (const group of grouped) {
      const itemsCents = group.lines.reduce((s, l) => s + l.lineTotalCents, 0);
      const child = await createConfirmedCommerceOrder({
        customerId: input.userId,
        commerceCustomerId: input.commerceCustomerId,
        merchantId: group.merchantId,
        lines: group.lines,
        deliveryLabel: input.deliveryLabel,
        deliveryLatitude: input.lat,
        deliveryLongitude: input.lng,
        customerWhatsAppPhone: input.customerPhone,
        paymentMethod: input.paymentMethod,
        paymentStatus: input.paymentStatus,
        orderSource: input.orderSource,
        checkoutId: parent.id,
        fulfillmentLabel: group.label,
        totals: {
          subtotalCents: itemsCents,
          deliveryFeeCents: 0,
          serviceFeeCents: 0,
          totalCents: itemsCents,
          currency: "usd"
        }
      });
      await prisma.commerceOrder.update({
        where: { id: child.id },
        data: {
          status: childStatus,
          merchantRespondBy,
          confirmedAt
        }
      });
      createdOrders.push({
        id: child.id,
        merchantId: group.merchantId,
        label: group.label,
        itemsCents
      });
    }

    const allocations: MultiShopAllocation = {
      merchants: createdOrders.map((o) => ({
        merchantId: o.merchantId,
        commerceOrderId: o.id,
        fulfillmentLabel: o.label,
        itemsSubtotalCents: o.itemsCents
      })),
      deliveryFeeCents: input.quote.deliveryFeeCents,
      serviceFeeCents: input.quote.serviceFeeCents,
      itemsSubtotalCents: input.quote.subtotalCents,
      totalCents: input.quote.totalCents
    };

    const checkout = await prisma.commerceCheckout.update({
      where: { id: parent.id },
      data: {
        pickupSequence: createdOrders.map((o) => o.id),
        allocations: allocations as unknown as Prisma.InputJsonValue
      },
      include: { orders: { include: { merchant: { select: { name: true } } } } }
    });

    logDutsFlow("COMMERCE_MULTI_SHOP_CHECKOUT", {
      userId: input.userId,
      checkoutId: checkout.id,
      checkoutNumber: checkout.checkoutNumber,
      shopCount: grouped.length,
      totalCents: checkout.totalCents
    });

    return checkout;
  } catch (err) {
    await prisma.commerceCheckoutPickupStop.deleteMany({ where: { checkoutId: parent.id } }).catch(() => undefined);
    await prisma.commerceOrder.deleteMany({ where: { checkoutId: parent.id } }).catch(() => undefined);
    await prisma.commerceCheckout.delete({ where: { id: parent.id } }).catch(() => undefined);
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
      const replay = await prisma.commerceCheckout.findUnique({
        where: { idempotencyKey: key },
        include: { orders: { include: { merchant: { select: { name: true } } } } }
      });
      if (replay) return replay;
    }
    throw err;
  }
}

export function presentCustomerCheckout(checkout: {
  id: string;
  checkoutNumber: number;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  totalCents: number;
  itemsSubtotalCents: number;
  deliveryFeeCents: number;
  serviceFeeCents: number;
  currency: string;
  deliveryLabel: string;
  notes?: string | null;
  linkedDeliveryGig?: { status: string; assignedWorkerId?: string | null } | null;
  orders: Array<{
    id: string;
    fulfillmentLabel: string | null;
    status: string;
    notes?: string | null;
    merchant: { id: string; name: string; locationLabel?: string | null };
    items: Array<{
      productNameSnapshot: string;
      quantity: number;
      unitPriceCents: number;
      lineTotalCents: number;
    }>;
  }>;
  pickupStops?: Array<{
    sequence: number;
    merchantId: string;
    status: string;
    commerceOrder?: { merchant?: { name: string } };
  }>;
}) {
  const shopCount = checkout.orders.length;
  const first = checkout.orders[0];
  const gigStatus = checkout.linkedDeliveryGig?.status ?? null;
  const hasCourier = Boolean(checkout.linkedDeliveryGig?.assignedWorkerId);
  const pickupProgress = (checkout.pickupStops ?? [])
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map((s) => ({
      shopName: s.commerceOrder?.merchant?.name ?? checkout.orders.find((o) => o.merchant.id === s.merchantId)?.merchant.name ?? "Shop",
      collected: s.status === "COLLECTED"
    }));

  const needsAttention =
    checkout.status === "NEEDS_ATTENTION" ||
    checkout.orders.some((o) => o.status === "MERCHANT_REJECTED");

  return {
    id: checkout.id,
    orderNumber: checkout.checkoutNumber,
    status: checkout.status,
    statusLabel: needsAttention
      ? "Needs attention"
      : shopCount > 1
        ? customerMultiShopStatusLabel(checkout.status, gigStatus, hasCourier, pickupProgress)
        : undefined,
    fulfillmentHint: needsAttention
      ? "There's a problem fulfilling your order. DUTS is checking it now."
      : null,
    shopCount,
    shops: checkout.orders.map((o) => ({
      id: o.merchant.id,
      name: o.merchant.name,
      fulfillmentLabel: o.fulfillmentLabel,
      collected: pickupProgress.find((p) => p.shopName === o.merchant.name)?.collected ?? false
    })),
    pickupProgress,
    totalCents: checkout.totalCents,
    subtotalCents: checkout.itemsSubtotalCents,
    deliveryFeeCents: checkout.deliveryFeeCents,
    serviceFeeCents: checkout.serviceFeeCents,
    currency: checkout.currency,
    paymentStatus: checkout.paymentStatus,
    paymentMethod: checkout.paymentMethod,
    merchant: first
      ? { id: first.merchant.id, name: shopCount > 1 ? `${shopCount} shops` : first.merchant.name, locationLabel: first.merchant.locationLabel ?? null }
      : { id: "", name: "Shops", locationLabel: null },
    merchantName: shopCount > 1 ? `${shopCount} shops` : first?.merchant.name,
    deliveryLabel: checkout.deliveryLabel,
    items: checkout.orders.flatMap((o) =>
      o.items.map((i) => ({
        name: i.productNameSnapshot,
        quantity: i.quantity,
        unitPriceCents: i.unitPriceCents,
        lineTotalCents: i.lineTotalCents,
        shopName: o.merchant.name
      }))
    ),
    deliveryStatus: gigStatus,
    checkoutId: checkout.id,
    isMultiShop: shopCount > 1
  };
}

function customerMultiShopStatusLabel(
  status: string,
  gigStatus: string | null,
  hasCourier: boolean,
  pickups: Array<{ shopName: string; collected: boolean }>
): string {
  if (status === "DELIVERED" || gigStatus === "COMPLETED") return "Delivered";
  if (gigStatus === "EN_ROUTE_TO_DROPOFF" || gigStatus === "ARRIVED_AT_DROPOFF" || gigStatus === "PACKAGE_COLLECTED") {
    return "On the way to you";
  }
  if (hasCourier && pickups.some((p) => !p.collected)) return "Picking up your order";
  if (hasCourier) return "Courier assigned";
  if (status === "PAYMENT_PENDING") return "Waiting for payment";
  return "Order confirmed";
}

export async function markCheckoutNeedsAttention(checkoutId: string, extraNote?: string): Promise<void> {
  const checkout = await prisma.commerceCheckout.findUnique({ where: { id: checkoutId } });
  if (!checkout) return;
  await prisma.commerceCheckout.update({
    where: { id: checkoutId },
    data: {
      status: CommerceCheckoutStatus.NEEDS_ATTENTION,
      notes: addFulfillmentNote(
        extraNote ? addFulfillmentNote(checkout.notes, extraNote) : checkout.notes,
        FULFILLMENT_NOTE.NEEDS_ATTENTION
      )
    }
  });
}

export async function findCheckoutForGig(gigId: string) {
  return prisma.commerceCheckout.findFirst({
    where: { linkedDeliveryGigId: gigId },
    include: {
      orders: {
        include: {
          merchant: true,
          items: true,
          customer: true,
          commerceCustomer: true
        }
      },
      pickupStops: { orderBy: { sequence: "asc" } }
    }
  });
}

export async function currentChildOrderForGig(gigId: string) {
  const checkout = await findCheckoutForGig(gigId);
  if (!checkout) return null;
  const seq = Array.isArray(checkout.pickupSequence)
    ? (checkout.pickupSequence as string[])
    : checkout.orders.map((o) => o.id);
  const currentId = seq[checkout.currentPickupIndex] ?? seq[0];
  return checkout.orders.find((o) => o.id === currentId) ?? checkout.orders[0] ?? null;
}

export async function ensureCombinedCheckoutDelivery(checkoutId: string, io: Server) {
  const checkout = await prisma.commerceCheckout.findUnique({
    where: { id: checkoutId },
    include: {
      orders: { include: { merchant: true, items: true, customer: true, commerceCustomer: true } },
      commerceCustomer: true,
      customer: true,
      linkedDeliveryGig: true
    }
  });
  if (!checkout) throw new AppError("Checkout not found.", 404, "ORDER_NOT_FOUND");
  if (checkout.linkedDeliveryGigId) {
    return {
      delivery: checkout.linkedDeliveryGig,
      secrets: null,
      idempotentReplay: true as const
    };
  }

  const seq = Array.isArray(checkout.pickupSequence)
    ? (checkout.pickupSequence as string[])
    : checkout.orders.map((o) => o.id);
  const ordered = seq
    .map((id) => checkout.orders.find((o) => o.id === id))
    .filter((o): o is (typeof checkout.orders)[number] => Boolean(o));
  if (!ordered.length) throw new AppError("Checkout has no shops.", 409, "INVALID_ORDER_STATE");

  const first = ordered[0]!;
  const contactName =
    checkout.commerceCustomer?.displayName || checkout.customer?.fullName || "Customer";
  const pickupContactPhone = first.merchant.phone || first.merchant.whatsappPhone || "0000000";
  const dropoffContactPhone =
    checkout.customerWhatsAppPhone ||
    checkout.commerceCustomer?.whatsappPhone ||
    checkout.commerceCustomer?.primaryPhone ||
    checkout.customer?.phoneNumber ||
    "0000000";
  const shopNames = ordered.map((o) => o.merchant.name).join(", ");
  const summary = ordered
    .flatMap((o) => o.items.map((i) => `${i.quantity}× ${i.productNameSnapshot}`))
    .join(", ");

  const deliveryClientId = await resolveDeliveryClientUserId(
    checkout.commerceCustomer ?? { userId: checkout.customerId }
  );

  const { createDelivery, hashDeliveryPin } = await import("../gigs/delivery.service.js");
  const deliveryResult = await createDelivery(
    deliveryClientId,
    {
      pickup: {
        latitude: Number(first.merchant.latitude),
        longitude: Number(first.merchant.longitude),
        formattedAddress: `${first.merchant.name}, ${first.merchant.locationLabel}`,
        addressLine1: first.merchant.locationLabel,
        city: "Harare",
        region: "Harare",
        postalCode: "0000",
        country: "ZW",
        contactName: (first.merchant.contactName?.trim() || first.merchant.name).slice(0, 80),
        contactPhone: pickupContactPhone,
        instructions: `${ordered.length} pickups · 1 delivery. Order #${checkout.checkoutNumber}. ${shopNames}`
      },
      dropoff: {
        latitude: Number(checkout.deliveryLatitude),
        longitude: Number(checkout.deliveryLongitude),
        formattedAddress: checkout.deliveryLabel,
        addressLine1: checkout.deliveryLabel,
        city: "Harare",
        region: "Harare",
        postalCode: "0000",
        country: "ZW",
        contactName,
        contactPhone: dropoffContactPhone,
        instructions: `DUTS order #${checkout.checkoutNumber}`
      },
      package: {
        category: PackageCategory.GROCERIES,
        description: `Order #${checkout.checkoutNumber}: ${summary}`.slice(0, 240),
        size: "SMALL",
        notes: `Commerce checkout ${checkout.id}`
      },
      prohibitedItemsAck: true,
      orderSource: "WHATSAPP"
    },
    io,
    {
      idempotencyKey: `commerce-checkout-${checkout.id}`,
      orderSource: "WHATSAPP",
      bypassClientPostGate: true
    }
  );

  const gigId = (deliveryResult.delivery as { id: string }).id;
  const replay = Boolean(deliveryResult.idempotentReplay);

  if (!replay) {
    const pins = ordered.map(() => generateDeliveryPin(4));
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < ordered.length; i++) {
        const order = ordered[i]!;
        const plain = pins[i]!;
        await tx.commerceCheckoutPickupStop.create({
          data: {
            checkoutId: checkout.id,
            commerceOrderId: order.id,
            merchantId: order.merchantId,
            sequence: i,
            pickupPin: hashDeliveryPin(plain, stopPinScope(gigId, order.id)),
            status: "PENDING"
          }
        });
      }
      await tx.commerceCheckout.update({
        where: { id: checkout.id },
        data: {
          linkedDeliveryGigId: gigId,
          currentPickupIndex: 0,
          status:
            checkout.status === CommerceCheckoutStatus.NEEDS_ATTENTION
              ? CommerceCheckoutStatus.NEEDS_ATTENTION
              : CommerceCheckoutStatus.FULFILLING
        }
      });
      await tx.gig.update({
        where: { id: gigId },
        data: {
          pickupPin: hashDeliveryPin(pins[0]!, stopPinScope(gigId, first.id)),
          title: `${ordered.length} pickups · 1 delivery`
        }
      });
    });
    await openMarketplaceDeliveryForCouriers(gigId, io);
  } else {
    await prisma.commerceCheckout.update({
      where: { id: checkout.id },
      data: { linkedDeliveryGigId: gigId }
    });
  }

  logDutsFlow("COMMERCE_COMBINED_DELIVERY", {
    gigId,
    checkoutId: checkout.id,
    checkoutNumber: checkout.checkoutNumber,
    shopCount: ordered.length,
    idempotent: replay
  });

  return deliveryResult;
}

export { stopPinScope, merchantFulfillmentRef };
