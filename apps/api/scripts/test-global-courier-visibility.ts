/**
 * Global courier visibility + DUTS delivery estimate.
 * Uses the configured local database. Does not touch production.
 *
 * Run: npx tsx apps/api/scripts/test-global-courier-visibility.ts
 */
import assert from "node:assert/strict";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "socket.io";
import { MockWhatsAppProvider, setWhatsAppProviderForTests } from "../src/modules/whatsapp/provider.js";

const here = fileURLToPath(new URL(".", import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });
loadEnv({ path: resolve(here, "../.env") });

const HARARE = { lat: -17.8292, lng: 31.0522, city: "Harare", region: "Harare" };
const GWERU = { lat: -19.455, lng: 29.815, city: "Gweru", region: "Midlands" };
const FAR = { lat: -33.9249, lng: 18.4241, city: "Cape Town", region: "Western Cape" };

const notifications: Array<{ userId: string; title: string; body: string }> = [];
const room = { emit: () => undefined, to: () => room };
const fakeIo = {
  to: (target: string) => ({
    emit: (event: string, payload: { title?: string; body?: string }) => {
      if (event === "notification" && target.startsWith("user:")) {
        notifications.push({
          userId: target.slice(5),
          title: payload.title ?? "",
          body: payload.body ?? ""
        });
      }
    },
    to: () => room
  })
} as unknown as Server;

async function main() {
  process.env.NODE_ENV = "test";
  const whatsapp = new MockWhatsAppProvider();
  setWhatsAppProviderForTests(whatsapp);

  const { prisma } = await import("../src/config/prisma.js");
  const { findNearbyGigs, getGigDetail } = await import("../src/modules/gigs/gig.service.js");
  const { expressWorkerInterest } = await import("../src/modules/gigs/gig-workflow.service.js");
  const {
    hashDeliveryPin,
    releaseCommerceDelivery,
    setCustomerDeliveryEstimate,
    setDeliveryCourierEligibility,
    startTravelToPickup,
    arriveAtPickup,
    verifyPickupPin,
    startTravelToDropoff,
    arriveAtDropoff,
    verifyDeliveryPinAndComplete
  } = await import("../src/modules/gigs/delivery.service.js");
  const { formatCustomerDeliveryEstimateMessage, commerceCustomerStatusCopy, commerceShopUiStatusLabel } = await import(
    "@gigflow/shared"
  );
  const { AppError } = await import("../src/lib/errors.js");

  const stamp = Date.now();
  const createdUserIds: string[] = [];
  const createdGigIds: string[] = [];
  let merchantId: string | null = null;

  async function courier(label: string, point: { lat: number; lng: number } | null, accountStatus = "APPROVED") {
    const user = await prisma.user.create({
      data: {
        email: `vis-${label}-${stamp}@example.com`,
        phoneNumber: `+26377${String(stamp).slice(-6)}${label.length}`,
        fullName: `Courier ${label}`,
        passwordHash: "test",
        roles: ["WORKER"],
        accountStatus: accountStatus as "APPROVED",
        emailVerified: true,
        profileCompleted: true,
        avatarUrl: "https://example.com/courier.png",
        workerProfile: {
          create: {
            bio: label,
            availabilityStatus: "AVAILABLE",
            travelDistanceMiles: 10,
            currentLatitude: point?.lat ?? null,
            currentLongitude: point?.lng ?? null
          }
        }
      }
    });
    createdUserIds.push(user.id);
    return user;
  }

  try {
    await prisma.gig.findFirst({ take: 1 });
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name::text FROM information_schema.columns
      WHERE table_name = 'Gig'
        AND column_name IN ('customerDeliveryEstimateStart', 'customerDeliveryEstimateEnd')
    `;
    assert.equal(columns.length, 2, "estimate columns exist on Gig");

    const client = await prisma.user.create({
      data: {
        email: `vis-client-${stamp}@example.com`,
        phoneNumber: `+26378${String(stamp).slice(-7)}`,
        fullName: "Visibility Client",
        passwordHash: "test",
        roles: ["CLIENT"],
        accountStatus: "ACTIVE",
        emailVerified: true,
        avatarUrl: "https://example.com/client.png"
      }
    });
    createdUserIds.push(client.id);

    const harare = await courier("harare", HARARE);
    const gweru = await courier("gweru", GWERU);
    const far = await courier("far", FAR);
    const nowhere = await courier("nowhere", null);
    const suspended = await courier("suspended", HARARE, "SUSPENDED");
    const ineligible = await courier("ineligible", HARARE);

    for (const user of [harare, gweru, far, nowhere, suspended]) {
      await setDeliveryCourierEligibility(user.id, { transportMode: "BICYCLE", enabled: true });
    }

    const category = await prisma.serviceCategory.findFirstOrThrow({ where: { slug: "parcel-delivery" } });
    const phone = `+26379${String(stamp).slice(-7)}`;

    async function openDelivery(city: typeof HARARE, title: string) {
      const gig = await prisma.gig.create({
        data: {
          clientId: client.id,
          serviceCategoryId: category.id,
          title,
          description: "Visibility fixture",
          status: "SEARCHING_FOR_WORKER",
          fulfillmentType: "DELIVERY",
          paymentStatus: "PAYMENT_AUTHORIZED",
          publishedAt: new Date(),
          pricingType: "FIXED",
          urgency: "STANDARD",
          size: "SMALL",
          estimatedHours: 1,
          distanceMiles: 2,
          estimatedDistanceKm: 3,
          demandMultiplier: 1,
          startsAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
          addressLine1: `${city.city} pickup`,
          city: city.city,
          region: city.region,
          postalCode: "0000",
          country: "ZW",
          formattedAddress: `${city.city} pickup`,
          latitude: city.lat,
          longitude: city.lng,
          dropoffCity: city.city,
          dropoffRegion: city.region,
          dropoffLatitude: city.lat,
          dropoffLongitude: city.lng,
          dropoffContactName: "Customer",
          dropoffContactPhone: phone,
          packageCategory: "DOCUMENTS",
          packageDescription: "Envelope",
          prohibitedItemsAck: true,
          totalCents: 500,
          platformFeeCents: 100,
          workerPayoutCents: 400,
          taxCents: 0,
          priceBreakdown: { fulfillmentType: "DELIVERY" },
          payment: { create: { amountCents: 500, platformFeeCents: 100, workerPayoutCents: 400, status: "AUTHORIZED" } },
          chatThread: { create: {} }
        }
      });
      createdGigIds.push(gig.id);
      const merchant = merchantId
        ? { id: merchantId }
        : await prisma.merchant.create({
            data: {
              name: `Visibility Shop ${stamp}`,
              contactName: "Shop",
              phone: `+26371${String(stamp).slice(-7)}`,
              whatsappPhone: `+26372${String(stamp).slice(-7)}`,
              locationLabel: city.city,
              latitude: city.lat,
              longitude: city.lng
            }
          });
      merchantId = merchant.id;
      await prisma.commerceOrder.create({
        data: {
          merchantId: merchant.id,
          status: "READY_FOR_PICKUP",
          paymentStatus: "PAID",
          paymentMethod: "CASH",
          subtotalCents: 400,
          deliveryFeeCents: 100,
          serviceFeeCents: 0,
          totalCents: 500,
          deliveryLabel: city.city,
          deliveryLatitude: city.lat,
          deliveryLongitude: city.lng,
          linkedDeliveryGigId: gig.id,
          customerWhatsAppPhone: phone,
          merchantAcceptedAt: new Date()
        }
      });
      const pickupPin = "1234";
      const deliveryPin = "5678";
      await prisma.gig.update({
        where: { id: gig.id },
        data: {
          pickupPin: hashDeliveryPin(pickupPin, gig.id),
          deliveryPin: hashDeliveryPin(deliveryPin, gig.id)
        }
      });
      return { gig, pickupPin, deliveryPin };
    }

    const gweruJob = await openDelivery(GWERU, `Gweru delivery ${stamp}`);
    const harareJob = await openDelivery(HARARE, `Harare delivery ${stamp}`);
    const releaseJob = await openDelivery(GWERU, `Release delivery ${stamp}`);

    async function sees(workerId: string, gigId: string) {
      const rows = await findNearbyGigs(workerId);
      return rows.some((row: { id: string }) => row.id === gigId);
    }

    assert.equal(await sees(harare.id, gweruJob.gig.id), true, "Harare courier sees Gweru delivery");
    assert.equal(await sees(gweru.id, harareJob.gig.id), true, "Gweru courier sees Harare delivery");
    assert.equal(await sees(far.id, gweruJob.gig.id), true, "far courier sees Gweru delivery");
    assert.equal(await sees(far.id, harareJob.gig.id), true, "far courier sees Harare delivery");
    assert.equal(await sees(nowhere.id, gweruJob.gig.id), true, "courier without a location sees the delivery");
    assert.equal(await sees(suspended.id, gweruJob.gig.id), false, "suspended courier excluded");
    assert.equal(await sees(ineligible.id, gweruJob.gig.id), false, "ineligible courier excluded");

    const detail = await getGigDetail(gweruJob.gig.id, far.id);
    assert.equal(detail.id, gweruJob.gig.id, "far courier can open the delivery");

    const race = await Promise.allSettled([
      expressWorkerInterest(harareJob.gig.id, harare.id, undefined, fakeIo),
      expressWorkerInterest(harareJob.gig.id, gweru.id, undefined, fakeIo)
    ]);
    const won = race.filter((result) => result.status === "fulfilled");
    const lost = race.filter((result) => result.status === "rejected");
    assert.equal(won.length, 1, "exactly one simultaneous accept succeeds");
    assert.equal(lost.length, 1, "the other simultaneous accept fails");
    const loser = lost[0] as PromiseRejectedResult;
    assert.equal(loser.reason instanceof AppError && loser.reason.code === "GIG_NOT_AVAILABLE", true);
    const assigned = await prisma.gig.findUniqueOrThrow({ where: { id: harareJob.gig.id } });
    assert.equal(assigned.assignedWorkerId != null, true);
    assert.notEqual(assigned.status, "SEARCHING_FOR_WORKER");
    assert.equal(await sees(far.id, harareJob.gig.id), false, "accepted delivery leaves the pool");

    const winnerId = assigned.assignedWorkerId!;
    const first = await setCustomerDeliveryEstimate(harareJob.gig.id, winnerId, {
      start: "2026-11-04T14:00:00+02:00",
      end: "2026-11-04T16:00:00+02:00"
    });
    assert.equal(first.notified, true);
    const stored = await prisma.gig.findUniqueOrThrow({ where: { id: harareJob.gig.id } });
    assert.equal(stored.customerDeliveryEstimateStart?.toISOString(), "2026-11-04T12:00:00.000Z");
    assert.equal(stored.customerDeliveryEstimateEnd?.toISOString(), "2026-11-04T14:00:00.000Z");
    const expectedFirst = formatCustomerDeliveryEstimateMessage(
      { start: stored.customerDeliveryEstimateStart, end: stored.customerDeliveryEstimateEnd },
      false
    );
    assert.match(expectedFirst, /Wednesday, 4 November/);
    assert.match(expectedFirst, /2:00 PM – 4:00 PM/);
    assert.doesNotMatch(expectedFirst, /courier|accepted|assigned/i);
    const customerTexts = () => whatsapp.sent.filter((message) => message.to === phone).map((message) => message.body);
    assert.equal(customerTexts().at(-1), expectedFirst);

    const second = await setCustomerDeliveryEstimate(harareJob.gig.id, winnerId, {
      start: "2026-11-04T15:00:00+02:00",
      end: "2026-11-04T17:00:00+02:00"
    });
    assert.equal(second.notified, true);
    const changed = customerTexts().at(-1) ?? "";
    assert.match(changed, /Your estimated delivery has changed/);
    assert.match(changed, /3:00 PM – 5:00 PM/);
    assert.doesNotMatch(changed, /Courier /);

    const same = await setCustomerDeliveryEstimate(harareJob.gig.id, winnerId, {
      start: "2026-11-04T15:00:00+02:00",
      end: "2026-11-04T17:00:00+02:00"
    });
    assert.equal(same.notified, false);
    assert.equal(customerTexts().length, 2);

    await startTravelToPickup(harareJob.gig.id, winnerId, fakeIo);
    await arriveAtPickup(
      harareJob.gig.id,
      winnerId,
      { latitude: HARARE.lat, longitude: HARARE.lng, confirmNearby: true },
      fakeIo
    );
    await verifyPickupPin(harareJob.gig.id, winnerId, harareJob.pickupPin, fakeIo);
    const collected = notifications.find((note) => note.title === "Package collected");
    assert.equal(collected?.body, "Your order is out for delivery.");
    await startTravelToDropoff(harareJob.gig.id, winnerId, fakeIo);
    await arriveAtDropoff(
      harareJob.gig.id,
      winnerId,
      { latitude: HARARE.lat, longitude: HARARE.lng, confirmNearby: true },
      fakeIo
    );
    await verifyDeliveryPinAndComplete(harareJob.gig.id, winnerId, harareJob.deliveryPin, fakeIo, {
      latitude: HARARE.lat,
      longitude: HARARE.lng
    });
    const delivered = await prisma.commerceOrder.findFirstOrThrow({ where: { linkedDeliveryGigId: harareJob.gig.id } });
    assert.equal(delivered.status, "DELIVERED");
    assert.equal(commerceShopUiStatusLabel("DELIVERED"), "Delivered");
    assert.equal(commerceCustomerStatusCopy("DELIVERED"), "Your order has been delivered.");
    assert.equal(
      commerceCustomerStatusCopy("COURIER_ASSIGNED", {
        start: "2026-11-04T12:00:00.000Z",
        end: "2026-11-04T14:00:00.000Z"
      }),
      "Estimated delivery: Nov 4, 2 PM–4 PM"
    );

    const beforeRelease = customerTexts().length;
    await expressWorkerInterest(releaseJob.gig.id, harare.id, undefined, fakeIo);
    await setCustomerDeliveryEstimate(releaseJob.gig.id, harare.id, {
      start: "2026-11-04T14:00:00+02:00",
      end: "2026-11-04T16:00:00+02:00"
    });
    const released = await releaseCommerceDelivery(releaseJob.gig.id, harare.id, { reason: "TRANSPORT" }, fakeIo);
    assert.equal(released.rematching, true);
    const cleared = await prisma.gig.findUniqueOrThrow({ where: { id: releaseJob.gig.id } });
    assert.equal(cleared.assignedWorkerId, null);
    assert.equal(cleared.status, "SEARCHING_FOR_WORKER");
    assert.equal(cleared.customerDeliveryEstimateStart, null);
    assert.equal(cleared.customerDeliveryEstimateEnd, null);
    const afterRelease = customerTexts().slice(beforeRelease);
    assert.equal(
      afterRelease.some((body) => /cancel|reassign|courier/i.test(body)),
      false,
      "release does not tell the customer a courier cancelled"
    );
    assert.equal(await sees(gweru.id, releaseJob.gig.id), true, "released delivery returns to every eligible courier");
    assert.equal(await sees(far.id, releaseJob.gig.id), true);

    await expressWorkerInterest(releaseJob.gig.id, gweru.id, undefined, fakeIo);
    await setCustomerDeliveryEstimate(releaseJob.gig.id, gweru.id, {
      start: "2026-11-05T10:00:00+02:00",
      end: "2026-11-05T12:00:00+02:00"
    });
    const fresh = customerTexts().at(-1) ?? "";
    assert.match(fresh, /Estimated delivery:/);
    assert.match(fresh, /Thursday, 5 November/);
    assert.match(fresh, /10:00 AM – 12:00 PM/);
    assert.doesNotMatch(fresh, /has changed/);
    assert.doesNotMatch(fresh, /courier|accepted|assigned/i);

    console.log(
      JSON.stringify({
        ok: true,
        visibility: ["harare-sees-gweru", "gweru-sees-harare", "far", "no-location"],
        excluded: ["suspended", "ineligible"],
        atomicAccept: true,
        estimateStoredUtc: true,
        releaseCleared: true,
        delivered: true
      })
    );
  } finally {
    if (createdGigIds.length) {
      await prisma.commerceOrder.deleteMany({ where: { linkedDeliveryGigId: { in: createdGigIds } } });
      await prisma.courierDeliveryRelease.deleteMany({ where: { gigId: { in: createdGigIds } } });
      await prisma.gigInterest.deleteMany({ where: { gigId: { in: createdGigIds } } });
      await prisma.gigAssignment.deleteMany({ where: { gigId: { in: createdGigIds } } });
      await prisma.payment.deleteMany({ where: { gigId: { in: createdGigIds } } });
      await prisma.chatThread.deleteMany({ where: { gigId: { in: createdGigIds } } });
      await prisma.gig.deleteMany({ where: { id: { in: createdGigIds } } });
    }
    if (merchantId) await prisma.merchant.deleteMany({ where: { id: merchantId } });
    if (createdUserIds.length) {
      await prisma.workerProfile.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
