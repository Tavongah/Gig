/**
 * Customer-facing journey stages mapped onto existing Gig.status + paymentStatus.
 * These are presentation labels — not separate Prisma enum values.
 */
export const customerJourneyStages = [
  "REQUEST_PENDING",
  "WORKERS_NOTIFIED",
  "WORKER_SELECTED",
  "PAYMENT_AUTHORIZED",
  "WORKER_EN_ROUTE",
  "WORKER_ARRIVED",
  "IN_PROGRESS",
  "WAITING_CUSTOMER_CONFIRMATION",
  "PAYMENT_CAPTURED",
  "COMPLETED",
  "CANCELLED"
] as const;

export type CustomerJourneyStage = (typeof customerJourneyStages)[number];

export const CUSTOMER_JOURNEY_PROGRESS = [
  { stage: "REQUEST_PENDING" as const, label: "Request sent" },
  { stage: "WORKERS_NOTIFIED" as const, label: "Matching" },
  { stage: "WORKER_SELECTED" as const, label: "Choose worker" },
  { stage: "PAYMENT_AUTHORIZED" as const, label: "Confirm & pay" },
  { stage: "WORKER_EN_ROUTE" as const, label: "On the way" },
  { stage: "IN_PROGRESS" as const, label: "In progress" },
  { stage: "WAITING_CUSTOMER_CONFIRMATION" as const, label: "Review" },
  { stage: "PAYMENT_CAPTURED" as const, label: "Complete" }
] as const;

export function resolveCustomerJourneyStage(input: {
  status: string;
  paymentStatus?: string | null;
  interestCount?: number;
}): CustomerJourneyStage {
  const { status, paymentStatus, interestCount = 0 } = input;

  if (status === "CANCELLED" || status === "DISPUTED") return "CANCELLED";
  if (status === "COMPLETED") {
    return paymentStatus === "PAYMENT_CAPTURED" ? "PAYMENT_CAPTURED" : "COMPLETED";
  }
  if (status === "WAITING_CUSTOMER_CONFIRMATION" || status === "WAITING_EXTRA_TIME_APPROVAL") {
    return status === "WAITING_EXTRA_TIME_APPROVAL" ? "IN_PROGRESS" : "WAITING_CUSTOMER_CONFIRMATION";
  }
  if (status === "IN_PROGRESS") return "IN_PROGRESS";
  if (status === "WORKER_ARRIVED") return "WORKER_ARRIVED";
  if (status === "WORKER_EN_ROUTE") return "WORKER_EN_ROUTE";
  if (
    status === "WORKER_ASSIGNED" ||
    paymentStatus === "PAYMENT_AUTHORIZED" ||
    paymentStatus === "PAYOUT_PENDING" ||
    paymentStatus === "PAYOUT_PAID"
  ) {
    return "PAYMENT_AUTHORIZED";
  }
  if (status === "WORKER_SELECTED") return "WORKER_SELECTED";
  if (status === "POSTED" || status === "SEARCHING_FOR_WORKER") {
    return interestCount > 0 ? "WORKERS_NOTIFIED" : "REQUEST_PENDING";
  }
  return "REQUEST_PENDING";
}

export function customerJourneyStageLabel(stage: CustomerJourneyStage): string {
  switch (stage) {
    case "REQUEST_PENDING":
      return "Request pending";
    case "WORKERS_NOTIFIED":
      return "Workers notified";
    case "WORKER_SELECTED":
      return "Worker chosen";
    case "PAYMENT_AUTHORIZED":
      return "Payment secured";
    case "WORKER_EN_ROUTE":
      return "On the way";
    case "WORKER_ARRIVED":
      return "Arrived";
    case "IN_PROGRESS":
      return "Work in progress";
    case "WAITING_CUSTOMER_CONFIRMATION":
      return "Awaiting your approval";
    case "PAYMENT_CAPTURED":
      return "Payment captured";
    case "COMPLETED":
      return "Completed";
    case "CANCELLED":
      return "Cancelled";
    default:
      return stage;
  }
}

export function customerJourneyHeadline(stage: CustomerJourneyStage): string {
  switch (stage) {
    case "REQUEST_PENDING":
      return "Your request was sent to nearby workers";
    case "WORKERS_NOTIFIED":
      return "Workers are reviewing your request";
    case "WORKER_SELECTED":
      return "Confirm your booking to secure this worker";
    case "PAYMENT_AUTHORIZED":
      return "Booking confirmed — your worker can begin";
    case "WORKER_EN_ROUTE":
      return "Your worker is on the way";
    case "WORKER_ARRIVED":
      return "Your worker has arrived";
    case "IN_PROGRESS":
      return "Work in progress";
    case "WAITING_CUSTOMER_CONFIRMATION":
      return "Review the completed work";
    case "PAYMENT_CAPTURED":
    case "COMPLETED":
      return "Gig completed successfully";
    case "CANCELLED":
      return "This request was cancelled";
    default:
      return customerJourneyStageLabel(stage);
  }
}

export function customerJourneyProgressIndex(stage: CustomerJourneyStage): number {
  const index = CUSTOMER_JOURNEY_PROGRESS.findIndex((step) => step.stage === stage);
  if (index !== -1) return index;
  if (stage === "WORKER_ARRIVED") {
    return CUSTOMER_JOURNEY_PROGRESS.findIndex((step) => step.stage === "WORKER_EN_ROUTE");
  }
  if (stage === "COMPLETED") {
    return CUSTOMER_JOURNEY_PROGRESS.length - 1;
  }
  return 0;
}

export function liveTrackingWorkerStatus(status: string): string {
  switch (status) {
    case "WORKER_ASSIGNED":
      return "Accepted";
    case "WORKER_EN_ROUTE":
      return "Driving";
    case "WORKER_ARRIVED":
      return "Arrived";
    case "IN_PROGRESS":
      return "Working";
    case "WAITING_CUSTOMER_CONFIRMATION":
    case "COMPLETED":
      return "Completed";
    default:
      return statusLabelFallback(status);
  }
}

function statusLabelFallback(status: string): string {
  return status.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}
