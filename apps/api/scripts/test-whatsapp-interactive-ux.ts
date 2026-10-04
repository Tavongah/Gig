/**
 * DUTS WhatsApp welcome + interactive customer UX.
 * Run: npm run test:whatsapp-interactive-ux --workspace=@gigflow/api
 */
import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });
loadEnv({ path: resolve(here, "../.env") });

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function src(rel: string): string {
  return readFileSync(resolve(here, "../src", rel), "utf8");
}

async function main() {
  const {
    formatCustomerWelcome,
    formatMainMenu,
    formatShopPrompt,
    formatCustomerHelpMenu,
    formatLocationAsk,
    formatPaymentMethodChoice,
    formatEcoCashPrompt,
    formatReadyToOrder,
    formatDisambiguation,
    formatLocationUseThisArea,
    formatLocationAmbiguous,
    formatOrderCartSummary
  } = await import("../src/modules/whatsapp/copy.js");
  const {
    isGreetingOrMenuIntent,
    classifyCustomerMenuTap,
    isSelectEcoCashIntent,
    isSelectCashIntent
  } = await import("../src/modules/whatsapp/shopping-intent.js");
  const {
    registerInteractiveAction,
    resolveInteractiveAction,
    isReturningWhatsAppCustomer
  } = await import("../src/modules/whatsapp/interactive-actions.js");
  const { isUnfinishedCheckout } = await import("../src/modules/whatsapp/checkout-session.js");
  const { WhatsAppConversationState } = await import("@prisma/client");
  const {
    TwilioWhatsAppProvider,
    MockWhatsAppProvider,
    resetWhatsAppProviderForTests,
    setWhatsAppProviderForTests
  } = await import("../src/modules/whatsapp/provider.js");
  const { extractTwilioMessage } = await import("../src/modules/whatsapp/twilio-payload.js");
  const { sendMainMenu, sendPaymentChoices, sendProductChoices, sendLocationCandidates } = await import(
    "../src/modules/whatsapp/customer-interactive.js"
  );

  console.log("A/B copy + greeting…");
  const welcome = formatCustomerWelcome();
  assert(/Welcome to DUTS/i.test(welcome), "welcome heading");
  assert(/What would you like to do/i.test(welcome), "welcome question");
  assert(!/CommerceOrder|Smart Basket|Fulfillment|CheckoutSession/i.test(welcome), "no internals");
  assert(/What would you like to do/.test(formatMainMenu()), "returning menu");
  assert(/What do you need/.test(formatShopPrompt()), "shop prompt");
  assert(/bread, milk and eggs/i.test(formatShopPrompt()), "typed products example");
  assert(/Track an order/i.test(formatCustomerHelpMenu()), "help short");
  assert(!/FAQ|CommerceOrder/i.test(formatCustomerHelpMenu()), "help not giant FAQ");
  assert(isGreetingOrMenuIntent("Hi"), "Hi greeting");
  assert(isGreetingOrMenuIntent("Hello"), "Hello");
  assert(isGreetingOrMenuIntent("Menu"), "Menu");
  assert(isGreetingOrMenuIntent("Start"), "Start");
  assert(isGreetingOrMenuIntent("Hey"), "Hey");
  assert(!isGreetingOrMenuIntent("bread, milk and eggs"), "products not greeting");
  assert(classifyCustomerMenuTap("🛒 Shop") === "SHOP", "shop tap");
  assert(classifyCustomerMenuTap("Track order") === "TRACK", "track tap");
  assert(classifyCustomerMenuTap("Help") === "HELP", "help tap");

  console.log("C unfinished checkout protection…");
  const unfinished = isUnfinishedCheckout(
    { requestedItems: [{ query: "bread", quantity: 1 }], expectedInput: "LOCATION" },
    WhatsAppConversationState.AWAITING_LOCATION
  );
  assert(unfinished, "unfinished checkout detected");
  assert(
    !isUnfinishedCheckout({ checkoutStatus: "COMPLETED", activeOrderId: "o1" }, WhatsAppConversationState.IDLE),
    "placed order is not unfinished checkout"
  );

  console.log("D–K copy: shop / products / cart / location / payment / EcoCash…");
  const pay = formatPaymentMethodChoice(420);
  assert(/EcoCash/i.test(pay) && /Cash on delivery/i.test(pay), "payment text fallback");
  assert(/1\. EcoCash USD/.test(pay), "numeric fallback preserved");
  assert(isSelectEcoCashIntent("EcoCash") && isSelectCashIntent("Cash"), "typed payment still works");
  const eco = formatEcoCashPrompt();
  assert(/0771234567/.test(eco), "ecocash example");
  assert(!/\bPIN\b|\bOTP\b|secret/i.test(eco), "never collect PIN/OTP");
  const loc = formatLocationAsk();
  assert(/Type your delivery address/i.test(loc), "typed address first-class");
  assert(/Send your current location/i.test(loc), "GPS instruction, not fake button");
  assert(!/open maps|google maps|duts website/i.test(loc), "no maps requirement");
  const ready = formatReadyToOrder({
    lines: [{ quantity: 1, productName: "Bread", lineTotalCents: 100 }],
    subtotalCents: 100
  });
  assert(/1\. Yes/.test(ready) && /2\. Add more/.test(ready), "cart numeric fallback");
  const amb = formatDisambiguation("Which bread?", [
    { name: "Bakers White", priceCents: 100 },
    { name: "Bakers Brown", priceCents: 100 }
  ]);
  assert(/Bakers White/.test(amb) && /Reply 1 or 2/.test(amb), "product text fallback");
  assert(/1\. Yes/.test(formatLocationUseThisArea({ label: "Senga Nehosho, Gweru" })), "area numeric fallback");
  assert(/Which one do you mean/.test(formatLocationAmbiguous([{ label: "Senga 2, Gweru" }])), "candidates fallback");
  const review = formatOrderCartSummary({
    lines: [{ quantity: 3, productName: "Milk", lineTotalCents: 350 }],
    subtotalCents: 350,
    deliveryFeeCents: 70,
    totalCents: 420,
    deliveryLabel: "Senga Nehosho, Gweru",
    includeConfirmChoices: true
  });
  assert(/Deliver to: Senga Nehosho/.test(review), "review address");
  assert(/1\. Confirm/.test(review), "review numeric fallback");

  console.log("L–O interactive tokens + stale + duplicate payload…");
  const sessionA = "session-a";
  const ctxA: Record<string, unknown> = {
    checkoutSessionId: sessionA,
    expectedInput: "PAYMENT_METHOD",
    interactiveActions: []
  };
  const payTok = registerInteractiveAction(ctxA as never, {
    kind: "PAYMENT_ECOCASH",
    checkoutSessionId: sessionA,
    expectedInput: "PAYMENT_METHOD"
  });
  const prodTok = registerInteractiveAction(ctxA as never, {
    kind: "SELECT_PRODUCT",
    checkoutSessionId: sessionA,
    expectedInput: "PRODUCT_DISAMBIGUATION",
    productId: "prod-1"
  });
  assert(resolveInteractiveAction(ctxA as never, payTok.token).ok, "live payment token");
  const otherSession = {
    checkoutSessionId: "session-b",
    expectedInput: "PAYMENT_METHOD",
    interactiveActions: (ctxA as { interactiveActions: unknown[] }).interactiveActions
  };
  const stalePay = resolveInteractiveAction(otherSession as never, payTok.token);
  assert(stalePay.ok === false && stalePay.reason === "stale", "stale payment across checkout");
  const locCtx = {
    checkoutSessionId: sessionA,
    expectedInput: "LOCATION_CLARIFICATION",
    locationClarificationType: "ADDRESS_CHOICE",
    interactiveActions: (ctxA as { interactiveActions: unknown[] }).interactiveActions
  };
  const staleProd = resolveInteractiveAction(locCtx as never, prodTok.token);
  assert(staleProd.ok === false && staleProd.reason === "stale", "product token rejected during location");
  const menuTok = registerInteractiveAction(locCtx as never, { kind: "MENU_TRACK" });
  assert(resolveInteractiveAction(locCtx as never, menuTok.token).ok, "menu track allowed");
  assert(!isReturningWhatsAppCustomer({}), "new customer");
  assert(isReturningWhatsAppCustomer({ welcomeSentAt: new Date().toISOString() }), "returning");

  const dup = extractTwilioMessage({
    MessageSid: "SMdup1",
    From: "whatsapp:+263771111111",
    ButtonPayload: payTok.token,
    Body: "EcoCash"
  });
  assert(dup?.buttonId === payTok.token, "ButtonPayload is token not label");
  const listMsg = extractTwilioMessage({
    MessageSid: "SMlist1",
    From: "whatsapp:+263771111111",
    ListId: "abc123xyz9",
    Body: "Senga Nehosho, Gweru"
  });
  assert(listMsg?.buttonId === "abc123xyz9", "ListId mapped");

  console.log("Twilio Content API + text fallback…");
  const calls: Array<{ url: string; body: string }> = [];
  const twilio = new TwilioWhatsAppProvider({
    accountSid: "ACtest0000000000000000000000000000",
    authToken: "test_auth_token_do_not_log",
    fromWhatsApp: "whatsapp:+14155238886",
    fetchImpl: (async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body ?? "") });
      if (String(url).includes("content.twilio.com")) {
        return new Response(JSON.stringify({ sid: "HXquick1" }), { status: 201 });
      }
      return new Response(JSON.stringify({ sid: "SMout1" }), { status: 201 });
    }) as typeof fetch
  });
  await twilio.sendButtons("+263771234567", "How would you like to pay?", [
    { id: payTok.token, title: "EcoCash" },
    { id: "tok2", title: "Cash on delivery" }
  ]);
  assert(calls.some((c) => c.url.includes("content.twilio.com")), "creates Content template dynamically");
  assert(calls.some((c) => c.body.includes("ContentSid=HXquick1")), "sends ContentSid");
  assert(!calls.some((c) => /TWILIO_CONTENT_SID_[A-Z0-9]{20,}/.test(c.body)), "no invented env SIDs");

  calls.length = 0;
  const twilioFallback = new TwilioWhatsAppProvider({
    accountSid: "ACtest0000000000000000000000000000",
    authToken: "test_auth_token_do_not_log",
    fromWhatsApp: "whatsapp:+14155238886",
    fetchImpl: (async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body ?? "") });
      if (String(url).includes("content.twilio.com")) {
        return new Response("forbidden", { status: 403 });
      }
      return new Response(JSON.stringify({ sid: "SMfb1" }), { status: 201 });
    }) as typeof fetch
  });
  await twilioFallback.sendButtons("+263771234567", "How would you like to pay?\n\nEcoCash\nCash on Delivery", [
    { id: "x", title: "EcoCash" },
    { id: "y", title: "Cash on delivery" }
  ]);
  assert(calls.some((c) => c.body.includes("Body=") && /EcoCash/.test(decodeURIComponent(c.body))), "text fallback");
  assert(calls.some((c) => /Reply:/i.test(decodeURIComponent(c.body))), "reply hints when buttons unavailable");

  console.log("P–U mock send of menu/payment/products/location…");
  resetWhatsAppProviderForTests();
  const mock = new MockWhatsAppProvider();
  setWhatsAppProviderForTests(mock);
  const menuCtx: Record<string, unknown> = { interactiveActions: [] };
  await sendMainMenu("+263770000001", menuCtx as never, true);
  assert(mock.sent.some((m) => /Welcome to DUTS/.test(m.body)), "A welcome sent");
  assert((mock.sent.at(-1)?.buttons?.length ?? 0) === 3, "welcome 3 buttons");
  mock.clear();
  await sendMainMenu("+263770000001", { welcomeSentAt: "x", interactiveActions: [] } as never, false);
  assert(mock.sent.some((m) => /What would you like to do/.test(m.body)), "B returning menu");
  mock.clear();
  const payCtx = {
    checkoutSessionId: "sess-pay",
    expectedInput: "PAYMENT_METHOD",
    interactiveActions: []
  };
  await sendPaymentChoices("+263770000001", payCtx as never, 420);
  const payMsg = mock.sent.at(-1);
  assert(payMsg?.buttons?.some((b) => b.title.includes("EcoCash")), "I EcoCash button");
  assert(payMsg?.buttons?.some((b) => /Cash/i.test(b.title)), "I COD button");
  const ecoAction = (payCtx.interactiveActions as Array<{ token: string; kind: string }>)[0];
  assert(ecoAction?.kind === "PAYMENT_ECOCASH", "payment action semantic not label");
  mock.clear();
  const prodCtx = {
    checkoutSessionId: "sess-prod",
    expectedInput: "PRODUCT_DISAMBIGUATION",
    pendingChoices: [
      {
        query: "bread",
        options: [
          { productId: "p-white", name: "Bakers White", priceCents: 100 },
          { productId: "p-brown", name: "Bakers Brown", priceCents: 110 }
        ]
      }
    ],
    interactiveActions: []
  };
  await sendProductChoices("+263770000001", prodCtx as never, "Which bread?", prodCtx.pendingChoices[0]!.options);
  const prodAction = (prodCtx.interactiveActions as Array<{ kind: string; productId?: string }>)[0];
  assert(prodAction?.kind === "SELECT_PRODUCT" && prodAction.productId === "p-white", "E product id payload");
  mock.clear();
  const locChoiceCtx = {
    checkoutSessionId: "sess-loc",
    expectedInput: "LOCATION_CLARIFICATION",
    locationClarificationType: "ADDRESS_CHOICE",
    interactiveActions: []
  };
  await sendLocationCandidates("+263770000001", locChoiceCtx as never, [
    { label: "Senga Nehosho, Gweru" },
    { label: "Senga 2, Gweru" }
  ]);
  const locActions = locChoiceCtx.interactiveActions as Array<{ kind: string }>;
  assert(locActions.some((a) => a.kind === "LOC_PICK"), "H location pick");
  assert(locActions.some((a) => a.kind === "LOC_NONE"), "H none of these");
  const locOnPay = resolveInteractiveAction(
    { ...payCtx, interactiveActions: locChoiceCtx.interactiveActions } as never,
    (locChoiceCtx.interactiveActions as Array<{ token: string }>)[0]!.token
  );
  assert(locOnPay.ok === false, "U location token not valid on payment");

  console.log("source guards…");
  const handler = src("modules/whatsapp/customer-handler.ts");
  const provider = src("modules/whatsapp/provider.ts");
  const ecoSrc = src("modules/whatsapp/copy.ts");
  assert(handler.includes("sendMainMenu"), "welcome wired");
  assert(handler.includes("sendShopPrompt"), "shop wired");
  assert(handler.includes("sendProductChoices"), "product choices wired");
  assert(handler.includes("sendCartActions"), "cart actions wired");
  assert(handler.includes("sendLocationCandidates"), "location candidates wired");
  assert(handler.includes("sendPaymentChoices"), "payment buttons wired");
  assert(handler.includes("sendOrderReview"), "review buttons wired");
  assert(handler.includes("sendHelpMenu"), "help wired");
  assert(handler.includes("claimInboundMessage"), "O webhook idempotency");
  assert(handler.includes("isUnfinishedCheckout"), "C checkout protection");
  assert(handler.includes("WEB_HANDOFF") && handler.includes("sendLocationAsk"), "T web handoff location");
  assert(provider.includes("twilio/quick-reply"), "Twilio quick replies");
  assert(provider.includes("twilio/list-picker"), "Twilio lists");
  assert(provider.includes("content.twilio.com"), "Content API");
  assert(!handler.includes("TWILIO_CONTENT_SID_CUSTOMER"), "no invented customer template SIDs");
  assert(!/\bPIN\b|\bOTP\b/.test(ecoSrc.match(/formatEcoCashPrompt[\s\S]+?join\("\\n"\)/)?.[0] ?? "formatEcoCashPrompt"), "copy PIN");
  assert(!provider.includes("location_request"), "do not fake Twilio location request");

  resetWhatsAppProviderForTests();
  console.log("✅ WhatsApp interactive UX tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
