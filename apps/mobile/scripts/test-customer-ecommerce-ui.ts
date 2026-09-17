/**
 * Static checks for customer ecommerce Phase 2 UI wiring (no device/DB).
 * Run: npx tsx apps/mobile/scripts/test-customer-ecommerce-ui.ts
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

const files = [
  "navigation/ClientTabs.tsx",
  "navigation/AppNavigator.tsx",
  "navigation/types.ts",
  "screens/commerce/ShopHomeScreen.tsx",
  "screens/commerce/ProductSearchScreen.tsx",
  "screens/commerce/ProductDetailScreen.tsx",
  "screens/commerce/ShopDetailScreen.tsx",
  "screens/commerce/CartScreen.tsx",
  "screens/commerce/CommerceCheckoutScreen.tsx",
  "screens/commerce/CommerceOrdersScreen.tsx",
  "screens/commerce/CommerceOrderDetailScreen.tsx",
  "components/ProductCard.tsx",
  "stores/commerce-cart.store.ts",
  "stores/shop-location.store.ts",
  "lib/api.ts"
];

for (const f of files) read(f);

const tabs = read("navigation/ClientTabs.tsx");
for (const name of ["Home", "Search", "Orders", "Cart", "Account"]) {
  assert.ok(tabs.includes(`name="${name}"`), `ClientTabs missing ${name}`);
}
assert.ok(!tabs.includes('name="MyGigs"'), "MyGigs tab must not be primary shop nav");
assert.ok(!tabs.includes("Workers"), "Workers tab must not appear");

const card = read("components/ProductCard.tsx");
assert.ok(card.includes("onError"), "image fallback on error");
assert.ok(card.includes("loading"), "lazy loading hint");
assert.ok(card.includes("accessibilityLabel"), "a11y labels");

const cart = read("stores/commerce-cart.store.ts");
assert.ok(cart.includes("Different shop"), "one-store rule alert");
assert.ok(cart.includes("productId"), "uses Product offer ids");

const home = read("screens/commerce/ShopHomeScreen.tsx");
assert.ok(home.includes("Deliver to"), "location first");
assert.ok(home.includes("Products near you") || home.includes("Popular near you"), "popular products");
assert.ok(home.includes("Nearby shops"), "nearby shops");
assert.ok(!/\bGig\b/.test(home.replace(/PostGig|MyGigsActivity/g, "")), "no Gig terminology on home");

const orders = read("screens/commerce/CommerceOrdersScreen.tsx");
assert.ok(orders.includes("Orders"), "orders screen");
assert.ok(!orders.includes("My Gigs"), "no My Gigs label");

const api = read("lib/api.ts");
for (const m of [
  "commerceNearbyProducts",
  "commerceProductDetail",
  "commerceShop",
  "commerceCartQuote",
  "commerceCheckout",
  "commerceOrders"
]) {
  assert.ok(api.includes(m), `api missing ${m}`);
}

const checkout = read("screens/commerce/CommerceCheckoutScreen.tsx");
assert.ok(checkout.includes("ECOCASH"), "EcoCash option");
assert.ok(checkout.includes("ONEMONEY"), "OneMoney option");
assert.ok(checkout.includes("CASH"), "Cash option");

console.log(JSON.stringify({ ok: true, filesChecked: files.length }, null, 2));
