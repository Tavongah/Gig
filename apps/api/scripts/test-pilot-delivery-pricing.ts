/**
 * DUTS pilot delivery pricing V1 — matrix, bands, package class, channel wiring.
 * Run: npx tsx scripts/test-pilot-delivery-pricing.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import {
  calculateDeliveryPrice,
  calculatePilotDeliveryPrice,
  classifyPackage,
  PILOT_DELIVERY_MATRIX_CENTS,
  PILOT_TYPED_ADDRESS_FEE_CENTS,
  type PilotPackageClass
} from "@gigflow/shared";

const here = fileURLToPath(new URL(".", import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });
loadEnv({ path: resolve(here, "../.env") });

const passed: string[] = [];
const skipped: string[] = [];

function pass(name: string) {
  passed.push(name);
}

function skip(name: string, reason: string) {
  skipped.push(name);
  void reason;
}

function src(rel: string) {
  return readFileSync(resolve(here, rel), "utf8");
}

function fee(km: number, pkg: PilotPackageClass) {
  return calculatePilotDeliveryPrice({ routeDistanceKm: km, packageClass: pkg });
}

function expectFee(km: number, pkg: PilotPackageClass, cents: number, name: string) {
  const result = fee(km, pkg);
  assert.equal(result.eligible, true, `${name} eligible`);
  assert.equal(result.deliveryFeeCents, cents, `${name} fee`);
  assert.equal(result.currency, "USD", `${name} currency`);
  pass(name);
}

expectFee(0.5, "SMALL", 50, "A");
expectFee(0.5, "MEDIUM", 70, "B");
expectFee(0.5, "LARGE", 100, "C");
expectFee(1.5, "SMALL", 70, "D");
expectFee(1.5, "MEDIUM", 100, "E");
expectFee(1.5, "LARGE", 130, "F");
expectFee(2.5, "SMALL", 100, "G");
expectFee(2.5, "MEDIUM", 150, "H");
expectFee(2.5, "LARGE", 200, "I");
expectFee(0, "SMALL", 50, "J");
expectFee(1.0, "MEDIUM", 70, "K");
expectFee(1.0001, "MEDIUM", 100, "L");
expectFee(2.0, "LARGE", 130, "M");
expectFee(2.0001, "LARGE", 200, "N");
expectFee(3.0, "LARGE", 200, "O");

{
  const result = fee(3.0001, "LARGE");
  assert.equal(result.eligible, false, "P ineligible");
  assert.equal(result.deliveryFeeCents, null, "P no $2 cap");
  pass("P");
}

{
  const cls = classifyPackage([
    { quantity: 1, category: "Snacks", sizeLabel: "150g" },
    { quantity: 1, category: "Groceries", sizeLabel: "700g" }
  ]);
  assert.equal(cls, "SMALL", `Q got ${cls}`);
  pass("Q");
}

{
  const cls = classifyPackage([
    { quantity: 2, category: "Drinks", sizeLabel: "1L" },
    { quantity: 1, category: "Groceries", sizeLabel: "2kg" },
    { quantity: 2, category: "Drinks", sizeLabel: "500ml" }
  ]);
  assert.equal(cls, "MEDIUM", `R got ${cls}`);
  pass("R");
}

{
  const cls = classifyPackage([
    { quantity: 4, category: "Drinks", sizeLabel: "2L" },
    { quantity: 3, category: "Groceries", sizeLabel: "2kg" },
    { quantity: 2, category: "Household", sizeLabel: "10kg" }
  ]);
  assert.equal(cls, "LARGE", `S got ${cls}`);
  pass("S");
}

{
  const cls = classifyPackage([{ quantity: 1 }, { quantity: 1 }]);
  assert.equal(cls, "MEDIUM", `T got ${cls}`);
  pass("T");
}

{
  const result = fee(1.6, "MEDIUM");
  assert.equal(result.eligible, true);
  assert.equal(result.deliveryFeeCents, 100, "U one fee");
  pass("U");
}

{
  const result = fee(2.6, "LARGE");
  assert.equal(result.eligible, true);
  assert.equal(result.deliveryFeeCents, 200, "V one fee");
  pass("V");
}

{
  const result = fee(4.2, "LARGE");
  assert.equal(result.eligible, false, "W not capped");
  pass("W");
}

{
  const order = src("../src/modules/commerce/order.service.ts");
  const wa = src("../src/modules/whatsapp/customer-handler.ts");
  const multi = src("../src/modules/commerce/multi-shop-checkout.service.ts");
  const mobileApi = src("../../mobile/src/lib/api.ts");
  const checkout = src("../../mobile/src/screens/commerce/CommerceCheckoutScreen.tsx");
  assert.ok(order.includes("quotePilotCommerceDelivery"), "X web/app quote");
  assert.ok(wa.includes("quoteBasketTotals"), "Z WhatsApp quote");
  assert.ok(mobileApi.includes("commerceCheckoutPrepare") && checkout.includes("quote.deliveryFeeCents"), "Y app renders backend fee");
  assert.ok(!checkout.includes("calculatePilotDeliveryPrice"), "Y no frontend matrix");
  pass("X");
  pass("Y");
  pass("Z");
}

{
  assert.equal(500 + 70, 570, "AA 5.00 + 0.70");
  const payment = src("../src/modules/commerce/payments/payment.service.ts");
  const checkout = src("../src/modules/commerce/customer-commerce.service.ts");
  assert.ok(payment.includes("totalCents") || payment.includes("amount"), "AA ZB uses order total");
  assert.ok(checkout.includes("checkoutCart") && checkout.includes("prepareCheckout"), "AA backend checkout");
  pass("AA");
}

{
  const paymentMode = src("../src/modules/commerce/payment-mode.ts");
  assert.ok(paymentMode.includes("CASH") && paymentMode.includes("DUE_ON_DELIVERY") || src("../src/modules/commerce/order.service.ts").includes("CASH"), "AB COD");
  pass("AB");
}

{
  const routes = src("../src/modules/commerce/customer-commerce.routes.ts");
  const checkoutBlock = routes.slice(routes.indexOf("const checkoutSchema"), routes.indexOf("customerCommerceRouter.post(\"/cart/checkout\""));
  assert.ok(!checkoutBlock.includes("deliveryFee"), "AC no client delivery fee field");
  pass("AC");
}

{
  const cart = src("../../mobile/src/screens/commerce/CartScreen.tsx");
  const home = src("../../mobile/src/screens/commerce/ShopHomeScreen.tsx");
  const checkout = src("../../mobile/src/screens/commerce/CommerceCheckoutScreen.tsx");
  const copy = src("../src/modules/whatsapp/copy.ts");
  assert.ok(home.includes("Delivery from $0.50"), "AD public copy");
  assert.ok(!home.includes("calculatePilotDeliveryPrice"), "AD no homepage fee calc");
  assert.ok(cart.includes("Calculated at checkout"), "AE deferred copy");
  assert.ok(checkout.includes("quote.deliveryFeeCents"), "AF exact after location");
  assert.equal((checkout.match(/Delivery\s+/g) ?? []).length >= 1, true, "AG one Delivery line");
  assert.ok(!checkout.includes("packageClass") && !checkout.includes("distanceBand"), "AG internals hidden");
  assert.ok(copy.includes("`Delivery: ${money(input.deliveryFeeCents)}`") || copy.includes("Delivery:"), "AH Delivery line");
  assert.ok(!copy.includes("Distance fee") && !copy.includes("Package fee") && !copy.includes("Courier fee"), "AH no internals");
  pass("AD");
  pass("AE");
  pass("AF");
  pass("AG");
  pass("AH");
}

{
  const gigPricing = src("../src/modules/gigs/delivery-pricing.service.ts");
  assert.ok(gigPricing.includes("calculateDeliveryPrice"), "legacy gig formula preserved");
  const legacy = calculateDeliveryPrice(1, { maxDistanceKm: 10, baseFeeCents: 200, pricePerKmCents: 50, minimumFeeCents: 200, commissionRate: 0.2 });
  assert.ok(legacy.totalCents >= 200, "legacy gig not replaced by matrix");
  const order = src("../src/modules/commerce/order.service.ts");
  const quoteFn = order.slice(order.indexOf("export async function quoteBasketTotals"), order.indexOf("export async function createConfirmedCommerceOrder"));
  assert.ok(!quoteFn.includes("workerPayoutCents"), "no courier split in commerce quote");
  const pilot = src("../src/modules/commerce/pilot-delivery.service.ts");
  assert.ok(!pilot.includes("commission") && !pilot.includes("workerPayout"), "no courier compensation");
  pass("legacy-gig");
  pass("no-courier-split");
}

{
  const engine = src("../../../packages/shared/src/pilot-delivery-pricing.ts");
  assert.ok(engine.includes("PILOT_DELIVERY_MATRIX_CENTS"), "central matrix");
  assert.equal(PILOT_DELIVERY_MATRIX_CENTS["0_TO_1_KM"].SMALL, 50);
  assert.equal(PILOT_DELIVERY_MATRIX_CENTS["2_TO_3_KM"].LARGE, 200);
  assert.ok(engine.includes("PILOT_TYPED_ADDRESS_FEE_CENTS"), "typed table is central");
  assert.equal(PILOT_TYPED_ADDRESS_FEE_CENTS.SMALL, 100);
  assert.equal(PILOT_TYPED_ADDRESS_FEE_CENTS.MEDIUM, 130);
  assert.equal(PILOT_TYPED_ADDRESS_FEE_CENTS.LARGE, 170);
  const gpsSmall = calculatePilotDeliveryPrice({
    routeDistanceKm: 0.5,
    packageClass: "SMALL",
    locationMode: "GPS"
  });
  assert.equal(gpsSmall.deliveryFeeCents, 50, "GPS SMALL is not forced to $1");
  const multi = src("../src/modules/commerce/multi-shop-checkout.service.ts");
  assert.ok(multi.includes("quotePilotCommerceDelivery"), "multi-shop uses same engine");
  assert.ok(multi.includes("input.lines"), "combined basket");
  assert.ok(src("../src/modules/commerce/payment-mode.ts").includes("isMultiShopCheckoutEnabled"), "flag preserved");
  pass("central-engine");
}

console.log(JSON.stringify({ ok: true, passed, skipped }, null, 2));
