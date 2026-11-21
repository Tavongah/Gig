/**
 * Guest cart keeps WhatsApp beside customer sign-in, and the cart journey
 * skips worker / merchant role selection.
 * Run: npx tsx scripts/test-guest-cart-auth-ui.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cartShopKey, cartsConflict, mergeSameShopCart, planCartClaim } from "../src/lib/cart-claim";

const src = join(__dirname, "..", "src");
const read = (rel: string) => readFileSync(join(src, rel), "utf8");

const cart = read("screens/commerce/CartScreen.tsx");
const webFooterAt = cart.indexOf('Platform.OS === "web" && browse.isGuest && lines.length > 0');
assert.ok(webFooterAt > 0, "website guest cart buttons are gated to web");
const webFooter = cart.slice(webFooterAt, cart.indexOf(") : (", webFooterAt));
assert.ok(webFooter.includes("Continue with WhatsApp"), "website cart shows WhatsApp");
assert.ok(webFooter.includes("Sign in / Create account"), "website cart shows sign-in beside WhatsApp");
assert.ok(webFooter.includes("continueWithWhatsApp"), "website WhatsApp uses the cart handoff helper");
assert.ok(webFooter.includes('variant="secondary"'), "sign-in is a full button, not only muted text");
assert.ok(cart.includes("commerceGuestHandoff"), "WhatsApp still uses the existing guest handoff");
assert.ok(cart.includes("startGuestWhatsApp"), "handoff helper remains");
assert.ok(cart.includes("Sign in to continue"), "native catalog-demand sign-in label remains");
assert.ok(cart.includes("Sign in or create account"), "native guest sign-in link remains");
assert.ok(cart.includes("continuePrimary"), "native continue action remains");
assert.ok(cart.includes("customerOnly: true"), "cart sign-in opens customer-only login");
assert.ok(!cart.includes("commerceCheckout("), "cart does not place an order");
assert.ok(!cart.includes("/commerce/cart/checkout"), "cart does not call checkout");

const choice = read("screens/commerce/GuestCheckoutChoiceScreen.tsx");
assert.ok(choice.includes("commerceGuestHandoff"), "checkout choice still creates the guest handoff");
assert.ok(choice.includes("Continue with WhatsApp"), "checkout choice WhatsApp remains");
assert.ok(choice.includes("customerOnly: true"), "checkout choice sign-in is customer-only");

const login = read("screens/auth/LoginScreen.tsx");
assert.ok(login.includes("api.login"), "customer login API unchanged");
assert.ok(login.includes("SocialAuthButtons"), "Google and Apple remain on customer login");
assert.ok(login.includes('intendedRole="CLIENT"'), "cart login stays a customer login");
assert.ok(
  login.includes('navigation.navigate("CustomerRegister", { customerOnly: true })'),
  "cart create-account opens customer registration"
);
assert.ok(login.includes('navigation.navigate("RegisterSelection")'), "normal create-account still opens role selection");
assert.ok(!login.includes("Work with DUTS"), "login itself does not offer worker signup");

const register = read("screens/auth/CustomerRegisterScreen.tsx");
assert.ok(register.includes("api.registerCustomer"), "customer registration endpoint unchanged");
assert.ok(register.includes("customerRegisterSchema"), "customer registration validation unchanged");
assert.ok(!register.includes("Work with DUTS"), "customer registration has no worker choice");
assert.ok(!register.includes("WorkerRegister"), "customer registration does not open worker signup");
assert.ok(register.includes("customerOnly"), "customer registration can return to the cart login");

const selection = read("screens/auth/RegisterSelectionScreen.tsx");
assert.ok(selection.includes("Work with DUTS"), "normal register selection still offers work");
assert.ok(selection.includes("Shop on DUTS"), "normal register selection still offers shopping");
assert.ok(
  selection.includes('navigate(intendedRole === "WORKER" ? "WorkerRegister" : "CustomerRegister")'),
  "worker register route remains on the normal selection page"
);

const authNav = read("navigation/AuthNavigator.tsx");
assert.ok(authNav.includes('name="WorkerRegister"'), "worker register screen stays registered");
assert.ok(authNav.includes('name="CustomerRegister"'), "customer register screen stays registered");

const app = readFileSync(join(__dirname, "..", "App.tsx"), "utf8");
assert.ok(app.includes('WorkerRegister: "register/worker"'), "worker register URL remains");
assert.ok(app.includes('CustomerRegister: "register/customer"'), "customer register URL remains");

const store = read("stores/commerce-cart.store.ts");
assert.ok(store.includes('const WORKING_KEY = "duts.commerce.cart"'), "guest cart storage key unchanged");
assert.ok(store.includes("if (guestHasItems)"), "login keeps the guest cart when it has items");
assert.ok(!store.includes("clear()") || store.includes("clear: ()"), "claim path does not wipe the working cart");
assert.ok(store.includes("Different shop"), "native different-shop alert remains");
assert.ok(store.includes("Keep current basket"), "native keep-current-basket action remains");
assert.ok(store.includes("Which basket should we keep?"), "account conflict still asks which basket");
assert.ok(store.includes("requestNewCartConfirm"), "website conflict uses the mounted cart confirm");
assert.ok(store.includes("cartsConflict"), "sign-out does not overwrite a different-shop account cart");
assert.ok(store.includes('onDismiss: () => settle(null)'), "dismiss keeps the on-screen cart");
const claimStart = store.indexOf("function chooseDifferentShopCart");
const claim = store.slice(claimStart, store.indexOf("export async function claimCartAfterLogin"));
assert.ok(claim.includes('Platform.OS === "web"'), "website conflict does not use Alert.alert");
assert.ok(claim.includes("requestNewCartConfirm"), "website conflict waits for the existing confirm");
assert.ok(!claim.includes("Alert.alert") || claim.indexOf("Alert.alert") > claim.indexOf("return new Promise"), "Alert.alert stays on the native branch");

const shopA = { lines: [{ productId: "p1", quantity: 1, merchantId: "shop-a", sellerOfferId: null }] };
const shopB = { lines: [{ productId: "p2", quantity: 1, merchantId: "shop-b", sellerOfferId: null }] };
assert.equal(planCartClaim({ guestHasItems: true, savedHasItems: false, guestShopKey: "shop:shop-b", savedShopKey: null }), "guest");
assert.equal(planCartClaim({ guestHasItems: false, savedHasItems: true, guestShopKey: null, savedShopKey: "shop:shop-a" }), "saved");
assert.equal(
  planCartClaim({ guestHasItems: true, savedHasItems: true, guestShopKey: "shop:shop-a", savedShopKey: "shop:shop-a" }),
  "merge"
);
assert.equal(
  planCartClaim({ guestHasItems: true, savedHasItems: true, guestShopKey: "shop:shop-b", savedShopKey: "shop:shop-a" }),
  "ask"
);
assert.equal(planCartClaim({ guestHasItems: true, savedHasItems: true, guestShopKey: null, savedShopKey: "shop:shop-a" }), "ask");
assert.equal(cartsConflict(shopA, shopB), true);
assert.equal(cartsConflict(shopA, shopA), false);
assert.equal(cartShopKey(shopB), "shop:shop-b");
const merged = mergeSameShopCart(
  {
    lines: [
      {
        productId: "p1",
        flavorOptionId: null,
        quantity: 1,
        unitPriceCents: 100,
        merchantId: "shop-a",
        merchantName: "A",
        name: "Milk",
        imageUrl: null,
        sizeLabel: null
      }
    ],
    merchantId: "shop-a",
    merchantName: "A"
  },
  {
    lines: [
      {
        productId: "p1",
        flavorOptionId: null,
        quantity: 2,
        unitPriceCents: 120,
        merchantId: "shop-a",
        merchantName: "A",
        name: "Milk",
        imageUrl: null,
        sizeLabel: null
      },
      {
        productId: "p9",
        flavorOptionId: null,
        quantity: 1,
        unitPriceCents: 50,
        merchantId: "shop-a",
        merchantName: "A",
        name: "Bread",
        imageUrl: null,
        sizeLabel: null
      }
    ],
    merchantId: "shop-a",
    merchantName: "A"
  }
);
assert.equal(merged.lines.length, 2);
assert.equal(merged.lines[0]?.quantity, 3);
assert.equal(merged.lines[0]?.unitPriceCents, 120);
assert.equal(merged.merchantId, "shop-a");
assert.equal(cartShopKey(merged), "shop:shop-a");

const home = read("screens/commerce/ShopHomeScreen.tsx");
assert.ok(home.includes("pendingCheckout"), "existing checkout return flag remains");
assert.ok(home.includes('navigation.navigate("CommerceCheckout")'), "signed-in cart return can resume checkout");
assert.ok(home.includes('next: "checkout"'), "missing location still goes through the location step");

console.log(JSON.stringify({ ok: true }));
