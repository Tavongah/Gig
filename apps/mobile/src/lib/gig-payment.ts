import type { GigDetail } from "./api";

const UNPAID_PAYMENT_LIFECYCLES = new Set(["PAYMENT_PENDING", "PAYMENT_FAILED"]);
const UNPAID_PAYMENT_STATUSES = new Set(["REQUIRES_PAYMENT_METHOD", "FAILED"]);

export function gigNeedsPayment(gig: Pick<GigDetail, "status" | "payment" | "paymentStatus">): boolean {
  if (gig.status === "DRAFT") return true;
  if (gig.paymentStatus && UNPAID_PAYMENT_LIFECYCLES.has(gig.paymentStatus)) return true;
  if (gig.payment?.status && UNPAID_PAYMENT_STATUSES.has(gig.payment.status)) return true;
  return false;
}
