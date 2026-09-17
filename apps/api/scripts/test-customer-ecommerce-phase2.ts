/**
 * Offline Phase 2 customer ecommerce helpers (no DB).
 * Run: npx tsx apps/api/scripts/test-customer-ecommerce-phase2.ts
 */
import assert from "node:assert/strict";
import {
  commerceCustomerStatusCopy,
  commerceShopUiStatusLabel,
  expandSearchTerms,
  normalizeProductSearchName,
  type CommerceOrderStatus
} from "@gigflow/shared";

const statuses: CommerceOrderStatus[] = [
  "MERCHANT_PENDING",
  "MERCHANT_ACCEPTED",
  "READY_FOR_PICKUP",
  "COURIER_ASSIGNED",
  "PICKED_UP",
  "OUT_FOR_DELIVERY",
  "DELIVERED"
];

assert.equal(commerceShopUiStatusLabel("MERCHANT_PENDING"), "Waiting for shop");
assert.equal(commerceShopUiStatusLabel("MERCHANT_ACCEPTED"), "Shop preparing order");
assert.equal(commerceShopUiStatusLabel("READY_FOR_PICKUP"), "Ready for pickup");
assert.equal(commerceShopUiStatusLabel("COURIER_ASSIGNED"), "Courier assigned");
assert.equal(commerceShopUiStatusLabel("PICKED_UP"), "Order picked up");
assert.equal(commerceShopUiStatusLabel("OUT_FOR_DELIVERY"), "On the way");
assert.equal(commerceShopUiStatusLabel("DELIVERED"), "Delivered");
assert.equal(commerceShopUiStatusLabel("COURIER_ASSIGNED", "EN_ROUTE_PICKUP"), "Courier going to shop");

for (const s of statuses) {
  const wa = commerceCustomerStatusCopy(s);
  assert.ok(wa.length > 5, `WhatsApp copy present for ${s}`);
  assert.ok(!wa.includes("Gig"), `WhatsApp copy must not say Gig (${s})`);
  const ui = commerceShopUiStatusLabel(s);
  assert.ok(!ui.includes("Gig"), `Shop UI label must not say Gig (${s})`);
  assert.ok(!/^[A-Z_]+$/.test(ui), `Must not expose raw enum ${s}`);
}

const milk = expandSearchTerms(normalizeProductSearchName("milk"));
assert.ok(milk.length >= 1);
assert.ok(milk.includes("milk"));

const coke = expandSearchTerms(normalizeProductSearchName("coke 2l"));
assert.ok(coke.some((t) => t.includes("coca") || t.includes("coke")));

console.log(
  JSON.stringify(
    {
      ok: true,
      shopUiLabels: statuses.map((s) => ({ s, label: commerceShopUiStatusLabel(s) })),
      whatsappUnchangedSample: commerceCustomerStatusCopy("MERCHANT_PENDING")
    },
    null,
    2
  )
);
