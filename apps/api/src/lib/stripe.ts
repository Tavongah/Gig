import Stripe from "stripe";
import { env } from "../config/env.js";
import { AppError } from "./errors.js";

let stripeClient: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new AppError("STRIPE_NOT_CONFIGURED", 503, "STRIPE_NOT_CONFIGURED", {
      stripe: "Stripe is not configured. Set STRIPE_SECRET_KEY."
    });
  }

  if (!stripeClient) {
    stripeClient = new Stripe(env.STRIPE_SECRET_KEY);
  }

  return stripeClient;
}

export function getStripePublishableKey(): string | null {
  return env.STRIPE_PUBLISHABLE_KEY ?? null;
}
