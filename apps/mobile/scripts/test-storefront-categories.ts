/**
 * Storefront marketplace category expansion checks.
 * Run: npx tsx scripts/test-storefront-categories.ts
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  STOREFRONT_CATEGORIES,
  allLiveCatalogCategories,
  canPurchaseStorefrontCategory,
  comingSoonCategories,
  featuredLiveCategories,
  isAlcoholRestrictedCategory,
  isPublicStorefrontCatalogProduct,
  matchComingSoonFromSearch,
  parseAlcoholCommerceEnabled,
  parseSmartBasketEnabled,
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
assert.equal(parseSmartBasketEnabled(undefined), true);
assert.equal(parseSmartBasketEnabled("false"), false);
assert.ok(isAlcoholRestrictedCategory("Alcohol"));
assert.ok(!isAlcoholRestrictedCategory("Drinks"));
assert.ok(!isAlcoholRestrictedCategory("Soft Drinks"));
assert.equal(canPurchaseStorefrontCategory("Alcohol", false), false);
assert.equal(canPurchaseStorefrontCategory("Alcohol", true), true);
assert.equal(canPurchaseStorefrontCategory("Groceries", false), true);

const catalog = ["Groceries", "Drinks", "Household", "Personal Care", "Vegetables", "Staples", "Soft Drinks", "Shoes", "Baby Products"];
const featured = featuredLiveCategories(catalog).map((c) => c.label);
assert.ok(featured.includes("Groceries"));
assert.ok(featured.includes("Drinks"));
assert.ok(featured.includes("Alcohol"));
assert.ok(!featured.includes("Fashion"));
assert.ok(!featured.includes("Soft Drinks"));

const soon = comingSoonCategories(catalog).map((c) => c.label);
assert.equal(soon.length, 0, "coming-soon category restriction removed");
assert.ok(!soon.includes("Shoes"));
assert.ok(!soon.includes("Fashion"));
assert.ok(!soon.includes("Groceries"));
assert.equal(STOREFRONT_CATEGORIES.find((c) => c.slug === "alcohol")?.state, "RESTRICTED");
assert.equal(STOREFRONT_CATEGORIES.find((c) => c.slug === "alcohol")?.requiresAgeGate, true);
assert.equal(STOREFRONT_CATEGORIES.find((c) => c.slug === "shoes")?.state, "LIVE");
assert.equal(resolveStorefrontCategory("fashion")?.state, "LIVE");
assert.equal(resolveStorefrontCategory("shoes")?.state, "LIVE");
assert.equal(resolveStorefrontCategory("Groceries", catalog)?.state, "LIVE");
assert.equal(resolveStorefrontCategory("Shoes", catalog)?.state, "LIVE");
assert.equal(resolveStorefrontCategory("Shoes", catalog)?.catalogName, "Shoes");
assert.equal(matchComingSoonFromSearch("shoes", catalog), undefined);
assert.equal(matchComingSoonFromSearch("mazoe", catalog), undefined);

const live = allLiveCatalogCategories(catalog).map((c) => c.catalogName ?? c.label);
assert.ok(live.includes("Groceries"));
assert.ok(live.includes("Shoes"));
assert.ok(live.includes("Baby Products"));
assert.ok(allLiveCatalogCategories(["Groceries"]).some((c) => c.label === "Shoes" && c.state === "LIVE"));
assert.ok(!featuredLiveCategories(["Groceries"]).some((c) => c.label === "Shoes"));
assert.equal(isPublicStorefrontCatalogProduct({ id: "ok", status: "APPROVED" }), true);
assert.equal(isPublicStorefrontCatalogProduct({ id: "pending", status: "PENDING" }), false);
assert.equal(isPublicStorefrontCatalogProduct({ id: "rejected", status: "REJECTED" }), false);
assert.equal(isPublicStorefrontCatalogProduct({ id: "archived", status: "ARCHIVED" }), false);

const home = read("screens/commerce/ShopHomeScreen.tsx");
assert.ok(home.includes("Coming to DUTS"));
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
assert.ok(all.includes("Coming to DUTS"));

const header = read("components/StoreHeader.tsx");
assert.ok(header.includes("All categories"));

const card = read("components/ProductCard.tsx");
assert.ok(card.includes("alcoholPurchaseAllowed"));

const detail = read("screens/commerce/ProductDetailScreen.tsx");
assert.ok(detail.includes("Alcohol ordering is coming at launch."));
assert.ok(detail.includes("alcoholPurchaseAllowed"));

const cart = read("lib/storefront-cart.ts");
assert.ok(cart.includes("alcoholPurchaseAllowed"));

const nav = read("lib/storefront-nav.ts");
assert.ok(nav.includes('dest.state === "LIVE"'));
assert.ok(nav.includes("dest.catalogName ?? dest.label"));
assert.match(nav, /navigate\("ProductSearch"/);
assert.ok(nav.includes("MarketplaceCategory"), "restricted destinations still use marketplace screen");

const search = read("screens/commerce/ProductSearchScreen.tsx");
assert.ok(search.includes("comingSoonFromQuery"));
assert.ok(search.includes("commerceNearbyProducts"));

console.log(JSON.stringify({ ok: true }, null, 2));
