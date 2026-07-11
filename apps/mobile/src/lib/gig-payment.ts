import type { GigDetail } from "./api";
import { gigNeedsPaymentAfterWorkerSelection } from "@gigflow/shared";

const LEGACY_UNPAID_STATUSES = new Set(["DRAFT"]);

export function gigNeedsPayment(gig: Pick<GigDetail, "status" | "payment" | "paymentStatus">): boolean {
  if (gigNeedsPaymentAfterWorkerSelection(gig.status, gig.paymentStatus ?? null)) return true;
  if (LEGACY_UNPAID_STATUSES.has(gig.status)) return true;
  return false;
}

export function gigAwaitingWorkerSelection(gig: Pick<GigDetail, "status">): boolean {
  return gig.status === "POSTED" || gig.status === "SEARCHING_FOR_WORKER";
}

export function gigAwaitingCompletionApproval(gig: Pick<GigDetail, "status">): boolean {
  return gig.status === "WAITING_CUSTOMER_CONFIRMATION";
}

export function gigAwaitingExtraTimeApproval(gig: Pick<GigDetail, "status">): boolean {
  return gig.status === "WAITING_EXTRA_TIME_APPROVAL";
}
