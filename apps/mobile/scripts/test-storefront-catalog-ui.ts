/**
 * Static checks for full-catalog storefront browsing UI.
 * Run: npx tsx scripts/test-storefront-catalog-ui.ts
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const src = join(root, "src");

function read(rel: string) {
  const p = join(src, rel);
  assert.ok(existsSync(p), `missing ${rel}`);
  return readFileSync(p, "utf8");
}

const card = read("components/ProductCard.tsx");
assert.ok(card.includes("Coming soon"), "catalog-only price copy");
assert.ok(!card.includes("VIEW"), "non-purchasable VIEW removed");
assert.ok(!card.includes("Price coming soon"), "do not shout Price coming soon on cards");
assert.ok(card.includes("isProductCardPurchasable"), "purchasable gate");
assert.ok(card.includes('resizeMode="contain"'), "object-fit contain");
assert.ok(card.includes('loading: "lazy"'), "lazy images");
assert.ok(card.includes("numberOfLines={2}"), "long-name clamp");
assert.ok(card.includes("fromPriceCents: number | null"), "nullable price");
assert.ok(card.includes("85%"), "image canvas containment");
assert.ok(!card.includes("$0.00") || card.includes("purchasable"), "do not always render $0.00");

const grid = read("components/ProductGrid.tsx");
assert.ok(grid.includes("columns"), "responsive columns");
assert.ok(grid.includes("ProductCardSkeleton"), "skeleton loading");

const header = read("components/StoreHeader.tsx");
assert.ok(header.includes("Search DUTS"), "prominent search");
assert.ok(header.includes("Shopping near"), "approximate area label");
assert.ok(header.includes("Cart"), "desktop cart");
assert.ok(header.includes("isDesktopNav"), "desktop vs mobile header");

const home = read("screens/commerce/ShopHomeScreen.tsx");
assert.ok(home.includes("Explore products"), "neutral heading");
assert.ok(home.includes("Shop by category"), "category quick links");
assert.ok(home.includes("See all"), "category sections");
assert.ok(!home.includes("Popular"), "no fake popularity");
assert.ok(home.includes("SHOW MORE PRODUCTS") || home.includes("Show more"), "pagination");
assert.ok(home.includes("addStorefrontProduct") || home.includes("isProductCardPurchasable"), "home add gated");
assert.ok(home.includes("useInfiniteQuery"), "paged catalog fetch");
assert.ok(home.includes("Need it? DUTS it."), "DUTS identity");

const search = read("screens/commerce/ProductSearchScreen.tsx");
assert.ok(search.includes("commerceNearbyProducts"), "search uses catalog API");
assert.ok(search.includes("SHOW MORE PRODUCTS") || search.includes("Show more"), "search pagination");
assert.ok(search.includes("addStorefrontProduct"), "search add gated");
assert.ok(search.includes("No products found"), "friendly empty state");
assert.ok(!search.includes("Set your location to see products available near you."), "search not geo-gated");

const detail = read("screens/commerce/ProductDetailScreen.tsx");
assert.ok(detail.includes("Coming soon"), "detail catalog-only copy");
assert.ok(detail.includes("Not available to order yet"), "friendly unavailable copy");
assert.ok(!detail.includes("No merchant"), "no internal architecture copy");
assert.ok(!detail.includes("CatalogProduct"), "no CatalogProduct leak");
assert.ok(detail.includes("purchasable"), "add only when purchasable");
assert.ok(detail.includes("ADD TO CART"), "purchasable CTA");

const api = read("lib/api.ts");
assert.ok(api.includes("purchasable"), "API card includes purchasable");
assert.ok(api.includes("fromPriceCents: number | null"), "nullable price on list");
assert.ok(api.includes("offset"), "pagination offset");
assert.ok(api.includes("Partial<CommerceBrowseGeo>"), "geo optional for catalog");

const cart = read("stores/commerce-cart.store.ts");
assert.ok(cart.includes("productId: string"), "cart uses merchant Product IDs");
assert.ok(!cart.includes("catalogProductId: string;"), "cart line key is not catalog id");

const tabs = read("navigation/GuestTabs.tsx");
assert.ok(tabs.includes("isDesktopNav"), "desktop hides bottom nav");
assert.ok(tabs.includes('display: "none"'), "desktop tab bar hidden");

const checkout = read("screens/commerce/CommerceCheckoutScreen.tsx");
assert.ok(checkout.includes("commerceCheckout") || checkout.includes("Checkout"), "checkout screen remains");

console.log(JSON.stringify({ ok: true }, null, 2));
