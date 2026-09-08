import { env } from "../config/env.js";
import { AppError } from "./errors.js";
import { isStripeConfigured } from "./stripe.js";

export function isProductionEnv(): boolean {
  return env.NODE_ENV === "production";
}

/** APP_ENV overlays NODE_ENV for Gig pilot / staging isolation. */
export function getAppEnv(): string {
  return (process.env.APP_ENV ?? env.NODE_ENV ?? "development").toLowerCase();
}

export function isPilotOrStagingEnv(): boolean {
  const appEnv = getAppEnv();
  return appEnv === "pilot" || appEnv === "staging";
}

/**
 * Gig/DUTS Delivery must never connect to the IA SaaS database.
 * Fail loudly — do not silently run against the wrong product.
 */
export function assertGigOwnedDatabase(): void {
  const url = process.env.DATABASE_URL ?? env.DATABASE_URL ?? "";
  if (/duts_whitelabel/i.test(url)) {
    throw new Error(
      "[env] DATABASE_URL points at duts_whitelabel (IA SaaS). " +
        "Gig / DUTS Delivery must use a Gig-owned database (e.g. duts_gig_dev or your pilot DB). " +
        "Refusing to start."
    );
  }
}

/**
 * Blocks dev-only payment shortcuts.
 * Pilot/staging: always blocked (no silent fake “paid”).
 * Production: blocked unless ALLOW_DEV_PAYMENT_BYPASS=true (emergency only).
 */
export function assertDevOnlyPaymentBypass(feature: string): void {
  if (isPilotOrStagingEnv()) {
    throw new AppError("DEV_PAYMENT_DISABLED", 403, "DEV_PAYMENT_DISABLED", {
      payment: `${feature} is disabled in pilot/staging. Configure Stripe test/live keys and use real card authorization.`
    });
  }

  if (isProductionEnv() && process.env.ALLOW_DEV_PAYMENT_BYPASS !== "true") {
    throw new AppError("DEV_PAYMENT_DISABLED", 403, "DEV_PAYMENT_DISABLED", {
      payment: `${feature} is disabled in production. Configure Stripe and use card authorization.`
    });
  }
}

/** When DELIVERY_ENABLED=false, refuse delivery quote/create. Default: enabled. */
export function assertDeliveryProductEnabled(): void {
  if (process.env.DELIVERY_ENABLED === "false" || process.env.DELIVERY_ENABLED === "0") {
    throw new AppError(
      "DUTS Delivery is not enabled in this environment.",
      403,
      "DELIVERY_DISABLED",
      { delivery: "Set DELIVERY_ENABLED=true to accept delivery requests." }
    );
  }
}

export function getDeliveryAutoApproveSeconds(): number {
  const raw = process.env.DELIVERY_AUTO_APPROVE_SECONDS;
  if (raw && /^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n >= 30 && n <= 86_400) return n;
  }
  return 60;
}

/** Failed PIN attempts before lock (default 5). Override: DELIVERY_PIN_MAX_ATTEMPTS */
export function getDeliveryPinMaxAttempts(fallback = 5): number {
  const raw = process.env.DELIVERY_PIN_MAX_ATTEMPTS;
  if (raw && /^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n >= 3 && n <= 20) return n;
  }
  return fallback;
}

/** Lock duration in minutes after max failed PIN attempts (default 15). */
export function getDeliveryPinLockMinutes(fallback = 15): number {
  const raw = process.env.DELIVERY_PIN_LOCK_MINUTES;
  if (raw && /^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n >= 1 && n <= 1440) return n;
  }
  return fallback;
}

export function logProductionReadinessWarnings(): void {
  const appEnv = getAppEnv();
  if (!isProductionEnv() && !isPilotOrStagingEnv()) return;

  const warnings: string[] = [];

  if (!isStripeConfigured()) {
    warnings.push("STRIPE_SECRET_KEY missing — customers cannot pay (required for pilot).");
  }
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    warnings.push("STRIPE_WEBHOOK_SECRET missing — Stripe webhooks will not verify.");
  }
  if (!env.STRIPE_PUBLISHABLE_KEY) {
    warnings.push("STRIPE_PUBLISHABLE_KEY missing — mobile card form will not load.");
  }
  if (process.env.ALLOW_DEV_PAYMENT_BYPASS === "true") {
    warnings.push("ALLOW_DEV_PAYMENT_BYPASS=true — forbidden for pilot; remove immediately.");
  }
  if (process.env.ALLOW_DEV_SESSION === "true") {
    warnings.push("ALLOW_DEV_SESSION=true — remove before public launch.");
  }
  if (env.CORS_ORIGINS === "*") {
    warnings.push('CORS_ORIGINS is "*" — set explicit admin and mobile origins.');
  }
  if (process.env.ALLOW_WHATSAPP_MOCK === "true") {
    warnings.push("ALLOW_WHATSAPP_MOCK=true — forbidden for pilot; remove immediately.");
  }
  if ((process.env.COMMERCE_PAYMENT_METHOD ?? "CASH").toUpperCase() === "TEST_BYPASS") {
    warnings.push("COMMERCE_PAYMENT_METHOD=TEST_BYPASS — forbidden for pilot.");
  }
  if ((process.env.WHATSAPP_PROVIDER ?? "mock").toLowerCase() === "meta") {
    if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
      warnings.push("WHATSAPP_PROVIDER=meta but token/phone number id missing.");
    }
    if (!process.env.WHATSAPP_APP_SECRET) {
      warnings.push("WHATSAPP_APP_SECRET missing — webhook signatures will not verify.");
    }
  }
  if ((process.env.WHATSAPP_PROVIDER ?? "mock").toLowerCase() === "twilio") {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      warnings.push("WHATSAPP_PROVIDER=twilio but TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN missing.");
    }
    if (!process.env.TWILIO_WHATSAPP_FROM && !process.env.TWILIO_FROM_NUMBER) {
      warnings.push("WHATSAPP_PROVIDER=twilio but TWILIO_WHATSAPP_FROM (or TWILIO_FROM_NUMBER) missing.");
    }
  }
  if (/duts_whitelabel/i.test(process.env.DATABASE_URL ?? "")) {
    warnings.push("DATABASE_URL is duts_whitelabel — wrong product database.");
  }

  if (warnings.length > 0) {
    console.warn(`[readiness:${appEnv}] Launch blockers / warnings:`);
    for (const warning of warnings) {
      console.warn(`  - ${warning}`);
    }
  } else {
    console.log(`[readiness:${appEnv}] Core payment and env checks look configured.`);
  }
}
