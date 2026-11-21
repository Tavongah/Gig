/**
 * Standard DUTS shop delivery fees and stored-quote preservation.
 * Run: npx tsx scripts/test-shop-delivery-fees.ts
 * Does not place orders, charge EcoCash, or write the database.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  calculatePilotDeliveryPrice,
  distanceKmBetween,
  PILOT_DELIVERY_FEE_CENTS,
  PILOT_DELIVERY_MAX_KM,
  PILOT_TYPED_ADDRESS_FEE_CENTS,
  SUPPORTED_PACKAGE_PRICING_CITY_SEEDS,
  SUPPORTED_PACKAGE_PRICING_MATCH_KM
} from "@gigflow/shared";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");

function src(rel: string) {
  return readFileSync(resolve(here, rel), "utf8");
}

function between(text: string, start: string, end: string) {
  const from = text.indexOf(start);
  assert.ok(from >= 0, `missing ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.ok(to > from, `missing ${end} after ${start}`);
  return text.slice(from, to);
}

/** Same selection as initiateMobileMoneyPaymentForOrder: stored checkout total, else stored order total. */
function mockEcoCashChargeCents(input: { checkoutTotalCents: number | null; orderTotalCents: number }) {
  return input.checkoutTotalCents ?? input.orderTotalCents;
}

/** Cash on delivery collects the total already stored on the order. */
function mockCashCollectCents(stored: { subtotalCents: number; deliveryFeeCents: number; serviceFeeCents: number }) {
  return stored.subtotalCents + stored.deliveryFeeCents + stored.serviceFeeCents;
}

assert.equal(PILOT_TYPED_ADDRESS_FEE_CENTS.SMALL, 119);
assert.equal(PILOT_TYPED_ADDRESS_FEE_CENTS.MEDIUM, 239);
assert.equal(PILOT_TYPED_ADDRESS_FEE_CENTS.LARGE, 359);

const gweru = SUPPORTED_PACKAGE_PRICING_CITY_SEEDS.find((seed) => seed.id === "GWERU")!;
const harare = SUPPORTED_PACKAGE_PRICING_CITY_SEEDS.find((seed) => seed.id === "HARARE")!;

for (const [pkg, cents] of [
  ["SMALL", 119],
  ["MEDIUM", 239],
  ["LARGE", 359]
] as const) {
  const gweruGps = calculatePilotDeliveryPrice({
    routeDistanceKm: 2,
    packageClass: pkg,
    locationMode: "GPS",
    customerLatitude: gweru.latitude,
    customerLongitude: gweru.longitude
  });
  const harareTyped = calculatePilotDeliveryPrice({
    routeDistanceKm: 12,
    packageClass: pkg,
    locationMode: "GPS",
    deliveryLabel: "Avondale, Harare",
    customerLatitude: harare.latitude,
    customerLongitude: harare.longitude
  });
  assert.equal(gweruGps.eligible, true, `Gweru ${pkg}`);
  assert.equal(gweruGps.deliveryFeeCents, cents, `Gweru ${pkg}`);
  assert.equal(harareTyped.eligible, true, `Harare ${pkg}`);
  assert.equal(harareTyped.deliveryFeeCents, cents, `Harare ${pkg}`);
  assert.equal(gweruGps.distanceBand, null);
  assert.equal(harareTyped.distanceBand, null);
}

const inside = { latitude: gweru.latitude + 39 / 111.32, longitude: gweru.longitude };
const insideKm = distanceKmBetween(gweru, inside);
assert.ok(insideKm <= SUPPORTED_PACKAGE_PRICING_MATCH_KM, `inside ${insideKm}`);
const insidePrice = calculatePilotDeliveryPrice({
  routeDistanceKm: insideKm,
  packageClass: "MEDIUM",
  customerLatitude: inside.latitude,
  customerLongitude: inside.longitude
});
assert.equal(insidePrice.eligible, true);
assert.equal(insidePrice.deliveryFeeCents, 239);

const outside = { latitude: gweru.latitude + 50 / 111.32, longitude: gweru.longitude };
const outsideKm = distanceKmBetween(gweru, outside);
assert.ok(outsideKm > SUPPORTED_PACKAGE_PRICING_MATCH_KM, `outside ${outsideKm}`);
assert.ok(outsideKm > PILOT_DELIVERY_MAX_KM);
const outsidePrice = calculatePilotDeliveryPrice({
  routeDistanceKm: outsideKm,
  packageClass: "SMALL",
  customerLatitude: outside.latitude,
  customerLongitude: outside.longitude
});
assert.equal(outsidePrice.eligible, false);
assert.equal(outsidePrice.deliveryFeeCents, null);

const bulawayo = calculatePilotDeliveryPrice({
  routeDistanceKm: 0.5,
  packageClass: "SMALL",
  locationMode: "GPS",
  customerLatitude: -20.1569,
  customerLongitude: 28.5809
});
assert.equal(bulawayo.eligible, true);
assert.equal(bulawayo.deliveryFeeCents, PILOT_DELIVERY_FEE_CENTS.SMALL_0_1_KM);
assert.equal(PILOT_DELIVERY_FEE_CENTS.SMALL_0_1_KM, 50);
assert.ok(bulawayo.deliveryFeeCents! < PILOT_TYPED_ADDRESS_FEE_CENTS.SMALL);

const historicalDeliveryCents = 100;
const merchandiseCents = 500;
const storedTotalCents = merchandiseCents + historicalDeliveryCents;
const freshSmall = calculatePilotDeliveryPrice({
  routeDistanceKm: 1.2,
  packageClass: "SMALL",
  locationMode: "TYPED_PILOT",
  typedAddress: "Senga Gweru"
});
assert.equal(freshSmall.deliveryFeeCents, 119);
assert.notEqual(freshSmall.deliveryFeeCents, historicalDeliveryCents);
assert.equal(
  mockEcoCashChargeCents({ checkoutTotalCents: storedTotalCents, orderTotalCents: storedTotalCents }),
  storedTotalCents
);
assert.equal(
  mockEcoCashChargeCents({ checkoutTotalCents: null, orderTotalCents: storedTotalCents }),
  storedTotalCents
);
assert.equal(
  mockCashCollectCents({
    subtotalCents: merchandiseCents,
    deliveryFeeCents: historicalDeliveryCents,
    serviceFeeCents: 0
  }),
  storedTotalCents
);
assert.notEqual(storedTotalCents, merchandiseCents + freshSmall.deliveryFeeCents!);

const payment = src("../src/modules/commerce/payments/payment.service.ts");
assert.match(payment, /const payAmountCents = checkout\?\.totalCents \?\? order\.totalCents/);
assert.doesNotMatch(payment, /calculatePilotDeliveryPrice/);

const approval = src("../src/modules/commerce/quote-approval.service.ts");
const handoff = between(approval, "export async function handoffApprovedQuote", "async function finishExisting");
assert.match(handoff, /deliveryFeeCents: row\.deliveryFeeCents/);
assert.match(handoff, /totalCents: row\.totalCents/);
assert.doesNotMatch(handoff, /calculatePilotDeliveryPrice/);
assert.doesNotMatch(handoff, /quoteBasketTotals/);

const proposal = src("../src/modules/commerce/quote-proposal.service.ts");
assert.match(proposal, /totalCents: itemsSubtotalCents \+ current\.deliveryFeeCents/);
assert.doesNotMatch(proposal, /calculatePilotDeliveryPrice/);

const order = src("../src/modules/commerce/order.service.ts");
const createOrder = between(order, "export async function createConfirmedCommerceOrder", "export async function merchantAcceptOrder");
assert.match(createOrder, /storedTotals: input\.totals/);
assert.match(createOrder, /presented: input\.totals \? null/);
assert.match(createOrder, /deliveryFeeCents: totals\.deliveryFeeCents/);
assert.doesNotMatch(createOrder, /deliveryFeeCents: input\.presented/);
const assertFn = between(order, "export async function assertBasketTotalsCurrent", "export async function createConfirmedCommerceOrder");
assert.match(assertFn, /quoteBasketTotals\(/);
const storedBranch = between(assertFn, "if (input.storedTotals)", "let merchantLat");
assert.doesNotMatch(storedBranch, /quoteBasketTotals/);

const cart = src("../src/modules/commerce/customer-commerce.service.ts");
const checkoutCart = between(cart, "export async function checkoutCart", "export async function checkoutCatalogDemand");
const placed = between(checkoutCart, "const order = await createConfirmedCommerceOrder", "if (paymentMethod === \"ECOCASH\")");
assert.match(placed, /presented/);
assert.doesNotMatch(placed, /totals:/);
assert.doesNotMatch(placed, /deliveryFeeCents/);

const whatsapp = src("../src/modules/whatsapp/customer-handler.ts");
const cashPay = between(whatsapp, "async function finalizeCashPayment", "async function startMobileMoneyWithPayerPhone");
const cashCreate = between(cashPay, "const order = await createConfirmedCommerceOrder", "ctx.activeOrderId = order.id");
assert.match(cashCreate, /presented:/);
assert.doesNotMatch(cashCreate, /totals:/);

const multi = src("../src/modules/commerce/multi-shop-checkout.service.ts");
assert.match(multi, /deliveryFeeCents: input\.quote\.deliveryFeeCents/);
assert.match(multi, /deliveryFeeCents: 0/);
const childTotals = between(multi, "const child = await createConfirmedCommerceOrder", "await prisma.commerceOrder.update");
assert.match(childTotals, /deliveryFeeCents: 0/);
assert.doesNotMatch(childTotals, /deliveryFeeCents: input\.quote\.deliveryFeeCents/);

const delivery = src("../src/modules/gigs/delivery.service.ts");
assert.match(delivery, /const workerPayoutCents = commerceFulfillment \? 0 : breakdown\.workerPayoutCents/);

const home = src("../../mobile/src/screens/commerce/ShopHomeScreen.tsx");
const checkoutScreen = src("../../mobile/src/screens/commerce/CommerceCheckoutScreen.tsx");
assert.match(home, /Delivery in Harare and Gweru from \$1\.19/);
assert.doesNotMatch(home, /Delivery from \$1\.19/);
assert.doesNotMatch(home, /Delivery from \$0\.50/);
assert.doesNotMatch(home, /calculatePilotDeliveryPrice/);
assert.match(checkoutScreen, /quote\.deliveryFeeCents/);
assert.doesNotMatch(checkoutScreen, /calculatePilotDeliveryPrice/);

function sqlFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sqlFiles(path));
    else if (entry.name.endsWith(".sql")) found.push(path);
  }
  return found;
}

const migrations = sqlFiles(resolve(repo, "apps/api/prisma/migrations"));
assert.ok(migrations.length > 0, "migrations present");
for (const file of migrations) {
  const sql = readFileSync(file, "utf8");
  assert.doesNotMatch(
    sql,
    /SET\s[\s\S]{0,800}?"deliveryFeeCents"\s*=/i,
    `${file} must not assign deliveryFeeCents`
  );
  assert.doesNotMatch(sql, /deliveryFeeCents"\s*=\s*(119|239|359)/);
}

console.log(JSON.stringify({
  ok: true,
  small: PILOT_TYPED_ADDRESS_FEE_CENTS.SMALL,
  medium: PILOT_TYPED_ADDRESS_FEE_CENTS.MEDIUM,
  large: PILOT_TYPED_ADDRESS_FEE_CENTS.LARGE,
  nonCityGpsSmallCents: bulawayo.deliveryFeeCents,
  approvedQuoteUsesStoredFee: true,
  directCartRequiresPresentedFeeMatch: true
}));
