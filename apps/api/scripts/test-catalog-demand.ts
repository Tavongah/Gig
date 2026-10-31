/**
 * Phase C2B — app catalog demand uses one signed-in checkout entry.
 * A complete nearby shop stays on the priced cart. Otherwise Gweru/Harare
 * persists one unresolved checkout and calls the existing proposer once.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AppError } from "../src/lib/errors.js";
import { prisma } from "../src/config/prisma.js";
import { createCatalogProduct, linkCatalogProductToMerchant } from "../src/modules/commerce/catalog.service.js";
import {
  browseNearbyProducts,
  checkoutCatalogDemand,
  getCustomerCommerceOrder,
  listCustomerCommerceOrders
} from "../src/modules/commerce/customer-commerce.service.js";
import { assertCheckoutPayable } from "../src/modules/commerce/unresolved-checkout.service.js";
import { approveProposedQuote, handoffApprovedQuote } from "../src/modules/commerce/quote-approval.service.js";

const root = dirname(fileURLToPath(import.meta.url));
const GWERU = { lat: -19.455, lng: 29.812, label: "Senga, Gweru" };
const HARARE = { lat: -17.8292, lng: 31.0522, label: "Avondale, Harare" };
const BULAWAYO = { lat: -20.15, lng: 28.58, label: "Bulawayo CBD" };
const FAR_GWERU = { lat: -19.62, lng: 29.812 };

function source(rel: string) {
  return readFileSync(resolve(root, rel), "utf8");
}

async function main() {
  const handler = source("../src/modules/whatsapp/customer-handler.ts");
  const routes = source("../src/modules/commerce/customer-commerce.routes.ts");
  assert.doesNotMatch(handler, /checkoutCatalogDemand/);
  assert.match(routes, /\/cart\/catalog-demand/);
  assert.match(routes, /requireCustomer/);

  const stamp = Date.now();
  const sellersBefore = await prisma.seller.count();
  const gigsBefore = await prisma.gig.count();
  const user = await prisma.user.create({
    data: { email: `c2b-${stamp}@duts.test`, fullName: "Catalog Demand", phoneNumber: `+26377${String(stamp).slice(-7)}` }
  });
  const other = await prisma.user.create({
    data: { email: `c2b-other-${stamp}@duts.test`, fullName: "Other Customer", phoneNumber: `+26378${String(stamp).slice(-7)}` }
  });
  const catalogIds: string[] = [];
  const merchantIds: string[] = [];

  async function catalog(name: string) {
    const row = await createCatalogProduct({ name: `${name} ${stamp}`, category: "Groceries", sizeLabel: "1" });
    catalogIds.push(row.id);
    return row;
  }

  async function shop(name: string, lat: number, lng: number, label: string) {
    const row = await prisma.merchant.create({
      data: {
        name: `${name} ${stamp}`,
        contactName: "Tester",
        phone: `+26371${String(stamp + merchantIds.length).slice(-7)}`,
        whatsappPhone: `+26372${String(stamp + merchantIds.length).slice(-7)}`,
        locationLabel: label,
        latitude: lat,
        longitude: lng,
        category: "TUCK_SHOP"
      }
    });
    merchantIds.push(row.id);
    return row;
  }

  function demand(userId: string, lat: number, lng: number, label: string, lines: Array<{ id: string; quantity: number }>, flavor?: { flavorOptionId: string; flavorPreference: "SPECIFIC" }) {
    return checkoutCatalogDemand({
      userId,
      lat,
      lng,
      deliveryLabel: label,
      items: lines.map((line) => ({
        catalogProductId: line.id,
        quantity: line.quantity,
        flavorOptionId: flavor?.flavorOptionId ?? null,
        flavorPreference: flavor?.flavorPreference ?? null
      }))
    });
  }

  try {
    await assert.rejects(
      () => checkoutCatalogDemand({ userId: "", lat: GWERU.lat, lng: GWERU.lng, deliveryLabel: GWERU.label, items: [] }),
      (error: unknown) => error instanceof AppError && error.code === "AUTH_REQUIRED"
    );

    const bread = await catalog("C2B Bread");
    const mazoe = await catalog("C2B Mazoe");
    const paste = await catalog("C2B Toothpaste");
    const basket = [
      { id: bread.id, quantity: 2 },
      { id: mazoe.id, quantity: 1 },
      { id: paste.id, quantity: 1 }
    ];

    const browsed = await browseNearbyProducts({ q: bread.name });
    assert.ok(browsed.products.some((row) => row.catalogProductId === bread.id && row.purchasable === false && row.fromPriceCents == null));

    const gweru = await demand(user.id, GWERU.lat, GWERU.lng, GWERU.label, basket);
    assert.equal(gweru.fulfillment, "UNRESOLVED");
    if (gweru.fulfillment !== "UNRESOLVED") return;
    assert.equal(gweru.status, "AWAITING_FULFILLMENT");
    assert.equal(gweru.payable, false);
    assert.equal(gweru.itemsSubtotalCents, 0);
    assert.equal(gweru.totalCents, 0);
    assert.ok(gweru.deliveryFeeCents > 0);
    const deliveryFee = gweru.deliveryFeeCents;
    const gweruRow = await prisma.commerceCheckout.findUniqueOrThrow({
      where: { id: gweru.checkoutId },
      include: { lines: true, orders: true, paymentAttempts: true }
    });
    assert.equal(gweruRow.validationFixture, false);
    assert.equal(gweruRow.orderSource, "APP");
    assert.equal(gweruRow.customerId, user.id);
    assert.equal(gweruRow.itemsSubtotalCents, 0);
    assert.equal(gweruRow.totalCents, 0);
    assert.equal(gweruRow.deliveryFeeCents, deliveryFee);
    assert.equal(gweruRow.orders.length, 0);
    assert.equal(gweruRow.paymentAttempts.length, 0);
    assert.equal(gweruRow.linkedDeliveryGigId, null);
    assert.deepEqual(
      gweruRow.lines.map((line) => [line.catalogProductId, line.quantity, line.unitPriceCents, line.sourceProductId, line.fulfillmentStatus]).sort(),
      [
        [bread.id, 2, null, null, "AWAITING_SOURCE"],
        [mazoe.id, 1, null, null, "AWAITING_SOURCE"],
        [paste.id, 1, null, null, "AWAITING_SOURCE"]
      ].sort()
    );
    const customer = await prisma.commerceCustomer.findFirstOrThrow({ where: { userId: user.id } });
    assert.equal(gweruRow.commerceCustomerId, customer.id);
    assert.throws(() => assertCheckoutPayable(gweruRow.status), (error: unknown) => error instanceof AppError && error.code === "REQUEST_NOT_PAYABLE");

    const harare = await demand(user.id, HARARE.lat, HARARE.lng, HARARE.label, basket);
    assert.equal(harare.fulfillment, "UNRESOLVED");
    if (harare.fulfillment !== "UNRESOLVED") return;
    assert.equal(harare.status, "AWAITING_FULFILLMENT");
    assert.notEqual(harare.checkoutId, gweru.checkoutId);
    assert.ok(harare.lines?.every((line) => basket.some((item) => item.id === line.catalogProductId)));

    const beforeBulawayo = await prisma.commerceCheckout.count({ where: { customerId: user.id } });
    await assert.rejects(
      () => demand(user.id, BULAWAYO.lat, BULAWAYO.lng, BULAWAYO.label, basket),
      (error: unknown) => error instanceof AppError && error.code === "OUTSIDE_DELIVERY_TERRITORY"
    );
    assert.equal(await prisma.commerceCheckout.count({ where: { customerId: user.id } }), beforeBulawayo);

    await assert.rejects(
      () =>
        demand(user.id, GWERU.lat, GWERU.lng, GWERU.label, [{ id: bread.id, quantity: 1 }], {
          flavorOptionId: "11111111-1111-4111-8111-111111111111",
          flavorPreference: "SPECIFIC"
        }),
      (error: unknown) => error instanceof AppError && error.code === "FLAVOR_UNRESOLVED"
    );

    const far = await shop("C2B Far", FAR_GWERU.lat, FAR_GWERU.lng, "Gweru");
    await linkCatalogProductToMerchant(far.id, { catalogProductId: bread.id, priceCents: 250, currency: "usd", available: true });
    const partial = await demand(user.id, GWERU.lat, GWERU.lng, GWERU.label, [
      { id: bread.id, quantity: 1 },
      { id: paste.id, quantity: 1 }
    ]);
    assert.equal(partial.fulfillment, "UNRESOLVED");
    if (partial.fulfillment !== "UNRESOLVED") return;
    assert.equal(partial.status, "AWAITING_FULFILLMENT");
    assert.equal(partial.totalCents, 0);
    assert.equal(await prisma.commerceOrder.count({ where: { checkoutId: partial.checkoutId } }), 0);

    await linkCatalogProductToMerchant(far.id, { catalogProductId: mazoe.id, priceCents: 180, currency: "usd", available: true });
    await linkCatalogProductToMerchant(far.id, { catalogProductId: paste.id, priceCents: 90, currency: "usd", available: true });
    const priced = await demand(user.id, GWERU.lat, GWERU.lng, GWERU.label, basket);
    assert.equal(priced.fulfillment, "UNRESOLVED");
    if (priced.fulfillment !== "UNRESOLVED") return;
    assert.equal(priced.checkoutId, gweru.checkoutId);
    assert.equal(priced.status, "PRICE_PROPOSED");
    assert.equal(priced.payable, false);
    assert.equal(priced.deliveryFeeCents, deliveryFee);
    assert.equal(priced.itemsSubtotalCents, 250 * 2 + 180 + 90);
    assert.equal(priced.totalCents, priced.itemsSubtotalCents + deliveryFee);
    const pricedRow = await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: priced.checkoutId }, include: { lines: true, orders: true } });
    assert.equal(pricedRow.orders.length, 0);
    assert.ok(pricedRow.lines.every((line) => line.unitPriceCents != null && line.sourceProductId && line.sourceMerchantId === far.id));
    assert.equal(await prisma.commerceNotificationAttempt.count({ where: { commerceOrder: { checkoutId: priced.checkoutId } } }), 0);

    const expiring = await demand(user.id, GWERU.lat, GWERU.lng, GWERU.label, [{ id: bread.id, quantity: 4 }]);
    assert.equal(expiring.fulfillment, "UNRESOLVED");
    if (expiring.fulfillment !== "UNRESOLVED") return;
    assert.equal(expiring.status, "PRICE_PROPOSED");
    const expiringRow = await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: expiring.checkoutId } });
    await prisma.commerceCheckout.update({ where: { id: expiring.checkoutId }, data: { quoteExpiresAt: new Date(Date.now() - 1000) } });
    await assert.rejects(
      () =>
        approveProposedQuote({
          checkoutId: expiring.checkoutId,
          approvalId: expiringRow.approvalId!,
          quoteVersion: expiringRow.quoteVersion,
          actor: { userId: user.id }
        }),
      (error: unknown) => error instanceof AppError && error.code === "QUOTE_EXPIRED"
    );

    const changing = await demand(user.id, GWERU.lat, GWERU.lng, GWERU.label, [{ id: mazoe.id, quantity: 5 }]);
    assert.equal(changing.fulfillment, "UNRESOLVED");
    if (changing.fulfillment !== "UNRESOLVED") return;
    assert.equal(changing.status, "PRICE_PROPOSED");
    const changingRow = await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: changing.checkoutId } });
    await prisma.product.updateMany({ where: { merchantId: far.id, catalogProductId: mazoe.id }, data: { priceCents: 999 } });
    await assert.rejects(
      () =>
        approveProposedQuote({
          checkoutId: changing.checkoutId,
          approvalId: changingRow.approvalId!,
          quoteVersion: changingRow.quoteVersion,
          actor: { userId: user.id }
        }),
      (error: unknown) => error instanceof AppError && error.code === "QUOTE_SOURCE_CHANGED"
    );
    await prisma.product.updateMany({ where: { merchantId: far.id, catalogProductId: mazoe.id }, data: { priceCents: 180 } });

    const harareShop = await shop("C2B Harare", -17.98, 31.0522, "Harare");
    await linkCatalogProductToMerchant(harareShop.id, { catalogProductId: paste.id, priceCents: 110, currency: "usd", available: true });
    const eco = await demand(user.id, HARARE.lat, HARARE.lng, HARARE.label, [{ id: paste.id, quantity: 6 }]);
    assert.equal(eco.fulfillment, "UNRESOLVED");
    if (eco.fulfillment !== "UNRESOLVED") return;
    assert.equal(eco.status, "PRICE_PROPOSED");
    const ecoRow = await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: eco.checkoutId } });
    await approveProposedQuote({
      checkoutId: eco.checkoutId,
      approvalId: ecoRow.approvalId!,
      quoteVersion: ecoRow.quoteVersion,
      actor: { userId: user.id }
    });
    const paid = await handoffApprovedQuote({
      checkoutId: eco.checkoutId,
      approvalId: ecoRow.approvalId!,
      quoteVersion: ecoRow.quoteVersion,
      paymentMethod: "ECOCASH",
      payerPhone: "0771234567",
      actor: { userId: user.id }
    });
    assert.equal(await prisma.commercePaymentAttempt.count({ where: { commerceOrderId: paid.orderId } }), 1);
    assert.equal(await prisma.commerceOrder.count({ where: { checkoutId: eco.checkoutId } }), 1);

    const near = await shop("C2B Near", GWERU.lat, GWERU.lng, "Gweru");
    await linkCatalogProductToMerchant(near.id, { catalogProductId: bread.id, priceCents: 200, currency: "usd", available: true });
    await linkCatalogProductToMerchant(near.id, { catalogProductId: mazoe.id, priceCents: 150, currency: "usd", available: true });
    await linkCatalogProductToMerchant(near.id, { catalogProductId: paste.id, priceCents: 100, currency: "usd", available: true });
    const beforeFast = await prisma.commerceCheckout.count({ where: { customerId: user.id } });
    const ordersBeforeFast = await prisma.commerceOrder.count({ where: { customerId: user.id } });
    const fast = await demand(user.id, GWERU.lat, GWERU.lng, GWERU.label, [
      { id: bread.id, quantity: 2 },
      { id: mazoe.id, quantity: 3 },
      { id: paste.id, quantity: 1 }
    ]);
    assert.equal(fast.fulfillment, "MERCHANT");
    if (fast.fulfillment !== "MERCHANT") return;
    assert.equal(fast.quote.merchant.id, near.id);
    assert.equal(fast.cartLines.find((line) => line.catalogProductId === bread.id)?.unitPriceCents, 200);
    assert.equal(fast.cartLines.find((line) => line.catalogProductId === mazoe.id)?.unitPriceCents, 150);
    assert.equal(await prisma.commerceCheckout.count({ where: { customerId: user.id } }), beforeFast);
    assert.equal(await prisma.commerceOrder.count({ where: { customerId: user.id } }), ordersBeforeFast);

    const listed = await listCustomerCommerceOrders(user.id);
    assert.ok(listed.orders.some((order) => order.id === harare.checkoutId && order.status === "AWAITING_FULFILLMENT" && order.totalCents === 0));
    assert.ok(listed.orders.some((order) => order.id === priced.checkoutId && order.status === "PRICE_PROPOSED" && order.totalCents === priced.totalCents));
    await prisma.commerceCheckout.update({ where: { id: partial.checkoutId }, data: { validationFixture: true } });
    const hidden = await listCustomerCommerceOrders(user.id);
    assert.equal(hidden.orders.some((order) => order.id === partial.checkoutId), false);
    await prisma.commerceCheckout.update({ where: { id: partial.checkoutId }, data: { validationFixture: false } });

    await assert.rejects(
      () => getCustomerCommerceOrder(other.id, priced.checkoutId),
      (error: unknown) => error instanceof AppError && error.code === "ORDER_NOT_FOUND"
    );
    await assert.rejects(
      () =>
        approveProposedQuote({
          checkoutId: priced.checkoutId,
          approvalId: pricedRow.approvalId!,
          quoteVersion: pricedRow.quoteVersion,
          actor: { userId: other.id }
        }),
      (error: unknown) => error instanceof AppError && error.code === "ORDER_NOT_FOUND"
    );
    await assert.rejects(
      () =>
        approveProposedQuote({
          checkoutId: priced.checkoutId,
          approvalId: pricedRow.approvalId!,
          quoteVersion: pricedRow.quoteVersion + 1,
          actor: { userId: user.id }
        }),
      (error: unknown) => error instanceof AppError && error.code === "QUOTE_STALE_APPROVAL"
    );

    const approved = await approveProposedQuote({
      checkoutId: priced.checkoutId,
      approvalId: pricedRow.approvalId!,
      quoteVersion: pricedRow.quoteVersion,
      actor: { userId: user.id }
    });
    assert.equal(approved.status, "CUSTOMER_APPROVED");
    const again = await approveProposedQuote({
      checkoutId: priced.checkoutId,
      approvalId: pricedRow.approvalId!,
      quoteVersion: pricedRow.quoteVersion,
      actor: { userId: user.id }
    });
    assert.equal(again.status, "CUSTOMER_APPROVED");
    assert.equal(again.quoteVersion, pricedRow.quoteVersion);
    const approvedList = await listCustomerCommerceOrders(user.id);
    assert.ok(approvedList.orders.some((order) => order.id === priced.checkoutId && order.status === "CUSTOMER_APPROVED"));
    assert.equal(await prisma.commerceOrder.count({ where: { checkoutId: priced.checkoutId } }), 0);

    const cod = await handoffApprovedQuote({
      checkoutId: priced.checkoutId,
      approvalId: pricedRow.approvalId!,
      quoteVersion: pricedRow.quoteVersion,
      paymentMethod: "CASH",
      actor: { userId: user.id }
    });
    assert.equal(cod.paymentStatus, "DUE_ON_DELIVERY");
    assert.equal(await prisma.commerceOrder.count({ where: { checkoutId: priced.checkoutId } }), 1);
    assert.equal((await prisma.commerceOrder.findUniqueOrThrow({ where: { id: cod.orderId } })).linkedDeliveryGigId, null);
    assert.equal(await prisma.gig.count(), gigsBefore);
    assert.equal(await prisma.seller.count(), sellersBefore);
    assert.equal(await prisma.gig.count(), gigsBefore);
    console.log("catalog demand c2b ok");
  } finally {
    const userIds = [user.id, other.id];
    await prisma.commercePaymentAttempt.deleteMany({ where: { commerceOrder: { customerId: { in: userIds } } } });
    await prisma.commerceOrder.deleteMany({ where: { customerId: { in: userIds } } });
    await prisma.commerceCheckout.deleteMany({ where: { customerId: { in: userIds } } });
    await prisma.commerceCustomer.deleteMany({ where: { userId: { in: userIds } } });
    if (merchantIds.length) await prisma.merchant.deleteMany({ where: { id: { in: merchantIds } } });
    if (catalogIds.length) await prisma.catalogProduct.deleteMany({ where: { id: { in: catalogIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
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
