/**
 * Publish an unresolved supported-city request into the global courier pool.
 * Does not invent a merchandise price, charge a customer, or create a shop order.
 */
import type { Server } from "socket.io";
import {
  CommerceCheckoutStatus,
  DeliveryJobKind,
  FulfillmentType,
  GigStatus,
  OrderSource,
  PackageCategory,
  PaymentLifecycle,
  PaymentStatus,
  PricingType,
  Prisma
} from "@prisma/client";
import {
  generateDeliveryPin,
  planSourceDeliveryBackfill,
  summarizeSourceDeliveryBackfill,
  presentSourceDelivery,
  sourceCityLabel,
  resolveSupportedPackagePricingCity,
  type SourceBackfillRow
} from "@gigflow/shared";
import { prisma } from "../../config/prisma.js";
import { getSocketServer } from "../../lib/socket.js";
import { resolveDeliveryClientUserId } from "./commerce-customer.service.js";
import { sourceDeliveryBackfillEnabled, sourceDeliveryEnabled } from "./source-delivery-pilot.js";
import { ensureDeliveryCategory, hashDeliveryPin } from "../gigs/delivery.service.js";

const OPEN_SOURCE_STATUSES: GigStatus[] = [GigStatus.POSTED, GigStatus.SEARCHING_FOR_WORKER];

type CheckoutRow = {
  id: string;
  createdAt: Date;
  status: CommerceCheckoutStatus;
  validationFixture: boolean;
  commerceCustomerId: string | null;
  customerId: string | null;
  deliveryLabel: string;
  deliveryLatitude: Prisma.Decimal;
  deliveryLongitude: Prisma.Decimal;
  deliveryFeeCents: number;
  packageClass: string | null;
  customerWhatsAppPhone: string | null;
  paymentMethod: string;
  orderSource: OrderSource;
  linkedDeliveryGigId: string | null;
  notes: string | null;
  lines: Array<{
    catalogProductId: string;
    quantity: number;
    productNameSnapshot: string;
    unitPriceCents: number | null;
  }>;
  orders: Array<{ id: string }>;
  commerceCustomer: { id: string; userId: string | null; displayName: string | null; whatsappPhone: string | null } | null;
};

function cityFor(row: { deliveryLabel: string; deliveryLatitude: Prisma.Decimal; deliveryLongitude: Prisma.Decimal }) {
  return resolveSupportedPackagePricingCity({
    deliveryLabel: row.deliveryLabel,
    typedAddress: row.deliveryLabel,
    customerLatitude: Number(row.deliveryLatitude),
    customerLongitude: Number(row.deliveryLongitude)
  });
}

function toPlanRow(row: CheckoutRow): SourceBackfillRow | null {
  const city = cityFor(row);
  if (!city || !row.commerceCustomerId) return null;
  return {
    checkoutId: row.id,
    createdAt: row.createdAt.toISOString(),
    customerKey: row.commerceCustomerId,
    city,
    lines: row.lines.map((line) => ({ catalogProductId: line.catalogProductId, quantity: line.quantity })),
    linkedDeliveryGigId: row.linkedDeliveryGigId,
    orderCount: row.orders.length,
    status: row.status,
    paymentMethod: row.paymentMethod
  };
}

async function loadOpenRequests(): Promise<CheckoutRow[]> {
  return prisma.commerceCheckout.findMany({
    where: { status: CommerceCheckoutStatus.AWAITING_FULFILLMENT, validationFixture: false },
    include: {
      lines: {
        select: { catalogProductId: true, quantity: true, productNameSnapshot: true, unitPriceCents: true }
      },
      orders: { select: { id: true } },
      commerceCustomer: { select: { id: true, userId: true, displayName: true, whatsappPhone: true } }
    },
    orderBy: { createdAt: "asc" }
  });
}

export async function dryRunSourceDeliveryBackfill() {
  const rows = await loadOpenRequests();
  const readable = rows.map(toPlanRow).filter((row): row is SourceBackfillRow => Boolean(row));
  const plan = planSourceDeliveryBackfill(readable);
  return {
    plan,
    ...summarizeSourceDeliveryBackfill({
      scanned: rows.length,
      plan,
      unreadable: rows.length - readable.length
    })
  };
}

async function optionalIo(io?: Server | null): Promise<Server | null> {
  if (io) return io;
  try {
    return getSocketServer();
  } catch {
    return null;
  }
}

export async function publishSourceDeliveryForCheckout(
  checkoutId: string,
  options?: { io?: Server | null; ignoreDuplicate?: boolean }
): Promise<{ gigId: string | null; action: string }> {
  if (!sourceDeliveryEnabled()) return { gigId: null, action: "skip" };
  const checkout = await prisma.commerceCheckout.findUnique({
    where: { id: checkoutId },
    include: {
      lines: {
        select: { catalogProductId: true, quantity: true, productNameSnapshot: true, unitPriceCents: true }
      },
      orders: { select: { id: true } },
      commerceCustomer: { select: { id: true, userId: true, displayName: true, whatsappPhone: true } }
    }
  });
  if (!checkout || checkout.validationFixture) return { gigId: null, action: "skip" };
  if (checkout.status !== CommerceCheckoutStatus.AWAITING_FULFILLMENT) return { gigId: checkout.linkedDeliveryGigId, action: "skip" };
  if (checkout.orders.length > 0 || checkout.fulfillmentOwner === "SHOP") return { gigId: null, action: "skip" };
  if (checkout.paymentMethod !== "CASH") return { gigId: null, action: "skip" };
  if (checkout.linkedDeliveryGigId) return { gigId: checkout.linkedDeliveryGigId, action: "already_published" };
  if (!checkout.lines.length || !checkout.commerceCustomerId) return { gigId: null, action: "skip" };

  const city = cityFor(checkout);
  if (!city) return { gigId: null, action: "skip" };

  if (!options?.ignoreDuplicate) {
    const peers = await loadOpenRequests();
    const plan = planSourceDeliveryBackfill(
      peers.map(toPlanRow).filter((row): row is SourceBackfillRow => Boolean(row))
    );
    const mine = plan.find((item) => item.checkoutId === checkoutId);
    if (!mine || mine.action === "duplicate" || mine.action === "skip") {
      return { gigId: null, action: mine?.action ?? "skip" };
    }
    if (mine.action === "already_published") {
      return { gigId: checkout.linkedDeliveryGigId, action: "already_published" };
    }
  }

  const displayCity = sourceCityLabel(city);
  const view = presentSourceDelivery({
    deliveryLabel: checkout.deliveryLabel,
    city,
    deliveryFeeCents: checkout.deliveryFeeCents,
    lines: checkout.lines.map((line) => ({
      name: line.productNameSnapshot,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents
    }))
  });
  const clientId = await resolveDeliveryClientUserId(
    checkout.commerceCustomer ?? { userId: checkout.customerId }
  );
  const category = await ensureDeliveryCategory();
  const idempotencyKey = `source-checkout-${checkout.id}`;
  const existingGig = await prisma.gig.findFirst({
    where: { idempotencyKey, fulfillmentType: FulfillmentType.DELIVERY }
  });
  if (existingGig) {
    await prisma.commerceCheckout.updateMany({
      where: { id: checkout.id, linkedDeliveryGigId: null },
      data: { linkedDeliveryGigId: existingGig.id }
    });
    return { gigId: existingGig.id, action: "already_published" };
  }

  const phone =
    checkout.customerWhatsAppPhone || checkout.commerceCustomer?.whatsappPhone || null;
  const description = view.products.map((line) => `${line.name} × ${line.quantity}`).join(", ").slice(0, 240);
  const size = checkout.packageClass === "LARGE" ? "LARGE" : checkout.packageClass === "MEDIUM" ? "MEDIUM" : "SMALL";
  const deliveryFeeCents = checkout.deliveryFeeCents;

  let gigId: string;
  try {
    const gig = await prisma.gig.create({
      data: {
        clientId,
        serviceCategoryId: category.id,
        title: "Source & deliver",
        description: description || "Source and deliver",
        status: GigStatus.SEARCHING_FOR_WORKER,
        fulfillmentType: FulfillmentType.DELIVERY,
        deliveryJobKind: DeliveryJobKind.SOURCE_AND_DELIVER,
        orderSource: checkout.orderSource,
        paymentStatus: PaymentLifecycle.PAYMENT_AUTHORIZED,
        publishedAt: new Date(),
        authorizedAt: new Date(),
        pricingType: PricingType.FIXED,
        urgency: "STANDARD",
        size,
        estimatedHours: 1,
        distanceMiles: 0,
        demandMultiplier: 1,
        startsAt: new Date(),
        addressLine1: `Source around ${displayCity}`,
        city: displayCity,
        region: displayCity,
        postalCode: "0000",
        country: "ZW",
        formattedAddress: `Source around ${displayCity}`,
        latitude: checkout.deliveryLatitude,
        longitude: checkout.deliveryLongitude,
        pickupInstructions: "No registered shop is supplying this request. Source the products, then deliver them.",
        dropoffAddressLine1: checkout.deliveryLabel,
        dropoffCity: view.deliverTo.split(",")[0]?.trim() || city,
        dropoffRegion: displayCity,
        dropoffPostalCode: "0000",
        dropoffCountry: "ZW",
        dropoffFormattedAddress: checkout.deliveryLabel,
        dropoffLatitude: checkout.deliveryLatitude,
        dropoffLongitude: checkout.deliveryLongitude,
        dropoffContactName: "Customer",
        dropoffContactPhone: phone,
        dropoffInstructions: `DUTS request. Merchandise price is not confirmed.`,
        packageCategory: PackageCategory.OTHER,
        packageDescription: description,
        packageSize: size,
        packageNotes: `source-checkout:${checkout.id}`,
        pickupPin: "pending",
        deliveryPin: "pending",
        prohibitedItemsAck: true,
        idempotencyKey,
        taxCents: 0,
        totalCents: deliveryFeeCents,
        platformFeeCents: 0,
        workerPayoutCents: deliveryFeeCents,
        authorizationBufferCents: 0,
        maximumAuthorizedAmountCents: deliveryFeeCents,
        priceBreakdown: {
          fulfillmentType: "DELIVERY",
          deliveryJobKind: "SOURCE_AND_DELIVER",
          deliveryFeeCents,
          merchandisePriceStatus: view.merchandisePriceStatus,
          merchandiseSubtotalCents: view.merchandiseSubtotalCents,
          pricingNote: "Merchandise price is not included until it is confirmed."
        } as Prisma.InputJsonValue,
        payment: {
          create: {
            amountCents: deliveryFeeCents,
            platformFeeCents: 0,
            workerPayoutCents: deliveryFeeCents,
            maximumAuthorizedAmountCents: deliveryFeeCents,
            currency: "usd",
            status: PaymentStatus.AUTHORIZED,
            authorizedAt: new Date()
          }
        },
        chatThread: { create: {} }
      }
    });
    gigId = gig.id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await prisma.gig.findFirst({ where: { idempotencyKey } });
      if (!raced) throw error;
      await prisma.commerceCheckout.updateMany({
        where: { id: checkout.id, linkedDeliveryGigId: null },
        data: { linkedDeliveryGigId: raced.id }
      });
      return { gigId: raced.id, action: "already_published" };
    }
    throw error;
  }

  const pickupPlain = generateDeliveryPin(4);
  const deliveryPlain = generateDeliveryPin(4);
  await prisma.gig.update({
    where: { id: gigId },
    data: {
      pickupPin: hashDeliveryPin(pickupPlain, gigId),
      deliveryPin: hashDeliveryPin(deliveryPlain, gigId)
    }
  });
  const linked = await prisma.commerceCheckout.updateMany({
    where: {
      id: checkout.id,
      linkedDeliveryGigId: null,
      status: CommerceCheckoutStatus.AWAITING_FULFILLMENT,
      OR: [{ fulfillmentOwner: null }, { fulfillmentOwner: "COURIER_SOURCE" }]
    },
    data: { linkedDeliveryGigId: gigId, fulfillmentOwner: "COURIER_SOURCE" }
  });
  if (linked.count !== 1) {
    await prisma.gig.delete({ where: { id: gigId } }).catch(() => undefined);
    const current = await prisma.commerceCheckout.findUnique({
      where: { id: checkout.id },
      select: { linkedDeliveryGigId: true }
    });
    return { gigId: current?.linkedDeliveryGigId ?? null, action: "already_published" };
  }

  const socket = await optionalIo(options?.io);
  if (socket) {
    const { broadcastGigOffer } = await import("../realtime/realtime.service.js");
    await broadcastGigOffer(socket, {
      gigId,
      title: "Source & deliver",
      serviceCategoryId: category.id,
      serviceCategoryName: category.name,
      latitude: Number(checkout.deliveryLatitude),
      longitude: Number(checkout.deliveryLongitude),
      city: displayCity,
      region: displayCity,
      size,
      totalCents: deliveryFeeCents,
      workerPayoutCents: deliveryFeeCents,
      startsAt: new Date().toISOString(),
      urgency: "STANDARD",
      estimatedHours: 1,
      fulfillmentType: "DELIVERY"
    });
  }
  return { gigId, action: "publish" };
}

export async function applySourceDeliveryBackfill(io?: Server | null) {
  const dry = await dryRunSourceDeliveryBackfill();
  if (!sourceDeliveryBackfillEnabled()) {
    return { before: dry.plan, publishedGigIds: [], after: dry.plan };
  }
  const published: string[] = [];
  for (const item of dry.plan) {
    if (item.action !== "publish") continue;
    const result = await publishSourceDeliveryForCheckout(item.checkoutId, { io, ignoreDuplicate: true });
    if (result.gigId) published.push(result.gigId);
  }
  const again = await dryRunSourceDeliveryBackfill();
  return { before: dry.plan, publishedGigIds: published, after: again.plan };
}

/** A shop quote replaces an unassigned sourcing job so the normal pickup path can be created later. */
export async function retireUnassignedSourceGig(
  tx: Prisma.TransactionClient,
  checkoutId: string
): Promise<boolean> {
  const checkout = await tx.commerceCheckout.findUnique({
    where: { id: checkoutId },
    select: { linkedDeliveryGigId: true }
  });
  if (!checkout?.linkedDeliveryGigId) return false;
  const gig = await tx.gig.findUnique({ where: { id: checkout.linkedDeliveryGigId } });
  if (!gig || gig.deliveryJobKind !== DeliveryJobKind.SOURCE_AND_DELIVER) return false;
  if (!OPEN_SOURCE_STATUSES.includes(gig.status)) return false;
  const cancelled = await tx.gig.updateMany({
    where: {
      id: gig.id,
      deliveryJobKind: DeliveryJobKind.SOURCE_AND_DELIVER,
      assignedWorkerId: null,
      status: { in: OPEN_SOURCE_STATUSES }
    },
    data: {
      status: GigStatus.CANCELLED,
      cancelledAt: new Date(),
      cancellationReason: "shop_can_supply"
    }
  });
  if (cancelled.count !== 1) return false;
  await tx.commerceCheckout.update({
    where: { id: checkoutId },
    data: { linkedDeliveryGigId: null }
  });
  return true;
}
