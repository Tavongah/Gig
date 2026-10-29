/**
 * Phase 2B.1 — one merchant may snapshot a price onto one unresolved checkout.
 * Payment, orders, courier, seller, and customer approval stay closed.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CommercePaymentMethod } from "@prisma/client";
import { DEFAULT_MARKETPLACE_MERCHANT_RADIUS_KM } from "@gigflow/shared";
import { AppError } from "../src/lib/errors.js";
import { prisma } from "../src/config/prisma.js";
import { createCatalogProduct, linkCatalogProductToMerchant } from "../src/modules/commerce/catalog.service.js";
import { getCustomerCommerceOrder, listCustomerCommerceOrders, payCustomerEcoCash } from "../src/modules/commerce/customer-commerce.service.js";
import { findNearbyMerchants, getMarketplaceSettings } from "../src/modules/commerce/merchant.service.js";
import { MockCommercePaymentProvider } from "../src/modules/commerce/payments/mock.provider.js";
import {
  initiateMobileMoneyPaymentForOrder,
  setCommercePaymentProviderForTests,
  switchOrderToCashOnDelivery
} from "../src/modules/commerce/payments/payment.service.js";
import { proposeMerchantPriceForCheckout, quoteTtlMs } from "../src/modules/commerce/quote-proposal.service.js";
import { assertCheckoutPayable } from "../src/modules/commerce/unresolved-checkout.service.js";

const root = dirname(fileURLToPath(import.meta.url));
const GWERU = { lat: -19.455, lng: 29.812, label: "Senga, Gweru" };
const HARARE = { lat: -17.8292, lng: 31.0522, label: "Harare CBD" };

function source(rel: string) {
  return readFileSync(resolve(root, rel), "utf8");
}

function zw(seed: number) {
  return `+2637${String(seed).padStart(8, "0").slice(-8)}`;
}

function throwsNotPayable(run: () => Promise<unknown>) {
  return assert.rejects(run, (error: unknown) => error instanceof AppError && error.code === "REQUEST_NOT_PAYABLE");
}

async function main() {
  const proposal = source("../src/modules/commerce/quote-proposal.service.ts");
  const payment = source("../src/modules/commerce/payments/payment.service.ts");
  const unresolved = source("../src/modules/commerce/unresolved-checkout.service.ts");
  const handler = source("../src/modules/whatsapp/customer-handler.ts");
  const migration = source("../prisma/migrations/20261029020000_merchant_quote_proposal/migration.sql");
  const storefront = source("../../../packages/shared/src/catalog.ts");

  assert.match(unresolved, /PRICE_PROPOSED/);
  assert.match(payment, /assertCheckoutPayable/);
  assert.match(proposal, /validationFixture: false/);
  assert.doesNotMatch(proposal, /commerceOrder\.create/);
  assert.doesNotMatch(proposal, /notifyMerchant/);
  assert.doesNotMatch(proposal, /SellerOffer/);
  assert.doesNotMatch(proposal, /DeliveryGig/);
  assert.doesNotMatch(proposal, /product\.update/);
  assert.match(handler, /QUOTE_APPROVAL/);
  assert.match(handler, /approveProposedQuote/);
  assert.match(storefront, /status === "APPROVED"/);
  assert.match(migration, /checkoutNumber" IN \(1, 2\)/);
  assert.match(migration, /phase1-unresolved-validation@duts\.invalid/);
  assert.match(migration, /Phase 1 validation fixture\. Not a live customer request\./);
  assert.match(migration, /RAISE EXCEPTION 'fixture backfill predicate failed'/);
  assert.doesNotMatch(migration, /CUSTOMER_APPROVED/);

  assert.throws(() => assertCheckoutPayable("AWAITING_FULFILLMENT"), (error: unknown) => {
    return error instanceof AppError && error.code === "REQUEST_NOT_PAYABLE";
  });
  assert.throws(() => assertCheckoutPayable("PRICE_PROPOSED"), (error: unknown) => {
    return error instanceof AppError && error.code === "REQUEST_NOT_PAYABLE";
  });

  const stamp = Date.now() % 10_000_000;
  const user = await prisma.user.create({
    data: {
      email: `quote-proposal-${stamp}@duts.test`,
      fullName: "Quote Proposal Test",
      phoneNumber: zw(stamp)
    }
  });
  const sellersBefore = await prisma.seller.count();
  const sellerOffersBefore = await prisma.sellerOffer.count();
  const sellerFulfillmentsBefore = await prisma.sellerFulfillment.count();
  const sellerPaymentsBefore = await prisma.sellerPaymentAttempt.count();
  const sellerLedgerBefore = await prisma.sellerLedgerEntry.count();
  const gigsBefore = await prisma.gig.count();
  const checkoutIds: string[] = [];
  const merchantIds: string[] = [];
  const catalogIds: string[] = [];
  const orderIds: string[] = [];

  async function merchant(name: string, lat: number, lng: number, label: string, n: number) {
    const row = await prisma.merchant.create({
      data: {
        name: `${name} ${stamp}`,
        contactName: "Tester",
        phone: zw(stamp + n),
        whatsappPhone: zw(stamp + n),
        locationLabel: label,
        latitude: lat,
        longitude: lng,
        category: "TUCK_SHOP"
      }
    });
    merchantIds.push(row.id);
    return row;
  }

  async function catalog(name: string, status?: "PENDING" | "APPROVED" | "REJECTED" | "ARCHIVED") {
    const row = await createCatalogProduct({
      name: `${name} ${stamp}`,
      category: "Drinks",
      sizeLabel: "2L",
      ...(status ? { status } : {})
    });
    catalogIds.push(row.id);
    return row;
  }

  async function offer(merchantId: string, catalogProductId: string, priceCents: number) {
    return linkCatalogProductToMerchant(merchantId, {
      catalogProductId,
      priceCents,
      currency: "usd",
      available: true
    });
  }

  async function checkout(input: {
    lat: number;
    lng: number;
    label: string;
    fee?: number;
    fixture?: boolean;
    notes?: string;
    lines: Array<{ catalogProductId: string; quantity: number; name: string }>;
  }) {
    const row = await prisma.commerceCheckout.create({
      data: {
        customerId: user.id,
        status: "AWAITING_FULFILLMENT",
        itemsSubtotalCents: 0,
        deliveryFeeCents: input.fee ?? 100,
        serviceFeeCents: 0,
        totalCents: 0,
        deliveryLabel: input.label,
        deliveryLatitude: input.lat,
        deliveryLongitude: input.lng,
        packageClass: "SMALL",
        pickupSequence: [],
        allocations: { merchants: [], awaitingFulfillment: true },
        validationFixture: input.fixture ?? false,
        notes: input.notes,
        lines: {
          create: input.lines.map((line) => ({
            catalogProductId: line.catalogProductId,
            quantity: line.quantity,
            productNameSnapshot: line.name,
            fulfillmentStatus: "AWAITING_SOURCE"
          }))
        }
      }
    });
    checkoutIds.push(row.id);
    return row;
  }

  try {
    const gweruShop = await merchant("Gweru Full", GWERU.lat, GWERU.lng, "Gweru", 11);
    const harareShop = await merchant("Harare Full", HARARE.lat, HARARE.lng, "Harare", 12);
    const priced = await catalog("Priced Cola");
    const gweruOffer = await offer(gweruShop.id, priced.id, 250);
    const harareOffer = await offer(harareShop.id, priced.id, 400);

    const fixtureOne = await checkout({
      ...GWERU,
      fixture: true,
      notes: "Phase 1 validation fixture. Not a live customer request. Merchandise price is not set. totalCents is not payable.",
      lines: [{ catalogProductId: priced.id, quantity: 1, name: priced.name }]
    });
    const fixtureTwo = await checkout({
      ...HARARE,
      fixture: true,
      notes: "Phase 1 validation fixture. Not a live customer request. Merchandise price is not set. totalCents is not payable.",
      lines: [{ catalogProductId: priced.id, quantity: 1, name: priced.name }]
    });
    for (const fixture of [fixtureOne, fixtureTwo]) {
      const blocked = await proposeMerchantPriceForCheckout(fixture.id);
      assert.equal(blocked.outcome, "FIXTURE_EXCLUDED");
      assert.equal(blocked.payable, false);
      const stored = await prisma.commerceCheckout.findUniqueOrThrow({
        where: { id: fixture.id },
        include: { lines: true }
      });
      assert.equal(stored.status, "AWAITING_FULFILLMENT");
      assert.equal(stored.quoteVersion, 0);
      assert.equal(stored.lines[0]?.unitPriceCents, null);
      assert.equal(await prisma.commerceOrder.count({ where: { checkoutId: fixture.id } }), 0);
    }

    const gweruRequest = await checkout({
      ...GWERU,
      fee: 170,
      lines: [{ catalogProductId: priced.id, quantity: 2, name: priced.name }]
    });
    const proposed = await proposeMerchantPriceForCheckout(gweruRequest.id);
    assert.equal(proposed.outcome, "PROPOSED");
    assert.equal(proposed.status, "PRICE_PROPOSED");
    assert.equal(proposed.payable, false);
    assert.equal(proposed.quoteVersion, 1);
    assert.match(proposed.approvalId ?? "", /^[0-9a-f-]{36}$/);
    assert.equal(proposed.itemsSubtotalCents, 500);
    assert.equal(proposed.deliveryFeeCents, 170);
    assert.equal(proposed.totalCents, 670);
    assert.equal(proposed.lines[0]?.sourceProductId, gweruOffer.id);
    assert.equal(proposed.lines[0]?.sourceMerchantId, gweruShop.id);
    const expiresDelta = new Date(proposed.quoteExpiresAt ?? 0).getTime() - Date.now();
    assert.ok(Math.abs(expiresDelta - quoteTtlMs()) < 10_000);
    const gweruStored = await prisma.commerceCheckout.findUniqueOrThrow({
      where: { id: gweruRequest.id },
      include: { lines: true, orders: true, pickupStops: true, paymentAttempts: true }
    });
    assert.equal(gweruStored.deliveryFeeCents, 170);
    assert.equal(gweruStored.lines[0]?.quotedAt instanceof Date, true);
    assert.equal(gweruStored.orders.length, 0);
    assert.equal(gweruStored.pickupStops.length, 0);
    assert.equal(gweruStored.paymentAttempts.length, 0);
    assert.equal(gweruStored.linkedDeliveryGigId, null);
    assert.equal(
      await prisma.commerceNotificationAttempt.count({ where: { commerceOrder: { checkoutId: gweruRequest.id } } }),
      0
    );
    const stock = await prisma.product.findUniqueOrThrow({ where: { id: gweruOffer.id } });
    assert.equal(stock.quantityApprox, null);
    assert.equal(stock.priceCents, 250);

    const again = await proposeMerchantPriceForCheckout(gweruRequest.id);
    assert.equal(again.outcome, "UNCHANGED");
    assert.equal(again.quoteVersion, 1);
    assert.equal(again.approvalId, proposed.approvalId);
    assert.equal(again.totalCents, 670);

    await prisma.product.update({ where: { id: gweruOffer.id }, data: { priceCents: 999 } });
    const repriced = await proposeMerchantPriceForCheckout(gweruRequest.id);
    assert.equal(repriced.outcome, "REPRICE_REQUIRED");
    assert.equal(repriced.quoteVersion, 1);
    assert.equal(repriced.lines[0]?.unitPriceCents, 500 / 2);
    const kept = await prisma.commerceCheckoutLine.findFirstOrThrow({ where: { checkoutId: gweruRequest.id } });
    assert.equal(kept.unitPriceCents, 250);
    await prisma.product.update({ where: { id: gweruOffer.id }, data: { priceCents: 250 } });

    const history = await listCustomerCommerceOrders(user.id);
    assert.equal(history.orders.some((row) => row.id === gweruRequest.id), false);
    const viewed = await getCustomerCommerceOrder(user.id, gweruRequest.id);
    assert.equal("payable" in viewed && viewed.payable, false);
    assert.equal("order" in viewed && viewed.order, null);

    const harareRequest = await checkout({
      ...HARARE,
      fee: 100,
      lines: [{ catalogProductId: priced.id, quantity: 1, name: priced.name }]
    });
    const harareProposed = await proposeMerchantPriceForCheckout(harareRequest.id);
    assert.equal(harareProposed.outcome, "PROPOSED");
    assert.equal(harareProposed.itemsSubtotalCents, 400);
    assert.equal(harareProposed.deliveryFeeCents, 100);
    assert.equal(harareProposed.totalCents, 500);
    assert.equal(harareProposed.lines[0]?.sourceMerchantId, harareShop.id);
    assert.equal(harareProposed.payable, false);

    const missing = await catalog("No Merchant Cola");
    const empty = await checkout({
      ...GWERU,
      lines: [{ catalogProductId: missing.id, quantity: 1, name: missing.name }]
    });
    const noMerchant = await proposeMerchantPriceForCheckout(empty.id);
    assert.equal(noMerchant.outcome, "NOT_PRICED");
    assert.equal(noMerchant.reason, "NO_FULL_MERCHANT");
    assert.equal((await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: empty.id } })).status, "AWAITING_FULFILLMENT");

    const partA = await catalog("Partial A");
    const partB = await catalog("Partial B");
    const partialShop = await merchant("Partial", GWERU.lat + 0.01, GWERU.lng, "Gweru", 13);
    await offer(partialShop.id, partA.id, 100);
    const partial = await checkout({
      ...GWERU,
      lines: [
        { catalogProductId: partA.id, quantity: 1, name: partA.name },
        { catalogProductId: partB.id, quantity: 1, name: partB.name }
      ]
    });
    const partialResult = await proposeMerchantPriceForCheckout(partial.id);
    assert.equal(partialResult.outcome, "NOT_PRICED");
    assert.equal((await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: partial.id } })).status, "AWAITING_FULFILLMENT");
    assert.equal(await prisma.commerceCheckoutLine.count({ where: { checkoutId: partial.id, unitPriceCents: { not: null } } }), 0);

    const splitA = await catalog("Split A");
    const splitB = await catalog("Split B");
    const shopA = await merchant("Split A", GWERU.lat, GWERU.lng, "Gweru", 14);
    const shopB = await merchant("Split B", GWERU.lat + 0.01, GWERU.lng, "Gweru", 15);
    await offer(shopA.id, splitA.id, 100);
    await offer(shopB.id, splitB.id, 100);
    const split = await checkout({
      ...GWERU,
      lines: [
        { catalogProductId: splitA.id, quantity: 1, name: splitA.name },
        { catalogProductId: splitB.id, quantity: 1, name: splitB.name }
      ]
    });
    assert.equal((await proposeMerchantPriceForCheckout(split.id)).outcome, "NOT_PRICED");
    assert.equal((await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: split.id } })).status, "AWAITING_FULFILLMENT");

    const pendingCatalog = await catalog("Pending Cola");
    const pendingShop = await merchant("Pending Shop", GWERU.lat, GWERU.lng, "Gweru", 16);
    const pendingOffer = await offer(pendingShop.id, pendingCatalog.id, 300);
    await prisma.catalogProduct.update({ where: { id: pendingCatalog.id }, data: { status: "PENDING" } });
    const pendingRequest = await checkout({
      ...GWERU,
      fee: 100,
      lines: [{ catalogProductId: pendingCatalog.id, quantity: 1, name: pendingCatalog.name }]
    });
    const pendingQuote = await proposeMerchantPriceForCheckout(pendingRequest.id);
    assert.equal(pendingQuote.outcome, "PROPOSED");
    assert.equal(pendingQuote.lines[0]?.sourceProductId, pendingOffer.id);
    assert.equal((await prisma.catalogProduct.findUniqueOrThrow({ where: { id: pendingCatalog.id } })).status, "PENDING");

    const rejectedCatalog = await catalog("Rejected Cola");
    const rejectedShop = await merchant("Rejected Shop", GWERU.lat, GWERU.lng, "Gweru", 17);
    await offer(rejectedShop.id, rejectedCatalog.id, 300);
    await prisma.catalogProduct.update({ where: { id: rejectedCatalog.id }, data: { status: "REJECTED" } });
    const rejectedRequest = await checkout({
      ...GWERU,
      lines: [{ catalogProductId: rejectedCatalog.id, quantity: 1, name: rejectedCatalog.name }]
    });
    assert.equal((await proposeMerchantPriceForCheckout(rejectedRequest.id)).reason, "NO_FULL_MERCHANT");

    const archivedCatalog = await catalog("Archived Cola");
    const archivedCatalogShop = await merchant("Archived Catalog Shop", GWERU.lat, GWERU.lng, "Gweru", 18);
    await offer(archivedCatalogShop.id, archivedCatalog.id, 300);
    await prisma.catalogProduct.update({ where: { id: archivedCatalog.id }, data: { status: "ARCHIVED" } });
    const archivedCatalogRequest = await checkout({
      ...GWERU,
      lines: [{ catalogProductId: archivedCatalog.id, quantity: 1, name: archivedCatalog.name }]
    });
    assert.equal((await proposeMerchantPriceForCheckout(archivedCatalogRequest.id)).reason, "NO_FULL_MERCHANT");

    const inactiveCatalog = await catalog("Inactive Merchant Cola");
    const inactiveShop = await merchant("Inactive", GWERU.lat, GWERU.lng, "Gweru", 19);
    await offer(inactiveShop.id, inactiveCatalog.id, 300);
    await prisma.merchant.update({ where: { id: inactiveShop.id }, data: { isActive: false } });
    const inactiveRequest = await checkout({
      ...GWERU,
      lines: [{ catalogProductId: inactiveCatalog.id, quantity: 1, name: inactiveCatalog.name }]
    });
    assert.equal((await proposeMerchantPriceForCheckout(inactiveRequest.id)).reason, "NO_FULL_MERCHANT");

    const closedCatalog = await catalog("Closed Merchant Cola");
    const closedShop = await merchant("Closed", GWERU.lat, GWERU.lng, "Gweru", 20);
    await offer(closedShop.id, closedCatalog.id, 300);
    await prisma.merchant.update({ where: { id: closedShop.id }, data: { acceptsOrders: false } });
    const closedRequest = await checkout({
      ...GWERU,
      lines: [{ catalogProductId: closedCatalog.id, quantity: 1, name: closedCatalog.name }]
    });
    assert.equal((await proposeMerchantPriceForCheckout(closedRequest.id)).reason, "NO_FULL_MERCHANT");

    const hiddenCatalog = await catalog("Unavailable Cola");
    const hiddenShop = await merchant("Hidden", GWERU.lat, GWERU.lng, "Gweru", 21);
    const hiddenOffer = await offer(hiddenShop.id, hiddenCatalog.id, 300);
    await prisma.product.update({ where: { id: hiddenOffer.id }, data: { available: false } });
    const hiddenRequest = await checkout({
      ...GWERU,
      lines: [{ catalogProductId: hiddenCatalog.id, quantity: 1, name: hiddenCatalog.name }]
    });
    assert.equal((await proposeMerchantPriceForCheckout(hiddenRequest.id)).reason, "NO_FULL_MERCHANT");

    const archivedProductCatalog = await catalog("Archived Product Cola");
    const archivedProductShop = await merchant("Archived Product", GWERU.lat, GWERU.lng, "Gweru", 22);
    const archivedProduct = await offer(archivedProductShop.id, archivedProductCatalog.id, 300);
    await prisma.product.update({ where: { id: archivedProduct.id }, data: { archived: true } });
    const archivedProductRequest = await checkout({
      ...GWERU,
      lines: [{ catalogProductId: archivedProductCatalog.id, quantity: 1, name: archivedProductCatalog.name }]
    });
    assert.equal((await proposeMerchantPriceForCheckout(archivedProductRequest.id)).reason, "NO_FULL_MERCHANT");

    const shortCatalog = await catalog("Short Stock Cola");
    const shortShop = await merchant("Short Stock", GWERU.lat, GWERU.lng, "Gweru", 23);
    const shortOffer = await offer(shortShop.id, shortCatalog.id, 300);
    await prisma.product.update({ where: { id: shortOffer.id }, data: { quantityApprox: 1 } });
    const shortRequest = await checkout({
      ...GWERU,
      lines: [{ catalogProductId: shortCatalog.id, quantity: 2, name: shortCatalog.name }]
    });
    assert.equal((await proposeMerchantPriceForCheckout(shortRequest.id)).reason, "NO_FULL_MERCHANT");
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: shortOffer.id } })).quantityApprox, 1);

    const wrongCityCatalog = await catalog("Wrong City Cola");
    const wrongCityShop = await merchant("Wrong City", HARARE.lat, HARARE.lng, "Harare", 24);
    await offer(wrongCityShop.id, wrongCityCatalog.id, 300);
    const wrongCityRequest = await checkout({
      ...GWERU,
      lines: [{ catalogProductId: wrongCityCatalog.id, quantity: 1, name: wrongCityCatalog.name }]
    });
    assert.equal((await proposeMerchantPriceForCheckout(wrongCityRequest.id)).reason, "NO_FULL_MERCHANT");

    const settings = await getMarketplaceSettings();
    const outsideKm = DEFAULT_MARKETPLACE_MERCHANT_RADIUS_KM + 2;
    const outsideCatalog = await catalog("Outside Radius Cola");
    const outsideShop = await merchant(
      "Outside Radius",
      GWERU.lat + outsideKm / 111,
      GWERU.lng,
      "Gweru",
      25
    );
    const outsideOffer = await offer(outsideShop.id, outsideCatalog.id, 180);
    const nearby = await findNearbyMerchants(GWERU.lat, GWERU.lng);
    if (settings.merchantRadiusKm < outsideKm) {
      assert.equal(nearby.some((row) => row.merchant.id === outsideShop.id), false);
    }
    const outsideRequest = await checkout({
      ...GWERU,
      fee: 170,
      lines: [{ catalogProductId: outsideCatalog.id, quantity: 1, name: outsideCatalog.name }]
    });
    const outsideQuote = await proposeMerchantPriceForCheckout(outsideRequest.id);
    assert.equal(outsideQuote.outcome, "PROPOSED");
    assert.equal(outsideQuote.lines[0]?.sourceProductId, outsideOffer.id);
    assert.equal(outsideQuote.deliveryFeeCents, 170);
    assert.equal(outsideQuote.totalCents, 350);

    const rankCatalog = await catalog("Rank Cola");
    const nearExpensive = await merchant("Near Expensive", GWERU.lat, GWERU.lng, "Gweru", 26);
    const farCheap = await merchant("Far Cheap", GWERU.lat + 0.05, GWERU.lng, "Gweru", 27);
    const nearRankOffer = await offer(nearExpensive.id, rankCatalog.id, 800);
    await offer(farCheap.id, rankCatalog.id, 100);
    const rankRequest = await checkout({
      ...GWERU,
      fee: 130,
      lines: [{ catalogProductId: rankCatalog.id, quantity: 1, name: rankCatalog.name }]
    });
    const ranked = await proposeMerchantPriceForCheckout(rankRequest.id);
    assert.equal(ranked.lines[0]?.sourceProductId, nearRankOffer.id);
    assert.equal(ranked.itemsSubtotalCents, 800);
    assert.equal(ranked.deliveryFeeCents, 130);
    assert.equal(ranked.totalCents, 930);

    const expiredRequest = await checkout({
      ...GWERU,
      fee: 100,
      lines: [{ catalogProductId: priced.id, quantity: 1, name: priced.name }]
    });
    const expiredQuote = await proposeMerchantPriceForCheckout(expiredRequest.id);
    assert.equal(expiredQuote.outcome, "PROPOSED");
    await prisma.commerceCheckout.update({
      where: { id: expiredRequest.id },
      data: { quoteExpiresAt: new Date(Date.now() - 60_000) }
    });
    const expiredView = await getCustomerCommerceOrder(user.id, expiredRequest.id);
    assert.equal("expired" in expiredView && expiredView.expired, true);
    assert.equal("payable" in expiredView && expiredView.payable, false);
    const stillProposed = await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: expiredRequest.id } });
    assert.equal(stillProposed.status, "PRICE_PROPOSED");

    setCommercePaymentProviderForTests(new MockCommercePaymentProvider());
    const payableOrder = await prisma.commerceOrder.create({
      data: {
        customerId: user.id,
        merchantId: gweruShop.id,
        checkoutId: gweruRequest.id,
        status: "MERCHANT_PENDING",
        paymentStatus: "PENDING",
        paymentMethod: "ECOCASH",
        subtotalCents: 500,
        deliveryFeeCents: 170,
        serviceFeeCents: 0,
        totalCents: 670,
        deliveryLabel: GWERU.label,
        deliveryLatitude: GWERU.lat,
        deliveryLongitude: GWERU.lng
      }
    });
    orderIds.push(payableOrder.id);
    await throwsNotPayable(() =>
      initiateMobileMoneyPaymentForOrder({
        commerceOrderId: payableOrder.id,
        payerPhoneRaw: "0771234567",
        paymentMethod: CommercePaymentMethod.ECOCASH
      })
    );
    await throwsNotPayable(() => payCustomerEcoCash(user.id, payableOrder.id, "0771234567"));
    await throwsNotPayable(() => switchOrderToCashOnDelivery(payableOrder.id));
    const afterPay = await prisma.commerceOrder.findUniqueOrThrow({ where: { id: payableOrder.id } });
    assert.notEqual(afterPay.paymentStatus, "DUE_ON_DELIVERY");
    assert.equal(await prisma.commercePaymentAttempt.count({ where: { commerceOrderId: payableOrder.id } }), 0);
    assert.equal(await prisma.gig.count(), gigsBefore);
    assert.equal(await prisma.seller.count(), sellersBefore);
    assert.equal(await prisma.sellerOffer.count(), sellerOffersBefore);
    assert.equal(await prisma.sellerFulfillment.count(), sellerFulfillmentsBefore);
    assert.equal(await prisma.sellerPaymentAttempt.count(), sellerPaymentsBefore);
    assert.equal(await prisma.sellerLedgerEntry.count(), sellerLedgerBefore);

    console.log("quote proposal phase 2b.1 ok");
  } finally {
    if (orderIds.length) {
      await prisma.commerceOrder.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (checkoutIds.length) {
      await prisma.commerceCheckout.deleteMany({ where: { id: { in: checkoutIds } } });
    }
    if (merchantIds.length) {
      await prisma.merchant.deleteMany({ where: { id: { in: merchantIds } } });
    }
    if (catalogIds.length) {
      await prisma.catalogProduct.deleteMany({ where: { id: { in: catalogIds } } });
    }
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
