export const gigFlowStatuses = [
  "POSTED",
  "WORKER_SELECTED",
  "SEARCHING_FOR_WORKER",
  "WORKER_ASSIGNED",
  "WORKER_EN_ROUTE",
  "WORKER_ARRIVED",
  "IN_PROGRESS",
  "WAITING_EXTRA_TIME_APPROVAL",
  "WAITING_CUSTOMER_CONFIRMATION",
  "COMPLETED",
  "CANCELLED",
  "DISPUTED",
  "DRAFT"
] as const;

export type GigFlowStatus = (typeof gigFlowStatuses)[number];

export const pricingTypes = ["FIXED", "HOURLY", "ESTIMATE_TIMER"] as const;
export type PricingType = (typeof pricingTypes)[number];

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function roundBillableMinutes(elapsedMinutes: number, minimumMinutes = 60, roundTo = 15): number {
  const rounded = Math.ceil(Math.max(0, elapsedMinutes) / roundTo) * roundTo;
  return Math.max(minimumMinutes, rounded);
}

/** HOURLY and ESTIMATE_TIMER use authorize-then-capture; FIXED is charged immediately. */
export function isTimeBasedPricing(pricingType: string): boolean {
  return pricingType === "HOURLY" || pricingType === "ESTIMATE_TIMER";
}

export function isFixedPricing(pricingType: string): boolean {
  return pricingType === "FIXED";
}

/**
 * Authorization ceiling for time-based gigs.
 * Buffer defaults to 25% of estimated labor, with a floor of 30 minutes of hourly rate.
 */
export function calculateTimeBasedAuthorization(input: {
  estimatedTotalCents: number;
  estimatedLaborCents: number;
  hourlyRateCents: number;
  bufferPercent?: number;
  minimumBufferMinutes?: number;
}): {
  authorizationBufferCents: number;
  maximumAuthorizedAmountCents: number;
} {
  const bufferPercent = input.bufferPercent ?? 0.25;
  const minimumBufferMinutes = input.minimumBufferMinutes ?? 30;
  const percentBuffer = Math.round(Math.max(0, input.estimatedLaborCents) * bufferPercent);
  const floorBuffer = Math.round((Math.max(0, input.hourlyRateCents) * minimumBufferMinutes) / 60);
  const authorizationBufferCents = Math.max(percentBuffer, floorBuffer, 0);
  const maximumAuthorizedAmountCents = Math.max(
    input.estimatedTotalCents,
    input.estimatedTotalCents + authorizationBufferCents
  );
  return { authorizationBufferCents, maximumAuthorizedAmountCents };
}

export function billableSecondsFromWorkWindow(input: {
  workStartedAt: Date | string | number;
  workCompletedAt: Date | string | number;
  totalApprovedPausedSeconds?: number;
}): number {
  const start = new Date(input.workStartedAt).getTime();
  const end = new Date(input.workCompletedAt).getTime();
  const paused = Math.max(0, input.totalApprovedPausedSeconds ?? 0);
  return Math.max(0, Math.floor((end - start) / 1000) - paused);
}

export function gigNeedsPaymentAfterWorkerSelection(status: string, paymentStatus?: string | null): boolean {
  return status === "WORKER_SELECTED" && (paymentStatus === "PAYMENT_PENDING" || paymentStatus === "PAYMENT_FAILED");
}

export function gigNeedsWorkerSelection(status: string): boolean {
  return status === "POSTED" || status === "SEARCHING_FOR_WORKER";
}

export function gigNeedsCompletionApproval(status: string): boolean {
  return status === "WAITING_CUSTOMER_CONFIRMATION";
}

export function gigNeedsExtraTimeApproval(status: string): boolean {
  return status === "WAITING_EXTRA_TIME_APPROVAL";
}

/** Before IN_PROGRESS: rematch. During/after work start: dispute. */
export function workerCancelOutcome(status: string): "REMATCH" | "DISPUTE" | "BLOCKED" {
  if (status === "COMPLETED" || status === "CANCELLED") return "BLOCKED";
  if (
    status === "IN_PROGRESS" ||
    status === "WAITING_CUSTOMER_CONFIRMATION" ||
    status === "WAITING_EXTRA_TIME_APPROVAL"
  ) {
    return "DISPUTE";
  }
  if (
    status === "WORKER_SELECTED" ||
    status === "WORKER_ASSIGNED" ||
    status === "WORKER_EN_ROUTE" ||
    status === "WORKER_ARRIVED"
  ) {
    return "REMATCH";
  }
  return "BLOCKED";
}

export function isCustomerRematching(status: string, paymentStatus?: string | null, paymentRecordStatus?: string | null): boolean {
  if (status !== "POSTED" && status !== "SEARCHING_FOR_WORKER") return false;
  return (
    paymentStatus === "PAYMENT_CAPTURED" ||
    paymentStatus === "PAYOUT_PENDING" ||
    paymentRecordStatus === "CAPTURED"
  );
}
