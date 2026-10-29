/**
 * Assisted fulfillment phase 1 — unresolved supported-city requests.
 * DB required. Does not take payment or create a merchant order for unmatched demand.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AppError } from "../src/lib/errors.js";
import { prisma } from "../src/config/prisma.js";
import { linkCatalogProductToMerchant, createCatalogProduct } from "../src/modules/commerce/catalog.service.js";
import { checkoutCart, listCustomerCommerceOrders, prepareCheckout } from "../src/modules/commerce/customer-commerce.service.js";
import { assertCheckoutPayable, acceptUnresolvedTextRequest } from "../src/modules/commerce/unresolved-checkout.service.js";
import { formatUnresolvedRequestAccepted } from "../src/modules/whatsapp/copy.js";

const root = dirname(fileURLToPath(import.meta.url));

function source(rel: string) {
  return readFileSync(resolve(root, rel), "utf8");
}

const GWERU = { lat: -19.455, lng: 29.812, label: "Senga, Gweru" };
const HARARE = { lat: -17.8292, lng: 31.0522, label: "Harare CBD" };
const BULAWAYO = { lat: -20.15, lng: 28.58, label: "Bulawayo CBD" };

async function main() {
  const schema = source("../prisma/schema.prisma");
  const service = source("../src/modules/commerce/unresolved-checkout.service.ts");
  const handler = source("../src/modules/whatsapp/customer-handler.ts");
  const payment = source("../src/modules/commerce/payments/payment.service.ts");
  const history = source("../src/modules/commerce/customer-commerce.service.ts");
  const pricing = source("../../../packages/shared/src/pilot-delivery-pricing.ts");

  assert.match(service, /AWAITING_FULFILLMENT/);
  assert.match(schema, /unitPriceCents\s+Int\?/);
  assert.doesNotMatch(service, /unitPriceCents:/);
  assert.doesNotMatch(service, /commerceOrder\.create/);
  assert.doesNotMatch(service, /commercePaymentAttempt/);
  assert.doesNotMatch(service, /notifyMerchant/);
  assert.doesNotMatch(service, /SellerOffer/);
  assert.doesNotMatch(service, /DeliveryGig/);
  assert.match(payment, /assertCheckoutPayable/);
  assert.match(service, /REQUEST_NOT_PAYABLE/);
  assert.match(history, /status: \{ notIn: \["AWAITING_FULFILLMENT", "PRICE_PROPOSED"\] \}/);
  assert.match(handler, /acceptUnresolvedTextRequest/);
  assert.match(handler, /SHOP_NOT_NEARBY/);
  assert.match(formatUnresolvedRequestAccepted(), /We've got your request/);
  assert.doesNotMatch(formatUnresolvedRequestAccepted(), /order confirmed/i);
  assert.doesNotMatch(formatUnresolvedRequestAccepted(), /pay now/i);
  assert.match(pricing, /function calculatePilotDeliveryPrice/);
  assert.throws(() => assertCheckoutPayable("AWAITING_FULFILLMENT"), (error: unknown) => {
    return error instanceof AppError && error.code === "REQUEST_NOT_PAYABLE";
  });

  const stamp = Date.now();
  const phone = `+26377${String(stamp).slice(-7)}`;
  const user = await prisma.user.create({
    data: { email: `unresolved-${stamp}@duts.test`, fullName: "Unresolved Test", phoneNumber: phone }
  });
  const near = await prisma.merchant.create({
    data: {
      name: `Gweru Near ${stamp}`,
      contactName: "Tester",
      phone: `+26371${String(stamp).slice(-7)}`,
      whatsappPhone: `+26371${String(stamp).slice(-7)}`,
      locationLabel: "Gweru",
      latitude: GWERU.lat,
      longitude: GWERU.lng,
      category: "TUCK_SHOP"
    }
  });
  const far = await prisma.merchant.create({
    data: {
      name: `Far Shop ${stamp}`,
      contactName: "Tester",
      phone: `+1203555${String(stamp).slice(-4)}`,
      whatsappPhone: `+1203555${String(stamp).slice(-4)}`,
      locationLabel: "Test",
      latitude: 41.5,
      longitude: -72.8,
      category: "TUCK_SHOP"
    }
  });
  const harareShop = await prisma.merchant.create({
    data: {
      name: `Harare Near ${stamp}`,
      contactName: "Tester",
      phone: `+26378${String(stamp).slice(-7)}`,
      whatsappPhone: `+26378${String(stamp).slice(-7)}`,
      locationLabel: "Harare",
      latitude: HARARE.lat,
      longitude: HARARE.lng,
      category: "TUCK_SHOP"
    }
  });

  const checkoutIds: string[] = [];
  try {
    const stocked = await createCatalogProduct({
      name: `Phase1 Stocked Cola ${stamp}`,
      category: "Drinks",
      sizeLabel: "2L"
    });
    const unmet = await createCatalogProduct({
      name: `Phase1 Unmet Cola ${stamp}`,
      category: "Drinks",
      sizeLabel: "2L"
    });
    const twinA = await createCatalogProduct({
      name: `Phase1 Twin Snack A ${stamp}`,
      category: "Snacks",
      sizeLabel: "50g"
    });
    const twinB = await createCatalogProduct({
      name: `Phase1 Twin Snack B ${stamp}`,
      category: "Snacks",
      sizeLabel: "50g"
    });
    const nearOffer = await linkCatalogProductToMerchant(near.id, {
      catalogProductId: stocked.id,
      priceCents: 250,
      currency: "usd",
      available: true
    });
    const harareOffer = await linkCatalogProductToMerchant(harareShop.id, {
      catalogProductId: stocked.id,
      priceCents: 250,
      currency: "usd",
      available: true
    });
    const farOffer = await linkCatalogProductToMerchant(far.id, {
      catalogProductId: unmet.id,
      priceCents: 999,
      currency: "usd",
      available: true
    });

    const available = await prepareCheckout({
      userId: user.id,
      lat: GWERU.lat,
      lng: GWERU.lng,
      deliveryLabel: GWERU.label,
      lines: [{ productId: nearOffer.id, quantity: 1 }]
    });
    assert.equal("acceptedRequest" in available && available.acceptedRequest, false);
    assert.equal("merchant" in available ? available.merchant.id : "", near.id);
    const awaitingAfterAvailable = await prisma.commerceCheckout.count({
      where: { customerId: user.id, status: "AWAITING_FULFILLMENT" }
    });
    assert.equal(awaitingAfterAvailable, 0, "Gweru merchant available must stay a normal quote");

    const harareAvailable = await prepareCheckout({
      userId: user.id,
      lat: HARARE.lat,
      lng: HARARE.lng,
      deliveryLabel: HARARE.label,
      lines: [{ productId: harareOffer.id, quantity: 1 }]
    });
    assert.equal("acceptedRequest" in harareAvailable && harareAvailable.acceptedRequest, false);

    const before = await prisma.commerceCheckout.count({ where: { customerId: user.id } });
    await assert.rejects(
      () =>
        prepareCheckout({
          lat: GWERU.lat,
          lng: GWERU.lng,
          deliveryLabel: GWERU.label,
          lines: [{ productId: farOffer.id, quantity: 1 }]
        }),
      (error: unknown) => error instanceof AppError && error.code === "SHOP_NOT_NEARBY"
    );
    assert.equal(await prisma.commerceCheckout.count({ where: { customerId: user.id } }), before);

    await assert.rejects(
      () =>
        prepareCheckout({
          userId: user.id,
          lat: GWERU.lat,
          lng: GWERU.lng,
          deliveryLabel: GWERU.label,
          lines: [{ productId: "00000000-0000-4000-8000-000000000000", quantity: 1 }]
        }),
      (error: unknown) => error instanceof AppError && error.code !== "REQUEST_NOT_PAYABLE"
    );
    assert.equal(
      await prisma.commerceCheckout.count({ where: { customerId: user.id, status: "AWAITING_FULFILLMENT" } }),
      0
    );

    await assert.rejects(
      () =>
        prepareCheckout({
          userId: user.id,
          lat: BULAWAYO.lat,
          lng: BULAWAYO.lng,
          deliveryLabel: BULAWAYO.label,
          lines: [{ productId: farOffer.id, quantity: 2 }]
        }),
      (error: unknown) => error instanceof AppError && error.code === "SHOP_NOT_NEARBY"
    );

    const gweru = await checkoutCart({
      userId: user.id,
      lat: GWERU.lat,
      lng: GWERU.lng,
      deliveryLabel: GWERU.label,
      lines: [{ productId: farOffer.id, quantity: 1 }],
      paymentMethod: "CASH"
    });
    assert.equal(gweru.acceptedRequest, true);
    assert.equal(gweru.payable, false);
    assert.equal(gweru.order, null);
    checkoutIds.push(gweru.checkout.id);

    const replay = await checkoutCart({
      userId: user.id,
      lat: GWERU.lat,
      lng: GWERU.lng,
      deliveryLabel: GWERU.label,
      lines: [{ productId: farOffer.id, quantity: 1 }],
      paymentMethod: "ECOCASH",
      customerPhone: phone
    });
    assert.equal(replay.checkout.id, gweru.checkout.id);

    const harare = await checkoutCart({
      userId: user.id,
      lat: HARARE.lat,
      lng: HARARE.lng,
      deliveryLabel: HARARE.label,
      lines: [{ productId: farOffer.id, quantity: 1 }],
      paymentMethod: "CASH"
    });
    assert.equal(harare.acceptedRequest, true);
    checkoutIds.push(harare.checkout.id);
    assert.notEqual(harare.checkout.id, gweru.checkout.id);

    const row = await prisma.commerceCheckout.findUniqueOrThrow({
      where: { id: gweru.checkout.id },
      include: { lines: true, orders: true, paymentAttempts: true, pickupStops: true }
    });
    assert.equal(row.status, "AWAITING_FULFILLMENT");
    assert.equal(row.orders.length, 0);
    assert.equal(row.paymentAttempts.length, 0);
    assert.equal(row.pickupStops.length, 0);
    assert.equal(row.linkedDeliveryGigId, null);
    assert.equal(row.packageClass, "MEDIUM");
    assert.equal(row.deliveryFeeCents, 130);
    assert.equal(row.itemsSubtotalCents, 0);
    assert.equal(row.totalCents, 0);
    assert.equal(row.paymentStatus, "PENDING");
    assert.equal(row.deliveryLabel, GWERU.label);
    assert.equal(row.lines.length, 1);
    assert.equal(row.lines[0]?.catalogProductId, unmet.id);
    assert.equal(row.lines[0]?.quantity, 1);
    assert.equal(row.lines[0]?.productNameSnapshot, unmet.name);
    assert.equal(row.lines[0]?.unitPriceCents, null);
    assert.equal(row.lines[0]?.fulfillmentStatus, "AWAITING_SOURCE");
    assert.notEqual(row.deliveryFeeCents, farOffer.priceCents);

    const harareRow = await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: harare.checkout.id } });
    assert.equal(harareRow.packageClass, "MEDIUM");
    assert.equal(harareRow.deliveryFeeCents, 130);
    assert.equal(harareRow.deliveryLabel, HARARE.label);

    const listed = await listCustomerCommerceOrders(user.id);
    assert.equal(
      listed.orders.some((order) => order.id === gweru.checkout.id || order.id === harare.checkout.id),
      false
    );

    const sameCount = await prisma.commerceCheckout.count({
      where: { id: { in: checkoutIds } }
    });
    assert.equal(sameCount, 2);

    const text = await acceptUnresolvedTextRequest({
      phone,
      lat: GWERU.lat,
      lng: GWERU.lng,
      deliveryLabel: GWERU.label,
      items: [{ query: unmet.name, quantity: 1 }]
    });
    assert.ok(text);
    checkoutIds.push(text.checkoutId);
    assert.equal(text.payable, false);
    assert.equal(text.merchandisePriced, false);
    assert.equal("totalCents" in text, false);
    assert.match(text.message, /confirm the total before payment/);
    const textReplay = await acceptUnresolvedTextRequest({
      phone,
      lat: GWERU.lat,
      lng: GWERU.lng,
      deliveryLabel: GWERU.label,
      items: [{ query: unmet.name, quantity: 1 }]
    });
    assert.equal(textReplay?.checkoutId, text.checkoutId);
    const textRow = await prisma.commerceCheckout.findUniqueOrThrow({
      where: { id: text.checkoutId },
      include: { lines: true, orders: true }
    });
    assert.equal(textRow.lines[0]?.quantity, 1);
    assert.equal(textRow.orders.length, 0);
    assert.equal(textRow.packageClass, "MEDIUM");

    const ambiguous = await acceptUnresolvedTextRequest({
      phone,
      lat: GWERU.lat,
      lng: GWERU.lng,
      deliveryLabel: GWERU.label,
      items: [{ query: `Phase1 Twin Snack ${stamp}`, quantity: 1 }]
    });
    assert.equal(ambiguous, null);

    const outside = await acceptUnresolvedTextRequest({
      phone,
      lat: BULAWAYO.lat,
      lng: BULAWAYO.lng,
      deliveryLabel: BULAWAYO.label,
      items: [{ query: unmet.name, quantity: 1 }]
    });
    assert.equal(outside, null);

    const attempts = await prisma.commercePaymentAttempt.count({
      where: { commerceCheckoutId: { in: checkoutIds } }
    });
    assert.equal(attempts, 0);
    const orders = await prisma.commerceOrder.count({ where: { checkoutId: { in: checkoutIds } } });
    assert.equal(orders, 0);

    console.log("unresolved supported-city request: PASS");
  } finally {
    if (checkoutIds.length) {
      await prisma.commerceCheckout.deleteMany({ where: { id: { in: checkoutIds } } });
    }
    await prisma.product.deleteMany({ where: { merchantId: { in: [near.id, far.id, harareShop.id] } } });
    await prisma.catalogProduct.deleteMany({
      where: { name: { contains: String(stamp) } }
    });
    await prisma.commerceCustomer.deleteMany({ where: { userId: user.id } });
    await prisma.commerceCustomer.deleteMany({ where: { whatsappPhone: phone } });
    await prisma.merchant.deleteMany({ where: { id: { in: [near.id, far.id, harareShop.id] } } });
    await prisma.user.delete({ where: { id: user.id } });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
