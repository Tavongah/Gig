import { GigStatus, PaymentLifecycle, PaymentStatus, TransactionType } from "@prisma/client";
import type { Server } from "socket.io";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import { getStripe, isStripeConfigured } from "../../lib/stripe.js";
import { notifyUser } from "../realtime/realtime.service.js";
import { createAdminRefund, releaseAuthorizedPayment } from "../payments/payment.service.js";
import { creditWorkerCancellationFee } from "../payments/worker-earnings.service.js";
import { isCapturedLifecycle } from "../payments/payment-status.js";
import { getSocketServer } from "../../lib/socket.js";

const DEFAULT_FEE_PERCENT = 0.25;
const DEFAULT_GRACE_MINUTES = 5;

export type PlatformCancellationPolicy = {
  cancellationFeePercent: number;
  cancellationGraceMinutes: number;
};

export async function getCancellationPolicy(): Promise<PlatformCancellationPolicy> {
  const setting = await prisma.platformSetting.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      cancellationFeePercent: DEFAULT_FEE_PERCENT,
      cancellationGraceMinutes: DEFAULT_GRACE_MINUTES
    },
    update: {}
  });

  return {
    cancellationFeePercent: Number(setting.cancellationFeePercent),
    cancellationGraceMinutes: setting.cancellationGraceMinutes
  };
}

export async function markTravelStarted(gigId: string, io?: Server): Promise<void> {
  const policy = await getCancellationPolicy();
  const now = new Date();
  const graceEnds = new Date(now.getTime() + policy.cancellationGraceMinutes * 60_000);

  const gig = await prisma.gig.update({
    where: { id: gigId },
    data: {
      travelStartedAt: now,
      cancellationGraceEndsAt: graceEnds
    },
    include: { assignments: { orderBy: { acceptedAt: "desc" }, take: 1 } }
  });

  if (!io) return;

  notifyUser(io, gig.clientId, {
    type: "CANCELLATION_GRACE_ACTIVE",
    title: "Grace period active",
    body: `You can cancel free of charge for the next ${policy.cancellationGraceMinutes} minutes while your worker travels.`,
    gigId
  });

  const workerId = gig.assignments[0]?.workerId ?? gig.assignedWorkerId;
  if (workerId) {
    notifyUser(io, workerId, {
      type: "TRAVEL_STARTED",
      title: "Travel started",
      body: `You started travel for "${gig.title}". The client has a ${policy.cancellationGraceMinutes}-minute free cancellation window.`,
      gigId
    });
  }
}

export async function maybeNotifyGracePeriodExpired(gigId: string, clientId: string, io?: Server): Promise<void> {
  let socket: Server | undefined = io;
  if (!socket) {
    try {
      socket = getSocketServer();
    } catch {
      return;
    }
  }

  const gig = await prisma.gig.findUnique({
    where: { id: gigId },
    select: {
      id: true,
      title: true,
      status: true,
      cancellationGraceEndsAt: true
    }
  });

  if (!gig || gig.status !== GigStatus.WORKER_EN_ROUTE || !gig.cancellationGraceEndsAt) return;
  if (gig.cancellationGraceEndsAt.getTime() > Date.now()) return;

  const existing = await prisma.notification.findFirst({
    where: {
      gigId,
      userId: clientId,
      title: "Grace period expired"
    }
  });
  if (existing) return;

  notifyUser(socket, clientId, {
    type: "CANCELLATION_GRACE_EXPIRED",
    title: "Grace period expired",
    body: `Free cancellation for "${gig.title}" has ended. Cancelling now may include a cancellation fee.`,
    gigId
  });
}

function computeCancellationFeeCents(totalCents: number, feePercent: number): number {
  if (totalCents <= 0 || feePercent <= 0) return 0;
  return Math.min(totalCents, Math.round(totalCents * feePercent));
}

async function settleCancellationFeePayment(
  gigId: string,
  feeCents: number
): Promise<{ paid: boolean }> {
  if (feeCents <= 0) return { paid: false };

  const gig = await prisma.gig.findUnique({
    where: { id: gigId },
    include: { payment: true }
  });
  if (!gig?.payment) return { paid: false };

  // Fixed / already-captured: refund everything except the fee (100% of fee goes to worker).
  if (isCapturedLifecycle(gig.paymentStatus)) {
    const refundable = Math.max(0, gig.payment.amountCents - gig.payment.refundAmountCents - feeCents);
    if (refundable > 0 && isStripeConfigured()) {
      await createAdminRefund(gig.payment.id, {
        amountCents: refundable,
        reason: "client_cancel_after_grace",
        notes: "Partial refund after travel grace — cancellation fee retained for worker",
        adminId: "system"
      });
    } else if (!isStripeConfigured()) {
      await prisma.payment.update({
        where: { id: gig.payment.id },
        data: {
          refundAmountCents: Math.max(0, gig.payment.amountCents - feeCents),
          status:
            feeCents >= gig.payment.amountCents
              ? PaymentStatus.CAPTURED
              : PaymentStatus.PARTIALLY_REFUNDED
        }
      });
    }
    return { paid: true };
  }

  // Time-based authorization: capture only the cancellation fee, release the rest.
  if (gig.paymentStatus === PaymentLifecycle.PAYMENT_AUTHORIZED) {
    if (!isStripeConfigured() || !gig.payment.stripePaymentIntentId) {
      await prisma.payment.update({
        where: { id: gig.payment.id },
        data: {
          amountCents: feeCents,
          status: PaymentStatus.CAPTURED,
          authorizationStatus: "CAPTURED",
          capturedAt: new Date()
        }
      });
      await prisma.gig.update({
        where: { id: gigId },
        data: { paymentStatus: PaymentLifecycle.PAYMENT_CAPTURED }
      });
      return { paid: true };
    }

    const stripe = getStripe();
    const intent = await stripe.paymentIntents.retrieve(gig.payment.stripePaymentIntentId);
    if (intent.status === "requires_capture") {
      const capturable = intent.amount_capturable || intent.amount;
      const captureAmount = Math.min(feeCents, capturable);
      if (captureAmount > 0) {
        await stripe.paymentIntents.capture(
          gig.payment.stripePaymentIntentId,
          { amount_to_capture: captureAmount },
          { idempotencyKey: `cancel-fee-capture-${gig.id}-${captureAmount}` }
        );
      } else {
        await stripe.paymentIntents.cancel(gig.payment.stripePaymentIntentId, undefined, {
          idempotencyKey: `cancel-fee-release-${gig.id}`
        });
      }
    }

    await prisma.payment.update({
      where: { id: gig.payment.id },
      data: {
        amountCents: feeCents,
        status: PaymentStatus.CAPTURED,
        authorizationStatus: "CAPTURED",
        capturedAt: new Date()
      }
    });
    await prisma.gig.update({
      where: { id: gigId },
      data: { paymentStatus: PaymentLifecycle.PAYMENT_CAPTURED }
    });
    await prisma.transaction.create({
      data: {
        paymentId: gig.payment.id,
        type: TransactionType.CLIENT_CHARGE,
        amountCents: feeCents,
        metadata: { reason: "cancellation_fee" } as never
      }
    });
    return { paid: true };
  }

  // Fallback: full release (no fee collected).
  await releaseAuthorizedPayment(gigId);
  return { paid: false };
}

/**
 * Client cancellation. Preserves free cancel before travel.
 * After Start Travel: free during grace; fee after grace (100% to worker).
 */
export async function applyClientCancellation(input: {
  gigId: string;
  clientId: string;
  previousStatus: GigStatus;
  reason?: string | null;
  io?: Server;
}): Promise<{
  feeCents: number;
  withinGrace: boolean;
  travelDurationSeconds: number | null;
}> {
  const { gigId, clientId, previousStatus, reason, io } = input;
  const now = new Date();

  const gig = await prisma.gig.findUniqueOrThrow({
    where: { id: gigId },
    include: {
      assignments: { orderBy: { acceptedAt: "desc" }, take: 1 }
    }
  });

  if (gig.clientId !== clientId) {
    throw new AppError("FORBIDDEN", 403, "FORBIDDEN");
  }

  const travelStartedAt = gig.travelStartedAt;
  const travelDurationSeconds =
    travelStartedAt != null
      ? Math.max(0, Math.floor((now.getTime() - travelStartedAt.getTime()) / 1000))
      : null;

  const policy = await getCancellationPolicy();
  const enRoute = previousStatus === GigStatus.WORKER_EN_ROUTE;
  const withinGrace =
    !enRoute ||
    !gig.cancellationGraceEndsAt ||
    now.getTime() < gig.cancellationGraceEndsAt.getTime();

  let feeCents = 0;
  if (enRoute && !withinGrace) {
    feeCents = computeCancellationFeeCents(gig.totalCents, policy.cancellationFeePercent);
  }

  await prisma.gig.update({
    where: { id: gigId },
    data: {
      cancelledAt: now,
      cancelledBy: "CLIENT",
      cancellationReason: reason?.trim() || (enRoute ? (withinGrace ? "client_cancel_during_grace" : "client_cancel_after_grace") : "client_cancel"),
      cancellationFeeCents: feeCents,
      travelDurationSeconds
    }
  });

  const workerId = gig.assignments[0]?.workerId ?? gig.assignedWorkerId;

  if (feeCents > 0) {
    const settled = await settleCancellationFeePayment(gigId, feeCents);
    if (settled.paid && workerId) {
      await prisma.gig.update({
        where: { id: gigId },
        data: { cancellationFeePaid: true }
      });
      await creditWorkerCancellationFee({
        gigId,
        workerId,
        amountCents: feeCents,
        title: gig.title
      });

      if (io) {
        notifyUser(io, workerId, {
          type: "GIG_CANCELLED",
          title: "Client cancelled the job",
          body: `The client cancelled "${gig.title}". A cancellation fee has been credited to your account.`,
          gigId
        });
        notifyUser(io, workerId, {
          type: "CANCELLATION_FEE_RECEIVED",
          title: "Cancellation fee received",
          body: `A cancellation fee for "${gig.title}" was added to your earnings.`,
          gigId
        });
        notifyUser(io, clientId, {
          type: "CANCELLATION_FEE_CHARGED",
          title: "Cancellation fee charged",
          body: "You cancelled after the 5-minute grace period. A cancellation fee has been charged.",
          gigId
        });
      }
    } else if (io && workerId) {
      notifyUser(io, workerId, {
        type: "GIG_CANCELLED",
        title: "Client cancelled the job",
        body: `The client cancelled "${gig.title}".`,
        gigId
      });
    }
  } else {
    await releaseAuthorizedPayment(gigId);
    if (io && workerId) {
      notifyUser(io, workerId, {
        type: "GIG_CANCELLED",
        title: "Client cancelled the job",
        body: enRoute
          ? `The client cancelled "${gig.title}" during the free cancellation window.`
          : `The client cancelled "${gig.title}".`,
        gigId
      });
    }
  }

  if (io) {
    notifyUser(io, clientId, {
      type: "CANCELLATION_SUCCESS",
      title: "Cancellation successful",
      body:
        feeCents > 0
          ? "You cancelled after the 5-minute grace period. A cancellation fee has been charged."
          : enRoute
            ? "You cancelled during the free grace period. No cancellation fee was charged."
            : `Your booking "${gig.title}" was cancelled.`,
      gigId
    });
  }

  return { feeCents, withinGrace, travelDurationSeconds };
}
