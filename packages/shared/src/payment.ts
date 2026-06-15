export const paymentLifecycleStatuses = [
  "payment_pending",
  "payment_authorized",
  "payment_captured",
  "payout_pending",
  "payout_paid",
  "payment_failed"
] as const;

export type PaymentLifecycleStatus = (typeof paymentLifecycleStatuses)[number];
