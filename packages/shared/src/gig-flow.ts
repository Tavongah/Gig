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
