import Stripe from "stripe";
import { env } from "../config/env.js";
import { AppError } from "./errors.js";

let stripeClient: Stripe | null = null;

/** Reject empty, truncated, or placeholder Stripe secrets (e.g. REPLACE_…est_). */
export function isUsableStripeSecretKey(key: string | undefined | null): boolean {
  if (!key) return false;
  const trimmed = key.trim();
  if (trimmed.length < 20) return false;
  if (/REPLACE|YOUR_|PLACEHOLDER|<.*>|\*{3,}/i.test(trimmed)) return false;
  return trimmed.startsWith("sk_test_") || trimmed.startsWith("sk_live_");
}

export function isUsableStripePublishableKey(key: string | undefined | null): boolean {
  if (!key) return false;
  const trimmed = key.trim();
  if (trimmed.length < 20) return false;
  if (/REPLACE|YOUR_|PLACEHOLDER|<.*>|\*{3,}/i.test(trimmed)) return false;
  return trimmed.startsWith("pk_test_") || trimmed.startsWith("pk_live_");
}

export function assertStripeConfiguredForProduction(): void {
  if (env.NODE_ENV !== "production") return;

  if (!isUsableStripeSecretKey(env.STRIPE_SECRET_KEY)) {
    throw new Error(
      "Production requires a real STRIPE_SECRET_KEY (sk_test_… or sk_live_…). Placeholder or REPLACE_ values are not allowed."
    );
  }

  if (!env.STRIPE_WEBHOOK_SECRET?.trim()) {
    throw new Error("Production requires STRIPE_WEBHOOK_SECRET for verified Stripe webhooks.");
  }

  if (!isUsableStripePublishableKey(env.STRIPE_PUBLISHABLE_KEY)) {
    throw new Error(
      "Production requires a real STRIPE_PUBLISHABLE_KEY (pk_test_… or pk_live_…). Placeholder values are not allowed."
    );
  }
}

export function isStripeConfigured(): boolean {
  return isUsableStripeSecretKey(env.STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe {
  if (!isUsableStripeSecretKey(env.STRIPE_SECRET_KEY)) {
    throw new AppError(
      "We couldn’t start the secure payment process. Please try again or contact Duts Support.",
      503,
      "STRIPE_NOT_CONFIGURED",
      { stripe: "Stripe is not configured" }
    );
  }

  if (!stripeClient) {
    stripeClient = new Stripe(env.STRIPE_SECRET_KEY!);
  }

  return stripeClient;
}

export function getStripePublishableKey(): string | null {
  return isUsableStripePublishableKey(env.STRIPE_PUBLISHABLE_KEY) ? env.STRIPE_PUBLISHABLE_KEY! : null;
}

export function toFriendlyPaymentStartError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  const message = error instanceof Error ? error.message : String(error);
  // Never echo secrets or raw Stripe key fragments to clients.
  const safe = message.replace(/sk_(test|live)_[A-Za-z0-9]+/g, "[redacted]").replace(/rk_live_[A-Za-z0-9]+/g, "[redacted]");
  console.error("[stripe] payment_start_failed", { message: safe.slice(0, 200) });

  return new AppError(
    "We couldn’t start the secure payment process. Please try again or contact Duts Support.",
    502,
    "PAYMENT_START_FAILED"
  );
}
