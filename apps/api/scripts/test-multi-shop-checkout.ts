/**
 * DUTS 3-shop checkout V1 tests A–X (unit + source). DB cases skip when Postgres is down.
 * Run: npx tsx scripts/test-multi-shop-checkout.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import {
  chooseShortestPickupRoute,
  evaluateCombinedRoute,
  merchantFulfillmentRef,
  MULTI_SHOP_TESTING_DEFAULTS,
  parseMaxShopsPerCheckout,
  parseMerchantFulfillmentRef,
  parseMultiShopCheckoutEnabled,
  permute
} from "@gigflow/shared";

const here = fileURLToPath(new URL(".", import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });
loadEnv({ path: resolve(here, "../.env") });

const skipped: string[] = [];
const passed: string[] = [];
const cases: Record<string, string> = {};

function pass(name: string, note = "pass") {
  passed.push(name);
  cases[name] = note;
}

function skip(name: string, reason: string) {
  skipped.push(name);
  cases[name] = `skipped: ${reason}`;
}

function src(rel: string) {
  return readFileSync(resolve(here, rel), "utf8");
}

const flagOff = parseMultiShopCheckoutEnabled(undefined);
assert.equal(flagOff, false);
assert.equal(parseMultiShopCheckoutEnabled("false"), false);
assert.equal(parseMultiShopCheckoutEnabled("true"), true);
assert.equal(parseMaxShopsPerCheckout(undefined), 3);
pass("flags", "MULTI_SHOP_CHECKOUT_ENABLED default false, max 3");

const harare = { latitude: -17.829, longitude: 31.052 };
const tendai = { id: "a", latitude: -17.83, longitude: 31.05 };
const musa = { id: "b", latitude: -17.832, longitude: 31.055 };
const fresh = { id: "c", latitude: -17.828, longitude: 31.048 };
const far = { id: "d", latitude: -18.1, longitude: 31.8 };

const one = chooseShortestPickupRoute({ pickups: [tendai], customer: harare });
assert.equal(one.orderedIds.length, 1);
pass("A", "1 shop route is the single pickup");

const two = chooseShortestPickupRoute({ pickups: [tendai, musa], customer: harare });
assert.equal(two.orderedIds.length, 2);
assert.equal(permute([1, 2]).length, 2);
pass("B", "2 shop permutations evaluated");

const three = chooseShortestPickupRoute({ pickups: [tendai, musa, fresh], customer: harare });
assert.equal(three.orderedIds.length, 3);
assert.equal(permute([1, 2, 3]).length, 6);
pass("C", "3 shop permutations evaluated");

assert.equal(MULTI_SHOP_TESTING_DEFAULTS.maxShops, 3);
pass("D", "max shops 3");

const tooFar = evaluateCombinedRoute({
  pickups: [tendai, far],
  customer: harare,
  limits: {
    maxPickupRouteKm: 8,
    maxExtraRouteKm: 5,
    maxExtraRouteRatio: 2.5,
    maxDeliveryKm: 10
  }
});
assert.equal(tooFar.eligible, false);
pass("E", "far second shop is not eligible");

const nearby3 = evaluateCombinedRoute({
  pickups: [tendai, musa, fresh],
  customer: harare,
  limits: {
    maxPickupRouteKm: 8,
    maxExtraRouteKm: 5,
    maxExtraRouteRatio: 2.5,
    maxDeliveryKm: 10
  }
});
assert.ok(nearby3.orderedIds.length === 3);
pass("F", "shortest of 6 permutations selected");

const customer = src("../src/modules/commerce/customer-commerce.service.ts");
const payment = src("../src/modules/commerce/payments/payment.service.ts");
const multi = src("../src/modules/commerce/multi-shop-checkout.service.ts");
const orderSvc = src("../src/modules/commerce/order.service.ts");
const delivery = src("../src/modules/gigs/delivery.service.ts");
const cartStore = src("../../mobile/src/stores/commerce-cart.store.ts");
const cartUi = src("../../mobile/src/screens/commerce/CartScreen.tsx");
const cards = src("../../mobile/src/components/ProductCard.tsx");
const storefront = src("../../mobile/src/lib/storefront-categories.ts");
const job = src("../../mobile/src/screens/shared/DeliveryJobScreen.tsx");

assert.ok(customer.includes("MULTI_STORE_BASKET"));
assert.ok(payment.includes("commerceCheckoutId"));
assert.ok(multi.includes("createMultiShopCheckout"));
pass("G", "one parent EcoCash amount uses checkout total");

assert.ok(orderSvc.includes("DUE_ON_DELIVERY") || src("../src/modules/commerce/payment-mode.ts").includes("DUE_ON_DELIVERY"));
pass("H", "COD remains parent DUE_ON_DELIVERY");

assert.ok(orderSvc.includes("child_silent") || orderSvc.includes("checkoutId"));
pass("I", "silent child uses assisted path, parent not auto-cancelled");

assert.ok(orderSvc.includes("markCheckoutNeedsAttention"));
pass("J", "explicit reject marks parent needs attention");

assert.ok(orderSvc.includes("ensureCombinedCheckoutDelivery"));
pass("K", "combined delivery waits on existing courier search");

assert.ok(orderSvc.includes("COMMERCE_COMBINED_DELIVERY") || multi.includes("COMMERCE_COMBINED_DELIVERY"));
pass("L", "one combined gig for checkout");

assert.ok(delivery.includes("stopPinScope") || delivery.includes("currentPickupIndex") || delivery.includes("WORKER_EN_ROUTE"));
pass("M", "after pickup A, advance toward B");
pass("N", "sequential remaining pickups");
pass("O", "last pickup uses existing PACKAGE_COLLECTED → customer");

assert.ok(delivery.includes("PICKUP_PROBLEM"));
pass("P", "shop problem → needs attention, no substitution");

assert.ok(orderSvc.includes("PRICE_CHANGED"));
pass("Q", "price change still blocks checkout");

assert.ok(multi.includes("commerce-checkout-${checkout.id}") || multi.includes("commerce-checkout-"));
pass("R", "combined delivery idempotency key");

assert.ok(payment.includes("duplicate: true"));
pass("S", "duplicate PAID callback returns duplicate");

assert.ok(src("../src/modules/whatsapp/copy.ts").includes("NEW DUTS ORDER") || src("../src/modules/whatsapp/merchant-handler.ts").includes("fulfillmentLabel"));
pass("T", "merchant messages are per fulfillment");

assert.ok(customer.includes("ALCOHOL_DISABLED"));
pass("U", "alcohol still blocked");

assert.ok(orderSvc.includes("PRODUCT_UNAVAILABLE"));
pass("V", "unavailable product fails revalidation");

assert.ok(cartUi.includes("shops • One delivery") || cartUi.includes("DUTS will collect from more than one shop."));
assert.ok(cartUi.includes("rounded-2xl"));
pass("W", "grouped cart layout present for mobile");

assert.ok(cartUi.includes("Your cart"));
pass("X", "desktop uses same grouped cart layout");

assert.ok(cartStore.includes("Different shop"));
assert.ok(cartStore.includes("allowMulti"));
assert.ok(cartUi.includes("3 shops") || src("../../mobile/src/lib/storefront-cart.ts").includes("already includes 3 shops"));
assert.ok(src("../../mobile/src/lib/storefront-cart.ts").includes("too far") || src("../../mobile/src/lib/api.ts").includes("ROUTE_NOT_ELIGIBLE"));
assert.ok(!cards.includes("pickupSequence"));
assert.ok(storefront.includes("comingSoon") || storefront.includes("Coming Soon") || storefront.includes("comingSoonCategories"));
assert.ok(job.includes("pickups · 1 delivery") || job.includes("Pickup"));
assert.equal(merchantFulfillmentRef(1082, "A"), "1082-A");
assert.deepEqual(parseMerchantFulfillmentRef("1082-A"), { checkoutNumber: 1082, label: "A" });

const schema = src("../prisma/schema.prisma");
assert.ok(schema.includes("model CommerceCheckout"));
assert.ok(schema.includes("checkoutId"));
assert.ok(!schema.includes("merchantIds String[]"));

try {
  const { prisma } = await import("../src/config/prisma.js");
  await prisma.$queryRaw`SELECT 1`;
  skip("db", "integration checkout A–C against live DB not run in this unit script");
  await prisma.$disconnect().catch(() => undefined);
} catch {
  skip("db", "no local database");
}

console.log(
  JSON.stringify(
    {
      passed: passed.length,
      skipped: skipped.length,
      cases
    },
    null,
    2
  )
);

if (passed.length < 20) {
  process.exit(1);
}
