/**
 * Remembers a final delivery quote this API returned to the customer.
 * Redis shares it across processes. This process keeps a copy when Redis is down.
 * A checkout that cannot see the quote fails closed. It does not invent a price.
 *
 * The stored fee authorizes a charge only while it is unexpired and the live
 * fee still matches it. A higher live fee is not charged. Quotes expire with
 * the cart TTL (45 minutes unless COMMERCE_CART_TTL_SECONDS sets 1 minute to 24 hours).
 * Checkout must not call this with the live re-quote. That would replace the
 * shown fee and make the new fee look already confirmed.
 */
import { redis } from "../../config/redis.js";
import { getCartTtlMs } from "../whatsapp/cart-mutations.js";
import {
  displayedDeliveryFingerprint,
  displayedQuoteFromResult,
  loadDisplayedDeliveryQuote,
  parseDisplayedDeliveryQuote,
  quoteToStore,
  saveDisplayedDeliveryQuote,
  type DisplayedDeliveryQuote,
  type DisplayedQuoteCart
} from "./displayed-delivery-quote.js";

const KEY_PREFIX = "commerce:displayed-delivery:";

function redisReady(): boolean {
  return redis.status === "ready";
}

function keyFor(cart: DisplayedQuoteCart): string {
  return `${KEY_PREFIX}${displayedDeliveryFingerprint(cart)}`;
}

export async function rememberDisplayedDeliveryQuote(
  input: DisplayedQuoteCart & {
    quote: {
      deliveryQuoteStatus?: string | null;
      deliveryFeeCents?: number | null;
      totalCents?: number | null;
      subtotalCents?: number | null;
      serviceFeeCents?: number | null;
    };
  },
  options?: { replaceShown?: boolean }
): Promise<void> {
  const quote = displayedQuoteFromResult(input.quote);
  if (!quote) return;
  // A caller that is not showing this quote to the customer must not write it.
  // Writing the live checkout fee would make that fee match itself.
  if (quoteToStore({ existing: null, next: quote, replaceShown: options?.replaceShown === true }) !== quote) {
    return;
  }
  saveDisplayedDeliveryQuote(input, quote);
  if (!redisReady()) return;
  try {
    const ttlSeconds = Math.max(60, Math.ceil(getCartTtlMs() / 1000));
    await redis.set(keyFor(input), JSON.stringify(quote), "EX", ttlSeconds);
  } catch {
    console.error("Displayed delivery quote was not stored in Redis.");
  }
}

export async function readDisplayedDeliveryQuote(
  cart: DisplayedQuoteCart
): Promise<DisplayedDeliveryQuote | null> {
  if (redisReady()) {
    try {
      const raw = await redis.get(keyFor(cart));
      if (!raw) return null;
      const parsed = parseDisplayedDeliveryQuote(raw);
      if (!parsed) return null;
      saveDisplayedDeliveryQuote(cart, parsed);
      return parsed;
    } catch {
      console.error("Displayed delivery quote could not be read from Redis.");
    }
  }
  return loadDisplayedDeliveryQuote(cart, Date.now(), getCartTtlMs());
}
