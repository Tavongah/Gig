/**
 * Static checks for guest storefront + cart + WhatsApp handoff UI.
 * Run: npx tsx apps/mobile/scripts/test-guest-storefront-ui.ts
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

const app = readFileSync(join(root, "App.tsx"), "utf8");
assert.ok(app.includes("GuestAppNavigator"), "logged-out root uses GuestAppNavigator");
assert.ok(app.includes("guestLinking"), "guest linking present");
{
  const guestBlock = app.slice(app.indexOf("const guestLinking"), app.indexOf("const appLinking"));
  assert.ok(!guestBlock.includes("ShopLocation"), "guest deep links must not open exact location");
}
assert.ok(!app.includes("<AuthNavigator />"), "root must not force AuthNavigator");
assert.ok(app.includes("hydrateCommerceCart"), "cart hydrates for refresh persistence");
assert.ok(app.includes("claimCartAfterLogin"), "guest cart claimed after login");

const guestTabs = read("navigation/GuestTabs.tsx");
for (const name of ["Home", "Search", "Cart", "SignIn"]) {
  assert.ok(guestTabs.includes(`name="${name}"`), `GuestTabs missing ${name}`);
}
assert.ok(!guestTabs.includes('name="Orders"'), "guest nav must not expose Orders");
assert.ok(!guestTabs.includes('name="Account"'), "guest nav must not expose Account");

const guestNav = read("navigation/GuestAppNavigator.tsx");
assert.ok(!guestNav.includes("ShopLocation"), "guest stack must not open exact-location screen");

const home = read("screens/commerce/ShopHomeScreen.tsx");
assert.ok(home.includes("StoreHeader"), "uses storefront header");
assert.ok(!home.includes("Use my location"), "guest home must not request GPS");
assert.ok(home.includes("session") || home.includes("isGuest") || read("components/StoreHeader.tsx").includes("isGuest"), "home works without auth token");
assert.ok(!home.includes("session!.token"), "home must not require session");

const header = read("components/StoreHeader.tsx");
assert.ok(header.includes("Shopping near"), "approximate area label");
assert.ok(header.includes("Change area"), "manual area change");
assert.ok(header.includes("Search DUTS"), "homepage search available");

const areaStore = read("stores/shop-area.store.ts");
assert.ok(areaStore.includes("duts.shop.area"), "persists coarse area only");
assert.ok(areaStore.includes("duts.shop.deliveryLocation"), "clears leftover exact GPS for guests");
assert.ok(areaStore.includes("Africa/Harare"), "timezone hint for default area");
assert.ok(!areaStore.includes("getCurrentCoordinates"), "area store must not request GPS");

const cart = read("screens/commerce/CartScreen.tsx");
assert.ok(cart.includes("GuestCheckoutChoice"), "guest checkout decision");
assert.ok(cart.includes("Continue to order"), "continue CTA");
assert.ok(cart.includes("Calculated when you order"), "deferred delivery copy");
assert.ok(cart.includes("deferDelivery"), "guest quote defers delivery");

const choice = read("screens/commerce/GuestCheckoutChoiceScreen.tsx");
assert.ok(choice.includes("Continue on WhatsApp"), "WhatsApp CTA");
assert.ok(choice.includes("Sign in / Create account"), "account path");
assert.ok(choice.includes("commerceGuestHandoff"), "creates guest handoff");
assert.ok(!choice.includes("latitude"), "handoff must not send exact coordinates");
assert.ok(!choice.includes("Create an account to track orders") || choice.includes("Create an account to track orders and save your details."), "short account copy");

const store = read("stores/commerce-cart.store.ts");
assert.ok(store.includes("duts.commerce.cart"), "persists cart");
assert.ok(store.includes("Different shop"), "one-store rule");
assert.ok(store.includes("Which basket should we keep"), "conflicting account cart");

const api = read("lib/api.ts");
assert.ok(api.includes("commerceGuestHandoff"), "handoff API");
assert.ok(api.includes("/commerce/guest/handoff"), "handoff path");
assert.ok(api.includes("/commerce/shopping-areas"), "shopping areas API");
assert.ok(api.includes("deferDelivery"), "deferred quote payload");

const checkout = read("screens/commerce/CommerceCheckoutScreen.tsx");
assert.ok(checkout.includes("Choose delivery location"), "account path collects exact address");

console.log(JSON.stringify({ ok: true }, null, 2));
