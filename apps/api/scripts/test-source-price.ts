/**
 * Source & deliver price confirmation and fulfillment ownership.
 * Local test database only.
 *
 * Run: npx tsx apps/api/scripts/test-source-price.ts
 */
import assert from "node:assert/strict";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MockWhatsAppProvider, setWhatsAppProviderForTests } from "../src/modules/whatsapp/provider.js";
import { sourcePaymentDecision } from "@gigflow/shared";

const here = fileURLToPath(new URL(".", import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });
loadEnv({ path: resolve(here, "../.env") });

const HARARE = { lat: -17.8292, lng: 31.0522, label: "8206 glennorah C" };

async function main() {
  process.env.NODE_ENV = "test";
  process.env.SOURCE_DELIVERY_ENABLED = "true";
  process.env.SOURCE_DELIVERY_AUTO_PUBLISH = "true";
  process.env.SOURCE_DELIVERY_PILOT_COURIERS = "";
  const whatsapp = new MockWhatsAppProvider();
  setWhatsAppProviderForTests(whatsapp);
  assert.equal(sourcePaymentDecision({
    paymentMethod: "CASH",
    confirmedMerchandiseCents: null,
    deliveryFeeCents: 100,
    paidAttemptCents: null
  }), "UNCONFIRMED");
  assert.equal(sourcePaymentDecision({
    paymentMethod: "CASH",
    confirmedMerchandiseCents: 2500,
    deliveryFeeCents: 300,
    paidAttemptCents: null
  }), "CASH_DUE");
  assert.equal(sourcePaymentDecision({
    paymentMethod: "ECOCASH",
    confirmedMerchandiseCents: 2500,
    deliveryFeeCents: 300,
    paidAttemptCents: null
  }), "PAYMENT_REQUIRED");
  assert.equal(sourcePaymentDecision({
    paymentMethod: "ECOCASH",
    confirmedMerchandiseCents: 2500,
    deliveryFeeCents: 300,
    paidAttemptCents: 2000
  }), "AMOUNT_MISMATCH");
  assert.equal(sourcePaymentDecision({
    paymentMethod: "ECOCASH",
    confirmedMerchandiseCents: 2500,
    deliveryFeeCents: 300,
    paidAttemptCents: 2800
  }), "PAID");

  const { prisma } = await import("../src/config/prisma.js");
  const { createCatalogProduct, linkCatalogProductToMerchant } = await import("../src/modules/commerce/catalog.service.js");
  const { checkoutCatalogDemand, listCustomerCommerceOrders } = await import("../src/modules/commerce/customer-commerce.service.js");
  const { proposeMerchantPriceForCheckout } = await import("../src/modules/commerce/quote-proposal.service.js");
  const { approveProposedQuote, handoffApprovedQuote } = await import("../src/modules/commerce/quote-approval.service.js");
  const { proposeSourceMerchandisePrice, rejectSourceMerchandisePrice, reportSourceProductsNotFound, assertSourceMayLeaveForDelivery } = await import("../src/modules/commerce/source-price.service.js");
  const { findNearbyGigs } = await import("../src/modules/gigs/gig.service.js");
  const { expressWorkerInterest } = await import("../src/modules/gigs/gig-workflow.service.js");
  const { createDelivery, markSourceOutForDelivery, releaseCommerceDelivery, setCustomerDeliveryEstimate, setDeliveryCourierEligibility } = await import("../src/modules/gigs/delivery.service.js");
  const { AppError } = await import("../src/lib/errors.js");

  const stamp = Date.now();
  const userIds: string[] = [];
  const catalogIds: string[] = [];
  const checkoutIds: string[] = [];
  const merchantIds: string[] = [];
  let pickupGigId: string | null = null;

  async function courier(label: string, point: { lat: number; lng: number } | null) {
    const user = await prisma.user.create({
      data: {
        email: `price-courier-${label}-${stamp}@example.com`,
        phoneNumber: `+26377${String(stamp).slice(-6)}${userIds.length}`,
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
    userIds.push(user.id);
    await setDeliveryCourierEligibility(user.id, { enabled: true, transportMode: "WALKING" });
    const allowed = process.env.SOURCE_DELIVERY_PILOT_COURIERS ?? "";
    process.env.SOURCE_DELIVERY_PILOT_COURIERS = allowed ? `${allowed},${user.id}` : user.id;
    return user;
  }

  try {
    const customer = await prisma.user.create({
      data: {
        email: `price-customer-${stamp}@example.com`,
        phoneNumber: `+26378${String(stamp).slice(-7)}`,
        fullName: "Shalom Fixture",
        passwordHash: "test",
        roles: ["CLIENT"],
        accountStatus: "ACTIVE",
        emailVerified: true
      }
    });
    userIds.push(customer.id);
    const colt = await createCatalogProduct({ name: `Af 1 double colt ${stamp}`, category: "Groceries", sizeLabel: "1" });
    const j4 = await createCatalogProduct({ name: `J4 ${stamp}`, category: "Groceries", sizeLabel: "1" });
    const kotex = await createCatalogProduct({ name: `Kotex pads ${stamp}`, category: "Personal Care", sizeLabel: "1" });
    catalogIds.push(colt.id, j4.id, kotex.id);

    async function request(lines: Array<{ id: string; quantity: number }>) {
      const saved = await checkoutCatalogDemand({
        userId: customer.id,
        lat: HARARE.lat,
        lng: HARARE.lng,
        deliveryLabel: HARARE.label,
        items: lines.map((line) => ({ catalogProductId: line.id, quantity: line.quantity }))
      });
      assert.equal(saved.fulfillment, "UNRESOLVED");
      if (saved.fulfillment !== "UNRESOLVED") throw new Error("expected unresolved");
      checkoutIds.push(saved.checkoutId);
      await prisma.commerceCheckout.update({
        where: { id: saved.checkoutId },
        data: { customerWhatsAppPhone: customer.phoneNumber }
      });
      return saved;
    }

    const six = await request([{ id: colt.id, quantity: 1 }, { id: j4.id, quantity: 1 }]);
    const seven = await request([{ id: colt.id, quantity: 1 }]);
    const five = await request([{ id: kotex.id, quantity: 1 }]);
    const rows = await prisma.commerceCheckout.findMany({
      where: { id: { in: [six.checkoutId, seven.checkoutId, five.checkoutId] } },
      include: { lines: true, orders: true }
    });
    assert.equal(rows.length, 3);
    for (const row of rows) {
      assert.equal(row.status, "AWAITING_FULFILLMENT");
      assert.equal(row.orders.length, 0);
      assert.ok(row.linkedDeliveryGigId);
      const gig = await prisma.gig.findUniqueOrThrow({ where: { id: row.linkedDeliveryGigId! } });
      assert.equal(gig.deliveryJobKind, "SOURCE_AND_DELIVER");
      assert.equal(gig.assignedWorkerId, null);
    }
    assert.equal(new Set(rows.map((row) => row.linkedDeliveryGigId)).size, 3);

    const harare = await courier("harare", HARARE);
    const gweru = await courier("gweru", { lat: -19.455, lng: 29.815 });
    const noLocation = await courier("noloc", null);
    const gigId = rows.find((row) => row.id === six.checkoutId)!.linkedDeliveryGigId!;
    for (const worker of [harare, gweru, noLocation]) {
      const seen = (await findNearbyGigs(worker.id)).find((row) => row.id === gigId);
      assert.equal(seen?.sourceDelivery?.jobKind, "SOURCE_AND_DELIVER");
      assert.equal(seen?.sourceDelivery?.products.length, 2);
      assert.equal(seen?.sourceDelivery?.merchandisePriceLabel, "Price to be confirmed");
    }

    const room = { emit: () => undefined, to: (): unknown => room };
    const fakeIo = { to: () => room } as never;
    const [first, second] = await Promise.allSettled([
      expressWorkerInterest(gigId, harare.id, undefined, fakeIo),
      expressWorkerInterest(gigId, gweru.id, undefined, fakeIo)
    ]);
    const outcomes = [first, second].map((item) => item.status);
    assert.equal(outcomes.filter((item) => item === "fulfilled").length, 1);
    assert.equal(outcomes.filter((item) => item === "rejected").length, 1);
    const assigned = await prisma.gig.findUniqueOrThrow({ where: { id: gigId } });
    const winnerId = assigned.assignedWorkerId!;
    const loserId = winnerId === harare.id ? gweru.id : harare.id;
    assert.ok(winnerId);

    await setCustomerDeliveryEstimate(gigId, winnerId, {
      start: "2026-11-04T14:00:00+02:00",
      end: "2026-11-04T16:00:00+02:00"
    });
    const beforeOut = await assert.rejects(
      () => markSourceOutForDelivery(gigId, winnerId),
      (error: unknown) => error instanceof AppError && error.code === "SOURCE_PRICE_UNCONFIRMED"
    );
    assert.equal(beforeOut, undefined);

    const proposed = await proposeSourceMerchandisePrice({ gigId, workerId: winnerId, merchandiseCents: 2500 });
    const proposedRow = await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: six.checkoutId } });
    assert.equal(proposedRow.status, "PRICE_PROPOSED");
    assert.equal(proposedRow.itemsSubtotalCents, 0);
    assert.equal(proposedRow.totalCents, 0);
    assert.equal(proposedRow.paymentStatus, "PENDING");
    assert.equal(proposedRow.approvalId, proposed.proposalId);
    const notice = whatsapp.sent.map((message) => message.body).join("\n");
    assert.match(notice, /Your order is available/);
    assert.match(notice, /Items: \$25\.00/);
    assert.match(notice, /Confirm to continue/);
    assert.doesNotMatch(notice, /courier|no shop|sourcing/i);
    const listed = await listCustomerCommerceOrders(customer.id);
    const card = listed.orders.find((row) => row.id === six.checkoutId);
    assert.equal(card?.statusLabel, "Confirm this total");
    assert.equal(card?.hideMerchandiseTotal, true);
    assert.doesNotMatch(String(card?.fulfillmentHint), /courier|no shop|sourcing/i);

    await rejectSourceMerchandisePrice(six.checkoutId, { userId: customer.id });
    const rejected = await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: six.checkoutId } });
    assert.equal(rejected.status, "AWAITING_FULFILLMENT");
    assert.equal(rejected.itemsSubtotalCents, 0);
    assert.equal((await prisma.gig.findUniqueOrThrow({ where: { id: gigId } })).assignedWorkerId, winnerId);

    const again = await proposeSourceMerchandisePrice({ gigId, workerId: winnerId, merchandiseCents: 2500 });
    const changed = await proposeSourceMerchandisePrice({ gigId, workerId: winnerId, merchandiseCents: 3000 });
    assert.notEqual(changed.proposalId, again.proposalId);
    const approved = await approveProposedQuote({
      checkoutId: six.checkoutId,
      approvalId: changed.proposalId,
      quoteVersion: changed.quoteVersion,
      actor: { userId: customer.id }
    });
    assert.equal(approved.sourceDelivery, true);
    const confirmed = await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: six.checkoutId } });
    assert.equal(confirmed.status, "CUSTOMER_APPROVED");
    assert.equal(confirmed.paymentMethod, "CASH");
    assert.equal(confirmed.paymentStatus, "DUE_ON_DELIVERY");
    assert.equal(confirmed.itemsSubtotalCents, 3000);
    assert.equal(confirmed.totalCents, 3000 + confirmed.deliveryFeeCents);
    assert.equal(await prisma.commerceOrder.count({ where: { checkoutId: six.checkoutId } }), 0);
    const confirmedCard = (await listCustomerCommerceOrders(customer.id)).orders.find((row) => row.id === six.checkoutId);
    assert.doesNotMatch(confirmedCard?.statusLabel ?? "", /courier|sourc|shop has/i);
    assert.equal(confirmedCard?.hideMerchandiseTotal, false);

    const textsBeforeChange = whatsapp.sent.length;
    const revised = await proposeSourceMerchandisePrice({ gigId, workerId: winnerId, merchandiseCents: 2600 });
    const revisedRow = await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: six.checkoutId } });
    assert.equal(revisedRow.status, "PRICE_PROPOSED");
    assert.equal(revisedRow.itemsSubtotalCents, 3000);
    assert.equal(revisedRow.paymentStatus, "DUE_ON_DELIVERY");
    assert.equal(revisedRow.paymentMethod, "CASH");
    assert.notEqual(revisedRow.approvalId, changed.proposalId);
    assert.ok(whatsapp.sent.length > textsBeforeChange);
    assert.doesNotMatch(whatsapp.sent.at(-1)?.body ?? "", /courier/i);
    await assert.rejects(
      () => markSourceOutForDelivery(gigId, winnerId),
      (error: unknown) => error instanceof AppError && error.code === "SOURCE_PRICE_UNCONFIRMED"
    );
    await approveProposedQuote({
      checkoutId: six.checkoutId,
      approvalId: revised.proposalId,
      quoteVersion: revised.quoteVersion,
      actor: { userId: customer.id }
    });
    const releasedAfter = await releaseCommerceDelivery(gigId, winnerId, { reason: "TRANSPORT" });
    assert.equal(releasedAfter.released, true);
    const kept = await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: six.checkoutId } });
    assert.equal(kept.fulfillmentOwner, "COURIER_SOURCE");
    assert.equal(kept.status, "CUSTOMER_APPROVED");
    assert.equal(kept.itemsSubtotalCents, 2600);
    assert.equal(kept.paymentMethod, "CASH");
    assert.equal(kept.paymentStatus, "DUE_ON_DELIVERY");
    const releasedGig = await prisma.gig.findUniqueOrThrow({ where: { id: gigId } });
    assert.equal(releasedGig.assignedWorkerId, null);
    assert.equal(releasedGig.customerDeliveryEstimateStart, null);
    assert.doesNotMatch(whatsapp.sent.map((message) => message.body).join("\n"), /courier cancelled|another courier|sourcing courier/i);
    const replacementView = (await findNearbyGigs(loserId)).find((row) => row.id === gigId);
    assert.equal(replacementView?.sourceDelivery?.customerConfirmed, true);
    assert.equal(replacementView?.sourceDelivery?.confirmedMerchandiseLabel, "$26.00");
    assert.equal(replacementView?.sourceDelivery?.paymentLabel, "Cash on delivery");
    await expressWorkerInterest(gigId, loserId, undefined, fakeIo);
    const samePriceTexts = whatsapp.sent.length;
    const same = await proposeSourceMerchandisePrice({ gigId, workerId: loserId, merchandiseCents: 2600 });
    assert.equal(same.unchanged, true);
    assert.equal(whatsapp.sent.length, samePriceTexts);
    assert.equal((await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: six.checkoutId } })).status, "CUSTOMER_APPROVED");
    const different = await proposeSourceMerchandisePrice({ gigId, workerId: loserId, merchandiseCents: 2800 });
    const pendingChange = await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: six.checkoutId } });
    assert.equal(pendingChange.status, "PRICE_PROPOSED");
    assert.equal(pendingChange.itemsSubtotalCents, 2600);
    await assert.rejects(
      () => markSourceOutForDelivery(gigId, loserId),
      (error: unknown) => error instanceof AppError && error.code === "SOURCE_PRICE_UNCONFIRMED"
    );
    await approveProposedQuote({
      checkoutId: six.checkoutId,
      approvalId: different.proposalId,
      quoteVersion: different.quoteVersion,
      actor: { userId: customer.id }
    });
    const out = await markSourceOutForDelivery(gigId, loserId);
    assert.equal(out.status, "PACKAGE_COLLECTED");
    assert.equal((await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: six.checkoutId } })).status, "OUT_FOR_DELIVERY");

    const cash = await handoffApprovedQuote({
      checkoutId: seven.checkoutId,
      approvalId: "00000000-0000-4000-8000-000000000000",
      quoteVersion: 1,
      paymentMethod: "CASH",
      actor: { userId: customer.id }
    }).catch((error: unknown) => error);
    assert.ok(cash instanceof AppError);

    const sevenGig = (await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: seven.checkoutId } })).linkedDeliveryGigId!;
    await expressWorkerInterest(sevenGig, loserId, undefined, fakeIo);
    const sevenPrice = await proposeSourceMerchandisePrice({ gigId: sevenGig, workerId: loserId, merchandiseCents: 1500 });
    await releaseCommerceDelivery(sevenGig, loserId, { reason: "OTHER" });
    const released = await prisma.commerceCheckout.findUniqueOrThrow({
      where: { id: seven.checkoutId },
      include: { sourcePriceProposals: true }
    });
    assert.equal(released.status, "AWAITING_FULFILLMENT");
    assert.equal(released.itemsSubtotalCents, 0);
    assert.equal(released.sourcePriceProposals.some((row) => row.id === sevenPrice.proposalId && row.status === "INVALIDATED"), true);
    assert.equal((await prisma.gig.findUniqueOrThrow({ where: { id: sevenGig } })).assignedWorkerId, null);
    assert.equal(whatsapp.sent.filter((message) => /courier/i.test(message.body)).length, 0);

    await expressWorkerInterest(sevenGig, winnerId, undefined, fakeIo);
    await proposeSourceMerchandisePrice({ gigId: sevenGig, workerId: winnerId, merchandiseCents: 1800 });
    await reportSourceProductsNotFound(sevenGig, winnerId);
    assert.equal((await prisma.gig.findUniqueOrThrow({ where: { id: sevenGig } })).status, "SEARCHING_FOR_WORKER");
    const seenAgain = (await findNearbyGigs(noLocation.id)).some((row) => row.id === sevenGig);
    assert.equal(seenAgain, true);
    await expressWorkerInterest(sevenGig, noLocation.id, undefined, fakeIo);
    const foundPrice = await proposeSourceMerchandisePrice({ gigId: sevenGig, workerId: noLocation.id, merchandiseCents: 1800 });
    await approveProposedQuote({
      checkoutId: seven.checkoutId,
      approvalId: foundPrice.proposalId,
      quoteVersion: foundPrice.quoteVersion,
      actor: { userId: customer.id }
    });
    await reportSourceProductsNotFound(sevenGig, noLocation.id);
    const missed = await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: seven.checkoutId } });
    assert.equal(missed.status, "CUSTOMER_APPROVED");
    assert.equal(missed.itemsSubtotalCents, 1800);
    assert.equal(missed.paymentMethod, "CASH");
    assert.equal(missed.paymentStatus, "DUE_ON_DELIVERY");
    assert.equal(missed.fulfillmentOwner, "COURIER_SOURCE");
    assert.equal((await prisma.gig.findUniqueOrThrow({ where: { id: sevenGig } })).assignedWorkerId, null);

    const ecoGig = (await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: five.checkoutId } })).linkedDeliveryGigId!;
    await expressWorkerInterest(ecoGig, noLocation.id, undefined, fakeIo);
    const ecoPrice = await proposeSourceMerchandisePrice({ gigId: ecoGig, workerId: noLocation.id, merchandiseCents: 900 });
    await approveProposedQuote({
      checkoutId: five.checkoutId,
      approvalId: ecoPrice.proposalId,
      quoteVersion: ecoPrice.quoteVersion,
      actor: { userId: customer.id }
    });
    const ecoBefore = await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: five.checkoutId } });
    await prisma.commerceCheckout.update({
      where: { id: five.checkoutId },
      data: { paymentMethod: "ECOCASH" }
    });
    await assert.rejects(
      () => markSourceOutForDelivery(ecoGig, noLocation.id),
      (error: unknown) => error instanceof AppError && error.code === "SOURCE_V1_CASH_ONLY"
    );
    const ecoAfter = await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: five.checkoutId } });
    assert.equal(ecoAfter.paymentMethod, "ECOCASH");
    assert.equal(ecoAfter.itemsSubtotalCents, ecoBefore.itemsSubtotalCents);
    assert.equal(ecoAfter.totalCents, ecoBefore.totalCents);
    await assert.rejects(
      () => handoffApprovedQuote({
        checkoutId: five.checkoutId,
        approvalId: ecoPrice.proposalId,
        quoteVersion: ecoPrice.quoteVersion,
        paymentMethod: "ECOCASH",
        payerPhone: "+263771234567",
        actor: { userId: customer.id }
      }),
      (error: unknown) => error instanceof AppError && error.code === "SOURCE_V1_CASH_ONLY"
    );
    assert.equal(await prisma.commerceOrder.count({ where: { checkoutId: five.checkoutId } }), 0);
    assert.equal(await prisma.commercePaymentAttempt.count({ where: { commerceCheckoutId: five.checkoutId } }), 0);

    const prepaid = await request([{ id: colt.id, quantity: 3 }]);
    const prepaidRow = await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: prepaid.checkoutId } });
    await prisma.commerceCheckout.update({
      where: { id: prepaid.checkoutId },
      data: { linkedDeliveryGigId: null, fulfillmentOwner: null, paymentMethod: "ECOCASH" }
    });
    const { publishSourceDeliveryForCheckout } = await import("../src/modules/commerce/source-delivery.service.js");
    const skippedPrepaid = await publishSourceDeliveryForCheckout(prepaid.checkoutId);
    assert.equal(skippedPrepaid.action, "skip");
    const prepaidAfter = await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: prepaid.checkoutId } });
    assert.equal(prepaidAfter.paymentMethod, "ECOCASH");
    assert.equal(prepaidAfter.linkedDeliveryGigId, null);

    const open = await request([{ id: kotex.id, quantity: 2 }]);
    const openGig = (await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: open.checkoutId } })).linkedDeliveryGigId!;
    const shop = await prisma.merchant.create({
      data: {
        name: `Price shop ${stamp}`,
        contactName: "Tester",
        phone: `+26371${String(stamp).slice(-7)}`,
        whatsappPhone: `+26372${String(stamp).slice(-7)}`,
        locationLabel: "Glen Norah, Harare",
        latitude: HARARE.lat,
        longitude: HARARE.lng,
        category: "TUCK_SHOP"
      }
    });
    merchantIds.push(shop.id);
    await linkCatalogProductToMerchant(shop.id, { catalogProductId: kotex.id, priceCents: 400, currency: "usd", available: true });
    await expressWorkerInterest(openGig, harare.id, undefined, fakeIo);
    const blocked = await proposeMerchantPriceForCheckout(open.checkoutId);
    assert.equal(blocked.outcome, "NOT_PRICED");
    assert.equal(blocked.reason, "SOURCE_FULFILLMENT_OWNED");
    assert.equal((await prisma.gig.findUniqueOrThrow({ where: { id: openGig } })).status, "WORKER_ASSIGNED");
    await releaseCommerceDelivery(openGig, harare.id, { reason: "TRANSPORT" });
    const afterRelease = await proposeMerchantPriceForCheckout(open.checkoutId);
    assert.equal(afterRelease.reason, "SOURCE_FULFILLMENT_OWNED");
    assert.equal((await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: open.checkoutId } })).fulfillmentOwner, "COURIER_SOURCE");

    const unclaimed = await request([{ id: j4.id, quantity: 2 }]);
    const unclaimedGig = (await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: unclaimed.checkoutId } })).linkedDeliveryGigId!;
    await linkCatalogProductToMerchant(shop.id, { catalogProductId: j4.id, priceCents: 500, currency: "usd", available: true });
    const shopWon = await proposeMerchantPriceForCheckout(unclaimed.checkoutId);
    assert.equal(shopWon.outcome, "PROPOSED");
    const shopRow = await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: unclaimed.checkoutId } });
    assert.equal(shopRow.fulfillmentOwner, "SHOP");
    assert.equal(shopRow.linkedDeliveryGigId, null);
    assert.equal((await prisma.gig.findUniqueOrThrow({ where: { id: unclaimedGig } })).status, "CANCELLED");

    const checkoutsBeforeShop = await prisma.commerceCheckout.count({ where: { customerId: customer.id } });
    const covered = await checkoutCatalogDemand({
      userId: customer.id,
      lat: HARARE.lat,
      lng: HARARE.lng,
      deliveryLabel: HARARE.label,
      items: [{ catalogProductId: j4.id, quantity: 1 }]
    });
    assert.equal(covered.fulfillment, "MERCHANT");
    assert.equal(await prisma.commerceCheckout.count({ where: { customerId: customer.id } }), checkoutsBeforeShop);

    const pickup = await createDelivery(
      customer.id,
      {
        pickup: {
          latitude: HARARE.lat,
          longitude: HARARE.lng,
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
          latitude: HARARE.lat,
          longitude: HARARE.lng,
          formattedAddress: "Customer, Harare",
          addressLine1: "Customer",
          city: "Harare",
          region: "Harare",
          postalCode: "0000",
          country: "ZW",
          contactName: "Customer",
          contactPhone: customer.phoneNumber!
        },
        package: { category: "GROCERIES", description: "Shop order", size: "SMALL" },
        prohibitedItemsAck: true
      },
      { to: () => ({ emit: () => undefined }) } as never,
      { bypassClientPostGate: true, idempotencyKey: `pickup-price-${stamp}` }
    );
    pickupGigId = (pickup.delivery as { id: string }).id;
    assert.equal((await prisma.gig.findUniqueOrThrow({ where: { id: pickupGigId } })).deliveryJobKind, "PICKUP_AND_DELIVER");

    console.log("source price ok");
  } finally {
    const gigs = await prisma.gig.findMany({
      where: { idempotencyKey: { in: checkoutIds.map((id) => `source-checkout-${id}`) } },
      select: { id: true }
    });
    if (checkoutIds.length) {
      await prisma.commerceCheckout.updateMany({ where: { id: { in: checkoutIds } }, data: { linkedDeliveryGigId: null } });
      await prisma.commerceCheckout.deleteMany({ where: { id: { in: checkoutIds } } });
    }
    if (gigs.length) await prisma.gig.deleteMany({ where: { id: { in: gigs.map((gig) => gig.id) } } });
    if (pickupGigId) await prisma.gig.delete({ where: { id: pickupGigId } }).catch(() => undefined);
    if (merchantIds.length) {
      await prisma.product.deleteMany({ where: { merchantId: { in: merchantIds } } });
      await prisma.merchant.deleteMany({ where: { id: { in: merchantIds } } });
    }
    if (catalogIds.length) await prisma.catalogProduct.deleteMany({ where: { id: { in: catalogIds } } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
