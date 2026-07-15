import type { PricingType } from "./gig-flow.js";

/** V1 Request Gig pricing options (Hourly hidden until later launch). */
export const REQUEST_GIG_PRICING_TYPES = ["FIXED", "ESTIMATE_TIMER"] as const;
export type RequestGigPricingType = (typeof REQUEST_GIG_PRICING_TYPES)[number];

/**
 * Base pricing by service slug.
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

const COMPLEXITY_KEYWORDS = [
  "deep",
  "entire",
  "whole house",
  "multiple",
  "multi",
  "large",
  "complex",
  "several rooms",
  "full day",
  "whole home",
  "many",
  "stairs",
  "heavy"
] as const;

export type PricingDecisionInput = {
  slug?: string | null;
  description?: string | null;
  estimatedHours?: number | null;
  size?: "SMALL" | "MEDIUM" | "LARGE" | "ENTERPRISE" | null;
};

export function recommendedPricingForService(slug: string | null | undefined): PricingType {
  if (!slug) return "FIXED";
  return SERVICE_PRICING_RECOMMENDATIONS[slug] ?? "FIXED";
}

/**
 * Resolves the system pricing model from service + job signals.
 * Customers never choose Fixed vs Estimate + Timer — DUTS decides.
 */
export function resolvePricingType(input: PricingDecisionInput): PricingType {
  const base = recommendedPricingForService(input.slug);
  if (base === "ESTIMATE_TIMER") {
    return "ESTIMATE_TIMER";
  }

  const hours = Number(input.estimatedHours ?? 0);
  if (Number.isFinite(hours) && hours >= 4) {
    return "ESTIMATE_TIMER";
  }

  if (input.size === "LARGE" || input.size === "ENTERPRISE") {
    return "ESTIMATE_TIMER";
  }

  const description = (input.description ?? "").toLowerCase();
  if (COMPLEXITY_KEYWORDS.some((keyword) => description.includes(keyword))) {
    return "ESTIMATE_TIMER";
  }

  return "FIXED";
}

export function isRequestGigPricingType(value: PricingType): value is RequestGigPricingType {
  return REQUEST_GIG_PRICING_TYPES.includes(value as RequestGigPricingType);
}
