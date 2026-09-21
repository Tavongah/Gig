/**
 * Visual redesign static checks.
 * Run: npx tsx scripts/test-storefront-visual.ts
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const src = join(__dirname, "..", "src");
function read(rel: string) {
  const p = join(src, rel);
  assert.ok(existsSync(p), `missing ${rel}`);
  return readFileSync(p, "utf8");
}

const ui = read("lib/storefront-ui.ts");
assert.ok(ui.includes("productCardMeta"), "brand/size helper");
assert.ok(ui.includes("STOREFRONT_MAX_WIDTH"), "desktop max width");
assert.ok(ui.includes("categoryIcon"), "category icons");

const card = read("components/ProductCard.tsx");
assert.ok(card.includes("Coming soon"), "subdued unavailable copy");
assert.ok(!/\bVIEW\b/.test(card), "VIEW CTA removed");
assert.ok(card.includes("h-8 w-8"), "compact add");
assert.ok(card.includes("onError"), "image failure placeholder");
assert.ok(card.includes("numberOfLines={2}"), "name clamp");

const header = read("components/StoreHeader.tsx");
assert.ok(header.includes("Search DUTS"));
assert.ok(header.includes("Shopping near"));
assert.ok(header.includes("Deliver to"));
assert.ok(header.includes("cartCount"));

const home = read("screens/commerce/ShopHomeScreen.tsx");
assert.ok(home.includes("ProductRail"), "category carousels");
assert.ok(home.includes("Shop by category"));
assert.ok(!home.includes("Best sellers"));
assert.ok(!home.includes("Trending"));
assert.ok(!home.includes("Recommended for you"));

const guestTabs = read("navigation/GuestTabs.tsx");
assert.ok(guestTabs.includes("isDesktopNav"));
assert.ok(guestTabs.includes("Home") && guestTabs.includes("Search") && guestTabs.includes("Cart"));

const guestNav = read("navigation/GuestAppNavigator.tsx");
assert.ok(guestNav.includes('name="ProductSearch"') && guestNav.includes("headerShown: false"));

console.log(JSON.stringify({ ok: true }, null, 2));
