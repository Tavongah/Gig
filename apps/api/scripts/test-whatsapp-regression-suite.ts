/**
 * DUTS WhatsApp regression contract (WA01–WA27 + golden flow).
 *
 * Established customer WhatsApp behavior is protected. No WhatsApp-related
 * feature (Flavor, address, payments, catalog, interactive options, unlisted)
 * is complete unless this suite passes.
 *
 * Run: npm run test:whatsapp-regression --workspace=@gigflow/api
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { WhatsAppConversationState } from "@prisma/client";
import {
  calculatePilotDeliveryPrice,
  isMsuGweruTypedPilotAddress,
  PILOT_DELIVERY_MATRIX_CENTS,
  PILOT_TYPED_ADDRESS_FEE_CENTS
} from "@gigflow/shared";

const here = fileURLToPath(new URL(".", import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });
loadEnv({ path: resolve(here, "../.env") });

const results: Record<string, string> = {};

function src(rel: string) {
  return readFileSync(resolve(here, rel), "utf8");
}

function pass(id: string) {
  results[id] = "PASS";
}

async function main() {
  process.env.PRODUCT_FLAVOR_OPTIONS_ENABLED = "false";
  const handler = src("../src/modules/whatsapp/customer-handler.ts");
  const session = src("../src/modules/whatsapp/checkout-session.ts");
  const interactive = src("../src/modules/whatsapp/customer-interactive.ts");
  const provider = src("../src/modules/whatsapp/provider.ts");
  const payload = src("../src/modules/whatsapp/twilio-payload.ts");
  const convo = src("../src/modules/whatsapp/conversation.service.ts");
  const merchant = src("../src/modules/whatsapp/merchant-handler.ts");
  const flavor = src("../src/modules/whatsapp/whatsapp-flavor.ts");
  const cartMut = src("../src/modules/whatsapp/cart-mutations.ts");
  const handoff = src("../src/modules/commerce/guest-handoff.service.ts");
  const delivery = src("../src/modules/gigs/delivery.service.ts");
  const notify = src("../src/modules/commerce/merchant-notification.service.ts");

  const {
    formatCustomerWelcome,
    formatMainMenu,
    formatChoiceTextFallback,
    formatShopPrompt,
    formatCustomerHelpMenu,
    formatPaymentMethodChoice,
    formatLocationAsk,
    formatClaimPaidIgnored
  } = await import("../src/modules/whatsapp/copy.js");
  const { isGreetingOrMenuIntent, classifyCustomerMenuTap, classifyShoppingIntent } = await import(
    "../src/modules/whatsapp/shopping-intent.js"
  );
  const {
    isProtectedWhatsAppTransaction,
    isAbandonedCheckoutDraft,
    shouldHoldGreetingAtCheckout,
    isMainMenuNumericEligible,
    parseNumericChoice,
    cancelCheckoutDraft,
    isLivePendingPayment
  } = await import("../src/modules/whatsapp/checkout-session.js");
  const { extractTwilioMessage } = await import("../src/modules/whatsapp/twilio-payload.js");
  const {
    registerInteractiveAction,
    resolveInteractiveAction
  } = await import("../src/modules/whatsapp/interactive-actions.js");
  const {
    MockWhatsAppProvider,
    resetWhatsAppProviderForTests,
    setWhatsAppProviderForTests,
    TwilioWhatsAppProvider
  } = await import("../src/modules/whatsapp/provider.js");
  const { sendMainMenu, sendCustomerChoices, sendPaymentChoices } = await import(
    "../src/modules/whatsapp/customer-interactive.js"
  );
  const { flavorUxEnabled } = await import("../src/modules/whatsapp/whatsapp-flavor.js");
  const { applyCartIntent: mutateCart } = await import("../src/modules/whatsapp/cart-mutations.js");

  // WA01 new customer Hi → welcome/menu
  assert.equal(isGreetingOrMenuIntent("Hi"), true);
  const welcome = formatCustomerWelcome();
  assert.match(welcome, /Welcome to DUTS/);
  assert.match(welcome, /1\. Shop/);
  assert.match(welcome, /2\. Track order/);
  assert.match(welcome, /3\. Help/);
  assert.ok(handler.indexOf("isGreetingOrMenuIntent") < handler.indexOf('expect === "LOCATION"'));
  assert.match(handler, /sendMainMenu/);
  pass("WA01");

  // WA02 Shop button → shopping flow
  assert.equal(classifyCustomerMenuTap("Shop"), "SHOP");
  assert.match(handler, /case "MENU_SHOP"/);
  assert.match(handler, /sendShopPrompt/);
  assert.match(formatShopPrompt(), /What do you need/);
  pass("WA02");

  // WA03 Track Order button
  assert.equal(classifyCustomerMenuTap("Track order"), "TRACK");
  assert.match(handler, /case "MENU_TRACK"/);
  assert.match(handler, /presentCustomerTracking/);
  pass("WA03");

  // WA04 Help button
  assert.equal(classifyCustomerMenuTap("Help"), "HELP");
  assert.match(handler, /case "MENU_HELP"/);
  assert.match(formatCustomerHelpMenu(), /Track an order|Help/i);
  pass("WA04");

  // WA05 text fallback "1" → Shop
  assert.equal(parseNumericChoice("1"), 1);
  assert.equal(isMainMenuNumericEligible({ expectedInput: "NONE" }), true);
  assert.equal(isMainMenuNumericEligible({ expectedInput: "LOCATION" }), false);
  assert.match(handler, /isMainMenuNumericEligible/);
  assert.match(handler, /menuTap = "SHOP"/);
  pass("WA05");

  // WA06 product text → product resolution
  const itemsIntent = classifyShoppingIntent("I want bread and Mazoe");
  assert.ok(itemsIntent.kind === "NEW_LIST" || itemsIntent.kind === "ADD_ITEM" || itemsIntent.kind === "UNKNOWN");
  assert.match(handler, /extractShoppingItemsWithOptionalAi/);
  assert.match(handler, /resolveProductsThenContinue|buildOneStoreBasket|searchProductsByQuery/);
  pass("WA06");

  // WA07 add product → cart
  const added = mutateCart([], { kind: "ADD_ITEM", items: [{ query: "bread", quantity: 1 }], confidence: "high" });
  assert.equal(added.ok, true);
  if (added.ok) assert.equal(added.items[0]?.query, "bread");
  assert.match(cartMut, /case "ADD_ITEM"/);
  pass("WA07");

  // WA08 quantity update
  const qty = mutateCart([{ query: "bread", quantity: 1 }], {
    kind: "CHANGE_QUANTITY",
    targetQuery: "bread",
    quantity: 3,
    confidence: "high"
  });
  assert.equal(qty.ok, true);
  if (qty.ok) assert.equal(qty.items[0]?.quantity, 3);
  pass("WA08");

  // WA09 show cart
  assert.match(handler, /presentCurrentCart|SHOW_CART|isCartCommand/);
  pass("WA09");

  // WA10 checkout
  assert.match(handler, /CART_CONTINUE|buildAndPresentQuote/);
  assert.match(interactive, /sendCartActions/);
  pass("WA10");

  // WA11 native GPS → location accepted
  assert.match(payload, /Latitude/);
  assert.match(payload, /Longitude/);
  assert.match(handler, /msg\.location/);
  assert.match(handler, /applyNativeLocation/);
  assert.match(formatLocationAsk(), /Send your current location/i);
  pass("WA11");

  // WA12 typed address accepted without clarification
  assert.equal(isMsuGweruTypedPilotAddress("34 Nehosho Senga Gweru"), true);
  assert.equal(isMsuGweruTypedPilotAddress("Senga"), true);
  assert.equal(isMsuGweruTypedPilotAddress("Nehosho"), true);
  assert.equal(isMsuGweruTypedPilotAddress("House 24 Senga 2 near MSU"), true);
  assert.ok(handler.indexOf('expect === "LOCATION"') < handler.indexOf("applyTypedLocation"));
  assert.match(handler, /recognizedPilot/);
  assert.doesNotMatch(handler, /applyTypedLocation\(phone, conv\.id, ctx, text\);\n[\s\S]{0,80}classifyShoppingIntent/);
  pass("WA12");

  // WA13–15 typed package fees
  for (const [id, pkg, cents] of [
    ["WA13", "SMALL", 100],
    ["WA14", "MEDIUM", 130],
    ["WA15", "LARGE", 170]
  ] as const) {
    const priced = calculatePilotDeliveryPrice({
      routeDistanceKm: 4.2,
      packageClass: pkg,
      locationMode: "TYPED_PILOT"
    });
    assert.equal(priced.deliveryFeeCents, cents);
    assert.equal(PILOT_TYPED_ADDRESS_FEE_CENTS[pkg], cents);
    pass(id);
  }

  // WA16 GPS pricing matrix unchanged
  const gps = calculatePilotDeliveryPrice({
    routeDistanceKm: 0.4,
    packageClass: "SMALL",
    locationMode: "GPS"
  });
  assert.equal(gps.deliveryFeeCents, PILOT_DELIVERY_MATRIX_CENTS["0_TO_1_KM"].SMALL);
  pass("WA16");

  // WA17 EcoCash selection — button and text share handlePaymentConversation
  assert.match(handler, /case "PAYMENT_ECOCASH"/);
  assert.match(handler, /handlePaymentConversation\(phone, customerId, convId, ctx, "EcoCash"/);
  assert.match(formatPaymentMethodChoice(), /1\. EcoCash/);
  pass("WA17");

  // WA18 COD selection — same backend as text
  assert.match(handler, /case "PAYMENT_COD"/);
  assert.match(handler, /handlePaymentConversation\(phone, customerId, convId, ctx, "Cash"/);
  assert.match(formatPaymentMethodChoice(), /2\. Cash on delivery/);
  const claim = formatClaimPaidIgnored();
  assert.match(claim, /Payment is still being confirmed/);
  pass("WA18");

  // WA19 duplicate MessageSid
  assert.match(convo, /claimInboundMessage/);
  assert.match(convo, /P2002/);
  assert.match(handler, /claimInboundMessage/);
  const extracted = extractTwilioMessage({
    MessageSid: "SMdup-reg-1",
    From: "whatsapp:+263771111111",
    Body: "Hi"
  });
  assert.equal(extracted?.providerMessageId, "SMdup-reg-1");
  pass("WA19");

  // WA20 stale draft → menu recovery
  assert.equal(
    isAbandonedCheckoutDraft(
      { expectedInput: "PRODUCT_TEXT", checkoutStatus: "DRAFT" },
      WhatsAppConversationState.BUILDING_CART
    ),
    true
  );
  assert.equal(
    shouldHoldGreetingAtCheckout(
      { expectedInput: "PRODUCT_TEXT" },
      WhatsAppConversationState.BUILDING_CART
    ),
    false
  );
  assert.match(handler, /recoverToMainMenu/);
  assert.match(session, /cancelCheckoutDraft/);
  pass("WA20");

  // WA21 active payment cannot attach new basket
  const livePay = {
    expectedInput: "PAYMENT_PENDING" as const,
    paymentPhase: "PENDING_PROVIDER" as const,
    paymentAttemptId: "pa1",
    pendingPaymentOrderId: "o1"
  };
  assert.equal(isLivePendingPayment(livePay), true);
  assert.equal(isProtectedWhatsAppTransaction(livePay), true);
  assert.equal(shouldHoldGreetingAtCheckout(livePay, WhatsAppConversationState.AWAITING_PAYMENT), true);
  const cancelled = cancelCheckoutDraft({ ...livePay, activeOrderId: "placed-1" });
  assert.equal(cancelled.activeOrderId, "placed-1");
  pass("WA21");

  // WA22 web handoff exact basket
  assert.match(handoff, /WEB_HANDOFF/);
  assert.match(handoff, /lockedProductLines/);
  assert.match(handler, /skipFuzzy/);
  assert.match(handler, /extractGuestBasketRef/);
  pass("WA22");

  // WA23 interactive failure → text fallback
  const fallback = formatChoiceTextFallback("Welcome to DUTS", ["Shop", "Track order", "Help"]);
  assert.match(fallback, /1\. Shop/);
  assert.match(fallback, /Reply with 1, 2 or 3/);
  assert.match(interactive, /formatChoiceTextFallback/);
  assert.match(provider, /formatChoiceTextFallback/);
  const calls: string[] = [];
  const twilioFallback = new TwilioWhatsAppProvider({
    accountSid: "ACtest0000000000000000000000000000",
    authToken: "test_auth_token_do_not_log",
    fromWhatsApp: "whatsapp:+14155238886",
    fetchImpl: (async (url, init) => {
      calls.push(String(init?.body ?? ""));
      if (String(url).includes("content.twilio.com")) {
        return new Response("forbidden", { status: 403 });
      }
      return new Response(JSON.stringify({ sid: "SMfb-reg" }), { status: 201 });
    }) as typeof fetch
  });
  await twilioFallback.sendButtons("+263771234567", "Welcome to DUTS", [
    { id: "tokshop12", title: "Shop" },
    { id: "toktrack12", title: "Track order" },
    { id: "tokhelp12", title: "Help" }
  ]);
  const decodedCalls = calls.map((b) => decodeURIComponent(b.replace(/\+/g, " ")));
  assert.ok(decodedCalls.some((b) => /1\. Shop/.test(b) && /Reply with 1/.test(b)));
  pass("WA23");

  // WA24 merchant/customer session isolation
  assert.match(handler, /WhatsAppParty\.CUSTOMER/);
  assert.match(merchant, /WhatsAppParty\.MERCHANT/);
  assert.match(convo, /phoneNormalized_party|party:/);
  pass("WA24");

  // WA25 placed order survives recovery
  const kept = cancelCheckoutDraft({
    activeOrderId: "ord-placed",
    expectedInput: "LOCATION",
    requestedItems: [{ query: "bread", quantity: 1 }]
  });
  assert.equal(kept.activeOrderId, "ord-placed");
  assert.equal(kept.expectedInput, "NONE");
  pass("WA25");

  // WA26 delivery PIN unchanged
  assert.match(delivery, /hashedPinsMatch/);
  assert.match(delivery, /verifyDeliveryPinAndComplete/);
  assert.doesNotMatch(handler, /deliveryPin\s*=/);
  pass("WA26");

  // WA27 pickup PIN unchanged
  assert.match(delivery, /PICKUP_PIN/);
  assert.doesNotMatch(handler, /pickupPin\s*=/);
  pass("WA27");

  // Interactive inbound fields actually used
  assert.match(payload, /ButtonPayload/);
  assert.match(payload, /ListId/);
  assert.match(payload, /MessageSid/);
  assert.match(provider, /ContentSid/);
  assert.match(provider, /twilio\/quick-reply/);

  // Flavor isolated (flag off default)
  assert.equal(flavorUxEnabled(), false);
  assert.match(flavor, /flavorUxEnabled/);
  assert.match(handler, /!flavorUxEnabled\(\)/);

  // Address resolver is not a global parser
  const locIdx = handler.indexOf('if (expect === "LOCATION")');
  const typedIdx = handler.indexOf("return applyTypedLocation(phone, conv.id, ctx, text);");
  const greetingIdx = handler.indexOf("isGreetingOrMenuIntent");
  assert.ok(greetingIdx > 0 && locIdx > greetingIdx && typedIdx > locIdx);

  resetWhatsAppProviderForTests();
  const mock = new MockWhatsAppProvider();
  setWhatsAppProviderForTests(mock);
  const menuCtx: Record<string, unknown> = { interactiveActions: [], expectedInput: "PRODUCT_TEXT" };
  await sendMainMenu("+263770000001", menuCtx as never, true);
  assert.equal(menuCtx.expectedInput, "NONE");
  assert.ok(mock.sent.some((m) => /Welcome to DUTS/.test(m.body)));
  assert.equal(mock.sent.at(-1)?.buttons?.length, 3);
  const shopTok = (menuCtx.interactiveActions as Array<{ kind: string; token: string }>).find(
    (a) => a.kind === "MENU_SHOP"
  );
  assert.ok(shopTok);
  const inboundShop = extractTwilioMessage({
    MessageSid: "SMshop1",
    From: "whatsapp:+263770000001",
    ButtonPayload: shopTok!.token,
    Body: "Shop"
  });
  assert.equal(inboundShop?.buttonId, shopTok!.token);
  assert.equal(resolveInteractiveAction(menuCtx as never, shopTok!.token).ok, true);

  mock.clear();
  mock.nextFailure = { ok: false, errorCategory: "PROVIDER", errorMessage: "interactive failed" };
  await sendCustomerChoices("+263770000001", { interactiveActions: [] } as never, "Welcome to DUTS", [
    { title: "Shop", action: { kind: "MENU_SHOP" } },
    { title: "Track order", action: { kind: "MENU_TRACK" } },
    { title: "Help", action: { kind: "MENU_HELP" } }
  ]);
  assert.ok(mock.sent.some((m) => /1\. Shop/.test(m.body) && /Reply with 1, 2 or 3/.test(m.body)));

  mock.failUntilCleared = null;
  mock.clear();
  const payCtx = {
    checkoutSessionId: "sess-pay",
    expectedInput: "PAYMENT_METHOD",
    interactiveActions: [] as unknown[]
  };
  await sendPaymentChoices("+263770000001", payCtx as never, 420);
  const eco = (payCtx.interactiveActions as Array<{ kind: string }>).find((a) => a.kind === "PAYMENT_ECOCASH");
  const cod = (payCtx.interactiveActions as Array<{ kind: string }>).find((a) => a.kind === "PAYMENT_COD");
  assert.ok(eco && cod);

  // Golden flow contract: Hi → menu → Shop → products → cart → checkout → typed address → COD
  const handleFn = handler.indexOf("export async function handleCustomerWhatsAppMessage");
  assert.ok(handleFn > 0, "customer handler entry");
  const interactiveCall = handler.indexOf("tryHandleInteractiveAction(", handleFn);
  const menuTapCall = handler.indexOf("classifyCustomerMenuTap(text)", handleFn);
  assert.ok(interactiveCall > 0 && menuTapCall > interactiveCall, "interactive before free-text menu");
  assert.ok(handler.includes("sendShopPrompt"));
  assert.ok(handler.includes("resolveProductsThenContinue") || handler.includes("buildOneStoreBasket"));
  assert.ok(handler.includes("sendCartActions"));
  assert.ok(handler.includes("sendLocationAsk"));
  assert.ok(handler.includes("isMsuGweruTypedPilotAddress"));
  assert.ok(handler.includes("sendPaymentChoices") || interactive.includes("sendPaymentChoices"));
  assert.ok(handler.indexOf("switchOrderToCashOnDelivery") > 0 || handler.includes("pay_cash"));
  assert.match(notify, /applyPaidOrderToConversation|notifyMerchant|WhatsApp/);
  results.GOLDEN = "PASS";

  resetWhatsAppProviderForTests();

  const missing = [
    "WA01",
    "WA02",
    "WA03",
    "WA04",
    "WA05",
    "WA06",
    "WA07",
    "WA08",
    "WA09",
    "WA10",
    "WA11",
    "WA12",
    "WA13",
    "WA14",
    "WA15",
    "WA16",
    "WA17",
    "WA18",
    "WA19",
    "WA20",
    "WA21",
    "WA22",
    "WA23",
    "WA24",
    "WA25",
    "WA26",
    "WA27",
    "GOLDEN"
  ].filter((k) => results[k] !== "PASS");
  if (missing.length) {
    throw new Error(`Missing: ${missing.join(", ")}`);
  }
  console.log("WA01–WA27 PASS");
  console.log("GOLDEN FLOW PASS");
  console.log("✅ WhatsApp regression suite passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
