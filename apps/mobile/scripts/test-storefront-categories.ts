/**
 * Storefront marketplace category expansion checks.
 * Run: npx tsx scripts/test-storefront-categories.ts
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  STOREFRONT_CATEGORIES,
  canPurchaseStorefrontCategory,
  comingSoonCategories,
  featuredLiveCategories,
  isAlcoholRestrictedCategory,
  matchComingSoonFromSearch,
  parseAlcoholCommerceEnabled,
  resolveStorefrontCategory
} from "@gigflow/shared";

const src = join(__dirname, "..", "src");
function read(rel: string) {
  const p = join(src, rel);
  assert.ok(existsSync(p), `missing ${rel}`);
  return readFileSync(p, "utf8");
}

assert.equal(parseAlcoholCommerceEnabled(undefined), false);
assert.equal(parseAlcoholCommerceEnabled("false"), false);
assert.equal(parseAlcoholCommerceEnabled("true"), true);
assert.ok(isAlcoholRestrictedCategory("Alcohol"));
assert.ok(!isAlcoholRestrictedCategory("Drinks"));
assert.ok(!isAlcoholRestrictedCategory("Soft Drinks"));
assert.equal(canPurchaseStorefrontCategory("Alcohol", false), false);
assert.equal(canPurchaseStorefrontCategory("Alcohol", true), true);
assert.equal(canPurchaseStorefrontCategory("Groceries", false), true);

const catalog = ["Groceries", "Drinks", "Household", "Personal Care", "Vegetables", "Staples", "Soft Drinks"];
const featured = featuredLiveCategories(catalog).map((c) => c.label);
assert.ok(featured.includes("Groceries"));
assert.ok(featured.includes("Drinks"));
assert.ok(featured.includes("Alcohol"));
assert.ok(!featured.includes("Fashion"));
assert.ok(!featured.includes("Soft Drinks"));

const soon = comingSoonCategories(catalog).map((c) => c.label);
for (const label of [
  "Fashion",
  "Shoes",
  "Electronics",
  "Auto Parts",
  "Home & Furniture",
  "Beauty",
  "Baby",
  "Sports & Outdoors"
]) {
  assert.ok(soon.includes(label), `missing coming soon ${label}`);
}
assert.ok(!soon.includes("Groceries"));
assert.equal(STOREFRONT_CATEGORIES.find((c) => c.slug === "alcohol")?.state, "RESTRICTED");
assert.equal(STOREFRONT_CATEGORIES.find((c) => c.slug === "alcohol")?.requiresAgeGate, true);
assert.equal(resolveStorefrontCategory("fashion")?.state, "COMING_SOON");
assert.equal(resolveStorefrontCategory("Groceries", catalog)?.state, "LIVE");
assert.equal(matchComingSoonFromSearch("shoes")?.label, "Shoes");
assert.equal(matchComingSoonFromSearch("mazoe"), undefined);

const home = read("screens/commerce/ShopHomeScreen.tsx");
assert.ok(home.includes("More on DUTS"));
assert.ok(home.includes("Shop by category"));
assert.ok(!home.includes("waitlist"));
assert.ok(!home.includes("Best sellers"));

const coming = read("screens/commerce/MarketplaceCategoryScreen.tsx");
assert.ok(coming.includes("is coming to DUTS"));
assert.ok(coming.includes("BACK TO SHOPPING"));
assert.ok(coming.includes("Age-restricted products"));
assert.ok(coming.includes("Alcohol ordering is coming at launch."));
assert.ok(!coming.includes("CatalogProduct"));
assert.ok(!coming.includes("0 products"));

const all = read("screens/commerce/AllCategoriesScreen.tsx");
assert.ok(all.includes("All categories"));
assert.ok(all.includes("More on DUTS"));

const header = read("components/StoreHeader.tsx");
assert.ok(header.includes("All categories"));

const card = read("components/ProductCard.tsx");
assert.ok(card.includes("alcoholPurchaseAllowed"));

const detail = read("screens/commerce/ProductDetailScreen.tsx");
assert.ok(detail.includes("Alcohol ordering is coming at launch."));
assert.ok(detail.includes("alcoholPurchaseAllowed"));

const cart = read("lib/storefront-cart.ts");
assert.ok(cart.includes("alcoholPurchaseAllowed"));

console.log(JSON.stringify({ ok: true }, null, 2));
