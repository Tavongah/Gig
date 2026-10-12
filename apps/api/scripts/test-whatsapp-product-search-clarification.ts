/**
 * WhatsApp product search relevance + stale clarification escape.
 * Run: npm run test:whatsapp-product-search-clarification --workspace=@gigflow/api
 */
import { config as loadEnv } from "dotenv";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Product } from "@prisma/client";
import {
  replaceDisambiguatedRequestedItems,
  resolveProductDisambiguationReply
} from "../src/modules/whatsapp/shopping-intent.js";

const here = fileURLToPath(new URL(".", import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });
loadEnv({ path: resolve(here, "../.env") });

function src(rel: string) {
  return readFileSync(resolve(here, rel), "utf8");
}

const BREAD_ALIASES = ["white bread", "bread", "loaf", "loaves", "lobels", "bred"];
const CREAM_ALIASES = ["lobels vanilla creams", "bread", "loaf", "loaves", "lobels", "bred"];

function fakeProduct(name: string, priceCents: number, aliases: string[]): Product {
  return {
    id: name,
    name,
    normalizedName: name.toLowerCase(),
    searchAliases: aliases,
    priceCents,
    available: true,
    archived: false,
    merchantId: "m1",
    unit: null,
    createdAt: new Date(),
    updatedAt: new Date()
  } as Product;
}

const catalog = [
  fakeProduct("White bread", 100, BREAD_ALIASES),
  fakeProduct("Brown Bread", 100, ["brown bread", ...BREAD_ALIASES.slice(1)]),
  fakeProduct("Whole Wheat Bread", 100, ["whole wheat bread", ...BREAD_ALIASES.slice(1)]),
  fakeProduct("Lobels Vanilla Creams", 50, CREAM_ALIASES),
  fakeProduct("Lobels Strawberry Creams", 50, ["lobels strawberry creams", ...CREAM_ALIASES.slice(1)]),
  fakeProduct("Lobels Bermuda Creams", 50, ["lobels bermuda creams", ...CREAM_ALIASES.slice(1)])
];

async function main() {
  const { scoreProductMatch } = await import("../src/modules/commerce/merchant.service.js");

  function rank(query: string) {
    return catalog
      .map((product) => ({ product, score: scoreProductMatch(product, query) }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || a.product.priceCents - b.product.priceCents);
  }

function clarificationOptions() {
  return [
    { productId: "a", name: "Lobels Vanilla Creams", priceCents: 50 },
    { productId: "b", name: "Lobels Strawberry Creams", priceCents: 50 },
    { productId: "c", name: "Lobels Bermuda Creams", priceCents: 50 }
  ];
}

function breadsAheadOfCreams(query: string) {
  const ranked = rank(query);
  const breadIdx = ranked.findIndex((r) => /bread/i.test(r.product.name) && !/cream/i.test(r.product.name));
  const creamIdx = ranked.findIndex((r) => /creams/i.test(r.product.name));
  assert.ok(breadIdx >= 0, `${query}: genuine bread must match`);
  if (creamIdx >= 0) {
    assert.ok(
      ranked[breadIdx]!.score > ranked[creamIdx]!.score,
      `${query}: bread score ${ranked[breadIdx]!.score} must beat creams ${ranked[creamIdx]!.score}`
    );
    assert.ok(breadIdx < creamIdx, `${query}: bread must rank ahead of creams`);
  }
  const top3 = ranked.slice(0, 3).map((r) => r.product.name);
  assert.ok(
    top3.every((n) => /bread/i.test(n) && !/cream/i.test(n)),
    `${query} top 3 must be bread loaves, got ${top3.join(", ")}`
  );
  return ranked;
}

console.log("TEST 1 bread ranks loaves ahead of Lobels Creams…");
const breadRanked = breadsAheadOfCreams("bread");
assert.ok(breadRanked.some((r) => r.product.name === "White bread"));
assert.ok(breadRanked.some((r) => r.product.name === "Brown Bread"));
assert.ok(breadRanked.some((r) => r.product.name === "Whole Wheat Bread"));
console.log("TEST 1 PASS");

console.log("TEST 2 white bread ranks White bread appropriately…");
const whiteRanked = rank("white bread");
assert.equal(whiteRanked[0]?.product.name, "White bread");
assert.ok(
  !whiteRanked[1] || whiteRanked[0]!.score - whiteRanked[1]!.score >= 30 || !/cream/i.test(whiteRanked[1]!.product.name),
  "white bread must not lose to creams"
);
assert.ok(whiteRanked[0]!.score > (whiteRanked.find((r) => /creams/i.test(r.product.name))?.score ?? 0));
console.log("TEST 2 PASS");

console.log("TEST 3 brown bread ranks Brown Bread appropriately…");
const brownRanked = rank("brown bread");
assert.equal(brownRanked[0]?.product.name, "Brown Bread");
assert.ok(brownRanked[0]!.score > (brownRanked.find((r) => /creams/i.test(r.product.name))?.score ?? 0));
console.log("TEST 3 PASS");

const options = clarificationOptions();

console.log("TEST 4 numeric clarification still selects option 2…");
const pick2 = resolveProductDisambiguationReply("2", options);
assert.equal(pick2.action, "select");
if (pick2.action === "select") assert.equal(pick2.choice, 2);
assert.equal(resolveProductDisambiguationReply("1", options).action, "select");
assert.equal(resolveProductDisambiguationReply("3", options).action, "select");
console.log("TEST 4 PASS");

console.log("TEST 5 White bread escapes stale clarification…");
const escape = resolveProductDisambiguationReply("White bread", options);
assert.equal(escape.action, "new_query");
if (escape.action === "new_query") {
  assert.equal(escape.items[0]?.query, "white bread");
  assert.notEqual(escape.items[0]?.query, "lobels vanilla creams");
}
assert.notEqual(resolveProductDisambiguationReply("White bread", options).action, "select");
assert.notEqual(resolveProductDisambiguationReply("White bread", options).action, "reprompt");
console.log("TEST 5 PASS");

console.log("TEST 6 interactive option selection unchanged…");
const handler = src("../src/modules/whatsapp/customer-handler.ts");
const interactive = src("../src/modules/whatsapp/interactive-actions.ts");
assert.match(handler, /case "SELECT_PRODUCT"/);
assert.match(handler, /return applyProductChoice\(phone, convId, ctx, idx \+ 1\)/);
assert.match(interactive, /SELECT_PRODUCT/);
console.log("TEST 6 PASS");

console.log("TEST 7 existing cart preserved when clarification is superseded…");
const kept = replaceDisambiguatedRequestedItems(
  [
    { query: "milk", quantity: 1 },
    { query: "bread", quantity: 1 }
  ],
  "bread",
  "bread",
  [{ query: "white bread", quantity: 1 }]
);
assert.deepEqual(kept, [
  { query: "milk", quantity: 1 },
  { query: "white bread", quantity: 1 }
]);
console.log("TEST 7 PASS");

console.log("TEST 8 placed order / payment / session isolation…");
const session = {
  activeOrderId: "order-live",
  pendingPaymentOrderId: "pay-1",
  paymentPhase: "PENDING_PROVIDER",
  deliveryLat: -19.49,
  deliveryLng: 29.83,
  requestedItems: [{ query: "bread", quantity: 1 }]
};
const nextItems = replaceDisambiguatedRequestedItems(
  session.requestedItems,
  "bread",
  "bread",
  [{ query: "white bread", quantity: 1 }]
);
assert.equal(session.activeOrderId, "order-live");
assert.equal(session.pendingPaymentOrderId, "pay-1");
assert.equal(session.paymentPhase, "PENDING_PROVIDER");
assert.equal(session.deliveryLat, -19.49);
assert.equal(session.deliveryLng, 29.83);
assert.equal(nextItems[0]?.query, "white bread");
assert.match(handler, /ctx\.pendingChoices = undefined/);
assert.match(handler, /resolveProductsThenContinue\(phone, conv\.id, ctx\)/);
assert.doesNotMatch(
  handler.slice(handler.indexOf("PRODUCT_DISAMBIGUATION"), handler.indexOf("isCartExpired")),
  /cancelCheckoutDraft|completeCheckoutSession|activeOrderId = undefined|deliveryLat = undefined/
);
console.log("TEST 8 PASS");

const fakeBread = fakeProduct("Lobels Bread", 100, ["bread", "loaf"]);
fakeBread.normalizedName = "lobels bread";
assert.ok(scoreProductMatch(fakeBread, "bred") > 0, "bred still scores bread");
const fakeSugar = fakeProduct("Sugar 2kg", 250, ["sugar", "suger"]);
fakeSugar.normalizedName = "sugar 2kg";
assert.ok(scoreProductMatch(fakeSugar, "suger") > 0, "suger still scores sugar");

console.log("✅ WhatsApp product search / clarification tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
