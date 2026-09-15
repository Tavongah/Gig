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
  "Share your location, then tell me what you need.",
  "You can also: add · remove · show cart · checkout"
].join("\n");

export const MERCHANT_HELP = [
  "I didn't quite get that. Try:",
  "• orders",
  "• add product",
  "• change price",
  "• out of stock",
  "• ready"
].join("\n");

export function formatCartLines(
  lines: Array<{ quantity: number; productName: string; lineTotalCents: number }>
): string {
  return lines.map((l) => `${l.quantity} × ${l.productName} — ${money(l.lineTotalCents)}`).join("\n");
}

/** Prefer human-readable delivery labels; keep coordinate strings as safe fallback. */
export function formatCustomerDeliveryLabel(label: string | null | undefined): string | null {
  const trimmed = String(label ?? "").trim();
  if (!trimmed) return null;
  return trimmed;
}

export function formatOrderCartSummary(input: {
  shopName?: string;
  lines: Array<{ quantity: number; productName: string; lineTotalCents: number }>;
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
    "Your order",
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
}): string {
  const total = input.totalCents ?? input.itemsTotalCents;
  return [
    `NEW ORDER #${input.orderNumber}`,
    "",
    ...input.lines,
    "",
    `Total: ${money(total)}`,
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

export function formatCustomerMerchantAccepted(): string {
  return ["✓ Shop accepted your order.", "", "Preparing it now."].join("\n");
}

export function formatCustomerOrderReady(): string {
  return ["✓ Your order is ready.", "", "Finding a courier..."].join("\n");
}

export function formatPaymentMethodChoice(_totalCents?: number): string {
  return [
    "Choose payment",
    "",
    "1. EcoCash",
    "2. OneMoney",
    "3. Cash on delivery",
    "",
    "Reply 1, 2 or 3."
  ].join("\n");
}

export function formatEcoCashPrompt(): string {
  return [
    "EcoCash",
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
    "EcoCash payment request sent.",
    "",
    "Approve the payment on your phone.",
    "",
    "Waiting for confirmation..."
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

export function formatEcoCashPaid(totalCents?: number): string {
  return [
    "✓ Payment received",
    totalCents != null ? `Total: ${money(totalCents)}` : null,
    "",
    "Your order has been sent to the shop."
  ]
    .filter((x) => x != null && x !== "")
    .join("\n");
}

export function formatCashOrderConfirmed(totalCents: number): string {
  return [
    "✓ Cash on delivery",
    "",
    `Total: ${money(totalCents)}`,
    "",
    "Pay when your order arrives.",
    "",
    "Your order has been sent to the shop."
  ].join("\n");
}

export function formatOrderCancelled(): string {
  return "Order cancelled.";
}

export function formatEcoCashFailed(): string {
  return ["Payment failed.", "", "1. Try again", "2. Pay cash"].join("\n");
}

export function formatEcoCashExpired(): string {
  return ["Payment request expired.", "", "1. Try again", "2. Pay cash"].join("\n");
}

export function formatMobileMoneyCancelled(): string {
  return ["Payment cancelled.", "", "1. Try again", "2. Pay cash"].join("\n");
}

export function formatClaimPaidIgnored(): string {
  return [
    "We'll confirm when payment clears.",
    "If it failed, reply 1 to try again or 2 for cash."
  ].join("\n");
}
