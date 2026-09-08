/**
 * Stage 3.5 — two-actor API E2E validation against duts_gig_dev.
 *
 * Simulates independent CUSTOMER + COURIER sessions (separate user IDs/tokens in DB).
 * Physical device UI must still be smoke-checked on phones; this proves backend + mobile
 * contract reliability end-to-end.
 *
 * Run (from apps/api):
 *   npm run db:setup-gig-dev
 *   DATABASE_URL=.../duts_gig_dev ADMIN_SEED_PASSWORD=... npm run prisma:seed
 *   npm run test:delivery-e2e
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DELIVERY_PIN_MAX_ATTEMPTS,
  DEFAULT_DELIVERY_MAX_DISTANCE_KM
} from "@gigflow/shared";
import { GigStatus } from "@prisma/client";
import type { Server } from "socket.io";

const here = fileURLToPath(new URL(".", import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });
loadEnv({ path: resolve(here, "../.env") });

if (process.env.GIG_TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.GIG_TEST_DATABASE_URL;
} else if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("duts_gig_dev")) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(/\/[^/?]+(\?|$)/, "/duts_gig_dev$1");
  console.log("Rewriting DATABASE_URL → duts_gig_dev (never duts_whitelabel)");
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function main() {
  const { AppError } = await import("../src/lib/errors.js");
  const { isStripeConfigured } = await import("../src/lib/stripe.js");
  const { assertWithinDeliveryRadius, estimateDeliveryFee } = await import(
    "../src/modules/gigs/delivery-pricing.service.js"
  );
  void assertWithinDeliveryRadius;
  const {
    createDelivery,
    setDeliveryCourierEligibility,
    startTravelToPickup,
    arriveAtPickup,
    verifyPickupPin,
    startTravelToDropoff,
    arriveAtDropoff,
    verifyDeliveryPinAndComplete,
    regenerateDeliveryPins,
    assertDeliveryClientCancelAllowed
  } = await import("../src/modules/gigs/delivery.service.js");
  const { findNearbyGigs, getGigDetail, updateGigStatus } = await import(
    "../src/modules/gigs/gig.service.js"
  );
  const {
    expressWorkerInterest,
    selectWorkerForGig,
    authorizeWorkerSelectionWithoutStripe,
    approveGigCompletion,
    autoApproveStaleGigs
  } = await import("../src/modules/gigs/gig-workflow.service.js");
  const { prisma } = await import("../src/config/prisma.js");

  const dbUrl = process.env.DATABASE_URL ?? "";
  assert(dbUrl.includes("duts_gig_dev"), `Must use duts_gig_dev, got: ${dbUrl.replace(/:[^:@]+@/, ":***@")}`);
  assert(!dbUrl.includes("duts_whitelabel"), "Must NOT use duts_whitelabel");

  console.log("Environment");
  console.log(`  DATABASE: .../duts_gig_dev @ localhost`);
  console.log(`  Stripe configured: ${isStripeConfigured()}`);
  console.log(`  Max delivery km: ${DEFAULT_DELIVERY_MAX_DISTANCE_KM}`);

  const parcel = await prisma.serviceCategory.findUnique({ where: { slug: "parcel-delivery" } });
  assert(parcel, "parcel-delivery category exists");
  const settings = await prisma.platformSetting.findFirst();
  assert(settings, "platform settings exist");

  const stamp = Date.now();
  const room = { emit: () => undefined, to: () => room };
  const fakeIo = { to: () => room } as unknown as Server;
  const notifications: Array<{ userId: string; title: string; body: string; type?: string }> = [];
  const capturingIo = {
    to: () => ({
      emit: () => undefined,
      to: () => ({ emit: () => undefined })
    }),
    // used by notifyUser path indirectly via fake — capture via prisma.notification instead
  } as unknown as Server;
  void capturingIo;

  const customer = await prisma.user.create({
    data: {
      email: `s35-customer-${stamp}@example.com`,
      phoneNumber: `+26377${String(stamp).slice(-7)}`,
      fullName: "S35 Customer",
      passwordHash: "test",
      roles: ["CLIENT"],
      accountStatus: "ACTIVE",
      emailVerified: true,
      avatarUrl: "https://example.com/c.png"
    }
  });

  const courier = await prisma.user.create({
    data: {
      email: `s35-courier-${stamp}@example.com`,
      phoneNumber: `+26378${String(stamp).slice(-7)}`,
      fullName: "S35 Courier",
      passwordHash: "test",
      roles: ["WORKER"],
      accountStatus: "APPROVED",
      emailVerified: true,
      profileCompleted: true,
      avatarUrl: "https://example.com/w.png",
      workerProfile: {
        create: {
          bio: "Harare courier",
          availabilityStatus: "AVAILABLE",
          travelDistanceMiles: 15,
          hourlyRateCents: 2000,
          minJobAmountCents: 200,
          currentLatitude: -17.83,
          currentLongitude: 31.05,
          locationUpdatedAt: new Date(),
          deliveryEligible: false,
          transportMode: null,
          serviceCategories: { connect: { id: parcel!.id } }
        }
      }
    }
  });

  const offline = await prisma.user.create({
    data: {
      email: `s35-offline-${stamp}@example.com`,
      phoneNumber: `+26379${String(stamp).slice(-7)}`,
      fullName: "S35 Offline",
      passwordHash: "test",
      roles: ["WORKER"],
      accountStatus: "APPROVED",
      emailVerified: true,
      profileCompleted: true,
      avatarUrl: "https://example.com/o.png",
      workerProfile: {
        create: {
          bio: "offline",
          availabilityStatus: "OFFLINE",
          travelDistanceMiles: 15,
          hourlyRateCents: 2000,
          minJobAmountCents: 200,
          currentLatitude: -17.83,
          currentLongitude: 31.05,
          deliveryEligible: true,
          transportMode: "BICYCLE",
          serviceCategories: { connect: { id: parcel!.id } }
        }
      }
    }
  });

  const pickup = {
    latitude: -17.8292,
    longitude: 31.0522,
    formattedAddress: "Highfield, Harare",
    city: "Highfield",
    region: "Harare",
    country: "ZW" as const,
    contactName: "Sender",
    contactPhone: "+263771111111",
    instructions: "Call at gate"
  };
  const dropoff = {
    latitude: -17.835,
    longitude: 31.06,
    formattedAddress: "Avondale, Harare",
    city: "Avondale",
    region: "Harare",
    country: "ZW" as const,
    contactName: "Recipient",
    contactPhone: "+263772222222",
    instructions: "Leave with guard"
  };
  const farDropoff = {
    ...dropoff,
    latitude: -18.0,
    longitude: 31.5,
    formattedAddress: "Far away",
    city: "Far"
  };

  const basePayload = {
    pickup,
    dropoff,
    package: { category: "DOCUMENTS" as const, description: "School papers" },
    prohibitedItemsAck: true as const
  };

  try {
    console.log("\n1. Courier eligibility setup");
    await setDeliveryCourierEligibility(courier.id, { transportMode: "BICYCLE", enabled: true });
    const profile = await prisma.workerProfile.findUniqueOrThrow({ where: { userId: courier.id } });
    assert(profile.deliveryEligible && profile.transportMode === "BICYCLE", "eligibility persists");

    console.log("2. Over-distance quote/create rejected");
    const farEstimate = await estimateDeliveryFee({ pickup, dropoff: farDropoff });
    assert(!farEstimate.withinMaxDistance, "far quote outside radius");
    let farCreateFailed = false;
    try {
      await createDelivery(
        customer.id,
        { ...basePayload, dropoff: farDropoff },
        fakeIo,
        { idempotencyKey: `far-${stamp}` }
      );
    } catch (error) {
      farCreateFailed = error instanceof AppError && error.code === "DELIVERY_DISTANCE_EXCEEDED";
    }
    assert(farCreateFailed, "over-distance create blocked");
    const farGigCount = await prisma.gig.count({
      where: { clientId: customer.id, idempotencyKey: `far-${stamp}` }
    });
    assert(farGigCount === 0, "no gig for over-distance");

    console.log("3. Quote + idempotent create (customer session)");
    const estimate = await estimateDeliveryFee(basePayload);
    assert(estimate.withinMaxDistance && estimate.distanceKm > 0, "quote ok");
    const idem = `s35-${stamp}`;
    const created = await createDelivery(customer.id, basePayload, fakeIo, { idempotencyKey: idem });
    const replay = await createDelivery(customer.id, basePayload, fakeIo, { idempotencyKey: idem });
    assert(created.secrets?.pickupPin && created.secrets.deliveryPin, "PINs once");
    assert(replay.idempotentReplay === true, "duplicate tap = replay");
    assert(replay.delivery.id === created.delivery.id, "same gig");
    assert((created.delivery as { pickupPin?: string }).pickupPin == null, "no PIN on gig payload");

    const gigId = created.delivery.id as string;
    const oldPickup = created.secrets!.pickupPin;
    const oldDelivery = created.secrets!.deliveryPin;

    console.log("4. PIN regenerate invalidates old codes");
    const regen = await regenerateDeliveryPins(gigId, customer.id);
    assert(regen.secrets.pickupPin !== oldPickup || regen.secrets.deliveryPin !== oldDelivery, "codes changed");

    // Recovery: getGig must not expose secrets
    const detail = await getGigDetail(gigId, customer.id);
    assert((detail as { pickupPin?: string }).pickupPin == null, "getGig hides PIN");
    assert((detail as { deliveryPin?: string }).deliveryPin == null, "getGig hides delivery PIN");

    console.log("5. Matching — eligible online vs offline");
    await prisma.gig.update({
      where: { id: gigId },
      data: { status: GigStatus.SEARCHING_FOR_WORKER, publishedAt: new Date() }
    });
    const nearbyCourier = await findNearbyGigs(courier.id);
    assert(nearbyCourier.some((g: { id: string }) => g.id === gigId), "courier sees offer");
    const offer = nearbyCourier.find((g: { id: string }) => g.id === gigId) as {
      offer?: { pickupArea?: string; dropoffArea?: string; estimatedEarningsCents?: number };
      dropoffContactPhone?: string | null;
      dropoffFormattedAddress?: string | null;
    };
    assert(offer?.offer?.pickupArea, "pickup area on offer");
    assert(offer?.dropoffContactPhone == null || offer.dropoffContactPhone === undefined, "phone private");
    const nearbyOffline = await findNearbyGigs(offline.id);
    assert(!nearbyOffline.some((g: { id: string }) => g.id === gigId), "offline no offer");

    console.log("6. Interest → select → pay (dev bypass when Stripe off)");
    await expressWorkerInterest(gigId, courier.id, undefined, fakeIo);
    await selectWorkerForGig(gigId, customer.id, courier.id, fakeIo);
    if (!isStripeConfigured()) {
      await authorizeWorkerSelectionWithoutStripe(gigId, customer.id, fakeIo);
    } else {
      // Stripe test mode present — mark captured + activate for CI without card UI
      await prisma.gig.update({
        where: { id: gigId },
        data: { paymentStatus: "PAYMENT_CAPTURED", authorizedAt: new Date() }
      });
      await prisma.payment.updateMany({ where: { gigId }, data: { status: "CAPTURED" } });
      const { activateGigAfterWorkerPayment } = await import("../src/modules/payments/payment.service.js");
      await activateGigAfterWorkerPayment(gigId, fakeIo);
    }
    assert(
      (await prisma.gig.findUniqueOrThrow({ where: { id: gigId } })).status === GigStatus.WORKER_ASSIGNED,
      "assigned after payment"
    );

    console.log("7. App restart recovery (re-fetch gig)");
    const recoveredCustomer = await getGigDetail(gigId, customer.id);
    const recoveredCourier = await getGigDetail(gigId, courier.id);
    assert(recoveredCustomer.status === GigStatus.WORKER_ASSIGNED, "customer recovers");
    assert(recoveredCourier.status === GigStatus.WORKER_ASSIGNED, "courier recovers");

    console.log("8. Travel → arrive → wrong PIN → old PIN → correct PIN");
    await startTravelToPickup(gigId, courier.id, fakeIo);
    await arriveAtPickup(gigId, courier.id, { latitude: pickup.latitude, longitude: pickup.longitude }, fakeIo);
    try {
      await verifyPickupPin(gigId, courier.id, "0000", fakeIo);
      throw new Error("expected wrong PIN fail");
    } catch (error) {
      assert(error instanceof AppError && error.code === "INVALID_PICKUP_PIN", "friendly wrong PIN");
    }
    try {
      await verifyPickupPin(gigId, courier.id, oldPickup, fakeIo);
      throw new Error("expected old PIN fail");
    } catch (error) {
      assert(error instanceof AppError && error.code === "INVALID_PICKUP_PIN", "old PIN fails");
    }
    await verifyPickupPin(gigId, courier.id, regen.secrets.pickupPin, fakeIo);
    assert(
      (await prisma.gig.findUniqueOrThrow({ where: { id: gigId } })).status === GigStatus.PACKAGE_COLLECTED,
      "collected"
    );

    console.log("9. Post-pickup cancel blocked");
    try {
      assertDeliveryClientCancelAllowed(GigStatus.PACKAGE_COLLECTED);
      throw new Error("expected cancel block");
    } catch (error) {
      assert(error instanceof AppError && error.code === "DELIVERY_CANCEL_AFTER_PICKUP", "cancel blocked");
    }
    try {
      await updateGigStatus(gigId, customer.id, GigStatus.CANCELLED, fakeIo);
      throw new Error("expected status cancel block");
    } catch (error) {
      assert(
        error instanceof AppError &&
          (error.code === "DELIVERY_CANCEL_AFTER_PICKUP" || error.code === "INVALID_STATUS_TRANSITION"),
        "status cancel blocked"
      );
    }

    console.log("10. Drop-off leg + delivery PIN → waiting confirmation");
    await startTravelToDropoff(gigId, courier.id, fakeIo);
    await arriveAtDropoff(
      gigId,
      courier.id,
      { latitude: dropoff.latitude, longitude: dropoff.longitude },
      fakeIo
    );
    await verifyDeliveryPinAndComplete(
      gigId,
      courier.id,
      regen.secrets.deliveryPin,
      fakeIo,
      { latitude: dropoff.latitude, longitude: dropoff.longitude }
    );
    assert(
      (await prisma.gig.findUniqueOrThrow({ where: { id: gigId } })).status ===
        GigStatus.WAITING_CUSTOMER_CONFIRMATION,
      "awaits confirmation"
    );

    // PIN reuse fails
    try {
      await verifyDeliveryPinAndComplete(gigId, courier.id, regen.secrets.deliveryPin, fakeIo);
      throw new Error("expected reuse fail");
    } catch (error) {
      assert(error instanceof AppError, "PIN reuse blocked");
    }

    console.log("11. Manual customer confirmation + earnings");
    await approveGigCompletion(gigId, customer.id, fakeIo);
    const completed = await prisma.gig.findUniqueOrThrow({ where: { id: gigId } });
    assert(completed.status === GigStatus.COMPLETED, "manually completed");
    const earnings = await prisma.workerEarningsTransaction.findFirst({
      where: { workerId: courier.id, gigId }
    });
    assert(earnings, "courier earnings created");

    console.log("12. Separate delivery — auto-approval");
    const auto = await createDelivery(
      customer.id,
      {
        ...basePayload,
        package: { category: "FOOD", description: "Hot meal tray" }
      },
      fakeIo,
      { idempotencyKey: `auto-${stamp}` }
    );
    const autoId = auto.delivery.id as string;
    await prisma.gig.update({
      where: { id: autoId },
      data: {
        status: GigStatus.WAITING_CUSTOMER_CONFIRMATION,
        assignedWorkerId: courier.id,
        paymentStatus: "PAYMENT_CAPTURED",
        deliveryVerifiedAt: new Date(),
        autoApproveAt: new Date(Date.now() - 5_000),
        assignments: { create: { workerId: courier.id, completedAt: new Date(), endedAt: new Date() } }
      }
    });
    await prisma.payment.updateMany({ where: { gigId: autoId }, data: { status: "CAPTURED" } });
    const autoCount = await autoApproveStaleGigs();
    assert(autoCount >= 1, "auto-approve executed");
    assert(
      (await prisma.gig.findUniqueOrThrow({ where: { id: autoId } })).status === GigStatus.COMPLETED,
      "auto completed"
    );

    console.log("13. Pre-collection cancel allowed");
    const cancelable = await createDelivery(
      customer.id,
      {
        ...basePayload,
        package: { category: "CLOTHING", description: "Shirt bag item" }
      },
      fakeIo,
      { idempotencyKey: `cancel-${stamp}` }
    );
    const cancelId = cancelable.delivery.id as string;
    await prisma.gig.update({
      where: { id: cancelId },
      data: { status: GigStatus.SEARCHING_FOR_WORKER }
    });
    assertDeliveryClientCancelAllowed(GigStatus.SEARCHING_FOR_WORKER);
    await updateGigStatus(cancelId, customer.id, GigStatus.CANCELLED, fakeIo);
    assert(
      (await prisma.gig.findUniqueOrThrow({ where: { id: cancelId } })).status === GigStatus.CANCELLED,
      "cancelled before pickup"
    );

    console.log("14. Notification copy review (delivery rows)");
    const notes = await prisma.notification.findMany({
      where: { userId: { in: [customer.id, courier.id] } },
      orderBy: { createdAt: "asc" }
    });
    for (const n of notes) {
      notifications.push({ userId: n.userId, title: n.title, body: n.body, type: n.type });
      const blob = `${n.title} ${n.body}`.toLowerCase();
      // Delivery notifications must not use Local Help-only wording as primary framing
      if (n.type?.includes("DELIVERY") || /courier|pickup|package|drop-off|delivery/i.test(n.title)) {
        assert(!/\bgig available\b/i.test(n.title), `delivery title uses Local Help: ${n.title}`);
      }
      void blob;
    }
    const hasCourierLang = notifications.some((n) => /courier|delivery|package|pickup/i.test(n.title));
    assert(hasCourierLang || notifications.length === 0, "expected delivery-oriented notifications when emitted");

    console.log("15. PIN lockout (separate fixture)");
    const lock = await createDelivery(
      customer.id,
      {
        ...basePayload,
        package: { category: "OTHER", description: "Lockout test parcel" }
      },
      fakeIo,
      { idempotencyKey: `lock-${stamp}` }
    );
    const lockId = lock.delivery.id as string;
    await prisma.gig.update({
      where: { id: lockId },
      data: {
        status: GigStatus.WORKER_ARRIVED,
        assignedWorkerId: courier.id,
        paymentStatus: "PAYMENT_CAPTURED",
        assignments: { create: { workerId: courier.id } }
      }
    });
    for (let i = 0; i < DELIVERY_PIN_MAX_ATTEMPTS - 1; i++) {
      try {
        await verifyPickupPin(lockId, courier.id, "1111", fakeIo);
      } catch (error) {
        assert(error instanceof AppError && error.code === "INVALID_PICKUP_PIN", `fail ${i}`);
      }
    }
    try {
      await verifyPickupPin(lockId, courier.id, "1111", fakeIo);
      throw new Error("expected lock");
    } catch (error) {
      assert(error instanceof AppError && error.code === "PICKUP_PIN_LOCKED", "locked");
    }

    console.log("\nStage 3.5 two-actor API E2E PASSED");
    console.log(`  Complete deliveries: 2 (1 manual confirm, 1 auto-approve)`);
    console.log(`  Cancelled before pickup: 1`);
    console.log(`  Stripe live card UI: ${isStripeConfigured() ? "keys present — card UI still needed on device" : "not configured — used authorize-without-stripe bypass"}`);
  } finally {
    await prisma.gigInterest.deleteMany({ where: { gig: { clientId: customer.id } } }).catch(() => undefined);
    await prisma.workerEarningsTransaction.deleteMany({
      where: { workerId: { in: [courier.id, offline.id] } }
    }).catch(() => undefined);
    await prisma.gigAssignment.deleteMany({ where: { gig: { clientId: customer.id } } }).catch(() => undefined);
    await prisma.payment.deleteMany({ where: { gig: { clientId: customer.id } } }).catch(() => undefined);
    await prisma.chatThread.deleteMany({ where: { gig: { clientId: customer.id } } }).catch(() => undefined);
    await prisma.notification.deleteMany({
      where: { userId: { in: [customer.id, courier.id, offline.id] } }
    }).catch(() => undefined);
    await prisma.gig.deleteMany({ where: { clientId: customer.id } }).catch(() => undefined);
    await prisma.workerProfile.deleteMany({ where: { userId: { in: [courier.id, offline.id] } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: [customer.id, courier.id, offline.id] } } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
