/**
 * Static checks for DUTS simple checkout + location-at-checkout V1.
 * Run: npx tsx scripts/test-simple-checkout-ui.ts
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const src = join(root, "src");
const apiSrc = join(root, "..", "api", "src");

function read(rel: string) {
  const p = join(src, rel);
  assert.ok(existsSync(p), `missing ${rel}`);
  return readFileSync(p, "utf8");
}

function readApi(rel: string) {
  const p = join(apiSrc, rel);
  assert.ok(existsSync(p), `missing api ${rel}`);
  return readFileSync(p, "utf8");
}

const home = read("screens/commerce/ShopHomeScreen.tsx");
const header = read("components/StoreHeader.tsx");
const cart = read("screens/commerce/CartScreen.tsx");
const location = read("screens/commerce/ShopLocationScreen.tsx");
const checkout = read("screens/commerce/CommerceCheckoutScreen.tsx");
const card = read("components/ProductCard.tsx");
const browse = read("lib/shop-browse.ts");
const api = read("lib/api.ts");
const guestNav = read("navigation/GuestAppNavigator.tsx");
const guestChoice = read("screens/commerce/GuestCheckoutChoiceScreen.tsx");
const orderDetail = read("screens/commerce/CommerceOrderDetailScreen.tsx");
const routes = readApi("modules/commerce/customer-commerce.routes.ts");
const service = readApi("modules/commerce/customer-commerce.service.ts");
const copy = readApi("modules/whatsapp/copy.ts");
const wa = readApi("modules/whatsapp/customer-handler.ts");
const flags = readFileSync(join(root, "..", "..", "packages", "shared", "src", "multi-shop-checkout.ts"), "utf8");

assert.ok(!home.includes("getCurrentCoordinates"), "A homepage does not auto-request GPS");
assert.ok(!home.includes("Use my location"), "A homepage does not request GPS");
assert.ok(browse.includes("areaId"), "B signed-in users can browse by area without exact location");
assert.ok(header.includes("useAreaPicker"), "B location is not forced before browse");
assert.ok(card.includes("Added ✓"), "C one-tap add confirmation");
assert.ok(cart.includes('label="Continue"'), "D cart CTA is Continue");
assert.ok(!cart.includes("Continue to order"), "D no Continue to order extra wording");
assert.ok(cart.includes("GuestCheckoutChoice"), "E guest continue stays WhatsApp/account");
assert.ok(guestChoice.includes("Continue on WhatsApp"), "E WhatsApp checkout without account");
assert.ok(!guestNav.includes("ShopLocation"), "E guests do not open exact-location screen");
assert.ok(cart.includes('next: "checkout"'), "F location only after Continue when missing");
assert.ok(location.includes("Where should we deliver?"), "G location step copy");
assert.ok(location.includes("USE MY CURRENT LOCATION"), "H GPS is a button, not automatic");
assert.ok(location.includes("onPress={() => void chooseGps()}"), "H GPS is a button, not automatic");
assert.ok(location.includes("ENTER DELIVERY ADDRESS"), "I typed address available");
assert.ok(location.includes("We couldn't use your current location"), "J GPS fail falls back to address");
assert.ok(checkout.includes("Review order"), "K one review screen");
assert.ok(checkout.includes("Deliver to"), "L delivery shown");
assert.ok(checkout.includes("Change"), "L change location from review");
assert.ok(checkout.includes("PLACE ORDER"), "M place order CTA");
assert.ok(checkout.includes("EcoCash USD"), "N EcoCash USD");
assert.ok(checkout.includes("Cash on delivery"), "N cash on delivery");
assert.ok(!checkout.includes("ONEMONEY"), "N OneMoney hidden");
assert.ok(checkout.includes("Check your phone to approve payment."), "O EcoCash hint");
assert.ok(checkout.includes("Pay when your order arrives."), "O COD hint");
assert.ok(checkout.includes("commerceCheckoutPrepare"), "P one checkout-prep call");
assert.ok(api.includes("/commerce/cart/prepare"), "P prepare API");
assert.ok(routes.includes("/cart/prepare"), "P prepare route");
assert.ok(service.includes("Tell us where to deliver."), "Q location missing error");
assert.ok(service.includes("Some items are no longer available."), "R product unavailable");
assert.ok(service.includes("This shop isn't taking orders right now."), "S shop closed");
assert.ok(service.includes("We can't deliver this order to this location yet."), "T delivery too far");
assert.ok(service.includes("Your delivery already includes 3 shops."), "U three-shop cap copy");
assert.ok(service.includes("That's too many items for one order."), "V too many items");
assert.ok(checkout.includes("Getting your order ready…"), "W loading copy");
assert.ok(checkout.includes("if (!ready || placing) return"), "X no double-tap place");
assert.ok(orderDetail.includes("Thank you"), "Y thank you");
assert.ok(orderDetail.includes("Order confirmed"), "Y order confirmed");
assert.ok(orderDetail.includes("DUTS is arranging your delivery."), "Y arranging delivery");
assert.ok(copy.includes("formatLocationAsk"), "Z WhatsApp location ask shared");
assert.ok(copy.includes("Send your location or type your address."), "Z short location copy");
assert.ok(wa.includes("formatLocationAsk()"), "Z WhatsApp uses short location ask");
assert.ok(copy.includes("Your DUTS order"), "AA short order review heading");
assert.ok(copy.includes("1. EcoCash USD"), "AB payment choice");
assert.ok(!checkout.includes("sub-order"), "AC no sub-order leak");
assert.ok(!checkout.includes("ASSISTED"), "AC no assisted leak");
assert.ok(!home.includes("MULTI_SHOP_CHECKOUT_ENABLED"), "AC no flag leak on home");
assert.ok(flags.includes("false"), "AD multi-shop flag defaults off");
assert.ok(cart.includes("deferDelivery"), "AE guest/no-location cart defers delivery");
assert.ok(location.includes("nextCheckout"), "AF returning saved location skips via next param only when missing");

console.log(JSON.stringify({ ok: true }, null, 2));
