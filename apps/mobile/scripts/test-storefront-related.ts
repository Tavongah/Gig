/**
 * Contextual "More like this" recommendations.
 * Run: npx tsx scripts/test-storefront-related.ts
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isPublicStorefrontCatalogProduct } from "@gigflow/shared";
import {
  moreLikeThisScore,
  pickMoreLikeThis,
  relatedSearchQuery,
  type RelatedSeed
} from "../src/lib/storefront-related";

const src = join(__dirname, "..", "src");
function read(rel: string) {
  const p = join(src, rel);
  assert.ok(existsSync(p), `missing ${rel}`);
  return readFileSync(p, "utf8");
}

function item(id: string, name: string, category: string, brand: string | null = null): RelatedSeed {
  return { catalogProductId: id, name, category, brand, sizeLabel: null };
}

const shoes = item("shoe-a", "Men's Running Shoes", "Shoes", "Nike");
const shoeB = item("shoe-b", "Women's Running Shoes", "Shoes", "Adidas");
const shoeC = item("shoe-c", "School Shoes", "Shoes", null);
const cola = item("cola", "Coca-Cola", "Soft Drinks", "Coca-Cola");
const pickedShoes = pickMoreLikeThis({
  seed: shoes,
  candidates: [shoes, shoeB, shoeC, cola, shoeB],
  visitSeed: 1,
  limit: 10
});
assert.deepEqual(
  pickedShoes.map((p) => p.catalogProductId),
  ["shoe-b", "shoe-c"],
  "shoes recommend other shoes, exclude self and drinks, no duplicates"
);

const whiteBread = item("bread-w", "White Bread", "Groceries");
const brownBread = item("bread-b", "Brown Bread", "Groceries");
const wheatBread = item("bread-ww", "Whole Wheat Bread", "Groceries");
const soap = item("soap", "Bath Soap", "Groceries");
const breads = pickMoreLikeThis({
  seed: whiteBread,
  candidates: [whiteBread, brownBread, wheatBread, soap, cola],
  visitSeed: 3
});
assert.ok(breads.some((p) => p.catalogProductId === "bread-b"));
assert.ok(breads.some((p) => p.catalogProductId === "bread-ww"));
assert.ok(!breads.some((p) => p.catalogProductId === "soap"), "unrelated groceries do not dominate bread");
assert.ok(!breads.some((p) => p.catalogProductId === "cola"));
assert.ok(!breads.some((p) => p.catalogProductId === "bread-w"), "current product excluded");

const sevenUp = item("7up", "7up", "Soft Drinks");
const fanta = item("fanta", "Fanta Orange", "Soft Drinks");
const drinks = pickMoreLikeThis({
  seed: cola,
  candidates: [cola, sevenUp, fanta, shoeB],
  visitSeed: 4
});
assert.ok(drinks.some((p) => p.catalogProductId === "7up"));
assert.ok(drinks.some((p) => p.catalogProductId === "fanta"));
assert.ok(!drinks.some((p) => p.catalogProductId === "shoe-b"));
assert.ok(!drinks.some((p) => p.catalogProductId === "cola"));

assert.ok(moreLikeThisScore(whiteBread, brownBread) > moreLikeThisScore(whiteBread, soap));
assert.equal(isPublicStorefrontCatalogProduct({ id: "ok", status: "APPROVED" }), true);
assert.equal(isPublicStorefrontCatalogProduct({ id: "pending", status: "PENDING" }), false);
assert.equal(isPublicStorefrontCatalogProduct({ id: "rejected", status: "REJECTED" }), false);
assert.equal(isPublicStorefrontCatalogProduct({ id: "archived", status: "ARCHIVED" }), false);

const a = pickMoreLikeThis({ seed: shoes, candidates: [shoeB, shoeC], visitSeed: 11 });
const b = pickMoreLikeThis({ seed: shoes, candidates: [shoeB, shoeC], visitSeed: 11 });
assert.deepEqual(a, b, "same session seed is stable");
assert.ok(relatedSearchQuery(whiteBread).includes("bread"));

const detail = read("screens/commerce/ProductDetailScreen.tsx");
assert.ok(detail.includes("More like this"), "More like this section");
assert.ok(detail.includes("pickMoreLikeThis"), "uses shared picker");
assert.ok(detail.includes("commerceNearbyProducts"), "existing catalog read");
assert.ok(detail.includes("ProductRail"), "existing rail");
assert.ok(detail.includes("addStorefrontProduct"), "existing add path");
assert.ok(detail.includes("navigate(\"ProductDetail\""), "existing product detail navigation");
assert.ok(!detail.includes("You may also like"), "no complementary section without relationship metadata");
assert.ok(!detail.includes("Math.random"), "no per-render shuffle");
assert.ok(!detail.includes("CatalogProduct"), "no CatalogProduct leak");
assert.ok(detail.includes("ADD TO CART"), "existing CTA unchanged");
assert.ok(!detail.includes("openai"), "no AI");
assert.ok(!detail.includes("embedding"), "no embeddings");

const helper = read("lib/storefront-related.ts");
assert.ok(!helper.includes("Math.random()"));
assert.ok(helper.includes("rotateStorefrontProducts"), "equal-score rotation reuses session shuffle");

console.log(JSON.stringify({ ok: true }, null, 2));
