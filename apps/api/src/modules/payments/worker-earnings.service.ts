import {
  GigStatus,
  PaymentLifecycle,
  PaymentStatus,
  TransactionType,
  WorkerEarningsTransactionStatus,
  WorkerEarningsTransactionType
} from "@prisma/client";
import { isTimeBasedPricing } from "@gigflow/shared";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import { getSocketServer } from "../../lib/socket.js";
import { getStripe, isStripeConfigured } from "../../lib/stripe.js";
import { createConnectAccountLink, getWorkerConnectStatus } from "./payment.service.js";
import { isCapturedLifecycle } from "./payment-status.js";

function logEarnings(event: string, details: Record<string, unknown>): void {
  console.info(`[worker-earnings] ${event}`, details);
}

async function recordPaymentTransaction(
  paymentId: string,
  type: TransactionType,
  amountCents: number,
  metadata?: Record<string, unknown>
) {
  await prisma.transaction.create({
    data: { paymentId, type, amountCents, metadata: metadata as never }
  });
}

async function syncGigPaymentCaptured(gigId: string, paymentId: string, paymentIntentId?: string | null) {
  const now = new Date();
  await prisma.gig.update({
    where: { id: gigId },
    data: {
      paymentStatus: PaymentLifecycle.PAYMENT_CAPTURED,
      paymentIntentId: paymentIntentId ?? undefined
    }
  });

  await prisma.payment.update({
    where: { id: paymentId },
    data: {
      status: PaymentStatus.CAPTURED,
      stripePaymentIntentId: paymentIntentId ?? undefined,
      authorizationStatus: "CAPTURED",
      capturedAt: now
    }
  });
}

/**
 * Capture after completion.
 * FIXED: already captured at booking → no-op.
 * TIME_BASED: capture final amount from authorization hold.
 */
async function captureCompletedGigPayment(
  gigId: string,
  amountToCaptureCents?: number
): Promise<{ ok: boolean; captureFailed: boolean }> {
  const gig = await prisma.gig.findUnique({
    where: { id: gigId },
    include: { payment: true }
  });

  if (!gig?.payment) return { ok: false, captureFailed: false };

  const amountToCapture = Math.max(0, amountToCaptureCents ?? gig.finalTotalCents ?? gig.totalCents);

  // Fixed bookings (and any already-captured payment) — nothing to capture.
  if (isCapturedLifecycle(gig.paymentStatus)) {
    return { ok: true, captureFailed: false };
  }

  if (!isStripeConfigured()) {
    await syncGigPaymentCaptured(gigId, gig.payment.id, gig.payment.stripePaymentIntentId);
    await prisma.payment.update({
      where: { id: gig.payment.id },
      data: { amountCents: amountToCapture }
    });
    logEarnings("payment_captured_dev", { gigId, amountToCapture });
    return { ok: true, captureFailed: false };
  }

  if (!gig.payment.stripePaymentIntentId) {
    logEarnings("payment_capture_skipped_missing_intent", { gigId });
    return { ok: false, captureFailed: true };
  }

  const stripe = getStripe();
  let paymentIntent = await stripe.paymentIntents.retrieve(gig.payment.stripePaymentIntentId);

  if (paymentIntent.status === "succeeded") {
    await syncGigPaymentCaptured(gigId, gig.payment.id, paymentIntent.id);
    return { ok: true, captureFailed: false };
  }

  if (paymentIntent.status === "requires_capture") {
    const capturable = paymentIntent.amount_capturable || paymentIntent.amount;
    const captureAmount = Math.min(amountToCapture, capturable);
    if (captureAmount <= 0) {
      return { ok: false, captureFailed: true };
    }

    try {
      paymentIntent = await stripe.paymentIntents.capture(
        gig.payment.stripePaymentIntentId,
        { amount_to_capture: captureAmount },
        { idempotencyKey: `capture-final-${gig.id}-${captureAmount}` }
      );
    } catch (error) {
      logEarnings("payment_capture_failed", {
        gigId,
        message: error instanceof Error ? error.message : "unknown"
      });
      await prisma.payment.update({
        where: { id: gig.payment.id },
        data: { authorizationStatus: "CAPTURE_FAILED", status: PaymentStatus.FAILED }
      });
      await prisma.gig.update({
        where: { id: gigId },
        data: { paymentStatus: PaymentLifecycle.PAYMENT_FAILED }
      });
      return { ok: false, captureFailed: true };
    }
  }

  if (paymentIntent.status !== "succeeded") {
    logEarnings("payment_capture_skipped_status", { gigId, status: paymentIntent.status });
    await prisma.payment.update({
      where: { id: gig.payment.id },
      data: { authorizationStatus: "CAPTURE_FAILED" }
    });
    return { ok: false, captureFailed: true };
  }

  const charged = paymentIntent.amount_received || amountToCapture;
  const chargeId =
    typeof paymentIntent.latest_charge === "string"
      ? paymentIntent.latest_charge
      : paymentIntent.latest_charge?.id ?? null;

  await syncGigPaymentCaptured(gigId, gig.payment.id, paymentIntent.id);
  await prisma.payment.update({
    where: { id: gig.payment.id },
    data: { amountCents: charged, stripeChargeId: chargeId ?? undefined }
  });
  await recordPaymentTransaction(gig.payment.id, TransactionType.CLIENT_CHARGE, charged, {
    paymentIntentId: paymentIntent.id,
    state: isTimeBasedPricing(gig.pricingType) ? "captured_final" : "captured"
  });
  await recordPaymentTransaction(gig.payment.id, TransactionType.PLATFORM_COMMISSION, gig.platformFeeCents, {
    paymentIntentId: paymentIntent.id
  });
  logEarnings("payment_captured", { gigId, paymentIntentId: paymentIntent.id, charged });
  return { ok: true, captureFailed: false };
}

function emitWorkerEarningsUpdated(workerId: string) {
  getSocketServer().to(`user:${workerId}`).emit("worker:earnings_updated", { workerId });
}

/** Credit 100% of a client travel-cancellation fee to the worker (no platform cut). */
export async function creditWorkerCancellationFee(input: {
  gigId: string;
  workerId: string;
  amountCents: number;
  title: string;
}): Promise<void> {
  const { gigId, workerId, amountCents, title } = input;
  if (amountCents <= 0) return;

  const existing = await prisma.workerEarningsTransaction.findFirst({
    where: {
      workerId,
      gigId,
      type: WorkerEarningsTransactionType.CANCELLATION_FEE_CREDIT
    }
  });
  if (existing) {
    logEarnings("cancellation_fee_skipped_duplicate", { gigId, workerId });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.workerEarningsTransaction.create({
      data: {
        workerId,
        gigId,
        type: WorkerEarningsTransactionType.CANCELLATION_FEE_CREDIT,
        status: WorkerEarningsTransactionStatus.COMPLETED,
        amountCents,
        metadata: { title, platformFeeCents: 0, source: "cancellation_fee" }
      }
    });

    await tx.workerProfile.update({
      where: { userId: workerId },
      data: {
        availableBalanceCents: { increment: amountCents },
        totalEarnedCents: { increment: amountCents }
      }
    });
  });

  logEarnings("cancellation_fee_credited", { gigId, workerId, amountCents });
  emitWorkerEarningsUpdated(workerId);
}

export async function creditWorkerForCompletedGig(gigId: string): Promise<void> {
  const gig = await prisma.gig.findUnique({
    where: { id: gigId },
    include: {
      payment: true,
      assignments: { orderBy: { acceptedAt: "desc" }, take: 1 }
    }
  });

  if (!gig || gig.status !== GigStatus.COMPLETED) return;

  const workerId = gig.assignments[0]?.workerId ?? gig.assignedWorkerId;
  if (!workerId || gig.workerPayoutCents <= 0) return;

  const existingCredit = await prisma.workerEarningsTransaction.findFirst({
    where: {
      workerId,
      gigId,
      type: WorkerEarningsTransactionType.GIG_COMPLETED_CREDIT
    }
  });

  if (existingCredit) {
    logEarnings("gig_credit_skipped_duplicate", { gigId, workerId });
    return;
  }

  const capture = await captureCompletedGigPayment(gigId, gig.finalTotalCents ?? gig.totalCents);
  if (capture.captureFailed || !capture.ok) {
    logEarnings("gig_credit_blocked_capture_failed", { gigId, workerId });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.workerEarningsTransaction.create({
      data: {
        workerId,
        gigId,
        type: WorkerEarningsTransactionType.GIG_COMPLETED_CREDIT,
        status: WorkerEarningsTransactionStatus.COMPLETED,
        amountCents: gig.workerPayoutCents,
        metadata: { title: gig.title, platformFeeCents: gig.platformFeeCents }
      }
    });

    await tx.workerProfile.update({
      where: { userId: workerId },
      data: {
        availableBalanceCents: { increment: gig.workerPayoutCents },
        totalEarnedCents: { increment: gig.workerPayoutCents }
      }
    });
  });

  logEarnings("gig_credit_applied", {
    gigId,
    workerId,
    amountCents: gig.workerPayoutCents
  });

  emitWorkerEarningsUpdated(workerId);
}

export async function requestWorkerWithdrawal(workerId: string, amountCents?: number) {
  const profile = await prisma.workerProfile.findUnique({ where: { userId: workerId } });
  if (!profile) {
    throw new AppError("NOT_FOUND", 404, "NOT_FOUND", { worker: "Worker profile not found" });
  }

  const amount = amountCents ?? profile.availableBalanceCents;
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new AppError("INVALID_AMOUNT", 400, "INVALID_AMOUNT", {
      amount: "Withdrawal amount must be greater than zero."
    });
  }

  if (amount > profile.availableBalanceCents) {
    throw new AppError("INSUFFICIENT_BALANCE", 400, "INSUFFICIENT_BALANCE", {
      balance: "Withdrawal amount exceeds available balance."
    });
  }

  if (!isStripeConfigured()) {
    throw new AppError("STRIPE_NOT_CONFIGURED", 503, "STRIPE_NOT_CONFIGURED", {
      stripe: "Stripe is not configured for withdrawals."
    });
  }

  const connect = await getWorkerConnectStatus(workerId);
  if (!connect.accountId || !connect.payoutsEnabled) {
    throw new AppError("STRIPE_CONNECT_REQUIRED", 403, "STRIPE_CONNECT_REQUIRED", {
      stripe: "Complete Stripe payout setup before withdrawing earnings."
    });
  }

  const requestRecord = await prisma.$transaction(async (tx) => {
    const updated = await tx.workerProfile.updateMany({
      where: { userId: workerId, availableBalanceCents: { gte: amount } },
      data: { availableBalanceCents: { decrement: amount } }
    });

    if (updated.count !== 1) {
      throw new AppError("INSUFFICIENT_BALANCE", 400, "INSUFFICIENT_BALANCE", {
        balance: "Withdrawal amount exceeds available balance."
      });
    }

    return tx.workerEarningsTransaction.create({
      data: {
        workerId,
        type: WorkerEarningsTransactionType.WITHDRAWAL_REQUESTED,
        status: WorkerEarningsTransactionStatus.PENDING,
        amountCents: amount
      }
    });
  });

  emitWorkerEarningsUpdated(workerId);
  logEarnings("withdrawal_requested", { workerId, amountCents: amount, transactionId: requestRecord.id });

  try {
    const stripe = getStripe();
    const transfer = await stripe.transfers.create(
      {
        amount,
        currency: "usd",
        destination: connect.accountId!,
        metadata: { workerId, withdrawalTransactionId: requestRecord.id }
      },
      { idempotencyKey: `withdraw-${requestRecord.id}` }
    );

    await prisma.$transaction(async (tx) => {
      await tx.workerEarningsTransaction.update({
        where: { id: requestRecord.id },
        data: {
          status: WorkerEarningsTransactionStatus.COMPLETED,
          stripeTransferId: transfer.id
        }
      });

      await tx.workerEarningsTransaction.create({
        data: {
          workerId,
          type: WorkerEarningsTransactionType.WITHDRAWAL_SUCCESS,
          status: WorkerEarningsTransactionStatus.COMPLETED,
          amountCents: amount,
          stripeTransferId: transfer.id,
          metadata: { requestTransactionId: requestRecord.id }
        }
      });

      await tx.workerProfile.update({
        where: { userId: workerId },
        data: { withdrawnBalanceCents: { increment: amount } }
      });
    });

    logEarnings("withdrawal_success", {
      workerId,
      amountCents: amount,
      transferId: transfer.id,
      transactionId: requestRecord.id
    });

    emitWorkerEarningsUpdated(workerId);

    return {
      ok: true,
      amountCents: amount,
      transferId: transfer.id,
      transactionId: requestRecord.id
    };
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : "Withdrawal failed";

    await prisma.$transaction(async (tx) => {
      await tx.workerEarningsTransaction.update({
        where: { id: requestRecord.id },
        data: {
          status: WorkerEarningsTransactionStatus.FAILED,
          failureReason
        }
      });

      await tx.workerEarningsTransaction.create({
        data: {
          workerId,
          type: WorkerEarningsTransactionType.WITHDRAWAL_FAILED,
          status: WorkerEarningsTransactionStatus.FAILED,
          amountCents: amount,
          failureReason,
          metadata: { requestTransactionId: requestRecord.id }
        }
      });

      await tx.workerProfile.update({
        where: { userId: workerId },
        data: { availableBalanceCents: { increment: amount } }
      });
    });

    logEarnings("withdrawal_failed", {
      workerId,
      amountCents: amount,
      transactionId: requestRecord.id,
      failureReason
    });

    emitWorkerEarningsUpdated(workerId);

    throw new AppError("WITHDRAWAL_FAILED", 502, "WITHDRAWAL_FAILED", {
      withdrawal: failureReason
    });
  }
}

export async function getWorkerWithdrawalOnboardingLink(workerId: string) {
  return createConnectAccountLink(workerId);
}
