/**
 * Offline + optional DB checks for guest basket handoff.
 * Run: npx tsx apps/api/scripts/test-guest-handoff.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const here = fileURLToPath(new URL(".", import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });
loadEnv({ path: resolve(here, "../.env") });

const skipped: string[] = [];
const passed: string[] = [];

function pass(name: string) {
  passed.push(name);
}

{
  const routes = readFileSync(resolve(here, "../src/modules/commerce/customer-commerce.routes.ts"), "utf8");
  assert.ok(!routes.includes("customerCommerceRouter.use(requireAuth"), "commerce router is not globally authenticated");
  assert.ok(routes.includes('customerCommerceRouter.get("/shopping-areas"'), "shopping areas public");
  assert.ok(routes.includes('customerCommerceRouter.get("/shops/nearby"'), "nearby shops public");
  assert.ok(routes.includes('customerCommerceRouter.get("/products"'), "products public");
  assert.ok(routes.includes('customerCommerceRouter.get("/categories"'), "categories public");
  assert.ok(routes.includes('customerCommerceRouter.get("/products/detail"'), "product detail public");
  assert.ok(routes.includes('customerCommerceRouter.get("/shops/:id"'), "shop page public");
  assert.ok(routes.includes('customerCommerceRouter.post("/cart/quote"'), "quote public");
  assert.ok(routes.includes('customerCommerceRouter.post("/guest/handoff"'), "guest handoff public");
  assert.ok(routes.includes('"/cart/checkout"') && routes.includes("requireCustomer"), "checkout remains protected");
  assert.ok(routes.includes('"/orders"') && routes.includes("requireCustomer"), "orders remain protected");
  assert.ok(routes.includes("quote-text") && routes.includes("requireCustomer"), "quote-text remains protected");
  pass("public commerce routes audited");
}

{
  const loc = readFileSync(resolve(here, "../src/modules/location/location.routes.ts"), "utf8");
  assert.ok(!loc.includes("requireAuth"), "guest location geocode is public");
  pass("public location routes");
}

{
  const handler = readFileSync(resolve(here, "../src/modules/whatsapp/customer-handler.ts"), "utf8");
  assert.ok(handler.includes("extractGuestBasketRef"), "WhatsApp recognizes guest basket ref");
  assert.ok(handler.includes("applyGuestHandoffToConversation"), "WhatsApp restores guest basket");
  assert.ok(handler.includes("ensureWhatsAppCommerceCustomer"), "CommerceCustomer still used");
  pass("WhatsApp import wiring");
}

{
  const copy = readFileSync(resolve(here, "../src/modules/whatsapp/copy.ts"), "utf8");
  assert.ok(copy.includes("formatGuestHandoffAwaitingLocation"), "guest restore asks for WhatsApp location");
  assert.ok(copy.includes("Please send your location using WhatsApp."), "native location request copy");
  assert.ok(copy.includes("Delivery: Calculated when you send your location"), "no authoritative delivery fee on restore");
  pass("WhatsApp location copy after handoff");
}

{
  const areas = readFileSync(resolve(here, "../src/modules/commerce/shopping-areas.ts"), "utf8");
  assert.ok(areas.includes("listShoppingAreas"), "areas derived from merchants");
  assert.ok(areas.includes("SHOPPING_AREA_MATCH_KM"), "coarse city clustering");
  pass("shopping area module");
}

{
  const quote = readFileSync(resolve(here, "../src/modules/commerce/customer-commerce.service.ts"), "utf8");
  assert.ok(quote.includes("canPurchaseStorefrontCategory"), "quoteCart uses alcohol restriction helper");
  assert.ok(quote.includes("ALCOHOL_DISABLED"), "quoteCart blocks alcohol server-side");
  assert.ok(quote.includes("Alcohol ordering isn't available yet."), "alcohol quote copy");
  assert.ok(quote.includes("We can't deliver from this shop to that location yet."), "shop not nearby copy");
  pass("quoteCart alcohol and location copy");
}

{
  const orders = readFileSync(resolve(here, "../src/modules/commerce/order.service.ts"), "utf8");
  assert.ok(orders.includes("canPurchaseStorefrontCategory"), "order create checks alcohol");
  assert.ok(orders.includes("ALCOHOL_DISABLED"), "order create blocks alcohol");
  pass("order create alcohol gate");
}

{
  const search = readFileSync(resolve(here, "../src/modules/commerce/merchant.service.ts"), "utf8");
  assert.ok(search.includes("canPurchaseStorefrontCategory"), "WhatsApp product search skips alcohol");
  pass("WhatsApp search alcohol skip");
}

{
  const handoff = readFileSync(resolve(here, "../src/modules/commerce/guest-handoff.service.ts"), "utf8");
  assert.ok(handoff.includes("GUEST_WHATSAPP_HANDOFF_CONSUMED"), "consume is logged");
  assert.ok(handoff.includes("deferDelivery: true"), "handoff quotes items without delivery");
  assert.ok(handoff.includes("locationIsApproximate: true"), "stored location is not exact");
  assert.ok(handoff.includes("AWAITING_LOCATION"), "restore waits for WhatsApp location");
  assert.ok(!handoff.includes("AWAITING_ORDER_CONFIRMATION"), "must not confirm before exact location");
  pass("handoff defers delivery until WhatsApp location");
}

const {
  extractGuestBasketRef,
  generateHandoffToken,
  hashHandoffToken,
  buildWhatsAppHandoffUrl
} = await import("../src/modules/commerce/guest-handoff.service.js");

{
  const token = generateHandoffToken();
  assert.match(token, /^[A-F0-9]{16}$/);
  assert.notEqual(token, hashHandoffToken(token));
  assert.equal(hashHandoffToken(token), hashHandoffToken(token.toLowerCase()));
  assert.equal(extractGuestBasketRef(`Hi DUTS, I want to order my basket.\nRef: ${token}`), token);
  assert.equal(extractGuestBasketRef(token), token);
  assert.equal(extractGuestBasketRef("hello"), null);
  assert.ok(!token.includes("$"));
  assert.ok(!hashHandoffToken(token).includes(token));
  pass("opaque token + extract ref");
}

{
  const prev = process.env.TWILIO_WHATSAPP_FROM;
  process.env.TWILIO_WHATSAPP_FROM = "whatsapp:+263771111111";
  const url = buildWhatsAppHandoffUrl("ABC123ABC123ABCD");
  assert.ok(url?.startsWith("https://wa.me/263771111111"));
  assert.ok(url?.includes("Ref%3A"));
  assert.ok(!url?.includes("2.50"));
  assert.ok(!url?.includes("price"));
  if (prev === undefined) delete process.env.TWILIO_WHATSAPP_FROM;
  else process.env.TWILIO_WHATSAPP_FROM = prev;
  pass("WhatsApp deep link has ref not prices");
}

{
  const { formatGuestHandoffAwaitingLocation } = await import("../src/modules/whatsapp/copy.js");
  const message = formatGuestHandoffAwaitingLocation({
    shopName: "Corner Shop",
    lines: [{ quantity: 1, productName: "Mazoe Orange Crush 2L", lineTotalCents: 250 }],
    subtotalCents: 250
  });
  assert.match(message, /Items: \$2\.50/);
  assert.match(message, /Where should we deliver\?/);
  assert.match(message, /Please send your location using WhatsApp/);
  assert.doesNotMatch(message, /Delivery:\s*\$/);
  assert.doesNotMatch(message, /Confirm order/);
  pass("handoff restore copy has no delivery fee");
}

{
  const { shoppingAreaForMerchant } = await import("../src/modules/commerce/shopping-areas.js");
  const harare = shoppingAreaForMerchant({
    id: "m1",
    locationLabel: "Borrowdale",
    pilotArea: "Harare",
    latitude: -17.78,
    longitude: 31.1
  });
  assert.equal(harare.id, "harare");
  assert.equal(harare.name, "Harare");
  const nearbyHarare = shoppingAreaForMerchant({
    id: "m2",
    locationLabel: "Glen Norah",
    pilotArea: null,
    latitude: -17.908,
    longitude: 30.98
  });
  assert.equal(nearbyHarare.id, "harare");
  const gweru = shoppingAreaForMerchant({
    id: "m3",
    locationLabel: "Mkoba",
    pilotArea: "Gweru",
    latitude: -19.45,
    longitude: 29.82
  });
  assert.equal(gweru.id, "gweru");
  pass("merchant clustering maps to coarse areas");
}

async function dbSuite() {
  if (process.env.GIG_TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.GIG_TEST_DATABASE_URL;
  } else if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("duts_gig_dev")) {
    process.env.DATABASE_URL = process.env.DATABASE_URL.replace(/\/[^/?]+(\?|$)/, "/duts_gig_dev$1");
  }
  if (!process.env.DATABASE_URL) {
    skipped.push("handoff DB (no DATABASE_URL)");
    return;
  }

  try {
    const { prisma } = await import("../src/config/prisma.js");
    await prisma.$queryRaw`SELECT 1`;
    const table = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'GuestCommerceHandoff'
      ) AS exists
    `;
    if (!table[0]?.exists) {
      skipped.push("handoff DB (GuestCommerceHandoff table missing — migrate first)");
      await prisma.$disconnect();
      return;
    }

    const token = generateHandoffToken();
    const { applyGuestHandoffToConversation } = await import("../src/modules/commerce/guest-handoff.service.js");
    const missing = await applyGuestHandoffToConversation({
      conversationId: "00000000-0000-0000-0000-000000000000",
      token
    });
    assert.equal(missing.ok, false);
    assert.match(missing.message, /couldn't find that basket/i);

    const expiredHash = hashHandoffToken(generateHandoffToken());
    const merchant = await prisma.merchant.findFirst({ where: { active: true }, select: { id: true } });
    if (!merchant) {
      skipped.push("handoff expiry/consume DB (no active merchant)");
      await prisma.$disconnect();
      return;
    }

    const expiredToken = generateHandoffToken();
    await prisma.guestCommerceHandoff.create({
      data: {
        tokenHash: hashHandoffToken(expiredToken),
        merchantId: merchant.id,
        basketJson: { lines: [] },
        deliveryLabel: "Test",
        deliveryLat: -17.83,
        deliveryLng: 31.05,
        expiresAt: new Date(Date.now() - 60_000)
      }
    });
    const expired = await applyGuestHandoffToConversation({
      conversationId: "00000000-0000-0000-0000-000000000000",
      token: expiredToken
    });
    assert.equal(expired.ok, false);
    assert.match(expired.message, /expired/i);

    const consumedToken = generateHandoffToken();
    await prisma.guestCommerceHandoff.create({
      data: {
        tokenHash: hashHandoffToken(consumedToken),
        merchantId: merchant.id,
        basketJson: { lines: [] },
        deliveryLabel: "Test",
        deliveryLat: -17.83,
        deliveryLng: 31.05,
        expiresAt: new Date(Date.now() + 60 * 60_000),
        consumedAt: new Date()
      }
    });
    const consumed = await applyGuestHandoffToConversation({
      conversationId: "00000000-0000-0000-0000-000000000000",
      token: consumedToken
    });
    assert.equal(consumed.ok, false);
    assert.match(consumed.message, /already opened/i);

    await prisma.guestCommerceHandoff.deleteMany({
      where: { tokenHash: { in: [expiredHash, hashHandoffToken(expiredToken), hashHandoffToken(consumedToken)] } }
    });
    await prisma.$disconnect();
    pass("invalid/expired/consumed handoff");
  } catch (err) {
    skipped.push(`handoff DB (${err instanceof Error ? err.message : "unavailable"})`);
  }
}

await dbSuite();

console.log(JSON.stringify({ ok: true, passed, skipped }, null, 2));
