import { CommercePaymentMethod, CommercePaymentStatus } from "@prisma/client";
import { parseGuaranteedOrderIntakeEnabled, parseMultiShopCheckoutEnabled } from "@gigflow/shared";
import { AppError } from "../../lib/errors.js";
import { getAppEnv, isPilotOrStagingEnv, isProductionEnv } from "../../lib/production-guards.js";

export function resolveCommercePaymentMethod(
  override?: CommercePaymentMethod | string | null
): CommercePaymentMethod {
  const raw = String(override ?? process.env.COMMERCE_PAYMENT_METHOD ?? "CASH")
    .trim()
    .toUpperCase();
  const allowed = Object.values(CommercePaymentMethod) as string[];
  if (!allowed.includes(raw)) {
    throw new AppError(
      `Unknown commerce payment method "${raw}". Use CASH for the Harare cash pilot.`,
      500,
      "INVALID_PAYMENT_METHOD"
    );
  }
  return raw as CommercePaymentMethod;
}

/**
 * TEST_BYPASS must never silently run in pilot/staging/production.
 * Development/test may use it explicitly via COMMERCE_PAYMENT_METHOD=TEST_BYPASS.
 */
export function assertCommercePaymentMethodAllowed(method: CommercePaymentMethod): void {
  if (method !== CommercePaymentMethod.TEST_BYPASS) return;

  if (isPilotOrStagingEnv() || isProductionEnv() || getAppEnv() === "pilot") {
    throw new AppError(
      "TEST_BYPASS commerce payments are forbidden in pilot/staging/production.",
      403,
      "TEST_BYPASS_FORBIDDEN",
      { payment: "Use CASH (due on delivery) or a real rail. Never fake paid orders." }
    );
  }
}

export function paymentStatusForMethod(method: CommercePaymentMethod): CommercePaymentStatus {
  switch (method) {
    case CommercePaymentMethod.CASH:
      return CommercePaymentStatus.DUE_ON_DELIVERY;
    case CommercePaymentMethod.TEST_BYPASS:
      return CommercePaymentStatus.NOT_REQUIRED;
    case CommercePaymentMethod.STRIPE:
      return CommercePaymentStatus.PENDING;
    case CommercePaymentMethod.ECOCASH:
      return CommercePaymentStatus.PAYMENT_PENDING;
    case CommercePaymentMethod.ONEMONEY:
      return CommercePaymentStatus.PAYMENT_PENDING;
    default:
      return CommercePaymentStatus.PENDING;
  }
}

/** Seconds a merchant has to accept before order expires (default 15 min). */
export function getMerchantResponseTimeoutSeconds(): number {
  const raw = process.env.COMMERCE_MERCHANT_TIMEOUT_SECONDS;
  if (raw && /^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n >= 60 && n <= 86_400) return n;
  }
  return 15 * 60;
}

/** Merchant-silence fallback + persistent courier search. Off unless explicitly enabled. */
export function isGuaranteedOrderIntakeEnabled(): boolean {
  return parseGuaranteedOrderIntakeEnabled(process.env.GUARANTEED_ORDER_INTAKE_ENABLED);
}

/** Multi-shop combined checkout. Default FALSE — do not enable publicly. */
export function isMultiShopCheckoutEnabled(): boolean {
  return parseMultiShopCheckoutEnabled(process.env.MULTI_SHOP_CHECKOUT_ENABLED);
}

/** Bounded courier rebroadcast interval (default 2 minutes). */
export function getCourierRematchIntervalSeconds(): number {
  const raw = process.env.COMMERCE_COURIER_REMATCH_SECONDS;
  if (raw && /^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n >= 60 && n <= 3_600) return n;
  }
  return 120;
}

/** Flag unfulfilled orders for admin without cancelling (default 60 minutes). */
export function getFulfillmentAttentionMinutes(): number {
  const raw = process.env.COMMERCE_FULFILLMENT_ATTENTION_MINUTES;
  if (raw && /^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n >= 15 && n <= 7 * 24 * 60) return n;
  }
  return 60;
}

/**
 * How long an unassigned courier search may be rebroadcast.
 * Default 12 hours: longer than the 60-minute admin attention flag, and still
 * a same-day pilot window. Measured from DeliveryGig.createdAt, which is when
 * the search started. gig.updatedAt is not used because rematch rewrites it.
 * Values outside 1–24 hours fall back to the default so a week-long search
 * cannot be configured here.
 */
export const DEFAULT_MAX_COURIER_SEARCH_MINUTES = 12 * 60;

export function getMaxCourierSearchMinutes(): number {
  const raw = process.env.COMMERCE_COURIER_SEARCH_MAX_MINUTES;
  if (raw && /^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n >= 60 && n <= 24 * 60) return n;
  }
  return DEFAULT_MAX_COURIER_SEARCH_MINUTES;
}

/** True when automatic rebroadcast must stop. Does not cancel or mutate anything. */
export function isCourierSearchBeyondMaxAge(gigCreatedAt: Date, now = new Date()): boolean {
  return now.getTime() - gigCreatedAt.getTime() >= getMaxCourierSearchMinutes() * 60_000;
}

/**
 * Age gate for automatic rematch. Status rules match the existing rematch query.
 * Payment status is intentionally not consulted here.
 */
export function canAutomaticallyRebroadcastCourierSearch(input: {
  orderStatus: string;
  gigStatus: string;
  gigCreatedAt: Date;
  hasAssignedCourier: boolean;
  now?: Date;
}): boolean {
  if (input.orderStatus !== "READY_FOR_PICKUP") return false;
  if (input.hasAssignedCourier) return false;
  if (input.gigStatus !== "SEARCHING_FOR_WORKER" && input.gigStatus !== "POSTED") return false;
  return !isCourierSearchBeyondMaxAge(input.gigCreatedAt, input.now ?? new Date());
}

/** Mock WhatsApp inbound: only development/test unless ALLOW_WHATSAPP_MOCK=true (never default in pilot). */
export function assertWhatsAppMockInboundAllowed(): void {
  const appEnv = getAppEnv();
  const allow = process.env.ALLOW_WHATSAPP_MOCK === "true";
  if (appEnv === "development" || appEnv === "test" || process.env.NODE_ENV === "test") {
    return;
  }
  if (allow && !isPilotOrStagingEnv() && !isProductionEnv()) {
    return;
  }
  // Fail closed for pilot/staging/production
  throw new AppError(
    "Mock WhatsApp inbound is disabled in this environment.",
    403,
    "WHATSAPP_MOCK_DISABLED",
    { whatsapp: "Use Meta Cloud API webhook. ALLOW_WHATSAPP_MOCK is not permitted for pilot/production." }
  );
}
