/**
 * A delivery quote the server already returned for a cart.
 * Client-sent cents never set the price. They only prove what was on screen.
 * A stored quote is the same kind of proof for clients that cannot send it back.
 */
import { createHash } from "node:crypto";
import {
  evaluatePresentedCheckout,
  type CheckoutTotalCents,
  type MerchandisePriceChange,
  type PresentedCheckoutDecision,
  type PresentedCheckoutTotal
} from "./presented-total.js";

export type DisplayedDeliveryQuote = {
  deliveryFeeCents: number;
  totalCents: number;
  subtotalCents: number;
  serviceFeeCents: number;
};

export type DisplayedQuoteCart = {
  userId: string;
  lat: number;
  lng: number;
  deliveryLabel?: string | null;
  locationMode?: string | null;
  deliveryPrecision?: string | null;
  lines: Array<{
    productId: string;
    quantity: number;
    flavorOptionId?: string | null;
    flavorPreference?: string | null;
  }>;
};

export const LEGACY_DELIVERY_REVIEW_HINT =
  "We did not place the order. Place it again only after the total on screen matches this delivery fee.";

const DEFAULT_TTL_MS = 45 * 60 * 1000;
const memory = new Map<string, DisplayedDeliveryQuote & { quotedAt: number }>();

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function integerCents(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function displayedDeliveryFingerprint(cart: DisplayedQuoteCart): string {
  const lines = [...cart.lines]
    .map((line) =>
      [
        line.productId,
        String(line.quantity),
        line.flavorOptionId ?? "",
        line.flavorPreference ?? ""
      ].join("~")
    )
    .sort();
  const payload = JSON.stringify([
    cart.userId,
    cart.lat.toFixed(5),
    cart.lng.toFixed(5),
    cart.locationMode ?? "",
    cart.deliveryPrecision ?? "",
    (cart.deliveryLabel ?? "").trim(),
    lines
  ]);
  return createHash("sha256").update(payload).digest("hex");
}

export function parseDisplayedDeliveryQuote(raw: unknown): DisplayedDeliveryQuote | null {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    !integerCents(row.deliveryFeeCents) ||
    !integerCents(row.totalCents) ||
    !integerCents(row.subtotalCents) ||
    !integerCents(row.serviceFeeCents)
  ) {
    return null;
  }
  return {
    deliveryFeeCents: row.deliveryFeeCents,
    totalCents: row.totalCents,
    subtotalCents: row.subtotalCents,
    serviceFeeCents: row.serviceFeeCents
  };
}

/** Only a final quote was shown as a delivery fee. Deferred totals are not evidence. */
export function displayedQuoteFromResult(quote: {
  deliveryQuoteStatus?: string | null;
  deliveryFeeCents?: number | null;
  totalCents?: number | null;
  subtotalCents?: number | null;
  serviceFeeCents?: number | null;
}): DisplayedDeliveryQuote | null {
  if (quote.deliveryQuoteStatus !== "final") return null;
  return parseDisplayedDeliveryQuote(quote);
}

export function withLegacyReviewHint(message: string): string {
  if (message.includes("total on screen matches")) return message;
  return `${message.trim()} ${LEGACY_DELIVERY_REVIEW_HINT}`;
}

/**
 * A checkout re-quote is not proof of what was on screen.
 * Only a quote returned to the customer may replace a stored fee.
 * Without that, keep the previous shown fee, or nothing.
 */
export function quoteToStore(input: {
  existing: DisplayedDeliveryQuote | null;
  next: DisplayedDeliveryQuote;
  replaceShown: boolean;
}): DisplayedDeliveryQuote | null {
  if (!input.replaceShown) return input.existing;
  return input.next;
}

/**
 * No stored quote and no client confirmation. Do not invent a previous fee,
 * and do not create the order. The fresh quote is what the customer must see.
 */
export function unseenDisplayedDeliveryDecision(input: {
  fresh: CheckoutTotalCents;
  merchandiseChanges?: MerchandisePriceChange[];
}): Extract<PresentedCheckoutDecision, { confirm: true }> {
  const parts: string[] = [];
  for (const change of input.merchandiseChanges ?? []) {
    parts.push(`${change.name}: ${money(change.oldCents)} → ${money(change.newCents)}`);
  }
  parts.push(`Delivery is ${money(input.fresh.deliveryFeeCents)}`);
  const changeDetail = parts.join("; ");
  const lead = input.merchandiseChanges?.length
    ? "One price changed since your quote."
    : "Confirm this delivery fee before we place the order.";
  return {
    confirm: true,
    code: "PRICE_CHANGED",
    message: withLegacyReviewHint(
      `${lead} ${changeDetail}. Total is ${money(input.fresh.totalCents)}.`
    ),
    changeDetail,
    totals: input.fresh
  };
}

/**
 * App checkout decision. A client confirmation wins over a stored quote.
 * A stored quote is what an older app was shown. No proof at all does not
 * authorize a charge, because that app may already be showing a fee.
 */
export function appCheckoutDecision(input: {
  clientPresented?: PresentedCheckoutTotal | null;
  displayed?: DisplayedDeliveryQuote | null;
  fresh: CheckoutTotalCents;
  merchandiseChanges?: MerchandisePriceChange[];
}): PresentedCheckoutDecision {
  const clientPresented = input.clientPresented ?? null;
  if (clientPresented) {
    return evaluatePresentedCheckout({
      presented: clientPresented,
      fresh: input.fresh,
      merchandiseChanges: input.merchandiseChanges
    });
  }
  if (input.displayed) {
    const decision = evaluatePresentedCheckout({
      presented: {
        deliveryFeeCents: input.displayed.deliveryFeeCents,
        totalCents: input.displayed.totalCents
      },
      fresh: input.fresh,
      merchandiseChanges: input.merchandiseChanges
    });
    if (!decision.confirm) return decision;
    return { ...decision, message: withLegacyReviewHint(decision.message) };
  }
  return unseenDisplayedDeliveryDecision({
    fresh: input.fresh,
    merchandiseChanges: input.merchandiseChanges
  });
}

export function saveDisplayedDeliveryQuote(
  cart: DisplayedQuoteCart,
  quote: DisplayedDeliveryQuote,
  now = Date.now()
): void {
  if (!cart.userId || !Number.isFinite(cart.lat) || !Number.isFinite(cart.lng)) return;
  memory.set(displayedDeliveryFingerprint(cart), { ...quote, quotedAt: now });
  if (memory.size <= 2000) return;
  for (const [key, row] of memory) {
    if (now - row.quotedAt > DEFAULT_TTL_MS) memory.delete(key);
  }
}

export function loadDisplayedDeliveryQuote(
  cart: DisplayedQuoteCart,
  now = Date.now(),
  ttlMs = DEFAULT_TTL_MS
): DisplayedDeliveryQuote | null {
  if (!cart.userId || !Number.isFinite(cart.lat) || !Number.isFinite(cart.lng)) return null;
  const key = displayedDeliveryFingerprint(cart);
  const row = memory.get(key);
  if (!row) return null;
  if (now - row.quotedAt > ttlMs) {
    memory.delete(key);
    return null;
  }
  return {
    deliveryFeeCents: row.deliveryFeeCents,
    totalCents: row.totalCents,
    subtotalCents: row.subtotalCents,
    serviceFeeCents: row.serviceFeeCents
  };
}
