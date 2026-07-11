import type { PricingType } from "./gig-flow.js";

/** V1 Request Gig pricing options shown to customers (Hourly hidden until later launch). */
export const REQUEST_GIG_PRICING_TYPES = ["FIXED", "ESTIMATE_TIMER"] as const;
export type RequestGigPricingType = (typeof REQUEST_GIG_PRICING_TYPES)[number];

/**
 * Recommended pricing per service slug.
 * Fixed Price: clear-scope jobs. Estimate + Timer: variable-duration work.
 */
export const SERVICE_PRICING_RECOMMENDATIONS: Record<string, PricingType> = {
  "furniture-assembly": "FIXED",
  "lawn-cutting": "FIXED",
  "car-detailing": "FIXED",
  "junk-removal": "FIXED",
  "short-term-labor": "FIXED",
  "moving-assistance": "ESTIMATE_TIMER",
  "house-cleaning": "ESTIMATE_TIMER",
  "room-cleaning": "ESTIMATE_TIMER",
  "event-help": "ESTIMATE_TIMER"
};

export function recommendedPricingForService(slug: string | null | undefined): PricingType {
  if (!slug) return "FIXED";
  return SERVICE_PRICING_RECOMMENDATIONS[slug] ?? "FIXED";
}

export function isRequestGigPricingType(value: PricingType): value is RequestGigPricingType {
  return REQUEST_GIG_PRICING_TYPES.includes(value as RequestGigPricingType);
}
