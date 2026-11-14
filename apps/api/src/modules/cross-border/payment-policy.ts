export type QuotePayStatus = "DRAFT" | "APPROVED" | "SENT" | "EXPIRED" | "SUPERSEDED" | "ACCEPTED";

export type PaymentAttemptSnap = {
  id: string;
  status: "CREATED" | "PENDING" | "PAID" | "FAILED" | "CANCELLED" | "EXPIRED" | "EXCEPTION";
  quoteId: string;
  quoteVersion: number;
  merchantReference: string;
};

const LINKABLE = new Set<QuotePayStatus>(["APPROVED", "SENT", "ACCEPTED"]);

export function paymentLinkBlockReason(input: {
  linksEnabled: boolean;
  quoteStatus: QuotePayStatus;
  expiresAt: Date;
  now: Date;
}): "LINKS_DISABLED" | "QUOTE_NOT_APPROVED" | "QUOTE_SUPERSEDED" | "QUOTE_EXPIRED" | "QUOTE_NOT_PAYABLE" | null {
  if (!input.linksEnabled) return "LINKS_DISABLED";
  if (input.quoteStatus === "DRAFT") return "QUOTE_NOT_APPROVED";
  if (input.quoteStatus === "SUPERSEDED") return "QUOTE_SUPERSEDED";
  if (input.quoteStatus === "EXPIRED" || input.expiresAt.getTime() <= input.now.getTime()) return "QUOTE_EXPIRED";
  if (!LINKABLE.has(input.quoteStatus)) return "QUOTE_NOT_PAYABLE";
  return null;
}

export type InitiationPlan =
  | { action: "BLOCK"; code: "PAYMENTS_DISABLED" | "QUOTE_NOT_APPROVED" | "QUOTE_SUPERSEDED" | "QUOTE_EXPIRED" | "QUOTE_NOT_PAYABLE" | "LINKS_DISABLED" }
  | { action: "ALREADY_PAID"; attemptId: string }
  | { action: "AWAIT_PENDING"; attemptId: string; merchantReference: string }
  | { action: "CREATE" };

export function planPaymentInitiation(input: {
  paymentsEnabled: boolean;
  quoteStatus: QuotePayStatus;
  expiresAt: Date;
  now: Date;
  attempts: PaymentAttemptSnap[];
}): InitiationPlan {
  if (!input.paymentsEnabled) return { action: "BLOCK", code: "PAYMENTS_DISABLED" };
  const block = paymentLinkBlockReason({ ...input, linksEnabled: true });
  if (block) return { action: "BLOCK", code: block };
  const paid = input.attempts.find((attempt) => attempt.status === "PAID");
  if (paid) return { action: "ALREADY_PAID", attemptId: paid.id };
  const pending = input.attempts.find((attempt) => attempt.status === "PENDING" || attempt.status === "CREATED");
  if (pending) return { action: "AWAIT_PENDING", attemptId: pending.id, merchantReference: pending.merchantReference };
  return { action: "CREATE" };
}

/** A second provider success must be stored for review and must not start procurement again. */
export function duplicateFundsAction(input: { providerPaid: boolean; anotherAttemptPaid: boolean; thisAttemptPaid: boolean }):
  | "APPLY"
  | "ALREADY_RECORDED"
  | "RECORD_DUPLICATE" {
  if (!input.providerPaid) return "APPLY";
  if (input.thisAttemptPaid) return "ALREADY_RECORDED";
  if (input.anotherAttemptPaid) return "RECORD_DUPLICATE";
  return "APPLY";
}
