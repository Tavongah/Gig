/**
 * DUTS Delivery domain service (Stage 2 + 2.5).
 *
 * PIN model (hashed):
 * - DB stores SHA-256(gigId:pin) in pickupPin / deliveryPin columns (legacy names).
 * - Plaintext is returned only from createDelivery / regenerateDeliveryPins (`secrets`).
 * - getGigDetail and all serializers never expose PIN fields.
 *
 * Completion semantics:
 * - Delivery PIN success → WAITING_CUSTOMER_CONFIRMATION (customer confirm or auto-approve).
 * - autoApproveAt is set; autoApproveStaleGigs honors it.
 */
import type { Server } from "socket.io";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import { logDutsFlow } from "../../lib/flow-log.js";
import { assertClientCanPostGigs } from "../auth/access.service.js";
import { notifyUser } from "../realtime/realtime.service.js";
import { assertWithinDeliveryRadius, estimateDeliveryFee } from "./delivery-pricing.service.js";
import { publishPostedGig } from "../payments/payment.service.js";
import {
  assertDeliveryProductEnabled,
  getDeliveryAutoApproveSeconds,
  getDeliveryPinLockMinutes,
  getDeliveryPinMaxAttempts
} from "../../lib/production-guards.js";
import {
  FulfillmentType,
  GigStatus,
  LaunchPhase,
  OrderSource,
  PackageCategory,
  PricingType,
  Prisma,
  TransportMode
} from "@prisma/client";
import {
  createDeliverySchema,
  DELIVERY_PIN_LOCK_MINUTES,
  DELIVERY_PIN_MAX_ATTEMPTS,
  generateDeliveryPin,
  isPhase1TransportMode,
  packageCategoryLabels,
  type CreateDeliveryInput
} from "@gigflow/shared";
import { createHash, timingSafeEqual } from "node:crypto";

export const DELIVERY_CATEGORY_SLUG = "parcel-delivery";

/** Statuses where the courier holds the package — client cancel is blocked. */
export const DELIVERY_POST_PICKUP_STATUSES: GigStatus[] = [
  GigStatus.PACKAGE_COLLECTED,
  GigStatus.EN_ROUTE_TO_DROPOFF,
  GigStatus.ARRIVED_AT_DROPOFF
];

export async function ensureDeliveryCategory() {
  return prisma.serviceCategory.upsert({
    where: { slug: DELIVERY_CATEGORY_SLUG },
    update: { isActive: true, name: "Parcel Delivery", launchPhase: LaunchPhase.MVP },
    create: {
      slug: DELIVERY_CATEGORY_SLUG,
      name: "Parcel Delivery",
      description: "Hyperlocal parcel delivery (DUTS Delivery).",
      iconName: "package",
      baseRateCents: 200,
      hourlyRateCents: 0,
      distanceRateCents: 50,
      multiplier: 1,
      launchPhase: LaunchPhase.MVP,
      isActive: true
    }
  });
}

function assertDeliveryGig<T extends { fulfillmentType: FulfillmentType }>(gig: T): void {
  if (gig.fulfillmentType !== FulfillmentType.DELIVERY) {
    throw new AppError("This action is only valid for deliveries.", 400, "NOT_A_DELIVERY");
  }
}

async function loadAssignedDelivery(gigId: string, courierUserId: string) {
  const gig = await prisma.gig.findUniqueOrThrow({
    where: { id: gigId },
    include: { assignments: true, payment: true, serviceCategory: true }
  });
  assertDeliveryGig(gig);

  const assignment = gig.assignments.find((a) => a.workerId === courierUserId && !a.cancelledAt);
  if (!assignment || gig.assignedWorkerId !== courierUserId) {
    throw new AppError("Only the assigned courier can perform this action.", 403, "COURIER_NOT_ASSIGNED");
  }
  return { gig, assignment };
}

function stopFromInput(stop: CreateDeliveryInput["pickup"]) {
  return {
    addressLine1: stop.addressLine1?.trim() || stop.formattedAddress.slice(0, 150),
    addressLine2: stop.addressLine2,
    city: stop.city,
    region: stop.region,
    postalCode: stop.postalCode?.trim() || "0000",
    country: stop.country,
    formattedAddress: stop.formattedAddress,
    latitude: stop.latitude,
    longitude: stop.longitude,
    contactName: stop.contactName,
    contactPhone: stop.contactPhone,
    instructions: stop.instructions
  };
}

/** SHA-256 hash of gig-scoped PIN. Stored in DB; plaintext never persisted. */
export function hashDeliveryPin(pin: string, gigId: string): string {
  return createHash("sha256").update(`${gigId}:${String(pin).trim()}`).digest("hex");
}

function hashedPinsMatch(storedHash: string | null | undefined, submitted: string, gigId: string): boolean {
  if (!storedHash) return false;
  const candidate = Buffer.from(hashDeliveryPin(submitted, gigId), "utf8");
  const expected = Buffer.from(storedHash.trim(), "utf8");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

function assertPinNotLocked(lockedUntil: Date | null | undefined, kind: "pickup" | "delivery"): void {
  if (lockedUntil && lockedUntil.getTime() > Date.now()) {
    throw new AppError(
      `Too many failed ${kind} verification attempts. Try again later or ask the customer to regenerate the code.`,
      429,
      kind === "pickup" ? "PICKUP_PIN_LOCKED" : "DELIVERY_PIN_LOCKED",
      { lockedUntil: lockedUntil.toISOString() }
    );
  }
}

async function recordFailedPinAttempt(
  gigId: string,
  kind: "pickup" | "delivery",
  currentFails: number
): Promise<void> {
  const maxAttempts = getDeliveryPinMaxAttempts(DELIVERY_PIN_MAX_ATTEMPTS);
  const lockMinutes = getDeliveryPinLockMinutes(DELIVERY_PIN_LOCK_MINUTES);
  const nextFails = currentFails + 1;
  const locked = nextFails >= maxAttempts;
  const lockedUntil = locked
    ? new Date(Date.now() + lockMinutes * 60_000)
    : null;

  if (kind === "pickup") {
    await prisma.gig.update({
      where: { id: gigId },
      data: {
        pickupPinFailCount: nextFails,
        ...(locked ? { pickupPinLockedUntil: lockedUntil } : {})
      }
    });
  } else {
    await prisma.gig.update({
      where: { id: gigId },
      data: {
        deliveryPinFailCount: nextFails,
        ...(locked ? { deliveryPinLockedUntil: lockedUntil } : {})
      }
    });
  }

  if (locked) {
    throw new AppError(
      `Too many failed ${kind} verification attempts. Verification is temporarily locked.`,
      429,
      kind === "pickup" ? "PICKUP_PIN_LOCKED" : "DELIVERY_PIN_LOCKED",
      { lockedUntil: lockedUntil!.toISOString() }
    );
  }

  throw new AppError(
    kind === "pickup" ? "Incorrect pickup code." : "Incorrect delivery code.",
    400,
    kind === "pickup" ? "INVALID_PICKUP_PIN" : "INVALID_DELIVERY_PIN",
    { attemptsRemaining: String(maxAttempts - nextFails) }
  );
}

export async function quoteDelivery(input: unknown) {
  assertDeliveryProductEnabled();
  const base = createDeliverySchema.safeParse({
    ...(typeof input === "object" && input ? input : {}),
    prohibitedItemsAck: true
  });
  if (!base.success) {
    throw new AppError("Invalid delivery quote request.", 400, "VALIDATION_ERROR");
  }
  const estimate = await estimateDeliveryFee({ pickup: base.data.pickup, dropoff: base.data.dropoff });
  logDutsFlow("DELIVERY_QUOTE", {
    platform: "api",
    fulfillmentType: "DELIVERY",
    distanceKm: estimate.distanceKm,
    totalCents: estimate.totalCents
  });
  return estimate;
}

export async function createDelivery(
  clientId: string,
  input: unknown,
  io: Server,
  options?: {
    idempotencyKey?: string | null;
    orderSource?: "APP" | "WEB" | "WHATSAPP";
    /** Marketplace WhatsApp orders create lightweight customers without app onboarding. */
    bypassClientPostGate?: boolean;
    marketplaceCommerceOrderId?: string;
  }
) {
  assertDeliveryProductEnabled();
  const idempotencyKey = options?.idempotencyKey?.trim() || null;

  if (idempotencyKey) {
    const existing = await prisma.gig.findFirst({
      where: { clientId, idempotencyKey, fulfillmentType: FulfillmentType.DELIVERY },
      include: { serviceCategory: true, payment: true }
    });
    if (existing) {
      return {
        delivery: stripPinsForCourierSafe(existing as unknown as Record<string, unknown>),
        secrets: null as null,
        idempotentReplay: true
      };
    }
  }

  const parsed = createDeliverySchema.parse({
    ...(typeof input === "object" && input !== null ? input : {}),
    orderSource:
      options?.orderSource ??
      (typeof input === "object" && input !== null && "orderSource" in input
        ? (input as { orderSource?: string }).orderSource
        : undefined) ??
      "APP"
  });

  const client = await prisma.user.findUniqueOrThrow({ where: { id: clientId } });
  if (!options?.bypassClientPostGate) {
    assertClientCanPostGigs(client);
  }

  const smuggled = input as {
    distanceKm?: number;
    totalCents?: number;
    deliveryFeeCents?: number;
  };

  const breakdown = await estimateDeliveryFee({
    pickup: parsed.pickup,
    dropoff: parsed.dropoff
  });
  assertWithinDeliveryRadius(breakdown);

  const category = await ensureDeliveryCategory();
  const pickup = stopFromInput(parsed.pickup);
  const dropoff = stopFromInput(parsed.dropoff);
  const pickupPinPlain = generateDeliveryPin(4);
  const deliveryPinPlain = generateDeliveryPin(4);
  const title = `Delivery · ${packageCategoryLabels[parsed.package.category]}`;

  const orderSource =
    parsed.orderSource === "WHATSAPP"
      ? OrderSource.WHATSAPP
      : parsed.orderSource === "WEB"
        ? OrderSource.WEB
        : OrderSource.APP;

  let gig;
  try {
    gig = await prisma.gig.create({
      data: {
        clientId,
        serviceCategoryId: category.id,
        title,
        description: parsed.package.description,
        status: GigStatus.POSTED,
        fulfillmentType: FulfillmentType.DELIVERY,
        orderSource,
        paymentStatus: "PAYMENT_PENDING",
        publishedAt: new Date(),
        pricingType: PricingType.FIXED,
        urgency: "STANDARD",
        size: parsed.package.size === "LARGE" ? "LARGE" : parsed.package.size === "MEDIUM" ? "MEDIUM" : "SMALL",
        estimatedHours: 1,
        distanceMiles: breakdown.distanceKm * 0.621371,
        estimatedDistanceKm: breakdown.distanceKm,
        demandMultiplier: 1,
        startsAt: new Date(),
        addressLine1: pickup.addressLine1,
        addressLine2: pickup.addressLine2,
        city: pickup.city,
        region: pickup.region,
        postalCode: pickup.postalCode,
        country: pickup.country,
        formattedAddress: pickup.formattedAddress,
        latitude: pickup.latitude,
        longitude: pickup.longitude,
        pickupContactName: pickup.contactName,
        pickupContactPhone: pickup.contactPhone,
        pickupInstructions: pickup.instructions,
        dropoffAddressLine1: dropoff.addressLine1,
        dropoffAddressLine2: dropoff.addressLine2,
        dropoffCity: dropoff.city,
        dropoffRegion: dropoff.region,
        dropoffPostalCode: dropoff.postalCode,
        dropoffCountry: dropoff.country,
        dropoffFormattedAddress: dropoff.formattedAddress,
        dropoffLatitude: dropoff.latitude,
        dropoffLongitude: dropoff.longitude,
        dropoffContactName: dropoff.contactName,
        dropoffContactPhone: dropoff.contactPhone,
        dropoffInstructions: dropoff.instructions,
        packageCategory: parsed.package.category as PackageCategory,
        packageDescription: parsed.package.description,
        packageSize: parsed.package.size,
        packagePhotoUrl: parsed.package.photoUrl,
        packageNotes: parsed.package.notes,
        pickupPin: "pending",
        deliveryPin: "pending",
        prohibitedItemsAck: true,
        photoUrls: parsed.package.photoUrl ? [parsed.package.photoUrl] : [],
        idempotencyKey,
        taxCents: 0,
        totalCents: breakdown.totalCents,
        platformFeeCents: breakdown.platformFeeCents,
        workerPayoutCents: breakdown.workerPayoutCents,
        authorizationBufferCents: 0,
        maximumAuthorizedAmountCents: breakdown.totalCents,
        priceBreakdown: {
          ...breakdown,
          pricingType: "FIXED",
          fulfillmentType: "DELIVERY",
          taxRateBps: 0,
          taxAmountCents: 0,
          customerTotalCents: breakdown.totalCents,
          pricingNote: breakdown.pricingNote,
          clientSuppliedDistanceIgnored: smuggled?.distanceKm ?? null,
          clientSuppliedPriceIgnored: smuggled?.totalCents ?? smuggled?.deliveryFeeCents ?? null
        } as unknown as Prisma.InputJsonValue,
        payment: {
          create: {
            amountCents: breakdown.totalCents,
            platformFeeCents: breakdown.platformFeeCents,
            workerPayoutCents: breakdown.workerPayoutCents,
            maximumAuthorizedAmountCents: breakdown.totalCents,
            currency: "usd"
          }
        },
        chatThread: { create: {} }
      },
      include: { serviceCategory: true, payment: true }
    });
  } catch (error) {
    if (
      idempotencyKey &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await prisma.gig.findFirst({
        where: { clientId, idempotencyKey, fulfillmentType: FulfillmentType.DELIVERY },
        include: { serviceCategory: true, payment: true }
      });
      if (existing) {
        return {
          delivery: stripPinsForCourierSafe(existing as unknown as Record<string, unknown>),
          secrets: null,
          idempotentReplay: true
        };
      }
    }
    throw error;
  }

  gig = await prisma.gig.update({
    where: { id: gig.id },
    data: {
      pickupPin: hashDeliveryPin(pickupPinPlain, gig.id),
      deliveryPin: hashDeliveryPin(deliveryPinPlain, gig.id)
    },
    include: { serviceCategory: true, payment: true }
  });

  await publishPostedGig(gig.id);
  logDutsFlow("GIG_CREATED", {
    gigId: gig.id,
    userId: clientId,
    userRole: "CLIENT",
    fulfillmentType: "DELIVERY"
  });
  logDutsFlow("DELIVERY_REQUESTED", {
    gigId: gig.id,
    userId: clientId,
    userRole: "CLIENT",
    fulfillmentType: "DELIVERY",
    totalCents: gig.totalCents
  });

  notifyUser(io, clientId, {
    type: "DELIVERY_REQUESTED",
    title: "Delivery requested",
    body: "We're finding a nearby courier. Keep your pickup and delivery codes ready.",
    gigId: gig.id
  });

  return {
    delivery: stripPinsForCourierSafe(gig as unknown as Record<string, unknown>),
    secrets: { pickupPin: pickupPinPlain, deliveryPin: deliveryPinPlain },
    idempotentReplay: false
  };
}

/** Customer regeneration — invalidates previous codes; plaintext returned once. */
export async function regenerateDeliveryPins(gigId: string, clientId: string) {
  const gig = await prisma.gig.findUniqueOrThrow({ where: { id: gigId } });
  assertDeliveryGig(gig);
  if (gig.clientId !== clientId) {
    throw new AppError("FORBIDDEN", 403, "FORBIDDEN");
  }
  if (gig.status === GigStatus.COMPLETED || gig.status === GigStatus.CANCELLED || gig.deliveryVerifiedAt) {
    throw new AppError("PINs can no longer be regenerated for this delivery.", 409, "PIN_REGEN_NOT_ALLOWED");
  }

  const pickupPin = generateDeliveryPin(4);
  const deliveryPin = generateDeliveryPin(4);
  await prisma.gig.update({
    where: { id: gigId },
    data: {
      pickupPin: hashDeliveryPin(pickupPin, gigId),
      deliveryPin: hashDeliveryPin(deliveryPin, gigId),
      pickupPinFailCount: 0,
      deliveryPinFailCount: 0,
      pickupPinLockedUntil: null,
      deliveryPinLockedUntil: null
    }
  });
  return { secrets: { pickupPin, deliveryPin } };
}

export function stripDeliverySecrets<T extends Record<string, unknown>>(gig: T): T {
  const {
    pickupPin: _p,
    deliveryPin: _d,
    pickupPinFailCount: _pf,
    deliveryPinFailCount: _df,
    pickupPinLockedUntil: _pl,
    deliveryPinLockedUntil: _dl,
    ...rest
  } = gig as T & Record<string, unknown>;
  return {
    ...rest,
    pickupPin: undefined,
    deliveryPin: undefined,
    pickupPinFailCount: undefined,
    deliveryPinFailCount: undefined,
    pickupPinLockedUntil: undefined,
    deliveryPinLockedUntil: undefined
  } as unknown as T;
}

export function stripPinsForCourierSafe<T extends Record<string, unknown>>(gig: T): T {
  return stripDeliverySecrets(gig);
}

export function buildCourierOfferPayload(
  gig: {
    id: string;
    title: string;
    city: string;
    region: string;
    dropoffCity: string | null;
    dropoffRegion: string | null;
    packageCategory: PackageCategory | null;
    packageDescription: string | null;
    estimatedDistanceKm: { toNumber?: () => number } | number | null;
    workerPayoutCents: number;
    totalCents: number;
    fulfillmentType: FulfillmentType;
  },
  courierToPickupMiles?: number
) {
  const distanceKm =
    typeof gig.estimatedDistanceKm === "number"
      ? gig.estimatedDistanceKm
      : gig.estimatedDistanceKm && typeof gig.estimatedDistanceKm.toNumber === "function"
        ? gig.estimatedDistanceKm.toNumber()
        : null;

  return {
    id: gig.id,
    fulfillmentType: gig.fulfillmentType,
    title: gig.title,
    pickupArea: `${gig.city}, ${gig.region}`,
    dropoffArea: gig.dropoffCity
      ? `${gig.dropoffCity}${gig.dropoffRegion ? `, ${gig.dropoffRegion}` : ""}`
      : null,
    packageCategory: gig.packageCategory,
    packageDescription: gig.packageDescription,
    estimatedDistanceKm: distanceKm,
    distanceToPickupMiles: courierToPickupMiles,
    estimatedEarningsCents: gig.workerPayoutCents
  };
}

export async function startTravelToPickup(gigId: string, courierUserId: string, io?: Server) {
  const { gig } = await loadAssignedDelivery(gigId, courierUserId);
  if (gig.status !== GigStatus.WORKER_ASSIGNED) {
    throw new AppError("Invalid delivery status for start travel.", 409, "INVALID_STATUS_TRANSITION");
  }
  const { updateGigStatus } = await import("./gig.service.js");
  return updateGigStatus(gigId, courierUserId, GigStatus.WORKER_EN_ROUTE, io);
}

export async function arriveAtPickup(
  gigId: string,
  courierUserId: string,
  location: { latitude: number; longitude: number },
  io?: Server
) {
  const { gig } = await loadAssignedDelivery(gigId, courierUserId);
  if (gig.status !== GigStatus.WORKER_EN_ROUTE) {
    throw new AppError("Invalid delivery status for arrive at pickup.", 409, "INVALID_STATUS_TRANSITION");
  }
  const { updateGigStatus } = await import("./gig.service.js");
  return updateGigStatus(gigId, courierUserId, GigStatus.WORKER_ARRIVED, io, location);
}

export async function verifyPickupPin(
  gigId: string,
  courierUserId: string,
  pin: string,
  io?: Server
) {
  const { gig, assignment } = await loadAssignedDelivery(gigId, courierUserId);
  if (gig.status !== GigStatus.WORKER_ARRIVED) {
    throw new AppError(
      "Pickup verification is only allowed after arriving at pickup.",
      409,
      "INVALID_STATUS_TRANSITION"
    );
  }
  assertPinNotLocked(gig.pickupPinLockedUntil, "pickup");
  if (!hashedPinsMatch(gig.pickupPin, pin, gigId)) {
    await recordFailedPinAttempt(gigId, "pickup", gig.pickupPinFailCount);
  }

  const updated = await prisma.gig.update({
    where: { id: gigId },
    data: {
      status: GigStatus.PACKAGE_COLLECTED,
      pickupVerifiedAt: new Date(),
      pickupPinFailCount: 0,
      pickupPinLockedUntil: null
    },
    include: { assignments: true, serviceCategory: true, payment: true }
  });

  await prisma.gigAssignment.update({
    where: { id: assignment.id },
    data: { startedAt: new Date() }
  });

  if (io) {
    notifyUser(io, gig.clientId, {
      type: "PACKAGE_COLLECTED",
      title: "Package collected",
      body: "Your courier has collected the package and is heading to the drop-off.",
      gigId
    });
    io.to(`gig:${gigId}`).emit("gig:status", {
      gigId,
      status: GigStatus.PACKAGE_COLLECTED,
      gig: stripPinsForCourierSafe(updated as unknown as Record<string, unknown>)
    });
  }

  logDutsFlow("PACKAGE_COLLECTED", {
    gigId,
    userId: courierUserId,
    userRole: "WORKER",
    fulfillmentType: "DELIVERY"
  });

  try {
    const { syncCommerceOrderFromGig } = await import("../commerce/order.service.js");
    await syncCommerceOrderFromGig(gigId, GigStatus.PACKAGE_COLLECTED);
  } catch {
    /* non-blocking */
  }

  return stripPinsForCourierSafe(updated as unknown as Record<string, unknown>);
}

export async function startTravelToDropoff(gigId: string, courierUserId: string, io?: Server) {
  const { gig, assignment } = await loadAssignedDelivery(gigId, courierUserId);
  if (gig.status !== GigStatus.PACKAGE_COLLECTED) {
    throw new AppError("Start drop-off travel only after package collection.", 409, "INVALID_STATUS_TRANSITION");
  }

  const updated = await prisma.gig.update({
    where: { id: gigId },
    data: { status: GigStatus.EN_ROUTE_TO_DROPOFF },
    include: { assignments: true, serviceCategory: true, payment: true }
  });

  await prisma.gigAssignment.update({
    where: { id: assignment.id },
    data: { enRouteAt: assignment.enRouteAt ?? new Date() }
  });

  if (io) {
    notifyUser(io, gig.clientId, {
      type: "EN_ROUTE_TO_DROPOFF",
      title: "Package on the way",
      body: "Your package is heading to the drop-off location.",
      gigId
    });
    io.to(`gig:${gigId}`).emit("gig:status", {
      gigId,
      status: GigStatus.EN_ROUTE_TO_DROPOFF,
      gig: stripPinsForCourierSafe(updated as unknown as Record<string, unknown>)
    });
  }

  return stripPinsForCourierSafe(updated as unknown as Record<string, unknown>);
}

/**
 * Drop-off arrival requires GPS and records coordinates.
 * Proximity is soft (no hard geofence fail) to tolerate poor accuracy.
 */
export async function arriveAtDropoff(
  gigId: string,
  courierUserId: string,
  location: { latitude: number; longitude: number },
  io?: Server
) {
  const { gig, assignment } = await loadAssignedDelivery(gigId, courierUserId);
  if (gig.status !== GigStatus.EN_ROUTE_TO_DROPOFF) {
    throw new AppError("Arrive at drop-off only while en route to drop-off.", 409, "INVALID_STATUS_TRANSITION");
  }
  if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
    throw new AppError("GPS_REQUIRED", 400, "GPS_REQUIRED", {
      location: "Share your location when arriving at drop-off."
    });
  }

  const updated = await prisma.gig.update({
    where: { id: gigId },
    data: { status: GigStatus.ARRIVED_AT_DROPOFF },
    include: { assignments: true, serviceCategory: true, payment: true }
  });

  await prisma.gigAssignment.update({
    where: { id: assignment.id },
    data: {
      arrivedAt: assignment.arrivedAt ?? new Date(),
      endLatitude: location.latitude,
      endLongitude: location.longitude
    }
  });

  if (io) {
    notifyUser(io, gig.clientId, {
      type: "ARRIVED_AT_DROPOFF",
      title: "Courier at drop-off",
      body: "Your courier has arrived at the drop-off. Share the delivery code with the recipient.",
      gigId
    });
    io.to(`gig:${gigId}`).emit("gig:status", {
      gigId,
      status: GigStatus.ARRIVED_AT_DROPOFF,
      gig: stripPinsForCourierSafe(updated as unknown as Record<string, unknown>)
    });
  }

  return stripPinsForCourierSafe(updated as unknown as Record<string, unknown>);
}

export async function verifyDeliveryPinAndComplete(
  gigId: string,
  courierUserId: string,
  pin: string,
  io?: Server,
  location?: { latitude: number; longitude: number }
) {
  const { gig, assignment } = await loadAssignedDelivery(gigId, courierUserId);
  if (gig.status !== GigStatus.ARRIVED_AT_DROPOFF) {
    throw new AppError(
      "Delivery verification is only allowed after arriving at drop-off.",
      409,
      "INVALID_STATUS_TRANSITION"
    );
  }
  assertPinNotLocked(gig.deliveryPinLockedUntil, "delivery");
  if (!hashedPinsMatch(gig.deliveryPin, pin, gigId)) {
    await recordFailedPinAttempt(gigId, "delivery", gig.deliveryPinFailCount);
  }

  await prisma.gig.update({
    where: { id: gigId },
    data: {
      deliveryVerifiedAt: new Date(),
      deliveryPinFailCount: 0,
      deliveryPinLockedUntil: null,
      status: GigStatus.WAITING_CUSTOMER_CONFIRMATION,
      autoApproveAt: new Date(Date.now() + getDeliveryAutoApproveSeconds() * 1000)
    }
  });

  await prisma.gigAssignment.update({
    where: { id: assignment.id },
    data: {
      endedAt: new Date(),
      completedAt: new Date(),
      endLatitude: location?.latitude ?? assignment.endLatitude,
      endLongitude: location?.longitude ?? assignment.endLongitude
    }
  });

  // Stay in WAITING_CUSTOMER_CONFIRMATION — customer confirms or auto-approve job runs.
  // Do not force COMPLETED here; that blocked Stage 3.5 manual vs auto-approval testing.
  const waiting = await prisma.gig.findUniqueOrThrow({
    where: { id: gigId },
    include: { assignments: true, serviceCategory: true, payment: true }
  });

  if (io) {
    notifyUser(io, gig.clientId, {
      type: "DELIVERY_AWAITING_CONFIRMATION",
      title: "Package delivered",
      body: "Your package was delivered. Confirm completion when you’re ready — or we’ll finish it automatically shortly.",
      gigId
    });
    notifyUser(io, courierUserId, {
      type: "DELIVERY_AWAITING_CONFIRMATION",
      title: "Delivery confirmed",
      body: "Delivery PIN accepted. Waiting for customer confirmation — earnings update when the delivery completes.",
      gigId
    });
    io.to(`gig:${gigId}`).emit("gig:status", {
      gigId,
      status: GigStatus.WAITING_CUSTOMER_CONFIRMATION,
      gig: stripPinsForCourierSafe(waiting as unknown as Record<string, unknown>)
    });
  }

  logDutsFlow("DELIVERY_VERIFIED", {
    gigId,
    userId: courierUserId,
    userRole: "WORKER",
    fulfillmentType: "DELIVERY"
  });

  try {
    const { syncCommerceOrderFromGig } = await import("../commerce/order.service.js");
    await syncCommerceOrderFromGig(gigId, GigStatus.WAITING_CUSTOMER_CONFIRMATION);
  } catch {
    /* non-blocking */
  }

  return {
    ok: true,
    status: GigStatus.WAITING_CUSTOMER_CONFIRMATION,
    delivery: stripPinsForCourierSafe(waiting as unknown as Record<string, unknown>)
  };
}

export function assertDeliveryClientCancelAllowed(status: GigStatus): void {
  if (DELIVERY_POST_PICKUP_STATUSES.includes(status)) {
    throw new AppError(
      "This delivery cannot be cancelled after the package was collected. Contact support if you need help.",
      409,
      "DELIVERY_CANCEL_AFTER_PICKUP"
    );
  }
}

export function isDeliveryFulfillment(fulfillmentType: FulfillmentType | string | null | undefined): boolean {
  return fulfillmentType === FulfillmentType.DELIVERY || fulfillmentType === "DELIVERY";
}

export function isCourierDeliveryEligible(profile: {
  deliveryEligible?: boolean | null;
  transportMode?: TransportMode | string | null;
}): boolean {
  return Boolean(profile.deliveryEligible) && isPhase1TransportMode(profile.transportMode ?? null);
}

/** Opt courier into DUTS Delivery matching (parcel-delivery + Phase-1 transport). */
export async function setDeliveryCourierEligibility(
  workerUserId: string,
  input: { transportMode: "WALKING" | "BICYCLE" | "PUBLIC_TRANSPORT"; enabled?: boolean }
) {
  const enabled = input.enabled !== false;
  if (enabled && !isPhase1TransportMode(input.transportMode)) {
    throw new AppError(
      "Choose Walking, Bicycle, or Public Transport for delivery work.",
      400,
      "INVALID_TRANSPORT_MODE"
    );
  }

  const category = await ensureDeliveryCategory();
  const profile = await prisma.workerProfile.findUnique({
    where: { userId: workerUserId },
    include: { serviceCategories: true }
  });
  if (!profile) {
    throw new AppError("Worker profile required.", 400, "WORKER_PROFILE_REQUIRED");
  }

  if (!enabled) {
    return prisma.workerProfile.update({
      where: { userId: workerUserId },
      data: {
        deliveryEligible: false,
        serviceCategories: {
          set: profile.serviceCategories
            .filter((c) => c.slug !== DELIVERY_CATEGORY_SLUG)
            .map((c) => ({ id: c.id }))
        }
      },
      include: { serviceCategories: true }
    });
  }

  const categoryIds = new Set(profile.serviceCategories.map((c) => c.id));
  categoryIds.add(category.id);

  return prisma.workerProfile.update({
    where: { userId: workerUserId },
    data: {
      deliveryEligible: true,
      transportMode: input.transportMode as TransportMode,
      serviceCategories: { set: [...categoryIds].map((id) => ({ id })) }
    },
    include: { serviceCategories: true }
  });
}
