import { PaymentLifecycle, PaymentStatus } from "@prisma/client";

export const paymentLifecycleStatuses = [
  "payment_pending",
  "payment_authorized",
  "payment_captured",
  "payout_pending",
  "payout_paid",
  "payment_failed"
] as const;

export type PaymentLifecycleStatus = (typeof paymentLifecycleStatuses)[number];

export function lifecycleToSnakeCase(status: PaymentLifecycle): PaymentLifecycleStatus {
  switch (status) {
    case PaymentLifecycle.PAYMENT_PENDING:
      return "payment_pending";
    case PaymentLifecycle.PAYMENT_AUTHORIZED:
      return "payment_authorized";
    case PaymentLifecycle.PAYMENT_CAPTURED:
      return "payment_captured";
    case PaymentLifecycle.PAYOUT_PENDING:
      return "payout_pending";
    case PaymentLifecycle.PAYOUT_PAID:
      return "payout_paid";
    case PaymentLifecycle.PAYMENT_FAILED:
      return "payment_failed";
    default:
      return "payment_pending";
  }
}

export function paymentStatusToLifecycle(status: PaymentStatus): PaymentLifecycle {
  switch (status) {
    case PaymentStatus.REQUIRES_PAYMENT_METHOD:
      return PaymentLifecycle.PAYMENT_PENDING;
    case PaymentStatus.AUTHORIZED:
      return PaymentLifecycle.PAYMENT_AUTHORIZED;
    case PaymentStatus.CAPTURED:
      return PaymentLifecycle.PAYMENT_CAPTURED;
    case PaymentStatus.PAYOUT_PENDING:
      return PaymentLifecycle.PAYOUT_PENDING;
    case PaymentStatus.PAID_OUT:
      return PaymentLifecycle.PAYOUT_PAID;
    case PaymentStatus.FAILED:
    case PaymentStatus.REFUNDED:
      return PaymentLifecycle.PAYMENT_FAILED;
    default:
      return PaymentLifecycle.PAYMENT_PENDING;
  }
}

export function lifecycleToPaymentStatus(status: PaymentLifecycle): PaymentStatus {
  switch (status) {
    case PaymentLifecycle.PAYMENT_PENDING:
      return PaymentStatus.REQUIRES_PAYMENT_METHOD;
    case PaymentLifecycle.PAYMENT_AUTHORIZED:
      return PaymentStatus.AUTHORIZED;
    case PaymentLifecycle.PAYMENT_CAPTURED:
      return PaymentStatus.CAPTURED;
    case PaymentLifecycle.PAYOUT_PENDING:
      return PaymentStatus.PAYOUT_PENDING;
    case PaymentLifecycle.PAYOUT_PAID:
      return PaymentStatus.PAID_OUT;
    case PaymentLifecycle.PAYMENT_FAILED:
      return PaymentStatus.FAILED;
    default:
      return PaymentStatus.REQUIRES_PAYMENT_METHOD;
  }
}

export function isAuthorizedForWorkerAccept(status: PaymentLifecycle): boolean {
  return status === PaymentLifecycle.PAYMENT_AUTHORIZED;
}

export function isPaidLifecycle(status: PaymentLifecycle): boolean {
  return (
    status === PaymentLifecycle.PAYMENT_AUTHORIZED ||
    status === PaymentLifecycle.PAYMENT_CAPTURED ||
    status === PaymentLifecycle.PAYOUT_PENDING ||
    status === PaymentLifecycle.PAYOUT_PAID
  );
}

export function formatPaymentStatusResponse(input: {
  id: string;
  paymentStatus: PaymentLifecycle;
  amountCents: number;
  platformFeeCents: number;
  workerPayoutCents: number;
  paymentIntentId?: string | null;
  checkoutSessionId?: string | null;
  stripeTransferId?: string | null;
  gigStatus?: string;
}) {
  return {
    id: input.id,
    paymentStatus: lifecycleToSnakeCase(input.paymentStatus),
    lifecycleStatus: lifecycleToSnakeCase(input.paymentStatus),
    amountCents: input.amountCents,
    platformFeeCents: input.platformFeeCents,
    workerPayoutCents: input.workerPayoutCents,
    estimatedPrice: input.amountCents,
    platformFee: input.platformFeeCents,
    workerPayout: input.workerPayoutCents,
    paymentIntentId: input.paymentIntentId ?? null,
    checkoutSessionId: input.checkoutSessionId ?? null,
    stripeTransferId: input.stripeTransferId ?? null,
    gigStatus: input.gigStatus,
    isPaid: isPaidLifecycle(input.paymentStatus),
    isAuthorized: input.paymentStatus === PaymentLifecycle.PAYMENT_AUTHORIZED
  };
}
