/**
 * Static checks for Smart Basket V1 UI.
 * Run: npx tsx scripts/test-smart-basket-ui.ts
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

const store = read("stores/desired-basket.store.ts");
assert.ok(store.includes("catalogProductId"), "desired basket uses CatalogProduct IDs");
assert.ok(!store.includes("productId: string"), "desired basket does not invent Product IDs");
assert.ok(store.includes("fromPriceCents"), "discovery From price is labeled separately");

const cartStore = read("stores/commerce-cart.store.ts");
assert.ok(cartStore.includes("productId: string"), "merchant cart still uses Product IDs");
assert.ok(cartStore.includes("Different shop"), "one-store rule remains");

const add = read("lib/storefront-cart.ts");
assert.ok(add.includes("isSmartBasketEnabled"), "product-first add gated");
assert.ok(add.includes("addItem"), "catalog ADD goes to desired basket");
assert.ok(add.includes("addOffer"), "merchant-offer add path remains");

const shop = read("screens/commerce/ShopDetailScreen.tsx");
assert.ok(shop.includes("addOffer"), "shop page still merchant-specific");
assert.ok(!shop.includes("addCatalogProduct"), "shop page is not forced through matching");

const cart = read("screens/commerce/CartScreen.tsx");
assert.ok(cart.includes("Your shopping list"), "shopping list heading");
assert.ok(cart.includes("Find a shop"), "Find a Shop CTA");
assert.ok(cart.includes("From $"), "From price labeled");
assert.ok(cart.includes("Continue to order"), "merchant cart checkout remains");
assert.ok(cart.includes("GuestCheckoutChoice"), "WhatsApp/account handoff unchanged");

const match = read("screens/commerce/BasketMatchScreen.tsx");
assert.ok(match.includes("We found your items") || match.includes("Everything is available"), "complete match copy");
assert.ok(match.includes("of your"), "partial match copy");
assert.ok(match.includes("Other shops"), "other shops");
assert.ok(match.includes("Unavailable"), "missing items explicit");
assert.ok(match.includes("couldn't find these items nearby") || match.includes("We couldn"), "empty results copy");
assert.ok(match.includes("Something changed at this shop"), "race UX");
assert.ok(match.includes("commerceBasketSelect"), "server conversion");
assert.ok(match.includes("replaceCart"), "writes merchant cart");
assert.ok(!match.includes("Best shop"), "do not call it Best shop");
assert.ok(!match.includes("Cheapest shop"), "do not call it Cheapest shop");
assert.ok(!match.includes("deliveryFee"), "no fake delivery fee on match screen");

const detail = read("screens/commerce/ProductDetailScreen.tsx");
assert.ok(detail.includes("ADD TO CART"), "merchant-specific add remains");
assert.ok(detail.includes("Available nearby"), "product-first nearby copy");
assert.ok(detail.includes("Coming soon"), "coming soon preserved");

const api = read("lib/api.ts");
assert.ok(api.includes("/commerce/basket/match"), "match API");
assert.ok(api.includes("/commerce/basket/select"), "select API");
assert.ok(api.includes("catalogProductId"), "match items are catalog ids");

const nav = read("navigation/AppNavigator.tsx");
assert.ok(nav.includes("BasketMatch"), "match screen registered");
assert.ok(read("navigation/GuestAppNavigator.tsx").includes("BasketMatch"), "guest match screen");

const flag = readFileSync(join(root, "app.config.ts"), "utf8");
assert.ok(flag.includes("smartBasketEnabled"), "mobile feature flag");

console.log(JSON.stringify({ ok: true }, null, 2));
