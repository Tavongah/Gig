/**
 * Role-scoped financial DTOs. Backend is source of truth; clients must not invent totals.
 */

export type CustomerPricingView = {
  serviceAmountCents: number;
  taxAmountCents: number;
  taxRateBps: number;
  customerFeeCents: number;
  totalChargedCents: number;
  currency: "usd";
};

export type WorkerEarningsView = {
  grossEarningsCents: number;
  platformDeductionCents: number;
  netEarningsCents: number;
  tipsCents: number;
  payoutStatus: string;
  currency: "usd";
};

export type AdminFinancialView = CustomerPricingView &
  WorkerEarningsView & {
    platformFeeCents: number;
    workerPayoutCents: number;
    commissionRate: number | null;
  };

export function buildCustomerPricingView(input: {
  serviceAmountCents: number;
  taxAmountCents: number;
  taxRateBps?: number;
  customerFeeCents?: number;
}): CustomerPricingView {
  const serviceAmountCents = Math.max(0, Math.round(input.serviceAmountCents));
  const taxAmountCents = Math.max(0, Math.round(input.taxAmountCents));
  const customerFeeCents = Math.max(0, Math.round(input.customerFeeCents ?? 0));
  return {
    serviceAmountCents,
    taxAmountCents,
    taxRateBps: input.taxRateBps ?? 0,
    customerFeeCents,
    totalChargedCents: serviceAmountCents + taxAmountCents + customerFeeCents,
    currency: "usd"
  };
}

export function buildWorkerEarningsView(input: {
  workerPayoutCents: number;
  platformFeeCents: number;
  tipsCents?: number;
  payoutStatus?: string;
}): WorkerEarningsView {
  const netEarningsCents = Math.max(0, Math.round(input.workerPayoutCents));
  const platformDeductionCents = Math.max(0, Math.round(input.platformFeeCents));
  const tipsCents = Math.max(0, Math.round(input.tipsCents ?? 0));
  return {
    grossEarningsCents: netEarningsCents + platformDeductionCents,
    platformDeductionCents,
    netEarningsCents,
    tipsCents,
    payoutStatus: input.payoutStatus ?? "PENDING",
    currency: "usd"
  };
}
