/**
 * DUTS typed-address MSU/Gweru pilot pricing — package class table, GPS unchanged.
 * Run: npx tsx scripts/test-typed-address-pilot-pricing.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import {
  calculatePilotDeliveryPrice,
  classifyPackage,
  isMsuGweruTypedPilotAddress,
  PILOT_TYPED_ADDRESS_FEE_CENTS,
  PILOT_TYPED_ADDRESS_ZONE,
  resolvePilotLocationMode,
  type PilotPackageClass,
  type PilotPackageItem
} from "@gigflow/shared";

const here = fileURLToPath(new URL(".", import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });
loadEnv({ path: resolve(here, "../.env") });

const passed: string[] = [];

function pass(name: string) {
  passed.push(name);
}

function src(rel: string) {
  return readFileSync(resolve(here, rel), "utf8");
}

function typedFee(pkg: PilotPackageClass, km = 4.2) {
  return calculatePilotDeliveryPrice({
    routeDistanceKm: km,
    packageClass: pkg,
    locationMode: "TYPED_PILOT"
  });
}

function gpsFee(km: number, pkg: PilotPackageClass) {
  return calculatePilotDeliveryPrice({
    routeDistanceKm: km,
    packageClass: pkg,
    locationMode: "GPS"
  });
}

const ADDRESS = "34 Nehosho Senga Gweru";
const SMALL_BASKET: PilotPackageItem[] = [
  { quantity: 1, category: "Snacks", sizeLabel: "150g" },
  { quantity: 1, category: "Groceries", sizeLabel: "700g" }
];
const MEDIUM_BASKET: PilotPackageItem[] = [
  { quantity: 2, category: "Drinks", sizeLabel: "1L" },
  { quantity: 1, category: "Groceries", sizeLabel: "2kg" },
  { quantity: 2, category: "Drinks", sizeLabel: "500ml" }
];
const LARGE_BASKET: PilotPackageItem[] = [
  { quantity: 4, category: "Drinks", sizeLabel: "2L" },
  { quantity: 3, category: "Groceries", sizeLabel: "2kg" },
  { quantity: 2, category: "Household", sizeLabel: "10kg" }
];
const UNKNOWN_BASKET: PilotPackageItem[] = [{ quantity: 1 }, { quantity: 1 }];

assert.equal(PILOT_TYPED_ADDRESS_ZONE, "MSU_GWERU");
assert.equal(PILOT_TYPED_ADDRESS_FEE_CENTS.SMALL, 100);
assert.equal(PILOT_TYPED_ADDRESS_FEE_CENTS.MEDIUM, 130);
assert.equal(PILOT_TYPED_ADDRESS_FEE_CENTS.LARGE, 170);
assert.equal(isMsuGweruTypedPilotAddress(ADDRESS), true);
assert.equal(isMsuGweruTypedPilotAddress("34 Nehosho, senga Gweru"), true);
assert.equal(isMsuGweruTypedPilotAddress("Senga"), true);
assert.equal(isMsuGweruTypedPilotAddress("Nehosho"), true);
assert.equal(isMsuGweruTypedPilotAddress("House 24 Senga 2 near MSU"), true);
assert.equal(isMsuGweruTypedPilotAddress("Harare CBD"), false);

{
  assert.equal(classifyPackage(SMALL_BASKET), "SMALL");
  const priced = typedFee("SMALL");
  assert.equal(priced.eligible, true);
  assert.equal(priced.deliveryFeeCents, 100);
  assert.equal(priced.locationMode, "TYPED_PILOT");
  pass("A");
}

{
  assert.equal(classifyPackage(MEDIUM_BASKET), "MEDIUM");
  const priced = typedFee("MEDIUM");
  assert.equal(priced.deliveryFeeCents, 130);
  pass("B");
}

{
  assert.equal(classifyPackage(LARGE_BASKET), "LARGE");
  const priced = typedFee("LARGE");
  assert.equal(priced.deliveryFeeCents, 170);
  pass("C");
}

{
  const cls = classifyPackage(UNKNOWN_BASKET);
  assert.equal(cls, "MEDIUM", "unknown falls back to MEDIUM, not SMALL");
  assert.equal(typedFee(cls).deliveryFeeCents, 130);
  pass("D");
}

{
  const address = ADDRESS;
  const small = calculatePilotDeliveryPrice({
    routeDistanceKm: 1.6,
    packageClass: classifyPackage(SMALL_BASKET),
    locationMode: resolvePilotLocationMode({ typedAddress: address })
  });
  const medium = calculatePilotDeliveryPrice({
    routeDistanceKm: 1.6,
    packageClass: classifyPackage(MEDIUM_BASKET),
    locationMode: resolvePilotLocationMode({ typedAddress: address })
  });
  const large = calculatePilotDeliveryPrice({
    routeDistanceKm: 1.6,
    packageClass: classifyPackage(LARGE_BASKET),
    locationMode: resolvePilotLocationMode({ typedAddress: address })
  });
  assert.equal(small.deliveryFeeCents, 100);
  assert.equal(medium.deliveryFeeCents, 130);
  assert.equal(large.deliveryFeeCents, 170);
  pass("E");
}

{
  const priced = gpsFee(0.5, "SMALL");
  assert.equal(priced.eligible, true);
  assert.equal(priced.deliveryFeeCents, 50);
  assert.notEqual(priced.deliveryFeeCents, 100);
  assert.equal(priced.locationMode, "GPS");
  pass("F");
}

{
  const priced = gpsFee(1.5, "MEDIUM");
  assert.equal(priced.deliveryFeeCents, 100);
  assert.notEqual(priced.deliveryFeeCents, 130);
  pass("G");
}

{
  const priced = gpsFee(2.5, "LARGE");
  assert.equal(priced.deliveryFeeCents, 200);
  assert.notEqual(priced.deliveryFeeCents, 170);
  pass("H");
}

{
  const handler = src("../src/modules/whatsapp/customer-handler.ts");
  const typedFn = handler.slice(handler.indexOf("async function applyTypedLocation"));
  const recognizeAt = typedFn.indexOf('pilotLocationMode = "TYPED_PILOT"');
  const confirmAreaAt = typedFn.indexOf("sendUseThisArea");
  const landmarkAt = typedFn.indexOf("formatLocationNeedLandmarkForArea");
  assert.ok(recognizeAt >= 0, "I recognizes typed pilot zone");
  assert.ok(recognizeAt < confirmAreaAt, "I skips area confirmation for recognized zone");
  assert.ok(recognizeAt < landmarkAt, "I skips landmark interrogation for recognized zone");
  assert.equal(handler.includes("Is your order small"), false);
  const copy = src("../src/modules/whatsapp/copy.ts");
  assert.equal(copy.includes("Package size"), false);
  pass("I");
}

{
  const order = src("../src/modules/commerce/order.service.ts");
  const dropoff = order.slice(order.indexOf("dropoff:"), order.indexOf("package:"));
  assert.ok(dropoff.includes("formattedAddress: order.deliveryLabel"), "J courier formatted address");
  assert.ok(dropoff.includes("addressLine1: order.deliveryLabel"), "J courier address line");
  const wa = src("../src/modules/whatsapp/customer-handler.ts");
  assert.ok(wa.includes("originalTypedAddress || ctx.deliveryLabel"), "J preserves original typed text");
  pass("J");
}

{
  const delivery = src("../src/modules/gigs/delivery.service.ts");
  assert.ok(delivery.includes("export async function verifyDeliveryPinAndComplete"), "K PIN function");
  assert.ok(delivery.includes("hashedPinsMatch(gig.deliveryPin, pin, gigId)"), "K PIN required");
  assert.ok(delivery.includes("INVALID_DELIVERY_PIN") || delivery.includes("recordFailedPinAttempt"), "K PIN failure path");
  pass("K");
}

{
  const gpsFromPrecision = resolvePilotLocationMode({
    deliveryPrecision: "GPS",
    deliveryLabel: ADDRESS
  });
  assert.equal(gpsFromPrecision, "GPS", "GPS share in Senga stays on GPS matrix");
  const typed = resolvePilotLocationMode({ typedAddress: ADDRESS });
  assert.equal(typed, "TYPED_PILOT");
  const engine = src("../../../packages/shared/src/pilot-delivery-pricing.ts");
  const wa = src("../src/modules/whatsapp/copy.ts");
  const checkout = src("../../mobile/src/screens/commerce/CommerceCheckoutScreen.tsx");
  assert.ok(engine.includes("SMALL: 100"));
  assert.ok(engine.includes("MEDIUM: 130"));
  assert.ok(engine.includes("LARGE: 170"));
  assert.equal(wa.includes("100") && wa.includes("TYPED_ADDRESS"), false);
  assert.ok(!checkout.includes("PILOT_TYPED_ADDRESS_FEE_CENTS"), "frontend does not own cents");
  const quote = src("../src/modules/commerce/pilot-delivery.service.ts");
  assert.ok(quote.includes("classifyBasketPackageClass"), "backend classifies basket");
  assert.ok(quote.includes("resolvePilotLocationMode"), "backend chooses GPS vs typed");
  pass("authoritative-backend");
}

console.log(JSON.stringify({ ok: true, passed }, null, 2));
