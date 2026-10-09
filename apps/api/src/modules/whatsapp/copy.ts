/**
 * Stage 4.6A — WhatsApp copy helpers.
 * Keep messages short, clear, one decision per message.
 */

export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export const CUSTOMER_HELP = [
  "I didn't quite get that. You can say something like:",
  "'2 breads and eggs'",
  "'remove eggs'",
  "'total'",
  "'done'"
].join("\n");

export const CUSTOMER_HELP_FULL = [
  "Tell me what you need, then we'll confirm delivery.",
  "You can also: add · remove · show cart · checkout"
].join("\n");

export function formatCustomerWelcome(): string {
  return [
    "👋 Welcome to DUTS",
    "",
    "Shop from local stores and get your order delivered to you.",
    "",
    "What would you like to do?",
    "",
    "1. Shop",
    "2. Track order",
    "3. Help",
    "",
    "Reply with 1, 2 or 3."
  ].join("\n");
}

export function formatMainMenu(): string {
  return [
    "What would you like to do?",
    "",
    "1. Shop",
    "2. Track order",
    "3. Help",
    "",
    "Reply with 1, 2 or 3."
  ].join("\n");
}

/** Numbered text equivalent for interactive choices. Buttons are presentation only. */
export function formatChoiceTextFallback(body: string, titles: string[]): string {
  const labels = titles.map((t) => t.trim()).filter(Boolean);
  if (!labels.length) return body;
  const alreadyNumbered = labels.every((title, i) =>
    new RegExp(`(?:^|\\n)${i + 1}\\.\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(body)
  );
  const replyLine =
    labels.length === 1
      ? "Reply with 1."
      : `Reply with ${labels.map((_, i) => String(i + 1)).slice(0, -1).join(", ")} or ${labels.length}.`;
  if (alreadyNumbered) {
    return /reply with \d/i.test(body) ? body : `${body}\n\n${replyLine}`;
  }
  const numbered = labels.map((title, i) => `${i + 1}. ${title}`).join("\n");
  return `${body}\n\n${numbered}\n\n${replyLine}`;
}

export function formatShopPrompt(): string {
  return [
    "What do you need?",
    "",
    "You can type something like:",
    "",
    "bread, milk and eggs"
  ].join("\n");
}

export function formatCustomerHelpMenu(): string {
  return [
    "DUTS can help you shop from local stores and get your order delivered.",
    "",
    "You can:",
    "",
    "🛒 Shop",
    "📦 Track an order",
    "📍 Send or type your delivery location",
    "",
    "Need help with an order?"
  ].join("\n");
}

export const MERCHANT_HELP = [
  "I didn't quite get that. Try:",
  "• orders",
  "• add product",
  "• change price",
  "• out of stock",
  "• ready"
].join("\n");

type CartDisplayLine = {
  quantity: number;
  productName: string;
  lineTotalCents: number;
  flavorLine?: string | null;
};

export function formatCartLines(lines: CartDisplayLine[]): string {
  return lines
    .map((l) => {
      const flavor = l.flavorLine ? `\n${l.flavorLine}` : "";
      return `${l.quantity} × ${l.productName}${flavor} — ${money(l.lineTotalCents)}`;
    })
    .join("\n");
}

/** Guest web basket restored — ask for WhatsApp location before any delivery quote. */
export function formatGuestHandoffAwaitingLocation(input: {
  shopName?: string;
  lines: CartDisplayLine[];
  subtotalCents: number;
  superseded?: boolean;
}): string {
  void input.shopName;
  return [
    input.superseded ? "Got it — I've opened your new basket." : null,
    input.superseded ? "" : null,
    "Your DUTS cart",
    "",
    formatCartLines(input.lines),
    "",
    `Items: ${money(input.subtotalCents)}`,
    "",
    formatLocationAsk()
  ]
    .filter((x) => x != null)
    .join("\n");
}

export function formatLocationAsk(): string {
  return [
    "Where should we deliver?",
    "",
    "📍 Send your current location",
    "",
    "or",
    "",
    "✍️ Type your delivery address",
    "",
    "Example:",
    "House 24, Senga 2, near MSU Main Campus, Gweru"
  ].join("\n");
}

export function formatLocationConfirm(label: string): string {
  const clean = formatCustomerDeliveryLabel(label) ?? "Pinned location ✓";
  const withMark = /✓\s*$/.test(clean) ? clean : `${clean} ✓`;
  return `Deliver to:\n${withMark}`;
}

export function formatLocationFailed(): string {
  return [
    "I couldn't find that address.",
    "",
    "Please add your area and a nearby landmark.",
    "",
    "Example:",
    "Senga 2, near MSU Main Campus"
  ].join("\n");
}

export function formatLocationNeedCity(): string {
  return [
    "Which city should we deliver to?",
    "",
    "Example: Gweru"
  ].join("\n");
}

export function formatLocationNeedArea(input: { city?: string }): string {
  const city = input.city?.trim();
  return [
    city ? `Which area in ${city}?` : "Which area or suburb should we deliver to?",
    "",
    "Example: Senga"
  ].join("\n");
}

export function formatLocationAreaFound(input: { areaLabel: string; suburb?: string }): string {
  const suburb = input.suburb?.trim() || input.areaLabel.split(",")[0]?.trim() || "this area";
  return [
    `I found ${input.areaLabel}, but not the exact address.`,
    "",
    `Is this delivery in ${suburb}?`,
    "",
    "1. Yes",
    "2. No"
  ].join("\n");
}

export function formatLocationNeedLandmarkForArea(input: { areaLabel?: string; city?: string }): string {
  const where = input.areaLabel?.trim() || (input.city ? `in ${input.city}` : "");
  return [
    where
      ? `I found ${input.areaLabel ?? input.city}, but I couldn't find the exact address.`
      : "I couldn't find the exact address.",
    "",
    "What's a nearby landmark?",
    "",
    "Example:",
    "MSU Main Campus",
    "Senga Shopping Centre"
  ].join("\n");
}

export function formatLocationUseThisArea(input: { label: string }): string {
  return [
    `I found ${input.label}.`,
    "",
    "Use this delivery area?",
    "",
    "1. Yes",
    "2. Change address"
  ].join("\n");
}

export function formatLocationStillUnpinned(input: { areaLabel?: string; landmark?: string }): string {
  const where = [input.landmark, input.areaLabel].filter(Boolean).join(" in ");
  return [
    where ? `I still couldn't pin ${where}.` : "I still couldn't pin that delivery point.",
    "",
    "Send your current location, or another nearby landmark."
  ].join("\n");
}

export function formatLocationNeedLandmark(): string {
  return [
    "I couldn't find the exact delivery point.",
    "",
    "Please send:",
    "1. Area/suburb",
    "2. Nearest landmark"
  ].join("\n");
}

export function formatLocationAmbiguous(options: Array<{ label: string }>): string {
  const list = options.map((o, i) => `${i + 1}. ${formatCustomerDeliveryLabel(o.label) ?? o.label}`).join("\n");
  return ["I found more than one location.", "", "Which one do you mean?", "", list].join("\n");
}

const COORD_RE = /^-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+$/;

/** Prefer suburb/city labels. Never show raw lat/lng to the customer. */
export function formatCustomerDeliveryLabel(label: string | null | undefined): string | null {
  const trimmed = String(label ?? "").trim();
  if (!trimmed) return null;
  if (COORD_RE.test(trimmed)) return "Pinned location ✓";
  return trimmed;
}

export function formatOrderCartSummary(input: {
  heading?: string;
  shopName?: string;
  lines: CartDisplayLine[];
  subtotalCents: number;
  deliveryFeeCents: number;
  serviceFeeCents?: number;
  totalCents: number;
  deliveryLabel?: string;
  /** @deprecated Do not show payment before the customer selects a method. */
  paymentNote?: string;
  footer?: string;
  /** When true, append Confirm / Change / Cancel numbered choices (plain-text fallback). */
  includeConfirmChoices?: boolean;
}): string {
  const delivery = formatCustomerDeliveryLabel(input.deliveryLabel);
  const parts = [
    input.heading ?? "Your DUTS order",
    "",
    formatCartLines(input.lines),
    "",
    input.shopName ? `Shop: ${input.shopName}` : null,
    `Items: ${money(input.subtotalCents)}`,
    `Delivery: ${money(input.deliveryFeeCents)}`,
    input.serviceFeeCents && input.serviceFeeCents > 0
      ? `Service fee: ${money(input.serviceFeeCents)}`
      : null,
    `Total: ${money(input.totalCents)}`,
    delivery ? `Deliver to: ${delivery}` : null,
    // Never show premature payment method on order review.
    input.includeConfirmChoices
      ? ["", "Confirm order?", "", "1. Confirm", "2. Change", "3. Cancel"].join("\n")
      : input.footer ?? null
  ];
  return parts.filter((p) => p != null && p !== "").join("\n");
}

export function formatOrderReviewPrompt(): string {
  return "Confirm order?";
}

export function formatDisambiguation(
  title: string,
  options: Array<{ name: string; priceCents: number }>
): string {
  const list = options.map((o, i) => `${i + 1}. ${o.name} — ${money(o.priceCents)}`).join("\n");
  const max = Math.min(options.length, 3);
  return [
    title,
    "",
    list,
    "",
    max <= 2 ? `Reply 1 or 2.` : `Reply 1, 2, or 3.`
  ].join("\n");
}

export function formatBudgetOver(input: {
  subtotalCents: number;
  budgetCents: number;
  lines: Array<{ quantity: number; productName: string; lineTotalCents: number }>;
}): string {
  const over = input.subtotalCents - input.budgetCents;
  return [
    `Your items are ${money(input.subtotalCents)} before delivery, which is ${money(over)} over your ${money(input.budgetCents)} budget.`,
    "",
    formatCartLines(input.lines),
    "",
    "You can remove an item or reduce a quantity."
  ].join("\n");
}

export function formatShopSwitch(input: {
  previousShopName?: string;
  newShopName: string;
  totalCents: number;
}): string {
  if (input.previousShopName) {
    return `${input.previousShopName} doesn't have everything, but ${input.newShopName} has your full order. The new total is ${money(input.totalCents)}.`;
  }
  return `${input.newShopName} has your full order. The new total is ${money(input.totalCents)}.`;
}

export function formatPriceChange(input: {
  changes: Array<{ name: string; oldCents: number; newCents: number }>;
  totalCents: number;
}): string {
  const detail = input.changes
    .map(
      (c) =>
        `The price of ${c.name} changed from ${money(c.oldCents)} to ${money(c.newCents)}.`
    )
    .join("\n");
  return [
    detail,
    `Your new total is ${money(input.totalCents)}.`,
    "",
    "Confirm order?",
    "",
    "1. Confirm",
    "2. Change",
    "3. Cancel"
  ].join("\n");
}

/** Parse "Name: $1.00 → $1.20" style change strings from order.service. */
export function parsePriceChangeDetail(detail: string): Array<{
  name: string;
  oldCents: number;
  newCents: number;
}> {
  const parts = detail.split(";").map((p) => p.trim()).filter(Boolean);
  const out: Array<{ name: string; oldCents: number; newCents: number }> = [];
  for (const part of parts) {
    const m = part.match(/^(.+?):\s*\$?(\d+(?:\.\d{1,2})?)\s*→\s*\$?(\d+(?:\.\d{1,2})?)/);
    if (!m) continue;
    out.push({
      name: m[1]!.trim(),
      oldCents: Math.round(Number(m[2]) * 100),
      newCents: Math.round(Number(m[3]) * 100)
    });
  }
  return out;
}

export function formatCompactMutation(input: {
  note: string;
  totalCents: number;
}): string {
  const note = input.note.replace(/\.\s*$/, "");
  return `${note}. Your total is now ${money(input.totalCents)}.\n\nReply ADD, REMOVE, or CHECKOUT.`;
}

export function formatMissingItems(missing: string, hint?: string): string {
  return [
    "I couldn't find one nearby shop with everything.",
    `Not available right now: ${missing}.`,
    hint ?? null,
    "",
    "Remove an item or try a different product."
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatMerchantNewOrder(input: {
  orderNumber: number;
  lines: string[];
  itemsTotalCents: number;
  totalCents?: number;
  displayRef?: string;
}): string {
  const total = input.totalCents ?? input.itemsTotalCents;
  const heading = input.displayRef
    ? `NEW DUTS ORDER #${input.displayRef}`
    : `NEW ORDER #${input.orderNumber}`;
  return [
    heading,
    "",
    ...input.lines,
    "",
    input.displayRef ? `Items: ${money(input.itemsTotalCents)}` : `Total: ${money(total)}`,
    "",
    "1. ACCEPT",
    "2. REJECT"
  ].join("\n");
}

export function formatMerchantAccepted(orderNumber: number): string {
  return [
    `Order #${orderNumber} accepted.`,
    "",
    "Prepare the order.",
    "Reply READY when it can be collected."
  ].join("\n");
}

export function formatMerchantReady(orderNumber: number): string {
  return [`✓ Order #${orderNumber} ready`, "", "Finding a courier..."].join("\n");
}

/** READY succeeded at shop but delivery gig could not start — recoverable. */
export function formatMerchantReadyDeliveryFailed(): string {
  return [
    "Order is ready.",
    "",
    "DUTS couldn't start delivery yet.",
    "Please try READY again shortly."
  ].join("\n");
}

export function formatCustomerMerchantAccepted(): string {
  return ["✓ Shop accepted your order.", "", "Preparing it now."].join("\n");
}

export function formatCustomerOrderReady(): string {
  return ["✓ Your order is ready.", "", "Finding a courier..."].join("\n");
}

export function formatFindingAnotherCourier(): string {
  return ["We're finding another courier for your order.", "", "Your order is still confirmed."].join("\n");
}

export function formatCustomerOrderConfirmedArranging(): string {
  return [
    "Order confirmed ✓",
    "",
    "We're arranging your delivery.",
    "It may take a little longer than usual.",
    "",
    "We'll update you when your courier is assigned."
  ].join("\n");
}

export function formatCustomerMerchantSlow(): string {
  return [
    "Your order is confirmed ✓",
    "",
    "We're arranging pickup.",
    "It may take a little longer than usual."
  ].join("\n");
}

export function formatCustomerFindingCourier(): string {
  return [
    "Order confirmed ✓",
    "",
    "We're finding a courier.",
    "Delivery may take longer than usual."
  ].join("\n");
}

export function formatCustomerFulfillmentProblem(): string {
  return ["There's a problem fulfilling your order.", "DUTS is checking it now."].join("\n");
}

export function formatPaymentMethodChoice(_totalCents?: number): string {
  return ["Choose payment", "", "1. EcoCash USD", "2. Cash on delivery"].join("\n");
}

export function formatEcoCashPrompt(): string {
  return [
    "EcoCash number",
    "",
    "Enter the EcoCash number you want to pay with.",
    "",
    "Example: 0771234567"
  ].join("\n");
}

export function formatOneMoneyPrompt(): string {
  return [
    "OneMoney",
    "",
    "Enter the OneMoney number you want to pay with.",
    "",
    "Example: 0712345678"
  ].join("\n");
}

export function formatMobileMoneyPhonePrompt(method: "ECOCASH" | "ONEMONEY"): string {
  return method === "ONEMONEY" ? formatOneMoneyPrompt() : formatEcoCashPrompt();
}

export function formatEcoCashPending(_displayLocal?: string): string {
  return [
    "EcoCash request sent ✓",
    "",
    "Approve the payment on your phone.",
    "",
    "Waiting for confirmation…"
  ].join("\n");
}

export function formatOneMoneyPending(_displayLocal?: string): string {
  return [
    "OneMoney payment request sent.",
    "",
    "Approve the payment on your phone.",
    "",
    "Waiting for confirmation..."
  ].join("\n");
}

/** Paynow local/test modes — never claim funds received at initiation. */
export function formatPaynowTestPending(method: "ECOCASH" | "ONEMONEY" = "ECOCASH"): string {
  return method === "ONEMONEY" ? formatOneMoneyPending() : formatEcoCashPending();
}

export function formatMobileMoneyPending(input: {
  method: "ECOCASH" | "ONEMONEY";
  displayLocal: string;
  paynowTestMode?: boolean;
}): string {
  void input.displayLocal;
  void input.paynowTestMode;
  return input.method === "ONEMONEY" ? formatOneMoneyPending() : formatEcoCashPending();
}

export function formatEcoCashPaid(totalCents?: number, orderNumber?: number): string {
  return [
    "Payment received ✓",
    "",
    orderNumber != null ? `Order #${orderNumber} confirmed.` : "Your order is confirmed.",
    totalCents != null ? `Total: ${money(totalCents)}` : null,
    "",
    "We're sending it to the shop now."
  ]
    .filter((x) => x != null && x !== "")
    .join("\n");
}

export function formatCashOrderConfirmed(totalCents: number, orderNumber?: number): string {
  return [
    "Order confirmed ✓",
    "",
    orderNumber != null ? `Order #${orderNumber}` : null,
    `Total: ${money(totalCents)}`,
    "Payment: Cash on delivery",
    "",
    "We're sending it to the shop now."
  ]
    .filter((x) => x != null && x !== "")
    .join("\n");
}

export function formatOrderCancelled(): string {
  return [
    "No problem — your checkout was cancelled.",
    "",
    "You can start another order anytime."
  ].join("\n");
}

export function formatEcoCashFailed(): string {
  return ["Payment was not completed.", "", "1. Try again", "2. Cash on delivery"].join("\n");
}

export function formatEcoCashExpired(): string {
  return ["Payment was not completed.", "", "1. Try again", "2. Cash on delivery"].join("\n");
}

export function formatMobileMoneyCancelled(): string {
  return ["Payment was not completed.", "", "1. Try again", "2. Cash on delivery"].join("\n");
}

export function formatClaimPaidIgnored(): string {
  return [
    "Payment is still being confirmed.",
    "If it failed, reply 1 to try again or 2 for cash on delivery."
  ].join("\n");
}

export function formatPaymentStillPending(): string {
  return "Payment is still being confirmed.";
}

export function formatReadyToOrder(input: {
  lines: CartDisplayLine[];
  subtotalCents: number;
}): string {
  return [
    "Your cart",
    "",
    formatCartLines(input.lines),
    "",
    `Items: ${money(input.subtotalCents)}`,
    "",
    "Ready to order?",
    "",
    "1. Yes",
    "2. Add more"
  ].join("\n");
}

export function formatChangeWhat(includePayment: boolean): string {
  return [
    "What would you like to change?",
    "",
    "1. Items",
    "2. Delivery location",
    includePayment ? "3. Payment method" : null
  ]
    .filter((x) => x != null)
    .join("\n");
}

export function formatPendingPaymentHandoff(): string {
  return [
    "Your previous payment is still being checked.",
    "",
    "1. Check previous payment",
    "2. Start new basket"
  ].join("\n");
}

export function formatHandoffExpired(): string {
  return [
    "That basket link has expired.",
    "",
    "Please return to DUTS and continue your order again."
  ].join("\n");
}

export function formatStatusChoices(
  orders: Array<{ orderNumber: number; label: string }>
): string {
  return [
    `You have ${orders.length} active orders:`,
    "",
    ...orders.map((o, i) => `${i + 1}. #${o.orderNumber} — ${o.label}`)
  ].join("\n");
}

export function formatUnlistedNotFoundOffer(itemName: string): string {
  const name = itemName.trim() || "that item";
  return [
    `I couldn't find ${name} in DUTS.`,
    "",
    "Would you like us to look for it?",
    "",
    "1. Request this item",
    "2. Try another search"
  ].join("\n");
}

export function formatUnlistedSearching(itemName: string): string {
  return [
    `We're looking for ${itemName}.`,
    "",
    "We'll message you when a courier finds it — with the actual price — so you can decide before paying."
  ].join("\n");
}

export function formatUnlistedQuote(input: {
  productName: string;
  itemCents: number;
  deliveryCents: number;
  totalCents: number;
  merchantName?: string | null;
  quantity: number;
  maxBudgetCents?: number | null;
  foundPriceCents?: number | null;
  photoUrl?: string | null;
}): string {
  const overBudget =
    input.maxBudgetCents != null &&
    input.foundPriceCents != null &&
    input.foundPriceCents > input.maxBudgetCents;
  const lines = [
    "We found it 🎉",
    "",
    input.productName,
    input.quantity > 1 ? `Quantity: ${input.quantity}` : null,
    "",
    `Item: ${money(input.itemCents)}`,
    `Delivery: ${money(input.deliveryCents)}`,
    `Total: ${money(input.totalCents)}`,
    input.merchantName ? `\nFound at:\n${input.merchantName}` : null,
    overBudget
      ? `\nYour maximum was ${money(input.maxBudgetCents!)}.\nFound price is ${money(input.foundPriceCents!)}.`
      : null,
    input.photoUrl ? `\nPhoto: ${input.photoUrl}` : null,
    "",
    "1. Buy it",
    "2. No thanks"
  ];
  return lines.filter((l) => l != null).join("\n");
}

export function formatUnlistedDeclined(): string {
  return "No problem. You haven't been charged.\n\nTell me if you want to look for something else.";
}

export function formatUnlistedNotFoundCustomer(): string {
  return ["We couldn't find this item nearby.", "", "You haven't been charged."].join("\n");
}

export function formatUnlistedExpired(): string {
  return ["We couldn't find this item in time.", "", "You haven't been charged."].join("\n");
}

export function formatUnlistedNeedsAttention(): string {
  return "This request needs DUTS help. You won't be charged extra automatically.";
}

export function formatUnlistedPaymentChoice(totalCents: number): string {
  return [
    `Total ${money(totalCents)}.`,
    "",
    "Pay with EcoCash to confirm. We'll tell the courier to buy it only after payment is confirmed.",
    "",
    "Cash on delivery is not available for unlisted items yet.",
    "",
    "1. EcoCash"
  ].join("\n");
}

export function formatUnlistedPaid(): string {
  return "Payment confirmed. A courier is buying the item and will deliver it to you.";
}

export function formatCheckoutHelp(expected?: string): string {
  switch (expected) {
    case "PRODUCT_DISAMBIGUATION":
      return "Reply with 1, 2, or 3 to pick a product.";
    case "PRODUCT_FLAVOR":
      return "Reply with a flavor, or Any.";
    case "READY_TO_ORDER":
      return "Reply 1 to continue, or 2 to add more items.";
    case "LOCATION":
      return formatLocationAsk();
    case "LOCATION_CLARIFICATION":
      return "Reply 1 or 2 to pick a delivery location, or type a clearer address.";
    case "ORDER_CONFIRMATION":
      return ["Confirm order?", "", "1. Confirm", "2. Change", "3. Cancel"].join("\n");
    case "PAYMENT_METHOD":
      return formatPaymentMethodChoice();
    case "ECOCASH_NUMBER":
      return formatEcoCashPrompt();
    case "PAYMENT_PENDING":
      return formatPaymentStillPending();
    case "PAYMENT_RETRY":
      return formatEcoCashFailed();
    case "CHANGE_WHAT":
      return formatChangeWhat(true);
    case "PENDING_PAYMENT_HANDOFF":
      return formatPendingPaymentHandoff();
    case "UNLISTED_OFFER":
      return "Reply 1 to request this item, or 2 to try another search.";
    case "UNLISTED_QUOTE":
      return "Reply 1 to buy it, or 2 to decline. You will not be charged unless you approve.";
    case "UNLISTED_PAYMENT":
    case "UNLISTED_ECOCASH":
      return formatEcoCashPrompt();
    default:
      return CUSTOMER_HELP_FULL;
  }
}

