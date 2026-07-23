/**
 * MVP default customer hourly rate for all non-fixed (time-based) services.
 * Change this single constant to update pricing across estimate, billing, and UI.
 */
export const DEFAULT_HOURLY_RATE = 25;
export const DEFAULT_HOURLY_RATE_CENTS = Math.round(DEFAULT_HOURLY_RATE * 100);

/** Default billing increment for timed jobs (minutes). Matches Gig.billingIncrementMinutes. */
export const DEFAULT_BILLING_INCREMENT_MINUTES = 15;

/**
 * Resolves the hourly rate used for customer gig pricing.
 * Fixed-price jobs do not use an hourly rate.
 * Timed jobs always use DEFAULT_HOURLY_RATE_CENTS (category rates are ignored for MVP).
 */
export function resolveHourlyRateCents(pricingType: string): number {
  if (pricingType === "FIXED") {
    return 0;
  }
  return DEFAULT_HOURLY_RATE_CENTS;
}

/** Display helper, e.g. "$25.00/hour". */
export function formatHourlyRateLabel(hourlyRateCents: number = DEFAULT_HOURLY_RATE_CENTS): string {
  return `$${(hourlyRateCents / 100).toFixed(2)}/hour`;
}
