/**
 * Cancelling a Source & Deliver gig also cancels its linked checkout.
 * Local test database only.
 *
 * Run: npx tsx apps/api/scripts/test-source-cancel.ts
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
const configured = new URL(process.env.DATABASE_URL ?? "postgres://localhost");
if (configured.hostname !== "localhost" && configured.hostname !== "127.0.0.1") {
  throw new Error("Source cancel regression refuses a non-local database.");
}
configured.pathname = "/duts_gig_dev";
process.env.DATABASE_URL = configured.toString();

const HARARE = { lat: -17.8292, lng: 31.0522 };
const fakeIo = { to: () => ({ emit: () => undefined, to: () => ({ emit: () => undefined }) }) } as unknown as Server;

async function main() {
  process.env.NODE_ENV = "test";
  process.env.SOURCE_DELIVERY_ENABLED = "true";
  process.env.SOURCE_DELIVERY_AUTO_PUBLISH = "true";
  process.env.SOURCE_DELIVERY_BACKFILL_ENABLED = "false";
  process.env.SOURCE_DELIVERY_PILOT_COURIERS = "";
  process.env.STRIPE_SECRET_KEY = "";
  process.env.STRIPE_WEBHOOK_SECRET = "";
  const whatsapp = new MockWhatsAppProvider();
  setWhatsAppProviderForTests(whatsapp);

  const { prisma } = await import("../src/config/prisma.js");
  const { sourceRequestCustomerStatusLabel } = await import("@gigflow/shared");
  const { createCatalogProduct } = await import("../src/modules/commerce/catalog.service.js");
  const { acceptUnresolvedCatalogRequest, assertCheckoutPayable } = await import(
    "../src/modules/commerce/unresolved-checkout.service.js"
  );
  const { publishSourceDeliveryForCheckout } = await import("../src/modules/commerce/source-delivery.service.js");
  const { proposeSourceMerchandisePrice, settleSourcePaymentChoice, assertSourceMayLeaveForDelivery } =
    await import("../src/modules/commerce/source-price.service.js");
  const { approveProposedQuote } = await import("../src/modules/commerce/quote-approval.service.js");
  const { listCustomerCommerceOrders, getCustomerCommerceOrder } = await import(
    "../src/modules/commerce/customer-commerce.service.js"
  );
  const { findNearbyGigs, updateGigStatus } = await import("../src/modules/gigs/gig.service.js");
  const { expressWorkerInterest } = await import("../src/modules/gigs/gig-workflow.service.js");
  const { createDelivery, markSourceOutForDelivery, setDeliveryCourierEligibility } = await import(
    "../src/modules/gigs/delivery.service.js"
  );
  const { syncCommerceOrderFromGig } = await import("../src/modules/commerce/order.service.js");
  const { AppError } = await import("../src/lib/errors.js");
  const { GigStatus } = await import("@prisma/client");

  assert.equal(sourceRequestCustomerStatusLabel({ gigStatus: "CANCELLED" }), "Cancelled");
  assert.equal(sourceRequestCustomerStatusLabel({ gigStatus: "WORKER_ASSIGNED" }), "Preparing your order");

  const stamp = Date.now();
  const userIds: string[] = [];
  const catalogIds: string[] = [];
  const checkoutIds: string[] = [];
  const merchantIds: string[] = [];
  let pickupGigId: string | null = null;

  try {
    const client = await prisma.user.create({
      data: {
        email: `source-cancel-client-${stamp}@example.com`,
        phoneNumber: `+26378${String(stamp).slice(-7)}`,
        fullName: "Source Cancel Customer",
        passwordHash: "test",
        roles: ["CLIENT"],
        accountStatus: "ACTIVE",
        emailVerified: true,
        avatarUrl: "https://example.com/client.png"
      }
    });
    userIds.push(client.id);
    const courier = await prisma.user.create({
      data: {
        email: `source-cancel-courier-${stamp}@example.com`,
        phoneNumber: `+26377${String(stamp).slice(-7)}`,
        fullName: "Source Cancel Courier",
        passwordHash: "test",
        roles: ["WORKER"],
        accountStatus: "APPROVED",
        emailVerified: true,
        profileCompleted: true,
        avatarUrl: "https://example.com/courier.png",
        workerProfile: {
          create: {
            bio: "cancel regression",
            availabilityStatus: "AVAILABLE",
            travelDistanceMiles: 5,
            currentLatitude: HARARE.lat,
            currentLongitude: HARARE.lng
          }
        }
      }
    });
    userIds.push(courier.id);
    await setDeliveryCourierEligibility(courier.id, { enabled: true, transportMode: "WALKING" });

    const product = await createCatalogProduct({
      name: `Cancel fixture ${stamp}`,
      category: "Household",
      sizeLabel: "1"
    });
    catalogIds.push(product.id);
    const saved = await acceptUnresolvedCatalogRequest({
      userId: client.id,
      lat: HARARE.lat,
      lng: HARARE.lng,
      deliveryLabel: "Glen Norah C",
      lines: [{ catalogProductId: product.id, quantity: 1 }]
    });
    assert.ok(saved);
    checkoutIds.push(saved.checkoutId);
    const opened = await prisma.commerceCheckout.findUniqueOrThrow({
      where: { id: saved.checkoutId },
      include: { linkedDeliveryGig: true }
    });
    const gigId = opened.linkedDeliveryGigId!;
    assert.equal(opened.linkedDeliveryGig?.deliveryJobKind, "SOURCE_AND_DELIVER");
    await expressWorkerInterest(gigId, courier.id, undefined, fakeIo);
    const proposed = await proposeSourceMerchandisePrice({
      gigId,
      workerId: courier.id,
      merchandiseCents: 350
    });
    await approveProposedQuote({
      checkoutId: saved.checkoutId,
      approvalId: proposed.proposalId,
      quoteVersion: proposed.quoteVersion,
      actor: { userId: client.id }
    });
    const approved = await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: saved.checkoutId } });
    assert.equal(approved.status, "CUSTOMER_APPROVED");
    assert.equal(approved.paymentMethod, "CASH");
    assert.equal(approved.paymentStatus, "DUE_ON_DELIVERY");

    const collectedProduct = await createCatalogProduct({
      name: `Collected fixture ${stamp}`,
      category: "Household",
      sizeLabel: "1"
    });
    catalogIds.push(collectedProduct.id);
    const collectedSaved = await acceptUnresolvedCatalogRequest({
      userId: client.id,
      lat: HARARE.lat,
      lng: HARARE.lng,
      deliveryLabel: "Collected Glen Norah C",
      lines: [{ catalogProductId: collectedProduct.id, quantity: 1 }]
    });
    assert.ok(collectedSaved);
    checkoutIds.push(collectedSaved.checkoutId);
    const collectedCheckout = await prisma.commerceCheckout.findUniqueOrThrow({
      where: { id: collectedSaved.checkoutId }
    });
    const merchant = await prisma.merchant.create({
      data: {
        name: `Cancel shop ${stamp}`,
        contactName: "Shop",
        phone: `+26371${String(stamp).slice(-7)}`,
        whatsappPhone: `+26371${String(stamp).slice(-7)}`,
        locationLabel: "Harare",
        latitude: HARARE.lat,
        longitude: HARARE.lng
      }
    });
    const collectedOrder = await prisma.commerceOrder.create({
      data: {
        customerId: client.id,
        merchantId: merchant.id,
        checkoutId: collectedCheckout.id,
        status: "READY_FOR_PICKUP",
        paymentStatus: "DUE_ON_DELIVERY",
        paymentMethod: "CASH",
        subtotalCents: 350,
        deliveryFeeCents: collectedCheckout.deliveryFeeCents,
        totalCents: 350 + collectedCheckout.deliveryFeeCents,
        deliveryLabel: collectedCheckout.deliveryLabel,
        deliveryLatitude: collectedCheckout.deliveryLatitude,
        deliveryLongitude: collectedCheckout.deliveryLongitude
      }
    });
    await prisma.commerceCheckoutPickupStop.create({
      data: {
        checkoutId: collectedCheckout.id,
        commerceOrderId: collectedOrder.id,
        merchantId: merchant.id,
        sequence: 1,
        pickupPin: "hashed-fixture",
        status: "COLLECTED",
        collectedAt: new Date()
      }
    });
    await updateGigStatus(collectedCheckout.linkedDeliveryGigId!, client.id, GigStatus.CANCELLED, fakeIo, undefined, {
      cancellationReason: "collected source merchandise"
    });
    const needsAttention = await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: collectedCheckout.id } });
    const collectedGig = await prisma.gig.findUniqueOrThrow({ where: { id: collectedCheckout.linkedDeliveryGigId! } });
    assert.equal(collectedGig.status, "CANCELLED");
    assert.equal(needsAttention.status, "NEEDS_ATTENTION");
    assert.equal(needsAttention.cancelledAt, null);
    assert.equal(needsAttention.deliveredAt, null);
    assert.equal(needsAttention.paymentMethod, "CASH");
    assert.equal(needsAttention.paymentStatus, collectedCheckout.paymentStatus);
    merchantIds.push(merchant.id);

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
          contactPhone: "+263771110002"
        },
        package: { category: "GROCERIES", description: "Shop order", size: "SMALL" },
        prohibitedItemsAck: true
      },
      fakeIo,
      { bypassClientPostGate: true, idempotencyKey: `pickup-cancel-control-${stamp}` }
    );
    pickupGigId = (pickup.delivery as { id: string }).id;
    const pickupCheckout = await prisma.commerceCheckout.create({
      data: {
        customerId: client.id,
        status: "FULFILLING",
        paymentStatus: "DUE_ON_DELIVERY",
        paymentMethod: "ECOCASH",
        itemsSubtotalCents: 500,
        deliveryFeeCents: 100,
        totalCents: 600,
        deliveryLabel: "Pickup control",
        deliveryLatitude: -17.82,
        deliveryLongitude: 31.05,
        pickupSequence: [],
        allocations: {},
        linkedDeliveryGigId: pickupGigId
      }
    });
    checkoutIds.push(pickupCheckout.id);

    await updateGigStatus(gigId, client.id, GigStatus.CANCELLED, fakeIo, undefined, {
      cancellationReason: "source cancel regression"
    });

    const cancelledGig = await prisma.gig.findUniqueOrThrow({ where: { id: gigId }, include: { payment: true } });
    const cancelledCheckout = await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: saved.checkoutId } });
    assert.equal(cancelledGig.status, "CANCELLED");
    assert.equal(cancelledGig.cancelledBy, "CLIENT");
    assert.equal(cancelledGig.cancellationFeeCents, 0);
    assert.equal(cancelledGig.assignedWorkerId, courier.id);
    assert.equal(cancelledGig.payment?.status, "AUTHORIZED");
    assert.equal(cancelledGig.payment?.capturedAt, null);
    assert.equal(cancelledCheckout.status, "CANCELLED");
    assert.ok(cancelledCheckout.cancelledAt);
    assert.equal(cancelledCheckout.deliveredAt, null);
    assert.equal(cancelledCheckout.paymentMethod, "CASH");
    assert.equal(cancelledCheckout.paymentStatus, "DUE_ON_DELIVERY");
    assert.equal(cancelledCheckout.fulfillmentOwner, "COURIER_SOURCE");
    assert.equal(await prisma.commerceOrder.count({ where: { checkoutId: saved.checkoutId } }), 0);
    assert.equal(await prisma.commercePaymentAttempt.count({ where: { commerceCheckoutId: saved.checkoutId } }), 0);
    assert.equal(
      await prisma.gig.count({ where: { deliveryJobKind: "SOURCE_AND_DELIVER", id: gigId, status: { in: ["POSTED", "SEARCHING_FOR_WORKER"] } } }),
      0
    );
    assert.equal((await findNearbyGigs(courier.id)).some((row) => row.id === gigId), false);

    const listed = (await listCustomerCommerceOrders(client.id)).orders.find((row) => row.id === saved.checkoutId);
    assert.equal(listed?.status, "CANCELLED");
    assert.equal(listed?.statusLabel, "Cancelled");
    const detail = await getCustomerCommerceOrder(client.id, saved.checkoutId);
    assert.equal(detail.order?.status, "CANCELLED");
    assert.equal(detail.order?.statusLabel, "Cancelled");

    const republish = await publishSourceDeliveryForCheckout(saved.checkoutId);
    assert.equal(republish.action, "skip");
    assert.equal(await prisma.gig.count({ where: { idempotencyKey: `source-checkout-${saved.checkoutId}` } }), 1);
    await syncCommerceOrderFromGig(gigId, GigStatus.COMPLETED);
    const stillCancelled = await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: saved.checkoutId } });
    assert.equal(stillCancelled.status, "CANCELLED");
    assert.equal(stillCancelled.deliveredAt, null);

    assert.throws(
      () => assertCheckoutPayable("CANCELLED"),
      (error: unknown) => error instanceof AppError && error.code === "REQUEST_NOT_PAYABLE"
    );
    await assert.rejects(
      settleSourcePaymentChoice({ checkoutId: saved.checkoutId, paymentMethod: "CASH" }),
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "QUOTE_NOT_APPROVED")
    );
    await prisma.commerceCheckout.update({
      where: { id: saved.checkoutId },
      data: { status: "CUSTOMER_APPROVED", cancelledAt: null }
    });
    await assert.rejects(
      settleSourcePaymentChoice({ checkoutId: saved.checkoutId, paymentMethod: "ECOCASH" }),
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "SOURCE_DELIVERY_CANCELLED")
    );
    await prisma.commerceCheckout.update({
      where: { id: saved.checkoutId },
      data: { status: "CANCELLED", cancelledAt: new Date() }
    });
    await assert.rejects(markSourceOutForDelivery(gigId, courier.id), (error: unknown) => error instanceof Error);
    await assert.rejects(
      assertSourceMayLeaveForDelivery(gigId),
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "SOURCE_PRICE_UNCONFIRMED")
    );

    await updateGigStatus(pickupGigId, client.id, GigStatus.CANCELLED, fakeIo, undefined, {
      cancellationReason: "pickup control"
    });
    const pickupCheckoutAfter = await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: pickupCheckout.id } });
    const pickupGigAfter = await prisma.gig.findUniqueOrThrow({ where: { id: pickupGigId } });
    assert.equal(pickupGigAfter.status, "CANCELLED");
    assert.equal(pickupGigAfter.deliveryJobKind, "PICKUP_AND_DELIVER");
    assert.equal(pickupCheckoutAfter.status, "FULFILLING");
    assert.equal(pickupCheckoutAfter.cancelledAt, null);
    assert.equal(pickupCheckoutAfter.paymentMethod, "ECOCASH");
    assert.equal(pickupCheckoutAfter.paymentStatus, "DUE_ON_DELIVERY");
    const sourceAfterPickupCancel = await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: saved.checkoutId } });
    assert.equal(sourceAfterPickupCancel.status, "CANCELLED");

    console.log("source cancel ok");
  } finally {
    const { prisma } = await import("../src/config/prisma.js");
    if (checkoutIds.length) {
      await prisma.commerceCheckout.updateMany({
        where: { id: { in: checkoutIds } },
        data: { linkedDeliveryGigId: null }
      });
      await prisma.commerceCheckoutPickupStop.deleteMany({ where: { checkoutId: { in: checkoutIds } } });
      await prisma.commerceOrder.deleteMany({ where: { checkoutId: { in: checkoutIds } } });
      await prisma.sourcePriceProposal.deleteMany({ where: { checkoutId: { in: checkoutIds } } });
      await prisma.gig.deleteMany({
        where: { idempotencyKey: { in: checkoutIds.map((id) => `source-checkout-${id}`) } }
      });
      await prisma.commerceCheckout.deleteMany({ where: { id: { in: checkoutIds } } });
    }
    if (pickupGigId) await prisma.gig.delete({ where: { id: pickupGigId } }).catch(() => undefined);
    if (merchantIds.length) await prisma.merchant.deleteMany({ where: { id: { in: merchantIds } } });
    if (catalogIds.length) await prisma.catalogProduct.deleteMany({ where: { id: { in: catalogIds } } });
    if (userIds.length) {
      await prisma.commerceCustomer.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
