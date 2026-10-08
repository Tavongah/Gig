import {
  AccountStatus,
  AvailabilityStatus,
  CommercePaymentAttemptStatus,
  GigStatus,
  OrderSource,
  PaymentLifecycle,
  Prisma,
  UnlistedItemCustomerDecision,
  UnlistedItemRequestStatus,
  UserRole,
  type UnlistedItemRequest
} from "@prisma/client";
import { randomBytes } from "node:crypto";
import {
  calculatePilotDeliveryPrice,
  classifyPackage,
  distanceKmBetween,
  resolvePilotLocationMode,
  haversineMiles,
  parseUnlistedItemCodEnabled,
  parseUnlistedItemRequestEnabled,
  parseUnlistedRequestText,
  UNLISTED_PRE_PURCHASE_RELEASE_STATUSES,
  unlistedItemMaxPriceCents,
  unlistedItemMinPriceCents,
  unlistedItemSearchTtlSeconds,
  validateUnlistedFoundPriceCents
} from "@gigflow/shared";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import { logDutsFlow } from "../../lib/flow-log.js";
import { getSocketServer } from "../../lib/socket.js";
import { persistNormalizedCatalogPhoto } from "../../lib/catalog-photo-upload.js";
import { notifyUser } from "../realtime/realtime.service.js";

export function assertUnlistedEnabled() {
  if (!parseUnlistedItemRequestEnabled(process.env.UNLISTED_ITEM_REQUEST_ENABLED)) {
    throw new AppError("This feature is not available yet.", 404, "UNLISTED_ITEM_DISABLED");
  }
}

export function unlistedCodEnabled() {
  return parseUnlistedItemCodEnabled(process.env.UNLISTED_ITEM_COD_ENABLED);
}

function priceBounds() {
  return {
    minCents: unlistedItemMinPriceCents(process.env.UNLISTED_ITEM_MIN_PRICE_CENTS),
    maxCents: unlistedItemMaxPriceCents(process.env.UNLISTED_ITEM_MAX_PRICE_CENTS)
  };
}

function newApprovalId() {
  return randomBytes(12).toString("base64url");
}

function ttlMs() {
  return unlistedItemSearchTtlSeconds(process.env.UNLISTED_ITEM_SEARCH_TTL_SECONDS) * 1000;
}

async function recordEvent(
  requestId: string,
  type: string,
  actorType: "CUSTOMER" | "COURIER" | "SYSTEM" | "ADMIN",
  actorId?: string | null,
  payload?: Record<string, unknown>
) {
  await prisma.unlistedItemRequestEvent.create({
    data: { requestId, type, actorType, actorId: actorId ?? null, payload: (payload ?? undefined) as Prisma.InputJsonValue | undefined }
  });
}

function tryIo() {
  try {
    return getSocketServer();
  } catch {
    return null;
  }
}

function publicRequest(row: UnlistedItemRequest) {
  return {
    id: row.id,
    requestNumber: row.requestNumber,
    status: row.status,
    originalRequestText: row.originalRequestText,
    parsedItemName: row.parsedItemName,
    quantity: row.quantity,
    optionalNotes: row.optionalNotes,
    optionalMaxBudgetCents: row.optionalMaxBudgetCents,
    foundProductName: row.foundProductName,
    foundPriceCents: row.foundPriceCents,
    foundPhotoUrl: row.foundPhotoUrl,
    foundMerchantName: row.foundMerchantName,
    foundNote: row.foundNote,
    customerDecision: row.customerDecision,
    approvalId: row.approvalId,
    quoteVersion: row.quoteVersion,
    deliveryFeeCents: row.deliveryFeeCents,
    totalCents: row.totalCents,
    deliveryLabel: row.deliveryLabel,
    deliveryLatitude: row.deliveryLatitude != null ? Number(row.deliveryLatitude) : null,
    deliveryLongitude: row.deliveryLongitude != null ? Number(row.deliveryLongitude) : null,
    assignedCourierId: row.assignedCourierId,
    linkedDeliveryGigId: row.linkedDeliveryGigId,
    whatsappPhone: row.whatsappPhone,
    expiresAt: row.expiresAt.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
    purchasedAt: row.purchasedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export type CreateUnlistedRequestInput = {
  originalRequestText: string;
  quantity?: number;
  optionalNotes?: string;
  optionalMaxBudgetCents?: number | null;
  commerceCustomerId?: string | null;
  customerUserId?: string | null;
  checkoutSessionId?: string | null;
  whatsappPhone?: string | null;
  orderSource: OrderSource;
  deliveryLatitude: number;
  deliveryLongitude: number;
  deliveryLabel: string;
  deliveryPrecision?: string | null;
  deliveryInstructions?: string | null;
};

export async function createUnlistedItemRequest(input: CreateUnlistedRequestInput) {
  assertUnlistedEnabled();
  const parsed = parseUnlistedRequestText(input.originalRequestText);
  const quantity = input.quantity && input.quantity >= 1 ? Math.min(20, Math.floor(input.quantity)) : parsed.quantity;
  const budget =
    input.optionalMaxBudgetCents != null
      ? input.optionalMaxBudgetCents
      : parsed.optionalMaxBudgetCents;
  const row = await prisma.unlistedItemRequest.create({
    data: {
      commerceCustomerId: input.commerceCustomerId ?? null,
      customerUserId: input.customerUserId ?? null,
      checkoutSessionId: input.checkoutSessionId ?? null,
      originalRequestText: parsed.originalRequestText,
      parsedItemName: parsed.itemName,
      quantity,
      optionalNotes: input.optionalNotes?.trim().slice(0, 400) || null,
      optionalMaxBudgetCents: budget,
      status: UnlistedItemRequestStatus.REQUESTED,
      customerDecision: UnlistedItemCustomerDecision.NONE,
      deliveryLatitude: input.deliveryLatitude,
      deliveryLongitude: input.deliveryLongitude,
      deliveryLabel: input.deliveryLabel.slice(0, 240),
      deliveryPrecision: input.deliveryPrecision ?? null,
      deliveryInstructions: input.deliveryInstructions?.slice(0, 240) ?? null,
      whatsappPhone: input.whatsappPhone ?? null,
      orderSource: input.orderSource,
      expiresAt: new Date(Date.now() + ttlMs())
    }
  });
  await recordEvent(row.id, "REQUESTED", "CUSTOMER", input.customerUserId ?? input.whatsappPhone);
  logDutsFlow("COMMERCE_BASKET_CREATED", { requestId: row.id, item: row.parsedItemName });
  await offerUnlistedSearchToCouriers(row);
  return publicRequest(row);
}

async function offerUnlistedSearchToCouriers(row: UnlistedItemRequest) {
  const lat = Number(row.deliveryLatitude);
  const lng = Number(row.deliveryLongitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const workers = await prisma.user.findMany({
    where: {
      roles: { has: UserRole.WORKER },
      accountStatus: AccountStatus.APPROVED,
      workerProfile: {
        availabilityStatus: AvailabilityStatus.AVAILABLE,
        deliveryEligible: true,
        currentLatitude: { not: null },
        currentLongitude: { not: null }
      }
    },
    include: { workerProfile: true },
    take: 40
  });
  const io = tryIo();
  if (!io) return;
  for (const worker of workers) {
    const wLat = Number(worker.workerProfile?.currentLatitude);
    const wLng = Number(worker.workerProfile?.currentLongitude);
    if (!Number.isFinite(wLat) || !Number.isFinite(wLng)) continue;
    const miles = haversineMiles(wLat, wLng, lat, lng);
    const radius = Number(worker.workerProfile?.travelDistanceMiles ?? 10);
    if (miles > radius) continue;
    io.to(`user:${worker.id}`).emit("unlisted:offer", { requestId: row.id });
    notifyUser(io, worker.id, {
      type: "UNLISTED_SEARCH_OFFER",
      title: "FIND AN ITEM",
      body: `Customer needs: ${row.parsedItemName}`
    });
  }
}

export async function listOpenUnlistedSearchesForCourier(courierId: string) {
  if (!parseUnlistedItemRequestEnabled(process.env.UNLISTED_ITEM_REQUEST_ENABLED)) {
    return { searches: [] as ReturnType<typeof publicRequest>[] };
  }
  const worker = await prisma.user.findUnique({
    where: { id: courierId },
    include: { workerProfile: true }
  });
  const wLat = Number(worker?.workerProfile?.currentLatitude);
  const wLng = Number(worker?.workerProfile?.currentLongitude);
  const open = await prisma.unlistedItemRequest.findMany({
    where: {
      OR: [
        { status: UnlistedItemRequestStatus.REQUESTED },
        { status: UnlistedItemRequestStatus.SEARCHING, assignedCourierId: courierId },
        {
          assignedCourierId: courierId,
          status: {
            in: [
              UnlistedItemRequestStatus.FOUND_AWAITING_CUSTOMER,
              UnlistedItemRequestStatus.CUSTOMER_APPROVED,
              UnlistedItemRequestStatus.PAYMENT_PENDING,
              UnlistedItemRequestStatus.PAID,
              UnlistedItemRequestStatus.PURCHASED,
              UnlistedItemRequestStatus.DELIVERING,
              UnlistedItemRequestStatus.NEEDS_ATTENTION
            ]
          }
        }
      ]
    },
    orderBy: { createdAt: "desc" },
    take: 30
  });
  const searches = open.filter((row) => {
    if (row.assignedCourierId === courierId) return true;
    if (row.status !== UnlistedItemRequestStatus.REQUESTED) return false;
    if (!Number.isFinite(wLat) || !Number.isFinite(wLng)) return true;
    const miles = haversineMiles(wLat, wLng, Number(row.deliveryLatitude), Number(row.deliveryLongitude));
    const radius = Number(worker?.workerProfile?.travelDistanceMiles ?? 10);
    return miles <= radius;
  });
  return { searches: searches.map(publicRequest) };
}

export async function acceptUnlistedSearch(requestId: string, courierId: string) {
  assertUnlistedEnabled();
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.unlistedItemRequest.findUnique({ where: { id: requestId } });
    if (!row) throw new AppError("Search request not found.", 404, "UNLISTED_NOT_FOUND");
    if (row.status === UnlistedItemRequestStatus.SEARCHING && row.assignedCourierId === courierId) {
      return row;
    }
    if (row.status !== UnlistedItemRequestStatus.REQUESTED) {
      throw new AppError("This search is no longer available.", 409, "UNLISTED_NOT_AVAILABLE");
    }
    return tx.unlistedItemRequest.update({
      where: { id: requestId, status: UnlistedItemRequestStatus.REQUESTED },
      data: { status: UnlistedItemRequestStatus.SEARCHING, assignedCourierId: courierId }
    });
  });
  await recordEvent(updated.id, "COURIER_ACCEPTED", "COURIER", courierId);
  return publicRequest(updated);
}

export async function submitUnlistedQuote(
  requestId: string,
  courierId: string,
  input: {
    foundProductName: string;
    foundPriceCents: number;
    foundMerchantName: string;
    foundNote?: string;
    foundPhotoBase64?: string;
    shopLatitude?: number;
    shopLongitude?: number;
  }
) {
  assertUnlistedEnabled();
  const bounds = priceBounds();
  const priced = validateUnlistedFoundPriceCents(input.foundPriceCents, bounds);
  if (!priced.ok) throw new AppError(priced.reason, 400, "UNLISTED_PRICE_INVALID");
  const name = input.foundProductName.trim().slice(0, 180);
  const shop = input.foundMerchantName.trim().slice(0, 120);
  if (!name || !shop) throw new AppError("Product name and shop are required.", 400, "VALIDATION_ERROR");

  const row = await prisma.unlistedItemRequest.findUnique({ where: { id: requestId } });
  if (!row || row.assignedCourierId !== courierId) {
    throw new AppError("Search request not found.", 404, "UNLISTED_NOT_FOUND");
  }
  if (
    row.status !== UnlistedItemRequestStatus.SEARCHING &&
    row.status !== UnlistedItemRequestStatus.FOUND_AWAITING_CUSTOMER &&
    row.status !== UnlistedItemRequestStatus.CUSTOMER_APPROVED &&
    row.status !== UnlistedItemRequestStatus.PAYMENT_PENDING
  ) {
    if (
      row.status === UnlistedItemRequestStatus.PAID ||
      row.status === UnlistedItemRequestStatus.PURCHASED ||
      row.status === UnlistedItemRequestStatus.DELIVERING
    ) {
      return reportUnlistedPriceChangeAfterPaid(requestId, courierId, input);
    }
    throw new AppError("Cannot submit a quote in this state.", 409, "UNLISTED_INVALID_STATUS");
  }

  let photoUrl = row.foundPhotoUrl;
  if (input.foundPhotoBase64) {
    try {
      const uploaded = await persistNormalizedCatalogPhoto({
        userId: courierId,
        dataBase64: input.foundPhotoBase64
      });
      photoUrl = uploaded.url;
    } catch {
      photoUrl = row.foundPhotoUrl;
    }
  }

  const customerLat = Number(row.deliveryLatitude);
  const customerLng = Number(row.deliveryLongitude);
  const shopLat = input.shopLatitude ?? customerLat;
  const shopLng = input.shopLongitude ?? customerLng;
  const routeKm = distanceKmBetween(
    { latitude: shopLat, longitude: shopLng },
    { latitude: customerLat, longitude: customerLng }
  );
  const locationMode = resolvePilotLocationMode({
    deliveryPrecision: row.deliveryPrecision,
    typedAddress: row.deliveryInstructions,
    deliveryLabel: row.deliveryLabel
  });
  const packageClass =
    locationMode === "TYPED_PILOT"
      ? classifyPackage([{ quantity: row.quantity }])
      : "SMALL";
  const delivery = calculatePilotDeliveryPrice({
    routeDistanceKm: routeKm,
    packageClass,
    locationMode
  });
  if (!delivery.eligible || delivery.deliveryFeeCents == null) {
    throw new AppError("We can't deliver this to the customer location yet.", 409, "SHOP_NOT_NEARBY");
  }
  const itemCents = input.foundPriceCents * row.quantity;
  const approvalId = newApprovalId();
  const updated = await prisma.unlistedItemRequest.update({
    where: { id: requestId },
    data: {
      status: UnlistedItemRequestStatus.FOUND_AWAITING_CUSTOMER,
      foundProductName: name,
      foundPriceCents: input.foundPriceCents,
      foundMerchantName: shop,
      foundNote: input.foundNote?.trim().slice(0, 240) || null,
      foundPhotoUrl: photoUrl,
      approvalId,
      quoteVersion: { increment: 1 },
      deliveryFeeCents: delivery.deliveryFeeCents,
      totalCents: itemCents + delivery.deliveryFeeCents,
      customerDecision: UnlistedItemCustomerDecision.NONE
    }
  });
  await recordEvent(updated.id, "QUOTE_SUBMITTED", "COURIER", courierId, {
    foundPriceCents: input.foundPriceCents,
    foundProductName: name,
    approvalId
  });
  const pub = publicRequest(updated);
  void import("../whatsapp/unlisted-whatsapp.js")
    .then(({ presentUnlistedQuoteToWhatsApp }) => presentUnlistedQuoteToWhatsApp(pub))
    .catch(() => undefined);
  return pub;
}

export async function reportUnlistedNotFound(requestId: string, courierId: string) {
  assertUnlistedEnabled();
  const row = await prisma.unlistedItemRequest.findUnique({ where: { id: requestId } });
  if (!row || row.assignedCourierId !== courierId) {
    throw new AppError("Search request not found.", 404, "UNLISTED_NOT_FOUND");
  }
  if (row.status === UnlistedItemRequestStatus.PAID || row.status === UnlistedItemRequestStatus.PURCHASED) {
    throw new AppError("This item was already paid or purchased.", 409, "UNLISTED_ALREADY_PAID");
  }
  const updated = await prisma.unlistedItemRequest.update({
    where: { id: requestId },
    data: {
      status: UnlistedItemRequestStatus.NOT_FOUND,
      assignedCourierId: null
    }
  });
  await recordEvent(updated.id, "NOT_FOUND", "COURIER", courierId);
  const pub = publicRequest(updated);
  void import("../whatsapp/unlisted-whatsapp.js")
    .then(({ notifyUnlistedCustomerEvent }) => notifyUnlistedCustomerEvent(pub, "NOT_FOUND"))
    .catch(() => undefined);
  return pub;
}

export async function releaseUnlistedSearch(requestId: string, courierId: string) {
  assertUnlistedEnabled();
  const row = await prisma.unlistedItemRequest.findUnique({ where: { id: requestId } });
  if (!row || row.assignedCourierId !== courierId) {
    throw new AppError("Search request not found.", 404, "UNLISTED_NOT_FOUND");
  }
  if (
    row.status === UnlistedItemRequestStatus.PURCHASED ||
    row.status === UnlistedItemRequestStatus.DELIVERING ||
    row.status === UnlistedItemRequestStatus.COMPLETED
  ) {
    const updated = await prisma.unlistedItemRequest.update({
      where: { id: requestId },
      data: { status: UnlistedItemRequestStatus.NEEDS_ATTENTION }
    });
    await recordEvent(updated.id, "RELEASE_BLOCKED_POST_PURCHASE", "COURIER", courierId);
    throw new AppError(
      "This item was already purchased. DUTS needs to help resolve it.",
      409,
      "UNLISTED_NEEDS_ATTENTION"
    );
  }
  if (row.status === UnlistedItemRequestStatus.PAID) {
    const updated = await prisma.unlistedItemRequest.update({
      where: { id: requestId },
      data: { status: UnlistedItemRequestStatus.NEEDS_ATTENTION }
    });
    await recordEvent(updated.id, "RELEASE_AFTER_PAID", "COURIER", courierId);
    const pub = publicRequest(updated);
    void import("../whatsapp/unlisted-whatsapp.js")
      .then(({ notifyUnlistedCustomerEvent }) => notifyUnlistedCustomerEvent(pub, "NEEDS_ATTENTION"))
      .catch(() => undefined);
    return pub;
  }
  if (
    !(UNLISTED_PRE_PURCHASE_RELEASE_STATUSES as readonly string[]).includes(row.status) &&
    row.status !== UnlistedItemRequestStatus.SEARCHING
  ) {
    throw new AppError("This search cannot be released.", 409, "UNLISTED_INVALID_STATUS");
  }
  const updated = await prisma.unlistedItemRequest.update({
    where: { id: requestId },
    data: {
      status: UnlistedItemRequestStatus.REQUESTED,
      assignedCourierId: null,
      foundProductName: null,
      foundPriceCents: null,
      foundMerchantName: null,
      foundNote: null,
      approvalId: null,
      customerDecision: UnlistedItemCustomerDecision.NONE,
      expiresAt: new Date(Date.now() + ttlMs())
    }
  });
  await recordEvent(updated.id, "COURIER_RELEASED", "COURIER", courierId);
  await offerUnlistedSearchToCouriers(updated);
  return publicRequest(updated);
}

export async function approveUnlistedQuote(input: {
  requestId: string;
  approvalId: string;
  actorId?: string | null;
}) {
  assertUnlistedEnabled();
  const row = await prisma.unlistedItemRequest.findUnique({ where: { id: input.requestId } });
  if (!row) throw new AppError("Request not found.", 404, "UNLISTED_NOT_FOUND");
  if (!row.approvalId || row.approvalId !== input.approvalId) {
    throw new AppError("This offer is no longer valid.", 409, "UNLISTED_STALE_APPROVAL");
  }
  if (row.status === UnlistedItemRequestStatus.CUSTOMER_APPROVED || row.status === UnlistedItemRequestStatus.PAYMENT_PENDING) {
    return publicRequest(row);
  }
  if (row.status === UnlistedItemRequestStatus.PAID) return publicRequest(row);
  if (row.status !== UnlistedItemRequestStatus.FOUND_AWAITING_CUSTOMER) {
    throw new AppError("This offer cannot be approved now.", 409, "UNLISTED_INVALID_STATUS");
  }
  const updated = await prisma.unlistedItemRequest.update({
    where: { id: row.id, status: UnlistedItemRequestStatus.FOUND_AWAITING_CUSTOMER, approvalId: input.approvalId },
    data: {
      status: UnlistedItemRequestStatus.CUSTOMER_APPROVED,
      customerDecision: UnlistedItemCustomerDecision.APPROVED
    }
  });
  await recordEvent(updated.id, "CUSTOMER_APPROVED", "CUSTOMER", input.actorId, { approvalId: input.approvalId });
  return publicRequest(updated);
}

export async function declineUnlistedQuote(input: {
  requestId: string;
  approvalId: string;
  actorId?: string | null;
}) {
  assertUnlistedEnabled();
  const row = await prisma.unlistedItemRequest.findUnique({ where: { id: input.requestId } });
  if (!row) throw new AppError("Request not found.", 404, "UNLISTED_NOT_FOUND");
  if (!row.approvalId || row.approvalId !== input.approvalId) {
    throw new AppError("This offer is no longer valid.", 409, "UNLISTED_STALE_APPROVAL");
  }
  if (row.status === UnlistedItemRequestStatus.CUSTOMER_DECLINED) return publicRequest(row);
  if (row.status === UnlistedItemRequestStatus.PAID || row.status === UnlistedItemRequestStatus.PURCHASED) {
    throw new AppError("This request was already paid.", 409, "UNLISTED_ALREADY_PAID");
  }
  const updated = await prisma.unlistedItemRequest.update({
    where: { id: row.id },
    data: {
      status: UnlistedItemRequestStatus.CUSTOMER_DECLINED,
      customerDecision: UnlistedItemCustomerDecision.DECLINED
    }
  });
  await recordEvent(updated.id, "CUSTOMER_DECLINED", "CUSTOMER", input.actorId, { approvalId: input.approvalId });
  return publicRequest(updated);
}

export async function getUnlistedRequest(requestId: string) {
  const row = await prisma.unlistedItemRequest.findUnique({ where: { id: requestId } });
  if (!row) throw new AppError("Request not found.", 404, "UNLISTED_NOT_FOUND");
  return publicRequest(row);
}

export async function reportUnlistedPriceChangeAfterPaid(
  requestId: string,
  courierId: string,
  input: {
    foundProductName?: string;
    foundPriceCents: number;
    foundMerchantName?: string;
    foundNote?: string;
    foundPhotoBase64?: string;
  }
) {
  const row = await prisma.unlistedItemRequest.findUnique({ where: { id: requestId } });
  if (!row || row.assignedCourierId !== courierId) {
    throw new AppError("Search request not found.", 404, "UNLISTED_NOT_FOUND");
  }
  if (row.foundPriceCents === input.foundPriceCents) return publicRequest(row);
  const updated = await prisma.unlistedItemRequest.update({
    where: { id: requestId },
    data: {
      status: UnlistedItemRequestStatus.NEEDS_ATTENTION,
      foundNote: `Price changed at shop to $${(input.foundPriceCents / 100).toFixed(2)}. ${input.foundNote ?? ""}`.slice(
        0,
        240
      )
    }
  });
  await recordEvent(updated.id, "PRICE_CHANGE_AFTER_PAID", "COURIER", courierId, {
    previousCents: row.foundPriceCents,
    foundPriceCents: input.foundPriceCents
  });
  const pub = publicRequest(updated);
  void import("../whatsapp/unlisted-whatsapp.js")
    .then(({ notifyUnlistedCustomerEvent }) => notifyUnlistedCustomerEvent(pub, "NEEDS_ATTENTION"))
    .catch(() => undefined);
  return pub;
}

export async function reportUnlistedPriceChange(
  requestId: string,
  courierId: string,
  input: {
    foundProductName?: string;
    foundPriceCents: number;
    foundMerchantName?: string;
    foundNote?: string;
    foundPhotoBase64?: string;
  }
) {
  assertUnlistedEnabled();
  const bounds = priceBounds();
  const priced = validateUnlistedFoundPriceCents(input.foundPriceCents, bounds);
  if (!priced.ok) throw new AppError(priced.reason, 400, "UNLISTED_PRICE_INVALID");
  const row = await prisma.unlistedItemRequest.findUnique({ where: { id: requestId } });
  if (!row || row.assignedCourierId !== courierId) {
    throw new AppError("Search request not found.", 404, "UNLISTED_NOT_FOUND");
  }
  if (row.foundPriceCents === input.foundPriceCents) return publicRequest(row);
  if (
    row.status === UnlistedItemRequestStatus.PAID ||
    row.status === UnlistedItemRequestStatus.PURCHASED ||
    row.status === UnlistedItemRequestStatus.DELIVERING
  ) {
    return reportUnlistedPriceChangeAfterPaid(requestId, courierId, input);
  }
  return submitUnlistedQuote(requestId, courierId, {
    foundProductName: input.foundProductName ?? row.foundProductName ?? row.parsedItemName,
    foundPriceCents: input.foundPriceCents,
    foundMerchantName: input.foundMerchantName ?? row.foundMerchantName ?? "Shop",
    foundNote: input.foundNote,
    foundPhotoBase64: input.foundPhotoBase64
  });
}

export async function markUnlistedPurchased(requestId: string, courierId: string) {
  assertUnlistedEnabled();
  const row = await prisma.unlistedItemRequest.findUnique({ where: { id: requestId } });
  if (!row || row.assignedCourierId !== courierId) {
    throw new AppError("Search request not found.", 404, "UNLISTED_NOT_FOUND");
  }
  if (row.status !== UnlistedItemRequestStatus.PAID && row.status !== UnlistedItemRequestStatus.PURCHASED) {
    throw new AppError("Purchase is not authorized yet.", 409, "UNLISTED_NOT_AUTHORIZED");
  }
  if (row.status === UnlistedItemRequestStatus.PURCHASED && row.linkedDeliveryGigId) {
    return publicRequest(row);
  }
  const updated = await prisma.unlistedItemRequest.update({
    where: { id: requestId },
    data: { status: UnlistedItemRequestStatus.PURCHASED, purchasedAt: row.purchasedAt ?? new Date() }
  });
  await recordEvent(updated.id, "PURCHASED", "COURIER", courierId, {
    authorizedPriceCents: row.foundPriceCents
  });
  const io = tryIo();
  if (io) {
    await startUnlistedDeliveryAfterPurchase(updated.id, courierId, io).catch(() => undefined);
  }
  return publicRequest(await prisma.unlistedItemRequest.findUniqueOrThrow({ where: { id: requestId } }));
}

export async function expireStaleUnlistedRequests() {
  if (!parseUnlistedItemRequestEnabled(process.env.UNLISTED_ITEM_REQUEST_ENABLED)) return { expired: 0 };
  const now = new Date();
  const stale = await prisma.unlistedItemRequest.findMany({
    where: {
      expiresAt: { lt: now },
      status: {
        in: [
          UnlistedItemRequestStatus.REQUESTED,
          UnlistedItemRequestStatus.SEARCHING,
          UnlistedItemRequestStatus.FOUND_AWAITING_CUSTOMER
        ]
      }
    },
    take: 50
  });
  for (const row of stale) {
    await prisma.unlistedItemRequest.update({
      where: { id: row.id },
      data: { status: UnlistedItemRequestStatus.EXPIRED, assignedCourierId: null }
    });
    await recordEvent(row.id, "EXPIRED", "SYSTEM");
    void import("../whatsapp/unlisted-whatsapp.js")
      .then(({ notifyUnlistedCustomerEvent }) => notifyUnlistedCustomerEvent(publicRequest({ ...row, status: UnlistedItemRequestStatus.EXPIRED, assignedCourierId: null }), "EXPIRED"))
      .catch(() => undefined);
  }
  return { expired: stale.length };
}

export async function listUnlistedRequestsForAdmin() {
  const rows = await prisma.unlistedItemRequest.findMany({
    take: 100,
    orderBy: { createdAt: "desc" },
    include: {
      commerceCustomer: { select: { displayName: true, whatsappPhone: true } },
      assignedCourier: { select: { id: true, fullName: true } },
      events: { orderBy: { createdAt: "desc" }, take: 12 },
      paymentAttempts: { orderBy: { createdAt: "desc" }, take: 3 }
    }
  });
  return {
    requests: rows.map((row) => ({
      ...publicRequest(row),
      customer: row.commerceCustomer,
      courier: row.assignedCourier,
      events: row.events,
      paymentAttempts: row.paymentAttempts.map((a) => ({
        id: a.id,
        status: a.status,
        amountCents: a.amountCents,
        provider: a.provider,
        merchantReference: a.merchantReference,
        createdAt: a.createdAt
      }))
    }))
  };
}

export async function markUnlistedPaidFromAttempt(requestId: string, attemptId: string) {
  const row = await prisma.unlistedItemRequest.findUnique({ where: { id: requestId } });
  if (!row) return null;
  if (row.status === UnlistedItemRequestStatus.PAID || row.status === UnlistedItemRequestStatus.PURCHASED) {
    return row;
  }
  const updated = await prisma.unlistedItemRequest.update({
    where: { id: requestId },
    data: { status: UnlistedItemRequestStatus.PAID, paidAt: new Date() }
  });
  await recordEvent(updated.id, "PAID", "SYSTEM", attemptId);
  const pub = publicRequest(updated);
  void import("../whatsapp/unlisted-whatsapp.js")
    .then(({ notifyUnlistedCustomerEvent }) => notifyUnlistedCustomerEvent(pub, "PAID"))
    .catch(() => undefined);
  const io = tryIo();
  if (io && updated.assignedCourierId) {
    notifyUser(io, updated.assignedCourierId, {
      type: "UNLISTED_PAYMENT_CONFIRMED",
      title: "PAYMENT CONFIRMED ✓",
      body: `Purchase: ${updated.foundProductName ?? updated.parsedItemName}. Maximum authorized item price: $${((updated.foundPriceCents ?? 0) / 100).toFixed(2)}`
    });
    io.to(`user:${updated.assignedCourierId}`).emit("unlisted:paid", { requestId: updated.id });
  }
  return updated;
}

export async function markUnlistedPaymentFailed(requestId: string, reason: string) {
  const row = await prisma.unlistedItemRequest.findUnique({ where: { id: requestId } });
  if (!row || row.status === UnlistedItemRequestStatus.PAID) return row;
  const updated = await prisma.unlistedItemRequest.update({
    where: { id: requestId },
    data: { status: UnlistedItemRequestStatus.CUSTOMER_APPROVED }
  });
  await recordEvent(updated.id, "PAYMENT_FAILED", "SYSTEM", null, { reason });
  return updated;
}

export async function markUnlistedDelivering(requestId: string, gigId: string) {
  return prisma.unlistedItemRequest.update({
    where: { id: requestId },
    data: { status: UnlistedItemRequestStatus.DELIVERING, linkedDeliveryGigId: gigId }
  });
}

export async function startUnlistedDeliveryAfterPurchase(
  requestId: string,
  courierId: string,
  io: { to: (room: string) => { emit: (ev: string, payload: unknown) => void } }
) {
  const row = await prisma.unlistedItemRequest.findUnique({ where: { id: requestId } });
  if (!row || row.assignedCourierId !== courierId) return;
  if (row.linkedDeliveryGigId) return;
  if (row.status !== UnlistedItemRequestStatus.PURCHASED && row.status !== UnlistedItemRequestStatus.PAID) {
    return;
  }
  const { createDelivery } = await import("../gigs/delivery.service.js");
  const { resolveDeliveryClientUserId, ensureMarketplaceDeliveryClientUserId } = await import(
    "./commerce-customer.service.js"
  );
  const clientId = row.customerUserId
    ? await resolveDeliveryClientUserId({ userId: row.customerUserId })
    : await ensureMarketplaceDeliveryClientUserId();
  const courier = await prisma.user.findUnique({ where: { id: courierId } });
  const lat = Number(row.deliveryLatitude);
  const lng = Number(row.deliveryLongitude);
  const label = row.deliveryLabel || "Customer";
  const phone = row.whatsappPhone || courier?.phoneNumber || "+263700000000";
  const result = await createDelivery(
    clientId,
    {
      pickup: {
        latitude: lat,
        longitude: lng,
        formattedAddress: row.foundMerchantName || label,
        addressLine1: row.foundMerchantName || label,
        city: "Harare",
        region: "Harare",
        postalCode: "0000",
        country: "ZW",
        contactName: (row.foundMerchantName || "Shop").slice(0, 80),
        contactPhone: courier?.phoneNumber || phone,
        instructions: `Unlisted item ${row.parsedItemName}`
      },
      dropoff: {
        latitude: lat,
        longitude: lng,
        formattedAddress: label,
        addressLine1: label,
        city: "Harare",
        region: "Harare",
        postalCode: "0000",
        country: "ZW",
        contactName: "Customer",
        contactPhone: phone,
        instructions: row.deliveryInstructions || `Unlisted item #${row.requestNumber}`
      },
      package: {
        category: "GROCERIES",
        description: `${row.quantity}× ${row.foundProductName ?? row.parsedItemName}`.slice(0, 240),
        size: "SMALL",
        notes: `Unlisted request ${row.id}`
      },
      prohibitedItemsAck: true,
      orderSource: row.orderSource === OrderSource.WEB ? "WEB" : row.orderSource === OrderSource.APP ? "APP" : "WHATSAPP"
    },
    io as never,
    {
      idempotencyKey: `unlisted-${row.id}`,
      orderSource: row.orderSource === OrderSource.WEB ? "WEB" : row.orderSource === OrderSource.APP ? "APP" : "WHATSAPP",
      bypassClientPostGate: true,
      skipMarketplaceBroadcast: true
    }
  );
  const gigId = String((result.delivery as { id?: string }).id ?? "");
  if (!gigId) return;
  const now = new Date();
  await prisma.gig.update({
    where: { id: gigId },
    data: {
      assignedWorkerId: courierId,
      status: GigStatus.PACKAGE_COLLECTED,
      paymentStatus: PaymentLifecycle.PAYMENT_CAPTURED,
      pickupVerifiedAt: now
    }
  });
  await prisma.gigAssignment.upsert({
    where: { gigId_workerId: { gigId, workerId: courierId } },
    create: { gigId, workerId: courierId, acceptedAt: now, startedAt: now },
    update: { acceptedAt: now, startedAt: now }
  });
  await markUnlistedDelivering(requestId, gigId);
  io.to(`user:${courierId}`).emit("unlisted:delivering", { requestId, gigId });
}

export async function markUnlistedCompletedByGig(gigId: string) {
  const row = await prisma.unlistedItemRequest.findUnique({ where: { linkedDeliveryGigId: gigId } });
  if (!row) return;
  if (row.status === UnlistedItemRequestStatus.COMPLETED) return;
  await prisma.unlistedItemRequest.update({
    where: { id: row.id },
    data: { status: UnlistedItemRequestStatus.COMPLETED, completedAt: new Date() }
  });
  await recordEvent(row.id, "COMPLETED", "SYSTEM", gigId);
}

export { publicRequest };
export type UnlistedPublicRequest = ReturnType<typeof publicRequest>;
