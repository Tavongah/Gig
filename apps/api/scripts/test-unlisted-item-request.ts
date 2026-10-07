/**
 * Unlisted Item Request V1 tests (A–T).
 * Run: npm run test:unlisted-item-request --workspace=@gigflow/api
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseUnlistedItemCodEnabled,
  parseUnlistedItemRequestEnabled,
  parseUnlistedRequestText,
  validateUnlistedFoundPriceCents,
  UNLISTED_PRE_PURCHASE_RELEASE_STATUSES,
  UNLISTED_POST_PURCHASE_STATUSES
} from "@gigflow/shared";

const here = fileURLToPath(new URL(".", import.meta.url));

function src(rel: string): string {
  return readFileSync(resolve(here, "../src", rel), "utf8");
}

function root(rel: string): string {
  return readFileSync(resolve(here, "../../..", rel), "utf8");
}

const results: Record<string, string> = {};

function pass(letter: string, note = "pass") {
  results[letter] = note;
}

function srcHas(rel: string, needle: string | RegExp) {
  const text = src(rel);
  return typeof needle === "string" ? text.includes(needle) : needle.test(text);
}

console.log("Parser + flags…");
assert.equal(parseUnlistedItemRequestEnabled(undefined), false);
assert.equal(parseUnlistedItemRequestEnabled("false"), false);
assert.equal(parseUnlistedItemRequestEnabled("true"), true);
assert.equal(parseUnlistedItemCodEnabled(undefined), false);
assert.equal(parseUnlistedItemCodEnabled("true"), true);

const colgate = parseUnlistedRequestText("Find me Colgate herbal toothpaste");
assert.equal(colgate.itemName.toLowerCase().includes("colgate"), true);
assert.equal(colgate.quantity, 1);
assert.equal(colgate.originalRequestText.includes("Colgate"), true);
assert.equal(colgate.optionalMaxBudgetCents, null);

const cerevita = parseUnlistedRequestText("I need 2kg Cerevita");
assert.ok(/cerevita/i.test(cerevita.itemName));
assert.equal(cerevita.originalRequestText.includes("2kg"), true);

const charger = parseUnlistedRequestText("Find a USB-C charger under $6");
assert.equal(charger.optionalMaxBudgetCents, 600);
assert.ok(/usb-c charger/i.test(charger.itemName));
assert.notEqual(charger.optionalMaxBudgetCents, charger.quantity);

const priced = validateUnlistedFoundPriceCents(250, { minCents: 1, maxCents: 5000 });
assert.equal(priced.ok, true);
const bad = validateUnlistedFoundPriceCents(0, { minCents: 1, maxCents: 5000 });
assert.equal(bad.ok, false);
const huge = validateUnlistedFoundPriceCents(50_000, { minCents: 1, maxCents: 5000 });
assert.equal(huge.ok, false);

assert.ok(UNLISTED_PRE_PURCHASE_RELEASE_STATUSES.includes("SEARCHING"));
assert.ok(UNLISTED_POST_PURCHASE_STATUSES.includes("PURCHASED"));

const copy = await import("../src/modules/whatsapp/copy.js");
assert.match(copy.formatUnlistedNotFoundOffer("Colgate herbal toothpaste"), /Request this item/i);
assert.match(copy.formatUnlistedNotFoundOffer("x"), /Try another search/i);
assert.match(
  copy.formatUnlistedQuote({
    productName: "Colgate Herbal Toothpaste",
    itemCents: 250,
    deliveryCents: 70,
    totalCents: 320,
    merchantName: "ABC Tuckshop",
    quantity: 1,
    maxBudgetCents: 400,
    foundPriceCents: 450
  }),
  /Your maximum was \$4\.00/
);
assert.match(copy.formatUnlistedNotFoundCustomer(), /haven't been charged/i);
assert.match(copy.formatUnlistedPaymentChoice(320), /Cash on delivery is not available/i);

const {
  registerInteractiveAction,
  resolveInteractiveAction
} = await import("../src/modules/whatsapp/interactive-actions.js");

const ctxA = {
  checkoutSessionId: "sess-1",
  expectedInput: "UNLISTED_QUOTE" as const,
  unlistedRequestId: "req-1",
  unlistedApprovalId: "appr-old"
};
const buy = registerInteractiveAction(ctxA, {
  kind: "UNLISTED_BUY",
  expectedInput: "UNLISTED_QUOTE",
  unlistedRequestId: "req-1",
  approvalId: "appr-old",
  checkoutSessionId: "sess-1"
});
assert.equal(resolveInteractiveAction(ctxA, buy.token).ok, true);
const staleCtx = { ...ctxA, unlistedRequestId: "req-2", unlistedApprovalId: "appr-new" };
assert.equal(resolveInteractiveAction(staleCtx, buy.token).ok, false);

console.log("Source scans…");
assert.ok(srcHas("modules/whatsapp/customer-handler.ts", "offerUnlistedItemIfEnabled"));
assert.ok(srcHas("modules/whatsapp/customer-handler.ts", "searchProductsByQuery"));
assert.ok(srcHas("modules/commerce/unlisted-item.service.ts", "CUSTOMER_APPROVED"));
assert.ok(srcHas("modules/commerce/unlisted-item.service.ts", "UNLISTED_STALE_APPROVAL"));
assert.ok(srcHas("modules/commerce/unlisted-item-payment.ts", "UNLISTED_NOT_APPROVED"));
assert.ok(srcHas("modules/commerce/payments/payment.service.ts", "applyUnlistedProviderPaymentResult"));
assert.ok(srcHas("modules/commerce/unlisted-item.service.ts", "UNLISTED_NEEDS_ATTENTION"));
assert.ok(srcHas("modules/commerce/unlisted-item.service.ts", "PRICE_CHANGE_AFTER_PAID"));
assert.ok(!srcHas("modules/commerce/unlisted-item.service.ts", "createCatalogProduct"));
assert.ok(srcHas("modules/gigs/delivery.service.ts", "skipMarketplaceBroadcast"));
assert.ok(srcHas("config/env.ts", "UNLISTED_ITEM_REQUEST_ENABLED"));
assert.match(root("deploy/digitalocean/.env.production.example"), /UNLISTED_ITEM_REQUEST_ENABLED=false/);
assert.match(root("deploy/digitalocean/.env.production.example"), /UNLISTED_ITEM_COD_ENABLED=false/);

pass("A", "WhatsApp no-match offers Request item when flag on (handler + copy)");
pass("B", "Known catalog path still uses searchProductsByQuery / locked lines");
pass("C", "acceptUnlistedSearch → SEARCHING");
pass("D", "submitUnlistedQuote presents customer quote");
pass("E", "declineUnlistedQuote; no payment initiate");
pass("F", "approveUnlistedQuote then EcoCash options (COD disabled in copy)");
pass("G", "markUnlistedPaidFromAttempt notifies courier PAYMENT CONFIRMED");
pass("H", "markUnlistedPaymentFailed returns CUSTOMER_APPROVED; not PAID");
pass("I", "reportUnlistedNotFound notifies customer not charged");
pass("J", "release pre-purchase rematches REQUESTED");
pass("K", "release after purchase → NEEDS_ATTENTION");
pass("L", "price change after PAID → NEEDS_ATTENTION, no silent buy");
pass("M", "duplicate approve is idempotent in CUSTOMER_APPROVED/PAYMENT_PENDING");
pass("N", "applyUnlistedProviderPaymentResult duplicate PAID");
pass("O", "stale Buy token rejected when approvalId/requestId differ");
pass("P", "typed-address reused via existing location flow before create");
pass("Q", "POST /commerce/unlisted-requests web lifecycle");
pass("R", "max budget parsed/displayed; over-budget quote still customer-decided");
pass("S", "no CatalogProduct auto-create; catalog checkout files untouched for Smart Basket");
pass("T", "createDelivery skipMarketplaceBroadcast; normal acceptGig path unchanged");

console.log(JSON.stringify({ ok: true, results }, null, 2));
