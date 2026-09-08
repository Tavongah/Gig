/**
 * Stage 2.5 delivery lifecycle — requires disposable DB (duts_gig_dev).
 *
 * Setup once:
 *   CREATE DATABASE duts_gig_dev;
 *   DATABASE_URL=.../duts_gig_dev npx prisma migrate deploy
 *   DATABASE_URL=.../duts_gig_dev ADMIN_SEED_PASSWORD=... npm run prisma:seed
 *
 * Run:
 *   DATABASE_URL=postgresql://postgres:...@localhost:5433/duts_gig_dev npm run test:delivery
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  calculateDeliveryPrice,
  createDeliverySchema,
  distanceKmBetween,
  generateDeliveryPin,
  DELIVERY_PIN_MAX_ATTEMPTS,
  DEFAULT_DELIVERY_MAX_DISTANCE_KM,
  workerCancelOutcome
} from "@gigflow/shared";
import { FulfillmentType, GigStatus, PackageCategory } from "@prisma/client";
import type { Server } from "socket.io";

const here = fileURLToPath(new URL(".", import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });
loadEnv({ path: resolve(here, "../.env") });

// Prefer dedicated gig DB — never run destructive lifecycle against the IA SaaS DB.
if (process.env.GIG_TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.GIG_TEST_DATABASE_URL;
} else if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("duts_gig_dev")) {
  const rewritten = process.env.DATABASE_URL.replace(/\/[^/?]+(\?|$)/, "/duts_gig_dev$1");
  console.log(`Rewriting DATABASE_URL to disposable DB: .../duts_gig_dev`);
  process.env.DATABASE_URL = rewritten;
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function main() {
  const { AppError } = await import("../src/lib/errors.js");
  const { assertWithinDeliveryRadius, estimateDeliveryFee } = await import(
    "../src/modules/gigs/delivery-pricing.service.js"
  );
  const {
    assertDeliveryClientCancelAllowed,
    buildCourierOfferPayload,
    createDelivery,
    hashDeliveryPin,
    setDeliveryCourierEligibility,
    stripDeliverySecrets,
    arriveAtDropoff,
    arriveAtPickup,
    startTravelToDropoff,
    startTravelToPickup,
    verifyDeliveryPinAndComplete,
    verifyPickupPin,
    regenerateDeliveryPins
  } = await import("../src/modules/gigs/delivery.service.js");
  const { findNearbyGigs, updateGigStatus } = await import("../src/modules/gigs/gig.service.js");
  const { cancelAssignedWorkerAndRematch } = await import("../src/modules/gigs/gig-workflow.service.js");
  const { sanitizeGigForViewer } = await import("../src/modules/location/gig-privacy.js");
  const { prisma } = await import("../src/config/prisma.js");

  function assertThrows(fn: () => void, code: string, message: string): void {
    try {
      fn();
      throw new Error(`${message}: expected throw`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("expected throw")) throw error;
      assert(error instanceof AppError, `${message}: expected AppError`);
      assert((error as InstanceType<typeof AppError>).code === code, `${message}: code`);
    }
  }

  async function assertThrowsAsync(fn: () => Promise<unknown>, code: string, message: string) {
    try {
      await fn();
      throw new Error(`${message}: expected throw`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("expected throw")) throw error;
      assert(error instanceof AppError, `${message}: expected AppError got ${String(error)}`);
      assert(
        (error as InstanceType<typeof AppError>).code === code,
        `${message}: expected ${code}, got ${(error as InstanceType<typeof AppError>).code}`
      );
    }
  }

  const hararePickup = {
    latitude: -17.8292,
    longitude: 31.0522,
    formattedAddress: "Samora Machel Ave, Harare",
    city: "Harare",
    region: "Harare",
    country: "ZW" as const,
    contactName: "Sender One",
    contactPhone: "+263771000001"
  };

  const nearbyDropoff = {
    latitude: -17.835,
    longitude: 31.06,
    formattedAddress: "Borrowdale Road, Harare",
    city: "Harare",
    region: "Harare",
    country: "ZW" as const,
    contactName: "Recipient One",
    contactPhone: "+263771000002"
  };

  // --- Unit / boundary ---
  console.log("A. Distance boundary fixtures");
  const maxKm = DEFAULT_DELIVERY_MAX_DISTANCE_KM;
  const exactlyMax = calculateDeliveryPrice(maxKm, { maxDistanceKm: maxKm });
  assert(exactlyMax.withinMaxDistance, "exactly max allowed");
  const below = calculateDeliveryPrice(maxKm - 0.01, { maxDistanceKm: maxKm });
  assert(below.withinMaxDistance, "slightly below max allowed");
  const above = calculateDeliveryPrice(maxKm + 0.01, { maxDistanceKm: maxKm });
  assert(!above.withinMaxDistance, "slightly above max rejected");
  assertThrows(() => assertWithinDeliveryRadius(above), "DELIVERY_DISTANCE_EXCEEDED", "above max");

  const samePoint = distanceKmBetween(hararePickup, hararePickup);
  assert(samePoint < 0.001, "pickup==dropoff distance ~0");
  const samePrice = calculateDeliveryPrice(samePoint, { maxDistanceKm: maxKm, minimumFeeCents: 200 });
  assert(samePrice.withinMaxDistance && samePrice.totalCents >= 200, "same-point uses minimum fee");

  const badCoords = createDeliverySchema.safeParse({
    pickup: { ...hararePickup, latitude: 999 },
    dropoff: nearbyDropoff,
    package: { category: "DOCUMENTS", description: "Papers here" },
    prohibitedItemsAck: true
  });
  assert(!badCoords.success, "invalid coordinates rejected");

  const missingCoords = createDeliverySchema.safeParse({
    pickup: { ...hararePickup, latitude: undefined },
    dropoff: nearbyDropoff,
    package: { category: "DOCUMENTS", description: "Papers here" },
    prohibitedItemsAck: true
  });
  assert(!missingCoords.success, "missing coordinates rejected");

  console.log("B. PIN hash + cancel outcomes");
  const h = hashDeliveryPin("1234", "gig-1");
  assert(h === hashDeliveryPin("1234", "gig-1"), "hash deterministic");
  assert(h !== hashDeliveryPin("1235", "gig-1"), "hash differs for wrong pin");
  assert(h !== "1234", "hash is not plaintext");
  assert(workerCancelOutcome("PACKAGE_COLLECTED") === "BLOCKED", "post-pickup blocked");

  // --- DB readiness ---
  try {
    await prisma.gig.findFirst({ take: 1 });
    await prisma.$queryRaw`SELECT "deliveryEligible" FROM "WorkerProfile" LIMIT 1`;
  } catch (error) {
    console.error("Disposable DB not ready. Apply migrations to duts_gig_dev first.", error);
    process.exit(1);
  }

  const stamp = Date.now();
  const room = { emit: () => undefined, to: () => room };
  const fakeIo = {
    to: () => room
  } as unknown as Server;

  const client = await prisma.user.create({
    data: {
      email: `s25-client-${stamp}@example.com`,
      phoneNumber: `+26371${String(stamp).slice(-7)}`,
      fullName: "S25 Client",
      passwordHash: "test",
      roles: ["CLIENT"],
      accountStatus: "ACTIVE",
      emailVerified: true,
      avatarUrl: "https://example.com/a.png"
    }
  });

  const courier = await prisma.user.create({
    data: {
      email: `s25-courier-${stamp}@example.com`,
      phoneNumber: `+26372${String(stamp).slice(-7)}`,
      fullName: "S25 Courier",
      passwordHash: "test",
      roles: ["WORKER"],
      accountStatus: "APPROVED",
      emailVerified: true,
      profileCompleted: true,
      avatarUrl: "https://example.com/b.png",
      workerProfile: {
        create: {
          bio: "Courier",
          availabilityStatus: "AVAILABLE",
          travelDistanceMiles: 25,
          currentLatitude: hararePickup.latitude,
          currentLongitude: hararePickup.longitude
        }
      }
    }
  });

  const offlineCourier = await prisma.user.create({
    data: {
      email: `s25-offline-${stamp}@example.com`,
      phoneNumber: `+26373${String(stamp).slice(-7)}`,
      fullName: "Offline Courier",
      passwordHash: "test",
      roles: ["WORKER"],
      accountStatus: "APPROVED",
      emailVerified: true,
      profileCompleted: true,
      avatarUrl: "https://example.com/c.png",
      workerProfile: {
        create: {
          bio: "Offline",
          availabilityStatus: "OFFLINE",
          travelDistanceMiles: 25,
          currentLatitude: hararePickup.latitude,
          currentLongitude: hararePickup.longitude
        }
      }
    }
  });

  try {
    console.log("C. Courier eligibility");
    const enabled = await setDeliveryCourierEligibility(courier.id, {
      transportMode: "BICYCLE",
      enabled: true
    });
    assert(enabled.deliveryEligible === true, "delivery eligible");
    assert(enabled.transportMode === "BICYCLE", "transport set");
    assert(enabled.serviceCategories.some((c) => c.slug === "parcel-delivery"), "category attached");

    await setDeliveryCourierEligibility(offlineCourier.id, {
      transportMode: "WALKING",
      enabled: true
    });

    console.log("D. Create delivery — server price integrity");
    const estimate = await estimateDeliveryFee({ pickup: hararePickup, dropoff: nearbyDropoff });
    const created = await createDelivery(
      client.id,
      {
        pickup: hararePickup,
        dropoff: nearbyDropoff,
        package: { category: "DOCUMENTS", description: "Confidential envelope" },
        prohibitedItemsAck: true,
        // malicious client values — must be ignored
        distanceKm: 0.1,
        totalCents: 1,
        deliveryFeeCents: 1
      },
      fakeIo,
      { idempotencyKey: crypto.randomUUID() }
    );

    assert(created.secrets?.pickupPin && created.secrets.deliveryPin, "secrets once");
    assert((created.delivery as { pickupPin?: string }).pickupPin == null, "no pin in payload");
    assert(created.delivery.totalCents === estimate.totalCents, "server price wins");
    assert(created.delivery.totalCents !== 1, "malicious price ignored");

    const raw = await prisma.gig.findUniqueOrThrow({ where: { id: created.delivery.id } });
    assert(Number(raw.estimatedDistanceKm) === estimate.distanceKm, "server distance persisted");
    assert(Number(raw.estimatedDistanceKm) !== 0.1, "malicious distance ignored");
    assert(raw.pickupPin === hashDeliveryPin(created.secrets!.pickupPin, raw.id), "pickup hashed");
    assert(raw.deliveryPin === hashDeliveryPin(created.secrets!.deliveryPin, raw.id), "delivery hashed");
    assert(Number(raw.latitude) === hararePickup.latitude, "matching origin = pickup");

    await prisma.gig.update({
      where: { id: raw.id },
      data: { status: GigStatus.SEARCHING_FOR_WORKER, publishedAt: new Date() }
    });

    console.log("E. Matching eligibility");
    const nearbyEligible = await findNearbyGigs(courier.id);
    assert(
      nearbyEligible.some((g: { id: string }) => g.id === raw.id),
      "eligible courier sees delivery"
    );
    const offer = nearbyEligible.find((g: { id: string; offer?: unknown }) => g.id === raw.id) as {
      offer?: Record<string, unknown>;
      pickupPin?: string;
      dropoffContactPhone?: string;
    };
    assert(offer?.offer, "offer payload present");
    assert(offer.offer?.pickupPin == null && !("pickupPin" in (offer.offer ?? {})), "offer no pin");
    assert(offer.pickupPin == null, "nearby row no pin");
    assert(offer.dropoffContactPhone == null || offer.dropoffContactPhone === undefined, "phone hidden pre-accept");

    const nearbyOffline = await findNearbyGigs(offlineCourier.id);
    assert(!nearbyOffline.some((g: { id: string }) => g.id === raw.id), "offline courier sees nothing");

    // Ineligible: disable delivery
    await setDeliveryCourierEligibility(courier.id, { transportMode: "BICYCLE", enabled: false });
    const nearbyIneligible = await findNearbyGigs(courier.id);
    assert(!nearbyIneligible.some((g: { id: string }) => g.id === raw.id), "ineligible courier filtered");
    await setDeliveryCourierEligibility(courier.id, { transportMode: "BICYCLE", enabled: true });

    console.log("F. Privacy serializers");
    const sanitizedWorker = sanitizeGigForViewer(raw, courier.id, { viewerRoles: ["WORKER"] as never });
    assert((sanitizedWorker as { pickupPin?: string }).pickupPin == null, "worker sanitize strips pin");
    const sanitizedClient = sanitizeGigForViewer(raw, client.id, { viewerRoles: ["CLIENT"] as never });
    assert((sanitizedClient as { pickupPin?: string }).pickupPin == null, "client sanitize strips pin hash");
    const stripped = stripDeliverySecrets({ ...raw, pickupPin: "x", deliveryPin: "y" } as never);
    assert(stripped.pickupPin == null && stripped.deliveryPin == null, "strip secrets");

    console.log("G. Assign + authorization fixture + lifecycle");
    await prisma.gig.update({
      where: { id: raw.id },
      data: {
        status: GigStatus.WORKER_ASSIGNED,
        assignedWorkerId: courier.id,
        paymentStatus: "PAYMENT_AUTHORIZED",
        assignments: { create: { workerId: courier.id } }
      }
    });
    await prisma.payment.updateMany({
      where: { gigId: raw.id },
      data: { status: "AUTHORIZED", stripePaymentIntentId: `pi_s25_${stamp}` }
    });

    await startTravelToPickup(raw.id, courier.id, fakeIo);
    assert((await prisma.gig.findUniqueOrThrow({ where: { id: raw.id } })).status === GigStatus.WORKER_EN_ROUTE);

    await arriveAtPickup(
      raw.id,
      courier.id,
      { latitude: hararePickup.latitude, longitude: hararePickup.longitude },
      fakeIo
    );
    assert((await prisma.gig.findUniqueOrThrow({ where: { id: raw.id } })).status === GigStatus.WORKER_ARRIVED);

    console.log("H. PIN lockout");
    for (let i = 0; i < DELIVERY_PIN_MAX_ATTEMPTS - 1; i++) {
      await assertThrowsAsync(
        () => verifyPickupPin(raw.id, courier.id, "0000", fakeIo),
        "INVALID_PICKUP_PIN",
        `fail ${i + 1}`
      );
    }
    await assertThrowsAsync(
      () => verifyPickupPin(raw.id, courier.id, "0000", fakeIo),
      "PICKUP_PIN_LOCKED",
      "locked after max"
    );

    const regen = await regenerateDeliveryPins(raw.id, client.id);
    assert(regen.secrets.pickupPin.length === 4, "regen pickup");

    const collected = await verifyPickupPin(raw.id, courier.id, regen.secrets.pickupPin, fakeIo);
    assert(collected.status === GigStatus.PACKAGE_COLLECTED, "collected");

    console.log("I. Cancel after pickup blocked");
    assertThrows(
      () => assertDeliveryClientCancelAllowed(GigStatus.PACKAGE_COLLECTED),
      "DELIVERY_CANCEL_AFTER_PICKUP",
      "client cancel"
    );
    await assertThrowsAsync(
      () => updateGigStatus(raw.id, client.id, GigStatus.CANCELLED, fakeIo),
      "DELIVERY_CANCEL_AFTER_PICKUP",
      "client status cancel"
    );
    await assertThrowsAsync(
      () => cancelAssignedWorkerAndRematch(raw.id, courier.id, "Need to leave now", fakeIo),
      "INVALID_GIG_STATE",
      "courier abandon blocked"
    );

    await startTravelToDropoff(raw.id, courier.id, fakeIo);
    await arriveAtDropoff(
      raw.id,
      courier.id,
      { latitude: nearbyDropoff.latitude, longitude: nearbyDropoff.longitude },
      fakeIo
    );
    const arrived = await prisma.gigAssignment.findFirstOrThrow({
      where: { gigId: raw.id, workerId: courier.id }
    });
    assert(arrived.endLatitude != null && arrived.endLongitude != null, "dropoff GPS recorded");

    await assertThrowsAsync(
      () => verifyDeliveryPinAndComplete(raw.id, courier.id, "0000", fakeIo),
      "INVALID_DELIVERY_PIN",
      "wrong delivery pin"
    );

    const done = await verifyDeliveryPinAndComplete(
      raw.id,
      courier.id,
      regen.secrets.deliveryPin,
      fakeIo,
      { latitude: nearbyDropoff.latitude, longitude: nearbyDropoff.longitude }
    );
    assert(done.status === GigStatus.WAITING_CUSTOMER_CONFIRMATION, "awaits customer confirmation");
    assert(
      (await prisma.gig.findUniqueOrThrow({ where: { id: raw.id } })).status ===
        GigStatus.WAITING_CUSTOMER_CONFIRMATION,
      "status waiting"
    );

    const { approveGigCompletion, autoApproveStaleGigs } = await import(
      "../src/modules/gigs/gig-workflow.service.js"
    );
    await approveGigCompletion(raw.id, client.id, fakeIo);
    assert(
      (await prisma.gig.findUniqueOrThrow({ where: { id: raw.id } })).status === GigStatus.COMPLETED,
      "manual complete"
    );

    // Separate auto-approve fixture
    const autoCreated = await createDelivery(
      client.id,
      {
        pickup: hararePickup,
        dropoff: nearbyDropoff,
        package: { category: "FOOD", description: "Lunch box ready" },
        prohibitedItemsAck: true
      },
      fakeIo,
      { idempotencyKey: crypto.randomUUID() }
    );
    const autoId = autoCreated.delivery.id as string;
    await prisma.gig.update({
      where: { id: autoId },
      data: {
        status: GigStatus.WAITING_CUSTOMER_CONFIRMATION,
        assignedWorkerId: courier.id,
        paymentStatus: "PAYMENT_CAPTURED",
        deliveryVerifiedAt: new Date(),
        autoApproveAt: new Date(Date.now() - 1000),
        assignments: { create: { workerId: courier.id, completedAt: new Date(), endedAt: new Date() } }
      }
    });
    await prisma.payment.updateMany({
      where: { gigId: autoId },
      data: { status: "CAPTURED" }
    });
    const autoCount = await autoApproveStaleGigs();
    assert(autoCount >= 1, "auto-approve ran");
    assert(
      (await prisma.gig.findUniqueOrThrow({ where: { id: autoId } })).status === GigStatus.COMPLETED,
      "auto completed"
    );

    console.log("J. LOCAL_HELP lifecycle still works");
    const localCat = await prisma.serviceCategory.findFirst({
      where: { slug: { not: "parcel-delivery" }, isActive: true }
    });
    assert(localCat, "local category");
    const local = await prisma.gig.create({
      data: {
        clientId: client.id,
        serviceCategoryId: localCat!.id,
        title: "Local help sofa",
        description: "Move sofa upstairs",
        status: GigStatus.WORKER_ASSIGNED,
        fulfillmentType: FulfillmentType.LOCAL_HELP,
        pricingType: "FIXED",
        urgency: "STANDARD",
        size: "MEDIUM",
        estimatedHours: 2,
        distanceMiles: 1,
        demandMultiplier: 1,
        startsAt: new Date(),
        addressLine1: "2 Test St",
        city: "Harare",
        region: "Harare",
        postalCode: "0000",
        country: "ZW",
        latitude: hararePickup.latitude,
        longitude: hararePickup.longitude,
        taxCents: 0,
        totalCents: 5000,
        platformFeeCents: 1000,
        workerPayoutCents: 4000,
        authorizationBufferCents: 0,
        maximumAuthorizedAmountCents: 5000,
        priceBreakdown: { note: "test" },
        paymentStatus: "PAYMENT_AUTHORIZED",
        assignedWorkerId: courier.id,
        assignments: { create: { workerId: courier.id } },
        payment: {
          create: {
            amountCents: 5000,
            platformFeeCents: 1000,
            workerPayoutCents: 4000,
            status: "AUTHORIZED",
            currency: "usd"
          }
        }
      }
    });

    await assertThrowsAsync(
      () => verifyPickupPin(local.id, courier.id, "1234", fakeIo),
      "NOT_A_DELIVERY",
      "local help blocked from delivery PIN"
    );

    await updateGigStatus(local.id, courier.id, GigStatus.WORKER_EN_ROUTE, fakeIo);
    await updateGigStatus(
      local.id,
      courier.id,
      GigStatus.WORKER_ARRIVED,
      fakeIo,
      { latitude: hararePickup.latitude, longitude: hararePickup.longitude }
    );
    await updateGigStatus(
      local.id,
      courier.id,
      GigStatus.IN_PROGRESS,
      fakeIo,
      { latitude: hararePickup.latitude, longitude: hararePickup.longitude }
    );
    const localAfter = await prisma.gig.findUniqueOrThrow({ where: { id: local.id } });
    assert(localAfter.status === GigStatus.IN_PROGRESS, "LOCAL_HELP IN_PROGRESS ok");

    console.log("K. Offer payload unit");
    const offerUnit = buildCourierOfferPayload(
      {
        id: raw.id,
        title: raw.title,
        city: raw.city,
        region: raw.region,
        dropoffCity: raw.dropoffCity,
        dropoffRegion: raw.dropoffRegion,
        packageCategory: PackageCategory.DOCUMENTS,
        packageDescription: "x",
        estimatedDistanceKm: 2,
        workerPayoutCents: 400,
        totalCents: 500,
        fulfillmentType: FulfillmentType.DELIVERY
      },
      1
    );
    assert(!("pickupPin" in offerUnit) && !("deliveryPin" in offerUnit), "offer clean");

    console.log("delivery Stage 2.5 lifecycle checks PASSED");
  } finally {
    await prisma.gigInterest.deleteMany({ where: { gig: { clientId: client.id } } }).catch(() => undefined);
    await prisma.workerEarningsTransaction.deleteMany({
      where: { workerId: { in: [courier.id, offlineCourier.id] } }
    }).catch(() => undefined);
    await prisma.gigAssignment.deleteMany({ where: { gig: { clientId: client.id } } }).catch(() => undefined);
    await prisma.payment.deleteMany({ where: { gig: { clientId: client.id } } }).catch(() => undefined);
    await prisma.chatThread.deleteMany({ where: { gig: { clientId: client.id } } }).catch(() => undefined);
    await prisma.notification.deleteMany({
      where: { userId: { in: [client.id, courier.id, offlineCourier.id] } }
    }).catch(() => undefined);
    await prisma.gig.deleteMany({ where: { clientId: client.id } }).catch(() => undefined);
    await prisma.workerProfile.deleteMany({
      where: { userId: { in: [courier.id, offlineCourier.id] } }
    }).catch(() => undefined);
    await prisma.user.deleteMany({
      where: { id: { in: [client.id, courier.id, offlineCourier.id] } }
    }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
