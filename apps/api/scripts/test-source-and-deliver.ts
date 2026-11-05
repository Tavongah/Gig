/**
 * Source & deliver for unresolved catalog requests.
 * Uses the local test database. Does not touch production.
 *
 * Run: npx tsx apps/api/scripts/test-source-and-deliver.ts
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

const HARARE = { lat: -17.8292, lng: 31.0522 };
const GWERU = { lat: -19.455, lng: 29.815 };
const notifications: Array<{ userId: string; title: string; body: string }> = [];
const room = { emit: () => undefined, to: () => room };
const fakeIo = {
  to: (target: string) => ({
    emit: (event: string, payload: { title?: string; body?: string }) => {
      if (event === "notification" && target.startsWith("user:")) {
        notifications.push({ userId: target.slice(5), title: payload.title ?? "", body: payload.body ?? "" });
      }
    },
    to: () => room
  })
} as unknown as Server;

async function main() {
  process.env.NODE_ENV = "test";
  delete process.env.SOURCE_DELIVERY_ENABLED;
  delete process.env.SOURCE_DELIVERY_AUTO_PUBLISH;
  delete process.env.SOURCE_DELIVERY_BACKFILL_ENABLED;
  delete process.env.SOURCE_DELIVERY_PILOT_COURIERS;
  const pilot = await import("../src/modules/commerce/source-delivery-pilot.js");
  assert.equal(pilot.sourceDeliveryEnabled(), false);
  assert.equal(pilot.sourceDeliveryAutoPublishEnabled(), false);
  assert.equal(pilot.sourceDeliveryBackfillEnabled(), false);
  process.env.SOURCE_DELIVERY_PILOT_COURIERS = "not-a-pilot@example.com";
  assert.equal(pilot.isSourceDeliveryPilotCourier({ id: "not-a-pilot", email: "not-a-pilot@example.com" }), false);
  delete process.env.SOURCE_DELIVERY_PILOT_COURIERS;
  const { publishSourceDeliveryForCheckout, applySourceDeliveryBackfill } = await import(
    "../src/modules/commerce/source-delivery.service.js"
  );
  assert.deepEqual(await publishSourceDeliveryForCheckout("disabled-flag-check"), {
    gigId: null,
    action: "skip"
  });
  process.env.SOURCE_DELIVERY_ENABLED = "false";
  process.env.SOURCE_DELIVERY_BACKFILL_ENABLED = "true";
  const blockedBackfill = await applySourceDeliveryBackfill();
  assert.deepEqual(blockedBackfill.publishedGigIds, []);
  process.env.SOURCE_DELIVERY_ENABLED = "true";
  process.env.SOURCE_DELIVERY_AUTO_PUBLISH = "true";
  process.env.SOURCE_DELIVERY_BACKFILL_ENABLED = "false";
  process.env.SOURCE_DELIVERY_PILOT_COURIERS = "";
  assert.equal(pilot.isSourceDeliveryPilotCourier({ id: "anyone", email: "anyone@example.com" }), true);
  process.env.SOURCE_DELIVERY_PILOT_COURIERS = "someone-else@example.com";
  assert.equal(pilot.isSourceDeliveryPilotCourier({ id: "anyone", email: "anyone@example.com" }), true);
  process.env.SOURCE_DELIVERY_PILOT_COURIERS = "";
  const whatsapp = new MockWhatsAppProvider();
  setWhatsAppProviderForTests(whatsapp);
  const { prisma } = await import("../src/config/prisma.js");
  const { createCatalogProduct } = await import("../src/modules/commerce/catalog.service.js");
  const { acceptUnresolvedCatalogRequest } = await import("../src/modules/commerce/unresolved-checkout.service.js");
  const { dryRunSourceDeliveryBackfill } = await import("../src/modules/commerce/source-delivery.service.js");
  const { findNearbyGigs, getGigDetail } = await import("../src/modules/gigs/gig.service.js");
  const { expressWorkerInterest } = await import("../src/modules/gigs/gig-workflow.service.js");
  const { createDelivery, releaseCommerceDelivery, setCustomerDeliveryEstimate, setDeliveryCourierEligibility } =
    await import("../src/modules/gigs/delivery.service.js");
  const { formatCustomerDeliveryEstimateMessage, merchandisePricePresentation, planSourceDeliveryBackfill } =
    await import("@gigflow/shared");
  const { AppError } = await import("../src/lib/errors.js");
  const { listCustomerCommerceOrders } = await import("../src/modules/commerce/customer-commerce.service.js");

  const unpriced = merchandisePricePresentation([{ quantity: 1, unitPriceCents: null }]);
  assert.equal(unpriced.label, "Price to be confirmed");
  assert.equal(unpriced.subtotalCents, null);
  assert.equal(JSON.stringify(unpriced).includes("$0"), false);

  const stamp = Date.now();
  const createdUserIds: string[] = [];
  const catalogIds: string[] = [];
  const checkoutIds: string[] = [];
  let pickupGigId: string | null = null;
  let localGigId: string | null = null;
  let helpCategoryId: string | null = null;

  async function courier(label: string, point: { lat: number; lng: number } | null) {
    const user = await prisma.user.create({
      data: {
        email: `source-${label}-${stamp}@example.com`,
        phoneNumber: `+26377${String(stamp).slice(-6)}${createdUserIds.length}`,
        fullName: `Courier ${label}`,
        passwordHash: "test",
        roles: ["WORKER"],
        accountStatus: "APPROVED",
        emailVerified: true,
        profileCompleted: true,
        avatarUrl: "https://example.com/courier.png",
        workerProfile: {
          create: {
            bio: label,
            availabilityStatus: "AVAILABLE",
            travelDistanceMiles: 5,
            currentLatitude: point?.lat ?? null,
            currentLongitude: point?.lng ?? null
          }
        }
      }
    });
    createdUserIds.push(user.id);
    await setDeliveryCourierEligibility(user.id, { enabled: true, transportMode: "WALKING" });
    return user;
  }

  try {
    const client = await prisma.user.create({
      data: {
        email: `source-client-${stamp}@example.com`,
        phoneNumber: `+26378${String(stamp).slice(-7)}`,
        fullName: "Shalom Fixture",
        passwordHash: "test",
        roles: ["CLIENT"],
        accountStatus: "ACTIVE",
        emailVerified: true,
        avatarUrl: "https://example.com/client.png"
      }
    });
    createdUserIds.push(client.id);
    const phone = `+26379${String(stamp).slice(-7)}`;
    const harareCourier = await courier("harare", HARARE);
    const gweruCourier = await courier("gweru", GWERU);

    const colt = await createCatalogProduct({ name: `Af 1 double colt ${stamp}`, category: "Shoes", sizeLabel: "8" });
    const j4 = await createCatalogProduct({ name: `J4 ${stamp}`, category: "Shoes", sizeLabel: "8" });
    catalogIds.push(colt.id, j4.id);

    const saved = await acceptUnresolvedCatalogRequest({
      userId: client.id,
      lat: HARARE.lat,
      lng: HARARE.lng,
      deliveryLabel: "8206 glennorah C",
      lines: [
        { catalogProductId: colt.id, quantity: 1 },
        { catalogProductId: j4.id, quantity: 1 }
      ]
    });
    assert.ok(saved);
    checkoutIds.push(saved.checkoutId);
    const checkout = await prisma.commerceCheckout.findUniqueOrThrow({
      where: { id: saved.checkoutId },
      include: { orders: true, lines: true, linkedDeliveryGig: true }
    });
    assert.equal(checkout.status, "AWAITING_FULFILLMENT");
    assert.equal(checkout.orders.length, 0);
    assert.equal(checkout.itemsSubtotalCents, 0);
    assert.equal(checkout.totalCents, 0);
    assert.ok(checkout.linkedDeliveryGigId);
    assert.equal(checkout.linkedDeliveryGig?.deliveryJobKind, "SOURCE_AND_DELIVER");
    assert.equal(checkout.linkedDeliveryGig?.fulfillmentType, "DELIVERY");
    assert.equal(checkout.linkedDeliveryGig?.status, "SEARCHING_FOR_WORKER");
    assert.equal(checkout.linkedDeliveryGig?.assignedWorkerId, null);
    await prisma.commerceCheckout.update({
      where: { id: checkout.id },
      data: { customerWhatsAppPhone: phone }
    });

    const again = await publishSourceDeliveryForCheckout(checkout.id);
    assert.equal(again.action, "already_published");
    assert.equal(again.gigId, checkout.linkedDeliveryGigId);
    assert.equal(await prisma.gig.count({ where: { idempotencyKey: `source-checkout-${checkout.id}` } }), 1);

    async function seenBy(courierId: string) {
      const rows = await findNearbyGigs(courierId);
      return rows.find((row) => row.id === checkout.linkedDeliveryGigId);
    }
    const harareView = await seenBy(harareCourier.id);
    const gweruView = await seenBy(gweruCourier.id);
    assert.ok(harareView?.sourceDelivery, "Harare courier sees the sourcing job");
    assert.ok(gweruView?.sourceDelivery, "Gweru courier sees the sourcing job");
    const source = harareView!.sourceDelivery!;
    assert.equal(source.label, "SOURCE & DELIVER");
    assert.deepEqual(
      source.products.map((line) => `${line.name} × ${line.quantity}`).sort(),
      [`Af 1 double colt ${stamp} × 1`, `J4 ${stamp} × 1`].sort()
    );
    assert.equal(source.sourceAround, "Harare");
    assert.match(source.deliverTo, /Glennorah C, Harare/);
    assert.doesNotMatch(source.deliverTo, /8206/);
    assert.equal(source.merchandisePriceLabel, "Price to be confirmed");
    assert.equal(source.merchandiseSubtotalCents, null);
    assert.equal(JSON.stringify(source).includes("$0"), false);
    assert.equal(harareView?.commercePickup, undefined);
    assert.equal(harareView?.deliveryJobKind, "SOURCE_AND_DELIVER");

    const noLocation = await courier("noloc", null);
    const noLocationView = await seenBy(noLocation.id);
    assert.ok(noLocationView?.sourceDelivery, "A courier without a location still sees the sourcing job");

    const helpCategory = await prisma.serviceCategory.create({
      data: {
        slug: `source-help-${stamp}`,
        name: "Local errand",
        description: "Local help regression fixture",
        iconName: "hand",
        baseRateCents: 100,
        hourlyRateCents: 100
      }
    });
    helpCategoryId = helpCategory.id;
    const localGig = await prisma.gig.create({
      data: {
        clientId: client.id,
        serviceCategoryId: helpCategory.id,
        title: "Local help fixture",
        description: "Must stay inside the geographic match",
        fulfillmentType: "LOCAL_HELP",
        urgency: "STANDARD",
        size: "SMALL",
        estimatedHours: 1,
        distanceMiles: 0,
        startsAt: new Date(),
        addressLine1: "Harare",
        city: "Harare",
        region: "Harare",
        postalCode: "0000",
        latitude: HARARE.lat,
        longitude: HARARE.lng,
        priceBreakdown: { fulfillmentType: "LOCAL_HELP" },
        totalCents: 500,
        platformFeeCents: 100,
        workerPayoutCents: 400
      }
    });
    localGigId = localGig.id;
    await prisma.workerProfile.update({
      where: { userId: harareCourier.id },
      data: { serviceCategories: { connect: { id: helpCategory.id } } }
    });
    await prisma.workerProfile.update({
      where: { userId: gweruCourier.id },
      data: { serviceCategories: { connect: { id: helpCategory.id } } }
    });
    const harareNearby = await findNearbyGigs(harareCourier.id);
    const gweruNearby = await findNearbyGigs(gweruCourier.id);
    const noLocationNearby = await findNearbyGigs(noLocation.id);
    assert.equal(harareNearby.some((row) => row.id === localGig.id), true);
    assert.equal(gweruNearby.some((row) => row.id === localGig.id), false);
    assert.equal(noLocationNearby.some((row) => row.id === localGig.id), false);
    assert.equal(gweruNearby.some((row) => row.id === checkout.linkedDeliveryGigId), true);
    assert.equal(noLocationNearby.some((row) => row.id === checkout.linkedDeliveryGigId), true);

    const listed = await listCustomerCommerceOrders(client.id);
    const card = listed.orders.find((order) => order.id === checkout.id);
    assert.equal(card?.statusLabel, "Preparing your order");
    assert.doesNotMatch(String(card?.statusLabel), /shop|courier|sourc/i);

    const pickup = await createDelivery(
      client.id,
      {
        pickup: {
          latitude: -17.82,
          longitude: 31.05,
          formattedAddress: "Registered shop, Harare",
          addressLine1: "Registered shop",
          city: "Harare",
          region: "Harare",
          postalCode: "0000",
          country: "ZW",
          contactName: "Registered shop",
          contactPhone: "+263771110001"
        },
        dropoff: {
          latitude: -17.825,
          longitude: 31.055,
          formattedAddress: "Customer, Harare",
          addressLine1: "Customer",
          city: "Harare",
          region: "Harare",
          postalCode: "0000",
          country: "ZW",
          contactName: "Customer",
          contactPhone: phone
        },
        package: { category: "GROCERIES", description: "Shop order", size: "SMALL" },
        prohibitedItemsAck: true
      },
      fakeIo,
      { bypassClientPostGate: true, idempotencyKey: `pickup-control-${stamp}` }
    );
    pickupGigId = (pickup.delivery as { id: string }).id;
    const pickupRow = await prisma.gig.findUniqueOrThrow({ where: { id: pickupGigId } });
    assert.equal(pickupRow.deliveryJobKind, "PICKUP_AND_DELIVER");
    assert.equal(pickupRow.fulfillmentType, "DELIVERY");
    process.env.SOURCE_DELIVERY_PILOT_COURIERS = harareCourier.id;
    assert.equal(pilot.isSourceDeliveryPilotCourier({ id: gweruCourier.id, email: gweruCourier.email }), true);
    assert.equal((await findNearbyGigs(gweruCourier.id)).some((row) => row.id === pickupGigId), true);
    assert.equal((await findNearbyGigs(gweruCourier.id)).some((row) => row.id === checkout.linkedDeliveryGigId), true);
    const ineligible = await courier("ineligible", HARARE);
    await setDeliveryCourierEligibility(ineligible.id, { enabled: false, transportMode: "WALKING" });
    assert.equal((await findNearbyGigs(ineligible.id)).some((row) => row.id === checkout.linkedDeliveryGigId), false);
    assert.equal((await findNearbyGigs(ineligible.id)).some((row) => row.id === pickupGigId), false);
    await assert.rejects(
      () => getGigDetail(checkout.linkedDeliveryGigId!, ineligible.id),
      (error: unknown) => error instanceof Error && error.message === "FORBIDDEN"
    );
    await assert.rejects(
      () => expressWorkerInterest(checkout.linkedDeliveryGigId!, ineligible.id, undefined, fakeIo),
      (error: unknown) => error instanceof AppError && error.code === "WORKER_NOT_APPROVED"
    );
    process.env.SOURCE_DELIVERY_PILOT_COURIERS = "";

    const [first, second] = await Promise.allSettled([
      expressWorkerInterest(checkout.linkedDeliveryGigId!, harareCourier.id, undefined, fakeIo),
      expressWorkerInterest(checkout.linkedDeliveryGigId!, gweruCourier.id, undefined, fakeIo)
    ]);
    const wins = [first, second].filter((result) => result.status === "fulfilled");
    const losses = [first, second].filter((result) => result.status === "rejected");
    assert.equal(wins.length, 1);
    assert.equal(losses.length, 1);
    assert.equal((losses[0] as PromiseRejectedResult).reason instanceof AppError, true);
    assert.equal(((losses[0] as PromiseRejectedResult).reason as AppError).code, "GIG_NOT_AVAILABLE");
    const owned = await prisma.gig.findUniqueOrThrow({ where: { id: checkout.linkedDeliveryGigId! } });
    const winnerId = owned.assignedWorkerId!;
    assert.ok(winnerId);
    assert.equal(await seenBy(winnerId === harareCourier.id ? gweruCourier.id : harareCourier.id), undefined);

    const customerTexts = () => whatsapp.sent.filter((message) => message.to === phone).map((message) => message.body);
    const beforeEstimate = customerTexts().length;
    const estimate = await setCustomerDeliveryEstimate(owned.id, winnerId, {
      start: "2026-11-04T14:00:00+02:00",
      end: "2026-11-04T16:00:00+02:00"
    });
    assert.equal(estimate.notified, true);
    const expected = formatCustomerDeliveryEstimateMessage(
      { start: "2026-11-04T14:00:00+02:00", end: "2026-11-04T16:00:00+02:00" },
      false
    );
    assert.equal(customerTexts().at(-1), expected);
    assert.match(expected, /Wednesday, 4 November/);
    assert.match(expected, /2:00 PM – 4:00 PM/);
    assert.equal(customerTexts().length, beforeEstimate + 1);
    const customerNotes = [
      ...customerTexts(),
      ...notifications.filter((note) => note.userId === client.id).flatMap((note) => [note.title, note.body])
    ].join("\n");
    assert.doesNotMatch(customerNotes, /no shop|could not find a merchant|looking for your product|courier accepted|courier was assigned|sourcing job/i);

    const released = await releaseCommerceDelivery(owned.id, winnerId, { reason: "TRANSPORT" }, fakeIo);
    assert.equal(released.rematching, true);
    const cleared = await prisma.gig.findUniqueOrThrow({ where: { id: owned.id } });
    assert.equal(cleared.assignedWorkerId, null);
    assert.equal(cleared.status, "SEARCHING_FOR_WORKER");
    assert.equal(cleared.customerDeliveryEstimateStart, null);
    assert.equal(cleared.customerDeliveryEstimateEnd, null);
    assert.equal(customerTexts().length, beforeEstimate + 1);
    assert.ok(await seenBy(harareCourier.id), "Harare courier sees the released sourcing job");
    assert.ok(await seenBy(gweruCourier.id), "Gweru courier sees the released sourcing job");
    assert.equal(await seenBy(ineligible.id), undefined);

    const loserId = winnerId === harareCourier.id ? gweruCourier.id : harareCourier.id;
    await expressWorkerInterest(owned.id, loserId, undefined, fakeIo);
    const secondEstimate = await setCustomerDeliveryEstimate(owned.id, loserId, {
      start: "2026-11-05T10:00:00+02:00",
      end: "2026-11-05T12:00:00+02:00"
    });
    assert.equal(secondEstimate.notified, true);
    const fresh = customerTexts().at(-1) ?? "";
    assert.match(fresh, /Thursday, 5 November/);
    assert.doesNotMatch(fresh, /has changed/);
    assert.doesNotMatch(fresh, /courier|assigned|sourc/i);

    const duplicate = await prisma.commerceCheckout.create({
      data: {
        customerId: client.id,
        commerceCustomerId: checkout.commerceCustomerId,
        status: "AWAITING_FULFILLMENT",
        paymentStatus: "PENDING",
        paymentMethod: "CASH",
        itemsSubtotalCents: 0,
        deliveryFeeCents: checkout.deliveryFeeCents,
        serviceFeeCents: 0,
        totalCents: 0,
        deliveryLabel: checkout.deliveryLabel,
        deliveryLatitude: checkout.deliveryLatitude,
        deliveryLongitude: checkout.deliveryLongitude,
        packageClass: "SMALL",
        pickupSequence: [],
        allocations: { merchants: [] },
        lines: {
          create: checkout.lines.map((line) => ({
            catalogProductId: line.catalogProductId,
            quantity: line.quantity,
            productNameSnapshot: line.productNameSnapshot,
            fulfillmentStatus: "AWAITING_SOURCE"
          }))
        }
      }
    });
    checkoutIds.push(duplicate.id);
    const duplicatePublish = await publishSourceDeliveryForCheckout(duplicate.id);
    assert.equal(duplicatePublish.action, "duplicate");
    assert.equal(duplicatePublish.gigId, null);
    const dry = await dryRunSourceDeliveryBackfill();
    const duplicatePlan = dry.plan.find((item) => item.checkoutId === duplicate.id);
    assert.equal(duplicatePlan?.action, "duplicate");
    assert.equal(duplicatePlan?.duplicateOfCheckoutId, checkout.id);
    const rows = [
      {
        checkoutId: checkout.id,
        createdAt: checkout.createdAt.toISOString(),
        customerKey: checkout.commerceCustomerId!,
        city: "Harare",
        lines: checkout.lines.map((line) => ({ catalogProductId: line.catalogProductId, quantity: line.quantity })),
        linkedDeliveryGigId: checkout.linkedDeliveryGigId,
        orderCount: 0,
        status: "AWAITING_FULFILLMENT",
        paymentMethod: "CASH"
      },
      {
        checkoutId: duplicate.id,
        createdAt: duplicate.createdAt.toISOString(),
        customerKey: checkout.commerceCustomerId!,
        city: "Harare",
        lines: checkout.lines.map((line) => ({ catalogProductId: line.catalogProductId, quantity: line.quantity })),
        linkedDeliveryGigId: null,
        orderCount: 0,
        status: "AWAITING_FULFILLMENT",
        paymentMethod: "CASH"
      }
    ];
    assert.deepEqual(planSourceDeliveryBackfill(rows), planSourceDeliveryBackfill(rows));
    const firstDry = dry;
    const secondDry = await dryRunSourceDeliveryBackfill();
    assert.equal(secondDry.would_create, firstDry.would_create);
    assert.equal(secondDry.duplicate_suspected, firstDry.duplicate_suspected);
    assert.equal(secondDry.already_has_gig >= 1, true);
    assert.equal(secondDry.failed, 0);
    assert.equal(secondDry.scanned >= secondDry.eligible, true);

    console.log("source and deliver ok");
  } finally {
    if (checkoutIds.length) {
      await prisma.commerceCheckout.updateMany({
        where: { id: { in: checkoutIds } },
        data: { linkedDeliveryGigId: null }
      });
      await prisma.gig.deleteMany({
        where: { idempotencyKey: { in: checkoutIds.map((id) => `source-checkout-${id}`) } }
      });
      await prisma.commerceCheckout.deleteMany({ where: { id: { in: checkoutIds } } });
    }
    if (pickupGigId) await prisma.gig.delete({ where: { id: pickupGigId } }).catch(() => undefined);
    if (localGigId) await prisma.gig.delete({ where: { id: localGigId } }).catch(() => undefined);
    if (helpCategoryId) await prisma.serviceCategory.delete({ where: { id: helpCategoryId } }).catch(() => undefined);
    if (catalogIds.length) await prisma.catalogProduct.deleteMany({ where: { id: { in: catalogIds } } });
    if (createdUserIds.length) {
      await prisma.commerceCustomer.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
