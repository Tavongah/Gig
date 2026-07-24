/**
 * Location-based sales tax for DUTS (MVP: Connecticut launch markets).
 * Amounts are always integer cents — no floating-point money math.
 */

/** Basis points: 635 = 6.35% (Connecticut state sales tax). */
export const CT_SALES_TAX_RATE_BPS = 635;

/** Regions (US state codes) where marketplace service charges are taxable for MVP. */
const TAXABLE_US_REGIONS: Record<string, number> = {
  CT: CT_SALES_TAX_RATE_BPS
};

export type TaxLocationInput = {
  region?: string | null;
  country?: string | null;
};

export type TaxCalculation = {
  taxRateBps: number;
  taxAmountCents: number;
  taxableAmountCents: number;
};

function normalizeRegion(region: string | null | undefined): string {
  return (region ?? "").trim().toUpperCase();
}

function normalizeCountry(country: string | null | undefined): string {
  return (country ?? "US").trim().toUpperCase();
}

/** Resolve applicable tax rate in basis points for a service location. */
export function resolveTaxRateBps(location: TaxLocationInput): number {
  const country = normalizeCountry(location.country);
  if (country !== "US" && country !== "USA" && country !== "UNITED STATES") {
    return 0;
  }
  const region = normalizeRegion(location.region);
  return TAXABLE_US_REGIONS[region] ?? 0;
}

/**
 * Tax on the customer-facing service charge (subtotal before tax).
 * Uses integer basis-point math: round(amount * bps / 10000).
 */
export function calculateApplicableTaxCents(
  taxableAmountCents: number,
  location: TaxLocationInput
): TaxCalculation {
  const safeTaxable = Math.max(0, Math.round(taxableAmountCents));
  const taxRateBps = resolveTaxRateBps(location);
  const taxAmountCents = taxRateBps > 0 ? Math.round((safeTaxable * taxRateBps) / 10_000) : 0;
  return {
    taxRateBps,
    taxAmountCents,
    taxableAmountCents: safeTaxable
  };
}

/** Customer total = service subtotal + tax + optional customer fee. */
export function calculateCustomerTotalCents(params: {
  serviceAmountCents: number;
  taxAmountCents: number;
  customerFeeCents?: number;
}): number {
  return (
    Math.max(0, Math.round(params.serviceAmountCents)) +
    Math.max(0, Math.round(params.taxAmountCents)) +
    Math.max(0, Math.round(params.customerFeeCents ?? 0))
  );
}
