/**
 * Supported Gweru/Harare customer delivery fees follow package class, not distance.
 * Run: npm run test:package-city-pricing --workspace=@gigflow/api
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  calculatePilotDeliveryPrice,
  classifyPackage,
  PILOT_TYPED_ADDRESS_FEE_CENTS,
  SUPPORTED_PACKAGE_PRICING_CITY_SEEDS,
  parseSellerMarketplaceEnabled,
  type PilotPackageClass
} from "@gigflow/shared";

const here = dirname(fileURLToPath(import.meta.url));
const gweru = SUPPORTED_PACKAGE_PRICING_CITY_SEEDS.find((s) => s.id === "GWERU")!;
const harare = SUPPORTED_PACKAGE_PRICING_CITY_SEEDS.find((s) => s.id === "HARARE")!;

function fee(input: {
  km: number;
  pkg: PilotPackageClass;
  mode?: "GPS" | "TYPED_PILOT";
  label?: string;
  lat?: number;
  lng?: number;
}) {
  return calculatePilotDeliveryPrice({
    routeDistanceKm: input.km,
    packageClass: input.pkg,
    locationMode: input.mode ?? "GPS",
    deliveryLabel: input.label,
    customerLatitude: input.lat,
    customerLongitude: input.lng
  });
}

function expectPackage(
  name: string,
  input: Parameters<typeof fee>[0],
  cents: number
) {
  const priced = fee(input);
  assert.equal(priced.eligible, true, name);
  assert.equal(priced.deliveryFeeCents, cents, name);
  assert.equal(priced.distanceBand, null, name);
}

for (const [pkg, cents] of [
  ["SMALL", 100],
  ["MEDIUM", 130],
  ["LARGE", 170]
] as const) {
  expectPackage(`gweru typed ${pkg}`, { km: 4.2, pkg, mode: "TYPED_PILOT", label: "Senga Gweru" }, cents);
  expectPackage(`gweru gps ${pkg}`, { km: 2, pkg, mode: "GPS", lat: gweru.latitude, lng: gweru.longitude }, cents);
  expectPackage(`harare typed ${pkg}`, { km: 5, pkg, mode: "GPS", label: "Borrowdale Road, Harare" }, cents);
  expectPackage(`harare gps ${pkg}`, { km: 0.5, pkg, mode: "GPS", lat: harare.latitude, lng: harare.longitude }, cents);
}

assert.equal(PILOT_TYPED_ADDRESS_FEE_CENTS.SMALL, 100);
assert.equal(PILOT_TYPED_ADDRESS_FEE_CENTS.MEDIUM, 130);
assert.equal(PILOT_TYPED_ADDRESS_FEE_CENTS.LARGE, 170);

{
  const cls = classifyPackage([{ quantity: 1 }, { quantity: 2 }]);
  assert.equal(cls, "MEDIUM");
  expectPackage("unknown", { km: 5, pkg: cls, label: "Gweru" }, 130);
}

{
  const one = classifyPackage([{ quantity: 1, category: "Snacks", sizeLabel: "150g" }]);
  const many = classifyPackage([{ quantity: 8, category: "Snacks", sizeLabel: "150g" }]);
  assert.equal(one, "SMALL");
  assert.equal(many, "LARGE");
  assert.notEqual(one, many);
}

{
  const near = fee({ km: 0.5, pkg: "MEDIUM", label: "Nehosho Gweru" });
  const mid = fee({ km: 2, pkg: "MEDIUM", lat: gweru.latitude, lng: gweru.longitude });
  const far = fee({ km: 5, pkg: "MEDIUM", label: "MSU Gweru", lat: gweru.latitude + 0.04, lng: gweru.longitude });
  assert.equal(near.deliveryFeeCents, 130);
  assert.equal(mid.deliveryFeeCents, 130);
  assert.equal(far.deliveryFeeCents, 130);
}

{
  const outside = fee({ km: 0.5, pkg: "SMALL", lat: -20.1569, lng: 28.5809 });
  assert.equal(outside.deliveryFeeCents, 50, "Bulawayo GPS stays on the distance matrix");
  const tooFar = fee({ km: 5, pkg: "MEDIUM", label: "Bulawayo" });
  assert.equal(tooFar.eligible, false);
  assert.equal(tooFar.deliveryFeeCents, null);
}

const merchant = readFileSync(resolve(here, "../src/modules/commerce/merchant.service.ts"), "utf8");
const nearby = merchant.slice(merchant.indexOf("export async function findNearbyMerchants"), merchant.indexOf("export type ProductMatch"));
assert.match(nearby, /distanceKm <= maxKm/);
assert.match(nearby, /sort\(\(a, b\) => a\.distanceKm - b\.distanceKm\)/);

const quote = readFileSync(resolve(here, "../src/modules/commerce/order.service.ts"), "utf8");
const totals = quote.slice(quote.indexOf("export async function quoteBasketTotals"), quote.indexOf("export async function createConfirmedCommerceOrder"));
assert.match(totals, /customerLatitude: input\.customerLat/);
assert.match(totals, /routeDistanceKm/);
assert.doesNotMatch(totals, /workerPayoutCents/);
assert.match(quote, /status: CommerceOrderStatus\.READY_FOR_PICKUP/);

const cart = readFileSync(resolve(here, "../src/modules/commerce/customer-commerce.service.ts"), "utf8");
assert.match(cart, /prepareCheckout/);
assert.match(cart, /checkoutCart/);
assert.match(cart, /SHOP_NOT_NEARBY/);

const wa = readFileSync(resolve(here, "../src/modules/whatsapp/customer-handler.ts"), "utf8");
assert.match(wa, /quoteBasketTotals/);
assert.doesNotMatch(wa, /PILOT_TYPED_ADDRESS_FEE_CENTS/);

const mobile = readFileSync(resolve(here, "../../mobile/src/screens/commerce/CommerceCheckoutScreen.tsx"), "utf8");
assert.match(mobile, /quote\.deliveryFeeCents/);
assert.doesNotMatch(mobile, /calculatePilotDeliveryPrice/);

const goi = readFileSync(resolve(here, "../src/modules/commerce/payment-mode.ts"), "utf8");
assert.match(goi, /DEFAULT_MAX_COURIER_SEARCH_MINUTES = 12 \* 60/);
assert.match(goi, /DUE_ON_DELIVERY/);

assert.equal(parseSellerMarketplaceEnabled(undefined), false);
assert.equal(parseSellerMarketplaceEnabled("false"), false);

console.log(JSON.stringify({
  ok: true,
  small: 100,
  medium: 130,
  large: 170,
  unknown: 130,
  distanceAffectsSupportedPrice: false
}));
