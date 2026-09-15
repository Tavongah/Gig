/**
 * Stage 4.6A — WhatsApp copy helpers.
 * Keep messages short, natural, and action-oriented. No architecture changes.
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
  return lines.map((l) => `• ${l.quantity} × ${l.productName} — ${money(l.lineTotalCents)}`).join("\n");
}

export function formatOrderCartSummary(input: {
  shopName?: string;
  lines: Array<{ quantity: number; productName: string; lineTotalCents: number }>;
  subtotalCents: number;
  deliveryFeeCents: number;
  serviceFeeCents?: number;
  totalCents: number;
  deliveryLabel?: string;
  paymentNote?: string;
  footer?: string;
}): string {
  const parts = [
    "Your order:",
    formatCartLines(input.lines),
    "",
    input.shopName ? `Shop: ${input.shopName}` : null,
    `Items: ${money(input.subtotalCents)}`,
    `Delivery: ${money(input.deliveryFeeCents)}`,
    input.serviceFeeCents && input.serviceFeeCents > 0
      ? `Service fee: ${money(input.serviceFeeCents)}`
      : null,
    `Total: ${money(input.totalCents)}`,
    input.deliveryLabel ? `Deliver to: ${input.deliveryLabel}` : null,
    input.paymentNote ?? null,
    input.footer ?? null
  ];
  return parts.filter(Boolean).join("\n");
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
    `Your new total is ${money(input.totalCents)}. Continue?`,
    "",
    "Reply CONFIRM or CHANGE."
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
}): string {
  return [
    `*New DUTS order #${input.orderNumber}*`,
    "",
    ...input.lines,
    "",
    `Items: ${money(input.itemsTotalCents)}`,
    "",
    "Reply:",
    "ACCEPT",
    "REJECT"
  ].join("\n");
}

export function formatPaymentMethodChoice(totalCents: number): string {
  return [
    `Your total is ${money(totalCents)}.`,
    "Choose payment method:",
    "1. EcoCash",
    "2. OneMoney",
    "3. Cash on delivery"
  ].join("\n");
}

export function formatEcoCashPrompt(): string {
  return "Enter the EcoCash number you want to pay with.";
}

export function formatOneMoneyPrompt(): string {
  return "Enter the OneMoney number you want to pay with.";
}

export function formatMobileMoneyPhonePrompt(method: "ECOCASH" | "ONEMONEY"): string {
  return method === "ONEMONEY" ? formatOneMoneyPrompt() : formatEcoCashPrompt();
}

export function formatEcoCashPending(displayLocal: string): string {
  return [
    `We've sent an EcoCash payment request to ${displayLocal}.`,
    "Please approve it on your phone."
  ].join("\n");
}

export function formatOneMoneyPending(displayLocal: string): string {
  return [
    `We've sent a OneMoney payment request to ${displayLocal}.`,
    "Please approve it on your phone."
  ].join("\n");
}

/** Paynow local/test modes — controlled copy; do not forward provider strings. */
export function formatPaynowTestPending(): string {
  return "Payment request created. Waiting for payment confirmation.";
}

export function formatMobileMoneyPending(input: {
  method: "ECOCASH" | "ONEMONEY";
  displayLocal: string;
  paynowTestMode?: boolean;
}): string {
  if (input.paynowTestMode) return formatPaynowTestPending();
  return input.method === "ONEMONEY"
    ? formatOneMoneyPending(input.displayLocal)
    : formatEcoCashPending(input.displayLocal);
}

export function formatEcoCashPaid(): string {
  return "Payment received ✅\nYour order has been confirmed.";
}

export function formatEcoCashFailed(): string {
  return [
    "The payment was not completed.",
    "Reply RETRY to try again or CASH to pay on delivery."
  ].join("\n");
}

export function formatEcoCashExpired(): string {
  return [
    "The payment request expired.",
    "Reply RETRY to send another request or CASH to pay on delivery."
  ].join("\n");
}

export function formatMobileMoneyCancelled(): string {
  return [
    "The payment request was cancelled.",
    "Reply RETRY to try again or CASH to pay on delivery."
  ].join("\n");
}

export function formatClaimPaidIgnored(): string {
  return [
    "We'll confirm payment when the provider notifies us — you don't need to reply here.",
    "If the request failed, reply RETRY or CASH."
  ].join("\n");
}
