/**
 * Maximum automatic courier-search age.
 * Stale gigs drop out of rematch only. Nothing is cancelled or rewritten.
 * Run: npm run test:courier-search-max-age --workspace=@gigflow/api
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MAX_COURIER_SEARCH_MINUTES,
  canAutomaticallyRebroadcastCourierSearch,
  getMaxCourierSearchMinutes,
  isCourierSearchBeyondMaxAge
} from "../src/modules/commerce/payment-mode.js";

const here = dirname(fileURLToPath(import.meta.url));
const rematch = readFileSync(resolve(here, "../src/modules/commerce/order.service.ts"), "utf8");
const rematchFn = rematch.slice(
  rematch.indexOf("export async function rematchWaitingCommerceCouriers"),
  rematch.indexOf("export async function flagLongWaitCommerceOrders")
);

const now = new Date("2026-10-28T14:58:05.000Z");
const minutes = (n: number) => new Date(now.getTime() - n * 60_000);
const days = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60_000);

function eligible(gigCreatedAt: Date, extras?: Partial<Parameters<typeof canAutomaticallyRebroadcastCourierSearch>[0]>) {
  return canAutomaticallyRebroadcastCourierSearch({
    orderStatus: "READY_FOR_PICKUP",
    gigStatus: "SEARCHING_FOR_WORKER",
    gigCreatedAt,
    hasAssignedCourier: false,
    now,
    ...extras
  });
}

delete process.env.COMMERCE_COURIER_SEARCH_MAX_MINUTES;
assert.equal(getMaxCourierSearchMinutes(), DEFAULT_MAX_COURIER_SEARCH_MINUTES);
assert.equal(DEFAULT_MAX_COURIER_SEARCH_MINUTES, 12 * 60);

process.env.COMMERCE_COURIER_SEARCH_MAX_MINUTES = "30";
assert.equal(getMaxCourierSearchMinutes(), DEFAULT_MAX_COURIER_SEARCH_MINUTES, "below 1 hour rejected");
process.env.COMMERCE_COURIER_SEARCH_MAX_MINUTES = "20000";
assert.equal(getMaxCourierSearchMinutes(), DEFAULT_MAX_COURIER_SEARCH_MINUTES, "weeks rejected");
delete process.env.COMMERCE_COURIER_SEARCH_MAX_MINUTES;

assert.equal(eligible(minutes(5)), true, "A fresh search");
assert.equal(eligible(minutes(12 * 60 - 1)), true, "B just below 12 hours");
assert.equal(eligible(minutes(12 * 60)), false, "C exactly 12 hours");
assert.equal(isCourierSearchBeyondMaxAge(minutes(12 * 60), now), true);
assert.equal(eligible(days(1)), false, "D one day is past the 12-hour default");
assert.equal(eligible(days(17)), false, "E 17 days");
assert.equal(eligible(days(25)), false, "F 25 days");

const stale = days(17);
assert.equal(eligible(stale), false, "G no rebroadcast");
assert.equal(canAutomaticallyRebroadcastCourierSearch({
  orderStatus: "READY_FOR_PICKUP",
  gigStatus: "SEARCHING_FOR_WORKER",
  gigCreatedAt: stale,
  hasAssignedCourier: false,
  now
}), false, "H/I stale candidate never enters the update loop");

assert.equal(eligible(minutes(10)), true, "J fresh COD-shaped search still eligible");
assert.equal(eligible(minutes(10), { gigStatus: "POSTED" }), true, "K fresh prepaid search still eligible");

for (const orderStatus of ["CANCELLED", "PAYMENT_FAILED", "DELIVERED", "CUSTOMER_CONFIRMED", "COURIER_ASSIGNED"]) {
  assert.equal(eligible(minutes(10), { orderStatus }), false, `terminal/other ${orderStatus}`);
}
assert.equal(eligible(minutes(10), { hasAssignedCourier: true }), false, "N assigned courier");
assert.equal(
  eligible(minutes(10), { orderStatus: "CUSTOMER_CONFIRMED" }),
  false,
  "unpaid customer-confirmed order is not a new rematch path"
);

assert.match(rematchFn, /createdAt: \{ gt: searchStartedAfter \}/);
assert.match(rematchFn, /updatedAt: \{ lt: staleBefore \}/);
assert.match(rematchFn, /status: CommerceOrderStatus\.READY_FOR_PICKUP/);
assert.doesNotMatch(rematchFn, /paymentStatus/);
const updateAt = rematchFn.indexOf("prisma.commerceOrder.update");
const filterAt = rematchFn.indexOf("createdAt: { gt: searchStartedAfter }");
assert.ok(filterAt > 0 && updateAt > filterAt, "updates stay behind the age filter");

console.log(JSON.stringify({
  ok: true,
  maxMinutes: DEFAULT_MAX_COURIER_SEARCH_MINUTES,
  ageSource: "DeliveryGig.createdAt",
  cases: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O"]
}));
