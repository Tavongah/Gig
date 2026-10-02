/**
 * Static checks for checkout-prep human errors.
 * Run: npx tsx scripts/test-checkout-prep.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const service = readFileSync(resolve(here, "../src/modules/commerce/customer-commerce.service.ts"), "utf8");
const routes = readFileSync(resolve(here, "../src/modules/commerce/customer-commerce.routes.ts"), "utf8");

assert.ok(routes.includes('/cart/prepare'), "prepare route");
assert.ok(service.includes("export async function prepareCheckout"), "prepareCheckout exported");
assert.ok(service.includes("Tell us where to deliver."), "location missing");
assert.ok(service.includes("Some items are no longer available."), "product unavailable");
assert.ok(service.includes("This shop isn't taking orders right now."), "shop closed");
assert.ok(service.includes("We can't deliver this order to this location yet."), "too far");
assert.ok(service.includes("Your delivery already includes 3 shops."), "shop cap");
assert.ok(service.includes("That's too many items for one order."), "too many items");
assert.ok(service.includes("checkoutCart") && service.includes("prepareCheckout"), "checkout uses prep errors");
assert.ok(!service.includes("sub-order"), "no sub-order leak");

console.log(JSON.stringify({ ok: true }, null, 2));
