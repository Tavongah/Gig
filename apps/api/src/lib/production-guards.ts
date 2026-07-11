import { env } from "../config/env.js";
import { AppError } from "./errors.js";
import { isStripeConfigured } from "./stripe.js";

export function isProductionEnv(): boolean {
  return env.NODE_ENV === "production";
}

/** Blocks dev-only payment shortcuts unless ALLOW_DEV_PAYMENT_BYPASS=true (never use in live). */
export function assertDevOnlyPaymentBypass(feature: string): void {
  if (isProductionEnv() && process.env.ALLOW_DEV_PAYMENT_BYPASS !== "true") {
    throw new AppError("DEV_PAYMENT_DISABLED", 403, "DEV_PAYMENT_DISABLED", {
      payment: `${feature} is disabled in production. Configure Stripe and use card authorization.`
    });
  }
}

export function logProductionReadinessWarnings(): void {
  if (!isProductionEnv()) return;

  const warnings: string[] = [];

  if (!isStripeConfigured()) {
    warnings.push("STRIPE_SECRET_KEY missing — customers cannot pay.");
  }
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    warnings.push("STRIPE_WEBHOOK_SECRET missing — Stripe webhooks will not verify.");
  }
  if (!env.STRIPE_PUBLISHABLE_KEY) {
    warnings.push("STRIPE_PUBLISHABLE_KEY missing — mobile card form will not load.");
  }
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    warnings.push("Firebase Admin incomplete — Google/Apple sign-in will fail.");
  }
  if (!process.env.SPACES_BUCKET && !env.S3_BUCKET) {
    warnings.push("Object storage not configured — uploads will fail.");
  }
  if (env.CORS_ORIGINS === "*") {
    warnings.push('CORS_ORIGINS is "*" — set explicit admin and mobile origins.');
  }
  if (process.env.ALLOW_DEV_PAYMENT_BYPASS === "true") {
    warnings.push("ALLOW_DEV_PAYMENT_BYPASS=true — remove before taking live payments.");
  }
  if (process.env.ALLOW_DEV_SESSION === "true") {
    warnings.push("ALLOW_DEV_SESSION=true — remove before public launch.");
  }

  if (warnings.length > 0) {
    console.warn("[production-readiness] Launch blockers / warnings:");
    for (const warning of warnings) {
      console.warn(`  - ${warning}`);
    }
  } else {
    console.log("[production-readiness] Core payment, Firebase, and CORS env vars look configured.");
  }
}
