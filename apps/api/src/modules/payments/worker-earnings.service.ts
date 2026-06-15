import {
  GigStatus,
  PaymentLifecycle,
  PaymentStatus,
  TransactionType,
  WorkerEarningsTransactionStatus,
  WorkerEarningsTransactionType
} from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import { getSocketServer } from "../../lib/socket.js";
import { getStripe, isStripeConfigured } from "../../lib/stripe.js";
import { createConnectAccountLink, getWorkerConnectStatus } from "./payment.service.js";

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
      stripePaymentIntentId: paymentIntentId ?? undefined
    }
  });
}

async function captureCompletedGigPayment(gigId: string): Promise<void> {
  const gig = await prisma.gig.findUnique({
    where: { id: gigId },
    include: { payment: true }
  });

  if (!gig?.payment) return;

  if (gig.paymentStatus === PaymentLifecycle.PAYMENT_CAPTURED) return;

  if (!isStripeConfigured()) {
    await syncGigPaymentCaptured(gigId, gig.payment.id, gig.payment.stripePaymentIntentId);
    logEarnings("payment_captured_dev", { gigId });
    return;
  }

  if (!gig.payment.stripePaymentIntentId) {
    logEarnings("payment_capture_skipped_missing_intent", { gigId });
    return;
  }

  const stripe = getStripe();
  let paymentIntent = await stripe.paymentIntents.retrieve(gig.payment.stripePaymentIntentId);

  if (paymentIntent.status === "requires_capture") {
    paymentIntent = await stripe.paymentIntents.capture(
      gig.payment.stripePaymentIntentId,
      {},
      { idempotencyKey: `capture-${gig.id}` }
    );
  }

  if (paymentIntent.status !== "succeeded") {
    logEarnings("payment_capture_skipped_status", { gigId, status: paymentIntent.status });
    return;
  }

  await syncGigPaymentCaptured(gigId, gig.payment.id, paymentIntent.id);
  await recordPaymentTransaction(gig.payment.id, TransactionType.CLIENT_CHARGE, gig.totalCents, {
    paymentIntentId: paymentIntent.id,
    state: "captured"
  });
  await recordPaymentTransaction(gig.payment.id, TransactionType.PLATFORM_COMMISSION, gig.platformFeeCents, {
    paymentIntentId: paymentIntent.id
  });
  logEarnings("payment_captured", { gigId, paymentIntentId: paymentIntent.id });
}

function emitWorkerEarningsUpdated(workerId: string) {
  getSocketServer().to(`user:${workerId}`).emit("worker:earnings_updated", { workerId });
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

  await captureCompletedGigPayment(gigId);

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
