import { CommercePaymentMethod, CommercePaymentStatus } from "@prisma/client";
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
