/**
 * Customer delivery estimate copy. No database.
 * Run: npx tsx scripts/test-delivery-estimate-copy.ts
 */
import assert from "node:assert/strict";
import {
  commerceCustomerStatusCopy,
  commerceShopUiStatusLabel,
  formatCustomerDeliveryEstimateMessage
} from "@gigflow/shared";

const start = "2026-11-04T12:00:00.000Z";
const end = "2026-11-04T14:00:00.000Z";

const first = formatCustomerDeliveryEstimateMessage({ start, end }, false);
assert.match(first, /Delivery update/);
assert.match(first, /Wednesday, 4 November/);
assert.match(first, /2:00 PM/);
assert.match(first, /4:00 PM/);
assert.doesNotMatch(first, /courier|accepted|assigned/i);

const changed = formatCustomerDeliveryEstimateMessage({ start, end }, true);
assert.match(changed, /has changed/);
assert.match(changed, /Wednesday, 4 November/);
assert.doesNotMatch(changed, /courier/i);

const dateOnly = formatCustomerDeliveryEstimateMessage({ start }, false);
assert.equal(dateOnly, "Estimated delivery: Wednesday, 4 November.");

assert.equal(
  commerceShopUiStatusLabel("COURIER_ASSIGNED", "WORKER_ASSIGNED", { start, end }),
  "Estimated delivery: Nov 4, 2 PM–4 PM"
);
assert.equal(commerceShopUiStatusLabel("COURIER_ASSIGNED"), "Preparing your order");
assert.equal(commerceCustomerStatusCopy("COURIER_ASSIGNED"), "Preparing your order.");
assert.equal(commerceCustomerStatusCopy("OUT_FOR_DELIVERY"), "Your order is out for delivery.");
assert.doesNotMatch(commerceCustomerStatusCopy("COURIER_ASSIGNED"), /courier/i);

console.log("delivery estimate copy ok");
