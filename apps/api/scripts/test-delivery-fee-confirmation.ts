/**
 * Delivery-fee confirmation. Mocks only: no orders, payments, WhatsApp, or database writes.
 * Run: npx tsx scripts/test-delivery-fee-confirmation.ts
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PILOT_DELIVERY_FEE_CENTS,
  PILOT_TYPED_ADDRESS_FEE_CENTS
} from "@gigflow/shared";
import { formatPriceChange, parsePriceChangeDetail } from "../src/modules/whatsapp/copy.js";
import {
  evaluatePresentedCheckout,
  selectConfirmedTotals,
  type CheckoutTotalCents,
  type PresentedCheckoutTotal
} from "../src/modules/commerce/presented-total.js";
import {
  appCheckoutDecision,
  displayedDeliveryFingerprint,
  displayedQuoteFromResult,
  loadDisplayedDeliveryQuote,
  quoteToStore,
  saveDisplayedDeliveryQuote,
  type DisplayedDeliveryQuote,
  type DisplayedQuoteCart
} from "../src/modules/commerce/displayed-delivery-quote.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");

function src(rel: string) {
  return readFileSync(resolve(here, rel), "utf8");
}

function between(text: string, start: string, end: string) {
  const from = text.indexOf(start);
  assert.ok(from >= 0, `missing ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.ok(to > from, `missing ${end} after ${start}`);
  return text.slice(from, to);
}

function totals(input: {
  subtotalCents: number;
  deliveryFeeCents: number;
  serviceFeeCents?: number;
}): CheckoutTotalCents {
  const serviceFeeCents = input.serviceFeeCents ?? 0;
  return {
    subtotalCents: input.subtotalCents,
    deliveryFeeCents: input.deliveryFeeCents,
    serviceFeeCents,
    totalCents: input.subtotalCents + input.deliveryFeeCents + serviceFeeCents
  };
}

/** Cash and EcoCash both collect the total stored on the order. Neither runs unless an order exists. */
function mockChargeCents(order: CheckoutTotalCents | null) {
  return order ? order.totalCents : null;
}

function place(input: {
  presented: PresentedCheckoutTotal | null;
  fresh: CheckoutTotalCents;
  merchandiseChanges?: Array<{ name: string; oldCents: number; newCents: number }>;
  action: "pay" | "reject";
  /** Quote moves again before the customer confirms the updated total. */
  nextFresh?: CheckoutTotalCents;
}) {
  const prompts: string[] = [];
  let presented = input.presented;
  let fresh = input.fresh;
  let merchandiseChanges = input.merchandiseChanges;
  for (let step = 0; step < 3; step += 1) {
    const decision = evaluatePresentedCheckout({ presented, fresh, merchandiseChanges });
    merchandiseChanges = undefined;
    if (!decision.confirm) {
      if (input.action === "reject") return { prompts, order: null, charged: null };
      return { prompts, order: decision.totals, charged: mockChargeCents(decision.totals) };
    }
    prompts.push(decision.message);
    if (input.action === "reject") return { prompts, order: null, charged: null };
    if (input.nextFresh) {
      if (step === 0) {
        fresh = input.nextFresh;
        continue;
      }
      return { prompts, order: null, charged: null };
    }
    presented = {
      deliveryFeeCents: decision.totals.deliveryFeeCents,
      totalCents: decision.totals.totalCents
    };
    fresh = decision.totals;
  }
  return { prompts, order: null, charged: null };
}

assert.equal(PILOT_TYPED_ADDRESS_FEE_CENTS.SMALL, 119);
assert.equal(PILOT_TYPED_ADDRESS_FEE_CENTS.MEDIUM, 239);
assert.equal(PILOT_TYPED_ADDRESS_FEE_CENTS.LARGE, 359);
assert.equal(PILOT_DELIVERY_FEE_CENTS.SMALL_0_1_KM, 50);
assert.equal(PILOT_DELIVERY_FEE_CENTS.MEDIUM_1_2_KM, 100);
assert.equal(PILOT_DELIVERY_FEE_CENTS.LARGE_2_3_KM, 200);

const shown = totals({ subtotalCents: 500, deliveryFeeCents: 100 });
const raised = totals({ subtotalCents: 500, deliveryFeeCents: 119 });
const lowered = totals({ subtotalCents: 500, deliveryFeeCents: 50 });
const raisedAgain = totals({ subtotalCents: 500, deliveryFeeCents: 239 });

const freshCart = place({
  presented: null,
  fresh: raised,
  action: "pay"
});
assert.equal(freshCart.prompts.length, 0, "new cart has no extra confirmation");
assert.equal(freshCart.order?.deliveryFeeCents, 119);
assert.equal(freshCart.charged, raised.totalCents);

const sameFee = place({
  presented: { deliveryFeeCents: 119, totalCents: raised.totalCents },
  fresh: raised,
  action: "pay"
});
assert.equal(sameFee.prompts.length, 0, "unchanged fee is not confirmed twice");
assert.equal(sameFee.order?.deliveryFeeCents, 119);
assert.equal(sameFee.charged, raised.totalCents);

for (const method of ["CASH", "ECOCASH"] as const) {
  const increased = place({
    presented: { deliveryFeeCents: shown.deliveryFeeCents, totalCents: shown.totalCents },
    fresh: raised,
    action: "reject"
  });
  assert.equal(increased.prompts.length, 1, `${method} increase asks once`);
  assert.match(increased.prompts[0]!, /Delivery: \$1\.00 → \$1\.19/);
  assert.equal(increased.order, null, `${method} reject creates no order`);
  assert.equal(increased.charged, null, `${method} reject charges nothing`);

  const accepted = place({
    presented: { deliveryFeeCents: shown.deliveryFeeCents, totalCents: shown.totalCents },
    fresh: raised,
    action: "pay"
  });
  assert.equal(accepted.prompts.length, 1, `${method} accept asks once`);
  assert.equal(accepted.order?.deliveryFeeCents, 119);
  assert.equal(accepted.order?.totalCents, raised.totalCents);
  assert.equal(accepted.charged, raised.totalCents, `${method} charges the confirmed total`);

  const decreased = place({
    presented: { deliveryFeeCents: 239, totalCents: 739 },
    fresh: lowered,
    action: "pay"
  });
  assert.equal(decreased.prompts.length, 1, `${method} decrease still requires confirmation`);
  assert.match(decreased.prompts[0]!, /Delivery: \$2\.39 → \$0\.50/);
  assert.equal(decreased.order?.deliveryFeeCents, 50);
  assert.equal(decreased.charged, lowered.totalCents);
}

const both = evaluatePresentedCheckout({
  presented: { deliveryFeeCents: 100, totalCents: 600 },
  fresh: totals({ subtotalCents: 520, deliveryFeeCents: 119 }),
  merchandiseChanges: [{ name: "Bread", oldCents: 500, newCents: 520 }]
});
assert.equal(both.confirm, true);
assert.equal(both.message.match(/One price changed/g)?.length, 1);
assert.match(both.message, /Bread: \$5\.00 → \$5\.20/);
assert.match(both.message, /Delivery: \$1\.00 → \$1\.19/);
const parsed = parsePriceChangeDetail(both.changeDetail);
const prompt = formatPriceChange({
  changes: parsed,
  totalCents: both.totals.totalCents,
  deliveryFeeCents: both.totals.deliveryFeeCents,
  previousDeliveryFeeCents: 100
});
assert.equal(prompt.match(/Confirm order\?/g)?.length, 1, "merchandise and delivery share one prompt");
assert.match(prompt, /price of Bread/);
assert.match(prompt, /Delivery changed from \$1\.00 to \$1\.19/);
assert.match(prompt, /\$6\.39/);

const stale = place({
  presented: { deliveryFeeCents: 100, totalCents: shown.totalCents },
  fresh: raised,
  action: "pay",
  nextFresh: raisedAgain
});
assert.equal(stale.order, null, "stale confirmation does not create an order");
assert.equal(stale.charged, null, "stale confirmation does not charge");
assert.ok(stale.prompts.length >= 2);
assert.equal(
  evaluatePresentedCheckout({
    presented: { deliveryFeeCents: 119, totalCents: raised.totalCents },
    fresh: raisedAgain
  }).confirm,
  true
);

const multiBlocked = evaluatePresentedCheckout({
  presented: { deliveryFeeCents: 100, totalCents: 800 },
  fresh: totals({ subtotalCents: 700, deliveryFeeCents: 239 })
});
assert.equal(multiBlocked.confirm, true);
const multiFresh = totals({ subtotalCents: 700, deliveryFeeCents: 239 });
const multiOk = evaluatePresentedCheckout({
  presented: { deliveryFeeCents: 239, totalCents: multiFresh.totalCents },
  fresh: multiFresh
});
assert.equal(multiOk.confirm, false);
const parent = { deliveryFeeCents: multiOk.totals.deliveryFeeCents, totalCents: multiOk.totals.totalCents };
const children = [{ deliveryFeeCents: 0 }, { deliveryFeeCents: 0 }];
assert.equal(parent.deliveryFeeCents, 239);
assert.equal(parent.totalCents, multiFresh.totalCents);
assert.deepEqual(children.map((child) => child.deliveryFeeCents), [0, 0]);
assert.equal(mockChargeCents(parent), parent.totalCents);

const approved = selectConfirmedTotals({
  storedTotals: totals({ subtotalCents: 500, deliveryFeeCents: 100 }),
  fresh: raised,
  presented: { deliveryFeeCents: 100, totalCents: shown.totalCents }
});
assert.equal(approved.confirm, false);
assert.equal(approved.totals.deliveryFeeCents, 100, "approved quote keeps the stored fee");
assert.notEqual(approved.totals.deliveryFeeCents, 119);

const child = selectConfirmedTotals({
  storedTotals: { subtotalCents: 500, deliveryFeeCents: 0, serviceFeeCents: 0, totalCents: 500 },
  fresh: raised
});
assert.equal(child.confirm, false);
assert.equal(child.totals.deliveryFeeCents, 0, "multi-shop child delivery stays 0");

const historical = selectConfirmedTotals({
  storedTotals: totals({ subtotalCents: 500, deliveryFeeCents: 100 })
});
assert.equal(historical.confirm, false);
assert.equal(historical.totals.deliveryFeeCents, 100, "historical stored fee is not rewritten");

const productId = "11111111-1111-4111-8111-111111111111";
const websiteCart: DisplayedQuoteCart = {
  userId: "customer-1",
  lat: -17.8292,
  lng: 31.0522,
  deliveryLabel: "Sam Levy's Village, Harare",
  locationMode: "GPS",
  lines: [{ productId, quantity: 1, flavorOptionId: null, flavorPreference: null }]
};
const websiteKey = displayedDeliveryFingerprint(websiteCart);
assert.equal(
  websiteKey,
  displayedDeliveryFingerprint({
    ...websiteCart,
    lines: [{ productId, quantity: 1, flavorPreference: null, flavorOptionId: null }]
  }),
  "prepare and checkout use one cart key"
);
assert.notEqual(
  websiteKey,
  displayedDeliveryFingerprint({ ...websiteCart, userId: "customer-2" })
);

const shownFee = shownQuote(shown);
const raisedFee = shownQuote(raised);
assert.equal(
  quoteToStore({ existing: shownFee, next: raisedFee, replaceShown: false })?.deliveryFeeCents,
  100,
  "a checkout re-quote cannot replace the shown fee"
);
assert.equal(
  quoteToStore({ existing: null, next: raisedFee, replaceShown: false }),
  null,
  "a checkout re-quote with no stored fee does not become proof"
);
assert.equal(
  quoteToStore({ existing: shownFee, next: raisedFee, replaceShown: true })?.deliveryFeeCents,
  119,
  "a quote returned to the customer can replace the previous shown fee"
);

function rememberShown(quote: DisplayedDeliveryQuote, cart: DisplayedQuoteCart = websiteCart) {
  saveDisplayedDeliveryQuote(cart, quote, Date.now());
}

function shownQuote(fee: CheckoutTotalCents): DisplayedDeliveryQuote {
  return {
    deliveryFeeCents: fee.deliveryFeeCents,
    totalCents: fee.totalCents,
    subtotalCents: fee.subtotalCents,
    serviceFeeCents: fee.serviceFeeCents
  };
}

/** Production website and released apps omit confirmFeeCents. The updated app sends both. */
function legacyCheckout(input: {
  fresh: CheckoutTotalCents;
  cart?: DisplayedQuoteCart;
  confirm?: PresentedCheckoutTotal | null;
  merchandiseChanges?: Array<{ name: string; oldCents: number; newCents: number }>;
  action: "pay" | "reject";
}) {
  const cart = input.cart ?? websiteCart;
  const clientPresented = input.confirm ?? null;
  const displayed = clientPresented ? null : loadDisplayedDeliveryQuote(cart);
  const decision = appCheckoutDecision({
    clientPresented,
    displayed,
    fresh: input.fresh,
    merchandiseChanges: input.merchandiseChanges
  });
  if (decision.confirm) {
    return { prompts: [decision.message], order: null as CheckoutTotalCents | null, charged: null as number | null };
  }
  if (input.action === "reject") {
    return { prompts: [] as string[], order: null, charged: null };
  }
  return { prompts: [] as string[], order: decision.totals, charged: mockChargeCents(decision.totals) };
}

assert.equal(
  displayedQuoteFromResult({
    deliveryQuoteStatus: "deferred",
    deliveryFeeCents: 0,
    totalCents: 500,
    subtotalCents: 500,
    serviceFeeCents: 0
  }),
  null,
  "a deferred cart quote is not a displayed delivery fee"
);
assert.deepEqual(
  displayedQuoteFromResult({
    deliveryQuoteStatus: "final",
    deliveryFeeCents: 119,
    totalCents: raised.totalCents,
    subtotalCents: 500,
    serviceFeeCents: 0
  }),
  shownQuote(raised)
);

const productionBody = {
  lat: websiteCart.lat,
  lng: websiteCart.lng,
  deliveryLabel: websiteCart.deliveryLabel,
  locationMode: "GPS" as const,
  lines: websiteCart.lines,
  paymentMethod: "CASH" as const
};
assert.equal("confirmFeeCents" in productionBody, false);
assert.equal("confirmTotalCents" in productionBody, false);

const unseen = legacyCheckout({ fresh: raised, action: "pay" });
assert.equal(unseen.order, null, "no stored quote does not create an order");
assert.equal(unseen.charged, null, "no stored quote does not charge");
assert.match(unseen.prompts[0]!, /Delivery is \$1\.19/);
assert.match(unseen.prompts[0]!, /total on screen matches/);

rememberShown(shownQuote(raised));
for (const method of ["CASH", "ECOCASH"] as const) {
  const same = legacyCheckout({ fresh: raised, action: "pay" });
  assert.equal(same.prompts.length, 0, `${method} website checkout stays one step when the fee matches`);
  assert.equal(same.order?.deliveryFeeCents, 119);
  assert.equal(same.charged, raised.totalCents, `${method} charges the quoted total`);
}

rememberShown(shownQuote(shown));
const increased = legacyCheckout({ fresh: raised, action: "reject" });
assert.equal(increased.order, null, "website reject creates no order");
assert.equal(increased.charged, null, "website reject charges nothing");
assert.match(increased.prompts[0]!, /Delivery: \$1\.00 → \$1\.19/);
const staleRetry = legacyCheckout({ fresh: raised, action: "pay" });
assert.equal(staleRetry.order, null, "retry without a new quote does not authorize the new fee");
assert.equal(staleRetry.charged, null);

rememberShown(shownQuote(raised));
const accepted = legacyCheckout({ fresh: raised, action: "pay" });
assert.equal(accepted.prompts.length, 0, "re-quoted fee is the amount on screen");
assert.equal(accepted.order?.deliveryFeeCents, 119);
assert.equal(accepted.charged, raised.totalCents);

rememberShown(shownQuote(shown));
const updatedApp = legacyCheckout({
  fresh: raised,
  confirm: { deliveryFeeCents: 119, totalCents: raised.totalCents },
  action: "pay"
});
assert.equal(updatedApp.prompts.length, 0, "updated app can confirm the new total directly");
assert.equal(updatedApp.charged, raised.totalCents);
const staleConfirm = legacyCheckout({
  fresh: raisedAgain,
  confirm: { deliveryFeeCents: 119, totalCents: raised.totalCents },
  action: "pay"
});
assert.equal(staleConfirm.order, null, "stale confirmFeeCents does not authorize a newer total");
assert.equal(staleConfirm.charged, null);

rememberShown(shownQuote(totals({ subtotalCents: 500, deliveryFeeCents: 239 })));
const decreased = legacyCheckout({ fresh: lowered, action: "pay" });
assert.match(decreased.prompts[0]!, /Delivery: \$2\.39 → \$0\.50/);
assert.equal(decreased.order, null, "a lower fee still needs confirmation");
rememberShown(shownQuote(lowered));
const decreasedOk = legacyCheckout({ fresh: lowered, action: "pay" });
assert.equal(decreasedOk.order?.deliveryFeeCents, 50);
assert.equal(decreasedOk.charged, lowered.totalCents);

const bothLegacy = legacyCheckout({
  cart: { ...websiteCart, userId: "customer-unseen" },
  fresh: totals({ subtotalCents: 520, deliveryFeeCents: 119 }),
  merchandiseChanges: [{ name: "Bread", oldCents: 500, newCents: 520 }],
  action: "pay"
});
assert.equal(bothLegacy.prompts.length, 1, "merchandise and delivery are one prompt");
assert.equal(bothLegacy.prompts[0]!.match(/One price changed/g)?.length, 1);
assert.match(bothLegacy.prompts[0]!, /Bread: \$5\.00 → \$5\.20/);
assert.match(bothLegacy.prompts[0]!, /Delivery is \$1\.19/);
assert.equal(bothLegacy.order, null);

const multiCart: DisplayedQuoteCart = {
  ...websiteCart,
  lines: [
    { productId, quantity: 1 },
    { productId: "22222222-2222-4222-8222-222222222222", quantity: 1 }
  ]
};
rememberShown(shownQuote(totals({ subtotalCents: 700, deliveryFeeCents: 100 })), multiCart);
const multiBlockedLegacy = legacyCheckout({
  cart: multiCart,
  fresh: multiFresh,
  action: "pay"
});
assert.match(multiBlockedLegacy.prompts[0]!, /Delivery: \$1\.00 → \$2\.39/);
assert.equal(multiBlockedLegacy.order, null, "multi-shop fee increase is not charged");
assert.equal(multiBlockedLegacy.charged, null);
rememberShown(shownQuote(multiFresh), multiCart);
const multiPaid = legacyCheckout({ cart: multiCart, fresh: multiFresh, action: "pay" });
assert.equal(multiPaid.prompts.length, 0);
assert.equal(multiPaid.order?.deliveryFeeCents, 239, "parent keeps the delivery fee");
assert.equal(multiPaid.charged, multiFresh.totalCents);
assert.equal(loadDisplayedDeliveryQuote({ ...websiteCart, userId: "expired-customer" }), null);

const order = src("../src/modules/commerce/order.service.ts");
const assertFn = between(order, "export async function assertBasketTotalsCurrent", "export async function createConfirmedCommerceOrder");
const storedBranch = between(assertFn, "if (input.storedTotals)", "let merchantLat");
assert.match(storedBranch, /selectConfirmedTotals/);
assert.doesNotMatch(storedBranch, /quoteBasketTotals/);
const createOrder = between(order, "export async function createConfirmedCommerceOrder", "export async function merchantAcceptOrder");
assert.ok(createOrder.indexOf("assertBasketTotalsCurrent") < createOrder.indexOf("commerceOrder.create"));
assert.match(createOrder, /storedTotals: input\.totals/);
assert.match(createOrder, /presented: input\.totals \? null : \(input\.presented \?\? null\)/);
assert.match(createOrder, /deliveryFeeCents: totals\.deliveryFeeCents/);
assert.doesNotMatch(createOrder, /deliveryFeeCents: input\.presented/);

const cart = src("../src/modules/commerce/customer-commerce.service.ts");
const prepare = between(cart, "export async function prepareCheckout", "function presentedCheckoutTotals");
assert.match(prepare, /quoteAndRememberCart/);
assert.match(prepare, /rememberShown === false \? await quoteCart/);
assert.ok(prepare.indexOf("quoteAndRememberCart") < prepare.lastIndexOf("return quoted"));
const remembered = between(cart, "export async function quoteAndRememberCart", "const CHECKOUT_PREP_COPY");
assert.match(remembered, /rememberDisplayedDeliveryQuote/);
assert.match(remembered, /replaceShown: true/);
assert.match(src("../src/modules/commerce/displayed-delivery-quote.ts"), /deliveryQuoteStatus !== "final"/);
const checkoutCart = between(cart, "export async function checkoutCart", "export async function checkoutCatalogDemand");
assert.match(checkoutCart, /readDisplayedDeliveryQuote/);
assert.match(checkoutCart, /rememberShown: false/);
assert.doesNotMatch(checkoutCart, /rememberDisplayedDeliveryQuote/);
assert.match(src("../src/modules/commerce/displayed-delivery-quote-store.ts"), /replaceShown === true/);
const multiBranch = between(checkoutCart, "if (shopCount > 1)", "const order = await createConfirmedCommerceOrder");
assert.ok(multiBranch.indexOf("appCheckoutDecision") < multiBranch.indexOf("createMultiShopCheckout"));
assert.ok(multiBranch.indexOf("PRICE_CHANGED") < multiBranch.indexOf("initiateMobileMoneyPaymentForOrder"));
const singlePay = between(checkoutCart, "const order = await createConfirmedCommerceOrder", "if (paymentMethod === \"ECOCASH\")");
assert.match(singlePay, /presented/);
assert.match(singlePay, /unconfirmedDelivery/);
assert.doesNotMatch(singlePay, /deliveryFeeCents/);
assert.ok(checkoutCart.indexOf("readDisplayedDeliveryQuote") < checkoutCart.indexOf("createMultiShopCheckout"));
assert.ok(checkoutCart.indexOf("presented") < checkoutCart.lastIndexOf("initiateMobileMoneyPaymentForOrder"));
const quoteStore = src("../src/modules/commerce/displayed-delivery-quote-store.ts");
assert.doesNotMatch(quoteStore, /commerceOrder\.update/);
assert.match(quoteStore, /displayedQuoteFromResult/);
const assertFnTail = between(assertFn, "if (input.unconfirmedDelivery && !input.presented)", "const decision = selectConfirmedTotals");
assert.match(assertFnTail, /unseenDisplayedDeliveryDecision/);
assert.match(createOrder, /unconfirmedDelivery: input\.totals \? false/);
assert.match(createOrder, /legacyReview: input\.totals \? false/);

const multi = src("../src/modules/commerce/multi-shop-checkout.service.ts");
const childTotals = between(multi, "const child = await createConfirmedCommerceOrder", "await prisma.commerceOrder.update");
assert.match(childTotals, /deliveryFeeCents: 0/);
assert.match(multi, /deliveryFeeCents: input\.quote\.deliveryFeeCents/);

const whatsapp = src("../src/modules/whatsapp/customer-handler.ts");
const confirmDraft = between(whatsapp, "async function confirmDraftOrder", "async function handlePaymentConversation");
assert.ok(confirmDraft.indexOf("assertBasketTotalsCurrent") < confirmDraft.indexOf("sendPaymentChoices"));
const cashPay = between(whatsapp, "async function finalizeCashPayment", "async function startMobileMoneyWithPayerPhone");
assert.match(cashPay, /presented: presentedQuote\(ctx\)/);
assert.doesNotMatch(between(cashPay, "const order = await createConfirmedCommerceOrder", "ctx.activeOrderId = order.id"), /totals:/);
const ecoPay = between(whatsapp, "async function startMobileMoneyWithPayerPhone", "async function handleOrderCreateError");
assert.match(ecoPay, /presented: presentedQuote\(ctx\)/);
assert.ok(ecoPay.indexOf("createConfirmedCommerceOrder") < ecoPay.indexOf("initiateMobileMoneyPaymentForOrder"));

const home = src("../../mobile/src/screens/commerce/ShopHomeScreen.tsx");
assert.match(home, /Delivery in Harare and Gweru from \$1\.19/);
assert.doesNotMatch(home, /Delivery from \$1\.19/);
assert.doesNotMatch(home, /minimum everywhere/i);
assert.doesNotMatch(home, /calculatePilotDeliveryPrice/);

const checkoutScreen = src("../../mobile/src/screens/commerce/CommerceCheckoutScreen.tsx");
assert.match(checkoutScreen, /confirmFeeCents: shown\.deliveryFeeCents/);
assert.match(checkoutScreen, /confirmTotalCents: shown\.totalCents/);
assert.match(checkoutScreen, /setUpdatedTotals\(next\)/);
assert.match(checkoutScreen, /quote\.deliveryFeeCents/);
const onError = between(checkoutScreen, "onError:", "if (!session");
assert.doesNotMatch(onError, /\.mutate\(/);
assert.doesNotMatch(checkoutScreen, /calculatePilotDeliveryPrice/);

function sqlFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sqlFiles(path));
    else if (entry.name.endsWith(".sql")) found.push(path);
  }
  return found;
}

for (const file of sqlFiles(resolve(repo, "apps/api/prisma/migrations"))) {
  const sql = readFileSync(file, "utf8");
  assert.doesNotMatch(sql, /SET\s[\s\S]{0,800}?"deliveryFeeCents"\s*=/i, file);
  assert.doesNotMatch(sql, /deliveryFeeCents"\s*=\s*(119|239|359)/);
}

console.log(JSON.stringify({
  ok: true,
  newCartPrompts: freshCart.prompts.length,
  unchangedPrompts: sameFee.prompts.length,
  confirmedDeliveryFeeCents: freshCart.order?.deliveryFeeCents,
  approvedDeliveryFeeCents: approved.totals.deliveryFeeCents,
  childDeliveryFeeCents: child.totals.deliveryFeeCents
}));
