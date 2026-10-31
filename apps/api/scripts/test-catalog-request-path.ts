/**
 * Phase C1 — a customer can request the DUTS catalog before any merchant is nearby.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/config/prisma.js";
import { createCatalogProduct, linkCatalogProductToMerchant } from "../src/modules/commerce/catalog.service.js";
import { proposeMerchantPriceForCheckout } from "../src/modules/commerce/quote-proposal.service.js";
import { handleCustomerWhatsAppMessage } from "../src/modules/whatsapp/customer-handler.js";
import { MockWhatsAppProvider, setWhatsAppProviderForTests } from "../src/modules/whatsapp/provider.js";
import { supportedPackagePricingCityFromText } from "@gigflow/shared";

const root = dirname(fileURLToPath(import.meta.url));
const GWERU = { latitude: -19.455, longitude: 29.812 };
const HARARE = { latitude: -17.8292, longitude: 31.0522 };
const BULAWAYO = { latitude: -20.15, longitude: 28.58 };

function source(rel: string) {
  return readFileSync(resolve(root, rel), "utf8");
}

function zw(seed: number) {
  return `+2637${String(seed).padStart(8, "0").slice(-8)}`;
}

async function main() {
  const handler = source("../src/modules/whatsapp/customer-handler.ts");
  assert.match(handler, /matchPublicCatalogDemand/);
  assert.doesNotMatch(handler, /No nearby shop has/);
  assert.doesNotMatch(handler, /at nearby shops right now/);
  assert.doesNotMatch(handler, /couldn't find one nearby shop/);
  assert.match(handler, /buildOneStoreBasket/);
  assert.match(handler, /acceptUnresolvedTextRequest/);
  assert.equal(supportedPackagePricingCityFromText("Senga, Gweru"), "GWERU");
  assert.equal(supportedPackagePricingCityFromText("Avondale, Harare"), "HARARE");
  assert.equal(supportedPackagePricingCityFromText("Bulawayo"), null);

  const stamp = Date.now() % 10_000_000;
  const phones: string[] = [];
  const catalogIds: string[] = [];
  const merchantIds: string[] = [];
  const mock = new MockWhatsAppProvider();
  setWhatsAppProviderForTests(mock);
  let n = 0;
  const sellersBefore = await prisma.seller.count();
  const gigsBefore = await prisma.gig.count();

  function phone() {
    const value = zw(stamp + n);
    n += 1;
    phones.push(value);
    return value;
  }

  async function catalog(name: string) {
    const row = await createCatalogProduct({ name, category: "Groceries", sizeLabel: "1" });
    catalogIds.push(row.id);
    return row;
  }

  async function say(from: string, text: string, location?: { latitude: number; longitude: number }) {
    mock.sent.length = 0;
    await handleCustomerWhatsAppMessage({
      providerMessageId: `c1-${stamp}-${n}-${text.slice(0, 12)}`,
      from,
      text,
      location
    });
    n += 1;
    return mock.sent.map((message) => message.body).join("\n");
  }

  try {
    const cola = await catalog(`C1 Cola ${stamp}`);
    const gweruPhone = phone();
    const asked = await say(gweruPhone, `do you have ${cola.name}`);
    assert.match(asked, /you can request/i);
    assert.doesNotMatch(asked, /nearby shop/i);
    assert.doesNotMatch(asked, /\$\d/);
    assert.equal(await prisma.commerceCheckout.count({ where: { customerWhatsAppPhone: gweruPhone } }), 0);

    const priced = await say(gweruPhone, `how much is ${cola.name}`);
    assert.match(priced, /confirm the price/i);
    assert.doesNotMatch(priced, /\$\d/);

    const requested = await say(gweruPhone, cola.name);
    assert.match(requested, /We've got your request/);
    assert.doesNotMatch(requested, /nearby shop/i);
    const located = await say(gweruPhone, "", GWERU);
    assert.match(located, /checking availability and prices/i);
    const gweruCheckout = await prisma.commerceCheckout.findFirstOrThrow({
      where: { customerWhatsAppPhone: gweruPhone },
      include: { lines: true }
    });
    assert.equal(gweruCheckout.validationFixture, false);
    assert.equal(gweruCheckout.status, "AWAITING_FULFILLMENT");
    assert.equal(gweruCheckout.lines[0]?.catalogProductId, cola.id);
    assert.equal(gweruCheckout.lines[0]?.quantity, 1);
    assert.equal(gweruCheckout.lines[0]?.unitPriceCents, null);
    assert.equal(gweruCheckout.itemsSubtotalCents, 0);
    assert.equal(gweruCheckout.totalCents, 0);
    assert.ok(gweruCheckout.deliveryFeeCents > 0);
    assert.ok(gweruCheckout.packageClass);
    const deliveryFee = gweruCheckout.deliveryFeeCents;
    assert.equal(await prisma.commerceOrder.count({ where: { checkoutId: gweruCheckout.id } }), 0);
    assert.equal(await prisma.commercePaymentAttempt.count({ where: { commerceCheckoutId: gweruCheckout.id } }), 0);
    assert.equal(gweruCheckout.linkedDeliveryGigId, null);

    const hararePhone = phone();
    await say(hararePhone, cola.name);
    await say(hararePhone, "", HARARE);
    const harareCheckout = await prisma.commerceCheckout.findFirstOrThrow({
      where: { customerWhatsAppPhone: hararePhone },
      include: { lines: true }
    });
    assert.equal(harareCheckout.status, "AWAITING_FULFILLMENT");
    assert.equal(harareCheckout.lines[0]?.catalogProductId, cola.id);

    const typedPhone = phone();
    await say(typedPhone, cola.name);
    const typed = await say(typedPhone, "Senga, Gweru");
    assert.doesNotMatch(typed, /nearby shop/i);
    const typedCheckout = await prisma.commerceCheckout.findFirstOrThrow({
      where: { customerWhatsAppPhone: typedPhone }
    });
    assert.equal(typedCheckout.status, "AWAITING_FULFILLMENT");
    assert.equal(typedCheckout.deliveryFeeCents, deliveryFee);

    const outsidePhone = phone();
    await say(outsidePhone, cola.name);
    const outside = await say(outsidePhone, "", BULAWAYO);
    assert.match(outside, /not delivering there yet/i);
    assert.equal(await prisma.commerceCheckout.count({ where: { customerWhatsAppPhone: outsidePhone } }), 0);

    const unknownPhone = phone();
    const unknown = await say(unknownPhone, `do you have not-a-duts-product-${stamp}`);
    assert.match(unknown, /couldn't identify/i);
    assert.doesNotMatch(unknown, /nearby shop/i);

    const orange = await catalog(`Shared Cola ${stamp} Orange`);
    const cream = await catalog(`Shared Cola ${stamp} Cream`);
    const ambiguousPhone = phone();
    const ambiguous = await say(ambiguousPhone, `Shared Cola ${stamp}`);
    assert.match(ambiguous, /Which /);
    assert.match(ambiguous, /Orange/);
    assert.match(ambiguous, /Cream/);
    assert.doesNotMatch(ambiguous, /nearby shop/i);
    assert.doesNotMatch(ambiguous, /\$\d/);
    const chosen = await say(ambiguousPhone, "1");
    assert.match(chosen, /Shared Cola/);
    assert.doesNotMatch(chosen, /nearby shop/i);

    const bread = await catalog(`C1 Bread ${stamp}`);
    const drink = await catalog(`C1 Drink ${stamp}`);
    const basketPhone = phone();
    const basket = await say(basketPhone, `${bread.name} and ${drink.name}`);
    assert.match(basket, new RegExp(bread.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(basket, new RegExp(drink.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(basket, /nearby shop/i);

    const far = await prisma.merchant.create({
      data: {
        name: `C1 Far ${stamp}`,
        contactName: "Tester",
        phone: zw(stamp + 82),
        whatsappPhone: zw(stamp + 83),
        locationLabel: "Gweru",
        latitude: GWERU.latitude + 0.2,
        longitude: GWERU.longitude,
        category: "TUCK_SHOP"
      }
    });
    merchantIds.push(far.id);
    await linkCatalogProductToMerchant(far.id, {
      catalogProductId: cola.id,
      priceCents: 250,
      currency: "usd",
      available: true
    });
    const proposed = await proposeMerchantPriceForCheckout(gweruCheckout.id);
    assert.equal(proposed.outcome, "PROPOSED");
    const repriced = await prisma.commerceCheckout.findUniqueOrThrow({ where: { id: gweruCheckout.id } });
    assert.equal(repriced.status, "PRICE_PROPOSED");
    assert.equal(repriced.deliveryFeeCents, deliveryFee);
    assert.equal(repriced.itemsSubtotalCents, 250);
    assert.equal(repriced.totalCents, deliveryFee + 250);
    assert.equal(await prisma.commerceOrder.count({ where: { checkoutId: gweruCheckout.id } }), 0);
    assert.equal(await prisma.commercePaymentAttempt.count({ where: { commerceCheckoutId: gweruCheckout.id } }), 0);

    const nearPhone = phone();
    const shop = await prisma.merchant.create({
      data: {
        name: `C1 Shop ${stamp}`,
        contactName: "Tester",
        phone: zw(stamp + 80),
        whatsappPhone: zw(stamp + 81),
        locationLabel: "Gweru",
        latitude: GWERU.latitude,
        longitude: GWERU.longitude,
        category: "TUCK_SHOP"
      }
    });
    merchantIds.push(shop.id);
    await linkCatalogProductToMerchant(shop.id, {
      catalogProductId: cola.id,
      priceCents: 200,
      currency: "usd",
      available: true
    });
    await say(nearPhone, cola.name);
    const nearQuote = await say(nearPhone, "", GWERU);
    assert.match(nearQuote, /\$2\.00/);
    assert.equal(await prisma.commerceCheckout.count({ where: { customerWhatsAppPhone: nearPhone } }), 0);
    assert.equal(await prisma.gig.count(), gigsBefore);
    assert.equal(await prisma.seller.count(), sellersBefore);
    console.log("catalog request path c1 ok");
  } finally {
    const customers = phones.length
      ? await prisma.commerceCustomer.findMany({ where: { whatsappPhone: { in: phones } }, select: { id: true } })
      : [];
    const customerIds = customers.map((row) => row.id);
    if (customerIds.length) {
      await prisma.commercePaymentAttempt.deleteMany({ where: { commerceOrder: { commerceCustomerId: { in: customerIds } } } });
      await prisma.commerceOrder.deleteMany({ where: { commerceCustomerId: { in: customerIds } } });
      await prisma.commerceCheckout.deleteMany({ where: { commerceCustomerId: { in: customerIds } } });
      await prisma.whatsAppConversation.deleteMany({ where: { commerceCustomerId: { in: customerIds } } });
      await prisma.commerceCustomer.deleteMany({ where: { id: { in: customerIds } } });
    }
    if (merchantIds.length) await prisma.merchant.deleteMany({ where: { id: { in: merchantIds } } });
    if (catalogIds.length) await prisma.catalogProduct.deleteMany({ where: { id: { in: catalogIds } } });
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
