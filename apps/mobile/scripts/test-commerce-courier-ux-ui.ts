/**
 * Mobile/PWA source checks for commerce courier UX (no native popups).
 * Run: npx tsx scripts/test-commerce-courier-ux-ui.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = join(__dirname, "..", "src");
function read(rel: string) {
  return readFileSync(join(src, rel), "utf8");
}

const job = read("screens/shared/DeliveryJobScreen.tsx");
const home = read("screens/worker/WorkerHomeScreen.tsx");
const nearby = read("screens/worker/WorkerNearbyGigsScreen.tsx");
const checkout = read("screens/commerce/CommerceCheckoutScreen.tsx");

assert.ok(!job.includes("showAlert("), "job has no showAlert");
assert.ok(!job.includes("showConfirm("), "job has no showConfirm");
assert.ok(job.includes("DutsInlineBanner"), "inline errors");
assert.ok(job.includes("Delivery accepted"), "accept success is inline");
assert.ok(home.includes("fulfillmentType === \"DELIVERY\""), "delivery accept skips confirm");
assert.ok(nearby.includes("fulfillmentType === \"DELIVERY\""), "nearby delivery accept skips confirm");
assert.ok(checkout.includes("YOUR DUTS ORDER"), "short one-order checkout");
assert.ok(checkout.includes("items"), "item count");
assert.ok(!checkout.includes("Checkout Shop A"), "no shop-by-shop checkout");

console.log("Commerce courier UX UI checks passed.");
