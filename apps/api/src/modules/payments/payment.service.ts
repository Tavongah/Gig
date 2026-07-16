import { GigStatus, PaymentLifecycle, PaymentStatus, TransactionType, UserRole } from "@prisma/client";
import type { Server } from "socket.io";
import type Stripe from "stripe";
import { isTimeBasedPricing } from "@gigflow/shared";
import { env } from "../../config/env.js";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import { assertDevOnlyPaymentBypass } from "../../lib/production-guards.js";
import { getSocketServer } from "../../lib/socket.js";
import { getStripe, isStripeConfigured, toFriendlyPaymentStartError } from "../../lib/stripe.js";
import { broadcastGigOffer, notifyUser } from "../realtime/realtime.service.js";
import {
  formatPaymentStatusResponse,
  isAuthorizedForWorkerAccept,
  isCapturedLifecycle,
  isPaidLifecycle,
  lifecycleToPaymentStatus
} from "./payment-status.js";

const AWAITING_PAYMENT_GIG_STATUSES: GigStatus[] = [GigStatus.DRAFT, GigStatus.POSTED, GigStatus.WORKER_SELECTED];

function logPayment(event: string, details: Record<string, unknown>): void {
  console.info(`[stripe] ${event}`, details);
}

async function syncGigPaymentState(
  gigId: string,
  lifecycle: PaymentLifecycle,
  extra?: {
    paymentIntentId?: string | null;
    checkoutSessionId?: string | null;
    assignedWorkerId?: string | null;
    paymentRecord?: {
      paymentId: string;
      stripePaymentIntentId?: string | null;
      stripeCheckoutSessionId?: string | null;
      stripeTransferId?: string | null;
    };
  }
): Promise<void> {
  await prisma.gig.update({
    where: { id: gigId },
    data: {
      paymentStatus: lifecycle,
      paymentIntentId: extra?.paymentIntentId ?? extra?.paymentRecord?.stripePaymentIntentId ?? undefined,
      checkoutSessionId: extra?.checkoutSessionId ?? extra?.paymentRecord?.stripeCheckoutSessionId ?? undefined,
      assignedWorkerId: extra?.assignedWorkerId ?? undefined
    }
  });

  if (extra?.paymentRecord) {
    await prisma.payment.update({
      where: { id: extra.paymentRecord.paymentId },
      data: {
        status: lifecycleToPaymentStatus(lifecycle),
        stripePaymentIntentId: extra.paymentRecord.stripePaymentIntentId ?? undefined,
        stripeCheckoutSessionId: extra.paymentRecord.stripeCheckoutSessionId ?? undefined,
        stripeTransferId: extra.paymentRecord.stripeTransferId ?? undefined
      }
    });
  }
}

async function getOrCreateStripeCustomer(userId: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.fullName,
    metadata: { userId }
  });

  await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

async function recordTransaction(
  paymentId: string,
  type: TransactionType,
  amountCents: number,
  metadata?: Record<string, unknown>
) {
  await prisma.transaction.create({
    data: { paymentId, type, amountCents, metadata: metadata as never }
  });
}

function formatCentsLabel(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

type GigWithPayment = NonNullable<
  Awaited<
    ReturnType<
      typeof prisma.gig.findFirst<{
        include: { payment: true; serviceCategory: true };
      }>
    >
  >
>;

async function loadGigAwaitingClientPayment(gigId: string, clientId: string): Promise<GigWithPayment> {
  if (!isStripeConfigured()) {
    throw new AppError("STRIPE_NOT_CONFIGURED", 503, "STRIPE_NOT_CONFIGURED", {
      stripe: "Stripe is not configured"
    });
  }

  const gig = await prisma.gig.findFirst({
    where: { id: gigId, clientId },
    include: { payment: true, serviceCategory: true }
  });

  if (!gig?.payment) {
    throw new AppError("NOT_FOUND", 404, "NOT_FOUND", { gig: "Gig not found" });
  }

  if (!AWAITING_PAYMENT_GIG_STATUSES.includes(gig.status)) {
    throw new AppError("INVALID_STATE", 409, "INVALID_GIG_STATE", {
      gig: "This gig is no longer awaiting payment"
    });
  }

  if (gig.paymentStatus !== PaymentLifecycle.PAYMENT_PENDING && gig.paymentStatus !== PaymentLifecycle.PAYMENT_FAILED) {
    if (isPaidLifecycle(gig.paymentStatus)) {
      throw new AppError("This gig is already paid", 409, "ALREADY_PAID", { gig: "This gig is already paid" });
    }

    throw new AppError("INVALID_STATE", 409, "INVALID_GIG_STATE", {
      gig: "This gig is no longer awaiting payment"
    });
  }

  if (gig.paymentStatus === PaymentLifecycle.PAYMENT_FAILED) {
    await syncGigPaymentState(gigId, PaymentLifecycle.PAYMENT_PENDING, {
      paymentRecord: {
        paymentId: gig.payment.id,
        stripePaymentIntentId: null,
        stripeCheckoutSessionId: null
      }
    });
    logPayment("payment_retry_reset", { gigId, clientId });
    gig.paymentStatus = PaymentLifecycle.PAYMENT_PENDING;
  }

  return gig;
}

function formatGigPaymentResponse(gig: GigWithPayment) {
  return formatPaymentStatusResponse({
    id: gig.payment!.id,
    paymentStatus: gig.paymentStatus,
    amountCents: gig.totalCents,
    platformFeeCents: gig.platformFeeCents,
    workerPayoutCents: gig.workerPayoutCents,
    paymentIntentId: gig.paymentIntentId,
    checkoutSessionId: gig.checkoutSessionId,
    stripeTransferId: gig.payment!.stripeTransferId,
    gigStatus: gig.status,
    pricingType: gig.pricingType,
    maximumAuthorizedAmountCents: gig.maximumAuthorizedAmountCents,
    authorizationBufferCents: gig.authorizationBufferCents
  });
}

function checkoutChargeAmountCents(gig: GigWithPayment): number {
  if (isTimeBasedPricing(gig.pricingType)) {
    return gig.maximumAuthorizedAmountCents ?? gig.payment?.maximumAuthorizedAmountCents ?? gig.totalCents;
  }
  return gig.totalCents;
}

function paymentIntentCreateParams(gig: GigWithPayment, clientId: string, customerId: string): Stripe.PaymentIntentCreateParams {
  const amount = checkoutChargeAmountCents(gig);
  const timed = isTimeBasedPricing(gig.pricingType);
  return {
    amount,
    currency: "usd",
    customer: customerId,
    ...(timed ? { capture_method: "manual" as const } : {}),
    automatic_payment_methods: { enabled: true },
    setup_future_usage: "off_session",
    metadata: {
      gigId: gig.id,
      clientId,
      customerId: clientId,
      workerId: gig.assignedWorkerId ?? "",
      pricingType: gig.pricingType,
      platformFeeCents: String(gig.platformFeeCents),
      workerPayoutCents: String(gig.workerPayoutCents),
      totalCents: String(gig.totalCents),
      maximumAuthorizedAmountCents: String(amount),
      paymentMode: timed ? "TIME_BASED_AUTHORIZATION" : "FIXED_PAYMENT"
    }
  };
}

export async function createPaymentIntentForGig(gigId: string, clientId: string) {
  try {
    const gig = await loadGigAwaitingClientPayment(gigId, clientId);
    const stripe = getStripe();
    const customerId = await getOrCreateStripeCustomer(clientId);
    const amount = checkoutChargeAmountCents(gig);

    const paymentIntent = await stripe.paymentIntents.create(paymentIntentCreateParams(gig, clientId, customerId));

    await syncGigPaymentState(gigId, PaymentLifecycle.PAYMENT_PENDING, {
      paymentIntentId: paymentIntent.id,
      paymentRecord: {
        paymentId: gig.payment!.id,
        stripePaymentIntentId: paymentIntent.id,
        stripeCheckoutSessionId: null
      }
    });

    await prisma.payment.update({
      where: { id: gig.payment!.id },
      data: {
        amountCents: amount,
        maximumAuthorizedAmountCents: amount,
        authorizationStatus: isTimeBasedPricing(gig.pricingType) ? "REQUIRES_PAYMENT_METHOD" : "NOT_STARTED"
      }
    });

    logPayment("payment_intent_created", {
      gigId,
      paymentIntentId: paymentIntent.id,
      amountCents: amount,
      pricingType: gig.pricingType,
      captureMethod: isTimeBasedPricing(gig.pricingType) ? "manual" : "automatic",
      clientId
    });

    return {
      alreadyPaid: false,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      payment: formatGigPaymentResponse({ ...gig, paymentIntentId: paymentIntent.id })
    };
  } catch (error) {
    if (error instanceof AppError && error.code === "ALREADY_PAID") {
      const paidGig = await prisma.gig.findFirst({
        where: { id: gigId, clientId },
        include: { payment: true, serviceCategory: true }
      });
      if (!paidGig?.payment) throw error;

      return {
        alreadyPaid: true,
        clientSecret: null,
        payment: formatGigPaymentResponse(paidGig)
      };
    }
    throw toFriendlyPaymentStartError(error);
  }
}

export async function createCheckoutSession(gigId: string, clientId: string) {
  let gig: GigWithPayment;

  try {
    gig = await loadGigAwaitingClientPayment(gigId, clientId);
  } catch (error) {
    if (error instanceof AppError && error.code === "ALREADY_PAID") {
      const paidGig = await prisma.gig.findFirst({
        where: { id: gigId, clientId },
        include: { payment: true, serviceCategory: true }
      });
      if (!paidGig?.payment) throw error;

      return {
        alreadyPaid: true,
        payment: formatGigPaymentResponse(paidGig),
        checkoutUrl: null
      };
    }
    throw error;
  }

  try {
    const stripe = getStripe();

    // Reuse an open Checkout Session when the customer taps Pay repeatedly.
    if (gig.checkoutSessionId) {
      try {
        const existing = await stripe.checkout.sessions.retrieve(gig.checkoutSessionId);
        if (existing.status === "open" && existing.url) {
          logPayment("checkout_session_reused", { gigId, sessionId: existing.id, clientId });
          return {
            alreadyPaid: false,
            sessionId: existing.id,
            checkoutUrl: existing.url,
            payment: formatGigPaymentResponse(gig)
          };
        }
      } catch {
        // Fall through and create a new session.
      }
    }

    const customerId = await getOrCreateStripeCustomer(clientId);
    const apiBase = env.API_PUBLIC_URL ?? `http://localhost:${env.PORT}`;
    const amount = checkoutChargeAmountCents(gig);
    const timed = isTimeBasedPricing(gig.pricingType);
    const productDescription = timed
      ? `Authorization hold up to ${formatCentsLabel(amount)} for ${gig.serviceCategory.name}. Final charge is based on approved work time.`
      : `${gig.serviceCategory.name} gig — ${formatCentsLabel(amount)}`;

    const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer: customerId,
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: amount,
              product_data: {
                name: timed ? `${gig.title} (authorization)` : gig.title,
                description: productDescription
              }
            },
            quantity: 1
          }
        ],
        payment_intent_data: {
          ...(timed ? { capture_method: "manual" as const } : {}),
          setup_future_usage: "off_session",
          metadata: {
            gigId: gig.id,
            clientId,
            customerId: clientId,
            workerId: gig.assignedWorkerId ?? "",
            pricingType: gig.pricingType,
            platformFeeCents: String(gig.platformFeeCents),
            workerPayoutCents: String(gig.workerPayoutCents),
            totalCents: String(gig.totalCents),
            maximumAuthorizedAmountCents: String(amount),
            paymentMode: timed ? "TIME_BASED_AUTHORIZATION" : "FIXED_PAYMENT"
          }
        },
        metadata: {
          gigId: gig.id,
          clientId,
          customerId: clientId,
          workerId: gig.assignedWorkerId ?? "",
          pricingType: gig.pricingType,
          paymentMode: timed ? "TIME_BASED_AUTHORIZATION" : "FIXED_PAYMENT"
        },
        success_url: `${apiBase}/v1/payments/return/success?gigId=${gig.id}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${apiBase}/v1/payments/return/cancel?gigId=${gig.id}`
      });

    const paymentIntentId =
      typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;

    await syncGigPaymentState(gigId, PaymentLifecycle.PAYMENT_PENDING, {
      paymentIntentId,
      checkoutSessionId: session.id,
      paymentRecord: {
        paymentId: gig.payment!.id,
        stripePaymentIntentId: paymentIntentId,
        stripeCheckoutSessionId: session.id
      }
    });

    await prisma.payment.update({
      where: { id: gig.payment!.id },
      data: {
        amountCents: amount,
        maximumAuthorizedAmountCents: amount,
        authorizationStatus: timed ? "REQUIRES_PAYMENT_METHOD" : "NOT_STARTED"
      }
    });

    logPayment("checkout_session_created", {
      gigId,
      sessionId: session.id,
      amountCents: amount,
      pricingType: gig.pricingType,
      captureMethod: timed ? "manual" : "automatic",
      clientId
    });

    return {
      alreadyPaid: false,
      sessionId: session.id,
      checkoutUrl: session.url,
      payment: formatGigPaymentResponse({ ...gig, paymentIntentId, checkoutSessionId: session.id })
    };
  } catch (error) {
    throw toFriendlyPaymentStartError(error);
  }
}

export async function getPaymentStatusForGig(gigId: string, userId: string) {
  const gig = await prisma.gig.findFirst({
    where: {
      id: gigId,
      OR: [{ clientId: userId }, { assignments: { some: { workerId: userId } } }]
    },
    include: { payment: true }
  });

  if (!gig?.payment) {
    throw new AppError("NOT_FOUND", 404, "NOT_FOUND", { gig: "Gig not found" });
  }

  return formatPaymentStatusResponse({
    id: gig.payment.id,
    paymentStatus: gig.paymentStatus,
    amountCents: gig.totalCents,
    platformFeeCents: gig.platformFeeCents,
    workerPayoutCents: gig.workerPayoutCents,
    paymentIntentId: gig.paymentIntentId,
    checkoutSessionId: gig.checkoutSessionId,
    stripeTransferId: gig.payment.stripeTransferId,
    refundAmountCents: gig.payment.refundAmountCents,
    gigStatus: gig.status,
    pricingType: gig.pricingType,
    maximumAuthorizedAmountCents: gig.maximumAuthorizedAmountCents,
    authorizationBufferCents: gig.authorizationBufferCents
  });
}

export async function activateGigAfterPayment(gigId: string): Promise<void> {
  const gig = await prisma.gig.findUnique({
    where: { id: gigId },
    include: { serviceCategory: true, payment: true }
  });

  if (!gig?.payment) return;

  if (gig.status === GigStatus.WORKER_SELECTED && gig.assignedWorkerId) {
    await activateGigAfterWorkerPayment(gigId);
    return;
  }

  if (gig.status !== GigStatus.DRAFT) return;

  const ready = !isStripeConfigured() || isPaidLifecycle(gig.paymentStatus);
  if (!ready) return;

  await prisma.gig.update({
    where: { id: gigId },
    data: { status: GigStatus.SEARCHING_FOR_WORKER, paymentStatus: PaymentLifecycle.PAYMENT_CAPTURED }
  });

  await prisma.payment.update({
    where: { id: gig.payment.id },
    data: { status: PaymentStatus.CAPTURED }
  });

  logPayment("payment_captured", { gigId, paymentStatus: "payment_captured" });

  const io = getSocketServer();
  await broadcastGigOffer(io, {
    gigId: gig.id,
    title: gig.title,
    serviceCategoryId: gig.serviceCategoryId,
    serviceCategoryName: gig.serviceCategory.name,
    latitude: Number(gig.latitude),
    longitude: Number(gig.longitude),
    city: gig.city,
    region: gig.region,
    size: gig.size,
    totalCents: gig.totalCents,
    workerPayoutCents: gig.workerPayoutCents,
    startsAt: gig.startsAt.toISOString(),
    urgency: gig.urgency,
    estimatedHours: Number(gig.estimatedHours)
  });

  io.to(`user:${gig.clientId}`).emit("gig:payment_authorized", { gigId: gig.id });
}

export async function activateGigAfterWorkerPayment(gigId: string, io?: Server): Promise<void> {
  const gig = await prisma.gig.findUnique({
    where: { id: gigId },
    include: { serviceCategory: true, payment: true }
  });

  if (!gig?.payment || !gig.assignedWorkerId || gig.status !== GigStatus.WORKER_SELECTED) return;
  if (!isPaidLifecycle(gig.paymentStatus) && isStripeConfigured()) return;

  await prisma.$transaction(async (tx) => {
    await tx.gigAssignment.upsert({
      where: { gigId_workerId: { gigId, workerId: gig.assignedWorkerId! } },
      create: { gigId, workerId: gig.assignedWorkerId! },
      update: {}
    });

    await tx.gig.update({
      where: { id: gigId },
      data: {
        status: GigStatus.WORKER_ASSIGNED,
        authorizedAt: gig.authorizedAt ?? new Date()
      }
    });
  });

  const socket = io ?? getSocketServer();
  notifyUser(socket, gig.assignedWorkerId, {
    type: "PAYMENT_SECURED",
    title: "You have been selected for this gig.",
    body: `Payment received for "${gig.title}". You can start travel to the customer.`,
    gigId
  });
  notifyUser(socket, gig.clientId, {
    type: "PAYMENT_CAPTURED",
    title: "Booking confirmed",
    body: "Your payment was received. The worker is paid after the gig is completed.",
    gigId
  });
  socket.to(`user:${gig.clientId}`).to(`user:${gig.assignedWorkerId}`).emit("gig:payment_authorized", { gigId });
  socket.to(`user:${gig.assignedWorkerId}`).emit("worker_selected", {
    gigId,
    workerId: gig.assignedWorkerId,
    status: "SELECTED",
    paymentSecured: true
  });
  socket.to(`user:${gig.clientId}`).to(`user:${gig.assignedWorkerId}`).emit("gig:matched", { gigId });
  logPayment("worker_payment_captured", { gigId, workerId: gig.assignedWorkerId });
}

async function broadcastPostedGig(gigId: string): Promise<void> {
  const gig = await prisma.gig.findUnique({
    where: { id: gigId },
    include: { serviceCategory: true }
  });
  if (!gig) return;

  const io = getSocketServer();
  await broadcastGigOffer(io, {
    gigId: gig.id,
    title: gig.title,
    serviceCategoryId: gig.serviceCategoryId,
    serviceCategoryName: gig.serviceCategory.name,
    latitude: Number(gig.latitude),
    longitude: Number(gig.longitude),
    city: gig.city,
    region: gig.region,
    size: gig.size,
    totalCents: gig.totalCents,
    workerPayoutCents: gig.workerPayoutCents,
    startsAt: gig.startsAt.toISOString(),
    urgency: gig.urgency,
    estimatedHours: Number(gig.estimatedHours)
  });
}

export async function publishPostedGig(gigId: string): Promise<void> {
  await broadcastPostedGig(gigId);
}

export async function assertGigPaymentAuthorized(gigId: string): Promise<void> {
  if (!isStripeConfigured()) return;

  const gig = await prisma.gig.findUnique({
    where: { id: gigId },
    include: { payment: true }
  });
  if (!gig) {
    throw new AppError("PAYMENT_REQUIRED", 402, "PAYMENT_REQUIRED", { payment: "Gig not found" });
  }

  if (!isAuthorizedForWorkerAccept(gig.paymentStatus)) {
    throw new AppError("PAYMENT_REQUIRED", 402, "PAYMENT_REQUIRED", {
      payment: "Payment must be completed before the worker can begin."
    });
  }

  // Time-based authorizations expire — block Start Travel / Start Gig if hold is gone.
  if (
    isTimeBasedPricing(gig.pricingType) &&
    gig.paymentStatus === PaymentLifecycle.PAYMENT_AUTHORIZED &&
    gig.payment?.captureBefore &&
    gig.payment.captureBefore.getTime() < Date.now()
  ) {
    await prisma.payment.update({
      where: { id: gig.payment.id },
      data: { authorizationStatus: "EXPIRED" }
    });
    throw new AppError("AUTHORIZATION_EXPIRED", 402, "AUTHORIZATION_EXPIRED", {
      payment: "The card authorization expired. Ask the customer to reauthorize before continuing."
    });
  }
}

export async function handlePaymentIntentAuthorized(paymentIntent: Stripe.PaymentIntent): Promise<void> {
  const gigId = paymentIntent.metadata.gigId;
  if (!gigId) return;

  // Time-based manual capture hold.
  if (paymentIntent.status === "requires_capture") {
    await handlePaymentIntentRequiresCapture(paymentIntent);
    return;
  }

  if (paymentIntent.status !== "succeeded") {
    logPayment("payment_intent_ignored_status", { gigId, status: paymentIntent.status });
    return;
  }

  const gig = await prisma.gig.findUnique({ where: { id: gigId }, include: { payment: true } });
  if (!gig?.payment) return;

  if (isCapturedLifecycle(gig.paymentStatus)) {
    logPayment("payment_captured_skipped_duplicate", { gigId });
    return;
  }

  const chargeId =
    typeof paymentIntent.latest_charge === "string"
      ? paymentIntent.latest_charge
      : paymentIntent.latest_charge?.id ?? null;

  const now = new Date();
  await syncGigPaymentState(gigId, PaymentLifecycle.PAYMENT_CAPTURED, {
    paymentIntentId: paymentIntent.id,
    paymentRecord: {
      paymentId: gig.payment.id,
      stripePaymentIntentId: paymentIntent.id,
      stripeCheckoutSessionId: gig.checkoutSessionId
    }
  });

  await prisma.payment.update({
    where: { id: gig.payment.id },
    data: {
      stripeChargeId: chargeId ?? undefined,
      authorizationStatus: "CAPTURED",
      capturedAt: now,
      authorizedAt: gig.payment.authorizedAt ?? now
    }
  });

  await prisma.gig.update({
    where: { id: gigId },
    data: { authorizedAt: gig.authorizedAt ?? now }
  });

  await recordTransaction(gig.payment.id, TransactionType.CLIENT_CHARGE, paymentIntent.amount_received || gig.totalCents, {
    paymentIntentId: paymentIntent.id,
    state: "captured"
  });

  logPayment("payment_captured", { gigId, paymentIntentId: paymentIntent.id });
  await activateGigAfterPayment(gigId);
}

export async function handlePaymentIntentRequiresCapture(paymentIntent: Stripe.PaymentIntent): Promise<void> {
  const gigId = paymentIntent.metadata.gigId;
  if (!gigId) return;

  const gig = await prisma.gig.findUnique({ where: { id: gigId }, include: { payment: true } });
  if (!gig?.payment) return;

  if (isAuthorizedForWorkerAccept(gig.paymentStatus)) {
    logPayment("payment_authorized_skipped_duplicate", { gigId, status: gig.paymentStatus });
    return;
  }

  const now = new Date();
  const captureBefore = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000);

  await syncGigPaymentState(gigId, PaymentLifecycle.PAYMENT_AUTHORIZED, {
    paymentIntentId: paymentIntent.id,
    paymentRecord: {
      paymentId: gig.payment.id,
      stripePaymentIntentId: paymentIntent.id,
      stripeCheckoutSessionId: gig.checkoutSessionId
    }
  });

  await prisma.payment.update({
    where: { id: gig.payment.id },
    data: {
      authorizationStatus: "AUTHORIZED",
      authorizedAt: now,
      captureBefore,
      maximumAuthorizedAmountCents: paymentIntent.amount_capturable || paymentIntent.amount,
      amountCents: paymentIntent.amount_capturable || paymentIntent.amount
    }
  });

  await prisma.gig.update({
    where: { id: gigId },
    data: {
      authorizedAt: now,
      maximumAuthorizedAmountCents:
        gig.maximumAuthorizedAmountCents ?? (paymentIntent.amount_capturable || paymentIntent.amount)
    }
  });

  await recordTransaction(gig.payment.id, TransactionType.CLIENT_CHARGE, paymentIntent.amount_capturable || paymentIntent.amount, {
    paymentIntentId: paymentIntent.id,
    state: "authorized"
  });

  logPayment("payment_authorized", {
    gigId,
    paymentIntentId: paymentIntent.id,
    amountCapturable: paymentIntent.amount_capturable
  });
  await activateGigAfterPayment(gigId);
}

export async function handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent): Promise<void> {
  const gigId = paymentIntent.metadata.gigId;
  if (!gigId) return;

  const gig = await prisma.gig.findUnique({ where: { id: gigId }, include: { payment: true } });
  if (!gig?.payment) return;

  await syncGigPaymentState(gigId, PaymentLifecycle.PAYMENT_FAILED, {
    paymentRecord: { paymentId: gig.payment.id, stripePaymentIntentId: paymentIntent.id }
  });

  logPayment("payment_failed", { gigId, paymentIntentId: paymentIntent.id });
}

export async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const gigId = session.metadata?.gigId;
  if (!gigId) return;

  logPayment("webhook_received", { type: "checkout.session.completed", gigId, sessionId: session.id });

  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;

  // Manual-capture Checkout often reports payment_status "unpaid" until capture.
  const sessionLooksAuthorized =
    session.payment_status === "paid" ||
    (session.payment_status === "unpaid" && Boolean(paymentIntentId));

  if (!sessionLooksAuthorized) {
    logPayment("checkout_session_not_paid", { gigId, sessionId: session.id, paymentStatus: session.payment_status });
    return;
  }

  const gig = await prisma.gig.findUnique({ where: { id: gigId }, include: { payment: true } });
  if (!gig?.payment) return;

  if (isAuthorizedForWorkerAccept(gig.paymentStatus)) {
    logPayment("checkout_paid_skipped_duplicate", { gigId, sessionId: session.id });
    return;
  }

  await syncGigPaymentState(gigId, PaymentLifecycle.PAYMENT_PENDING, {
    checkoutSessionId: session.id,
    paymentIntentId: paymentIntentId ?? null,
    paymentRecord: {
      paymentId: gig.payment.id,
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: paymentIntentId ?? null
    }
  });

  if (paymentIntentId) {
    const stripe = getStripe();
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    await handlePaymentIntentAuthorized(paymentIntent);
    return;
  }

  // Session paid but PI not yet attached — mark captured from session metadata alone (fixed path).
  if (session.payment_status === "paid") {
    await syncGigPaymentState(gigId, PaymentLifecycle.PAYMENT_CAPTURED, {
      checkoutSessionId: session.id,
      paymentRecord: {
        paymentId: gig.payment.id,
        stripeCheckoutSessionId: session.id
      }
    });
    await prisma.gig.update({ where: { id: gigId }, data: { authorizedAt: new Date() } });
    await prisma.payment.update({
      where: { id: gig.payment.id },
      data: { authorizationStatus: "CAPTURED", capturedAt: new Date() }
    });
    await recordTransaction(gig.payment.id, TransactionType.CLIENT_CHARGE, gig.totalCents, {
      sessionId: session.id,
      state: "captured"
    });
    await activateGigAfterPayment(gigId);
  }
}

export async function handleCheckoutSessionExpired(session: Stripe.Checkout.Session): Promise<void> {
  const gigId = session.metadata?.gigId;
  if (!gigId) return;

  const gig = await prisma.gig.findUnique({ where: { id: gigId }, include: { payment: true } });
  if (!gig?.payment || isPaidLifecycle(gig.paymentStatus)) return;

  if (gig.checkoutSessionId === session.id) {
    await syncGigPaymentState(gigId, PaymentLifecycle.PAYMENT_PENDING, {
      checkoutSessionId: null,
      paymentRecord: {
        paymentId: gig.payment.id,
        stripeCheckoutSessionId: null
      }
    });
  }

  logPayment("checkout_session_expired", { gigId, sessionId: session.id });
}

export async function handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
  const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!paymentIntentId) return;

  const payment = await prisma.payment.findFirst({ where: { stripePaymentIntentId: paymentIntentId } });
  if (!payment) return;

  const refunded = charge.amount_refunded ?? 0;
  if (refunded <= 0) return;

  const status =
    refunded >= payment.amountCents ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED;

  if (payment.refundAmountCents >= refunded && (payment.status === PaymentStatus.REFUNDED || payment.status === PaymentStatus.PARTIALLY_REFUNDED)) {
    logPayment("refund_skipped_duplicate", { paymentId: payment.id, refunded });
    return;
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status,
      refundAmountCents: refunded,
      stripeChargeId: charge.id,
      stripeRefundId: typeof charge.refunds?.data?.[0]?.id === "string" ? charge.refunds.data[0].id : payment.stripeRefundId
    }
  });

  if (status === PaymentStatus.REFUNDED) {
    await prisma.gig.update({
      where: { id: payment.gigId },
      data: { paymentStatus: PaymentLifecycle.PAYMENT_FAILED }
    });
  }

  await recordTransaction(payment.id, TransactionType.REFUND, refunded, {
    chargeId: charge.id,
    state: status === PaymentStatus.REFUNDED ? "full" : "partial"
  });

  logPayment("charge_refunded", { paymentId: payment.id, refunded, status });
}

async function syncWorkerStripeFields(workerId: string, account: Stripe.Account) {
  await prisma.workerProfile.updateMany({
    where: { userId: workerId },
    data: {
      stripeAccountId: account.id,
      stripeOnboardingComplete: account.details_submitted ?? false,
      stripeChargesEnabled: account.charges_enabled ?? false,
      stripePayoutsEnabled: account.payouts_enabled ?? false
    }
  });
}

export async function handleAccountUpdated(account: Stripe.Account): Promise<void> {
  logPayment("webhook_received", { type: "account.updated", accountId: account.id });

  const workerId = account.metadata?.workerId;
  if (workerId) {
    await syncWorkerStripeFields(workerId, account);
    logPayment("account_updated", { workerId, accountId: account.id });
    return;
  }

  const profile = await prisma.workerProfile.findFirst({ where: { stripeAccountId: account.id } });
  if (!profile) return;

  await prisma.workerProfile.update({
    where: { id: profile.id },
    data: {
      stripeOnboardingComplete: account.details_submitted ?? false,
      stripeChargesEnabled: account.charges_enabled ?? false,
      stripePayoutsEnabled: account.payouts_enabled ?? false
    }
  });

  logPayment("account_updated", { workerId: profile.userId, accountId: account.id });
}

function mapConnectStatus(account: Stripe.Account | null, accountId: string | null = account?.id ?? null) {
  return {
    connected: Boolean(accountId),
    accountId,
    stripeAccountId: accountId,
    stripeOnboardingComplete: account?.details_submitted ?? false,
    stripeChargesEnabled: account?.charges_enabled ?? false,
    stripePayoutsEnabled: account?.payouts_enabled ?? false,
    detailsSubmitted: account?.details_submitted ?? false,
    payoutsEnabled: account?.payouts_enabled ?? false
  };
}

export async function createConnectAccount(workerId: string) {
  if (!isStripeConfigured()) {
    throw new AppError("STRIPE_NOT_CONFIGURED", 503, "STRIPE_NOT_CONFIGURED", {
      stripe: "Stripe is not configured"
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: workerId },
    include: { workerProfile: true }
  });

  if (!user?.roles.includes(UserRole.WORKER) || !user.workerProfile) {
    throw new AppError("NOT_FOUND", 404, "NOT_FOUND", { worker: "Worker profile not found" });
  }

  const stripe = getStripe();
  let accountId = user.workerProfile.stripeAccountId;

  if (!accountId) {
    const account = await stripe.accounts.create({
      type: "express",
      country: "US",
      email: user.email,
      capabilities: { transfers: { requested: true } },
      business_type: "individual",
      metadata: { workerId }
    });
    accountId = account.id;
    await syncWorkerStripeFields(workerId, account);
  }

  const account = await stripe.accounts.retrieve(accountId);
  await syncWorkerStripeFields(workerId, account);
  return mapConnectStatus(account);
}

export async function createConnectAccountLink(workerId: string) {
  const connect = await createConnectAccount(workerId);
  if (!connect.accountId) {
    throw new AppError("STRIPE_CONNECT_ERROR", 500, "STRIPE_CONNECT_ERROR", {
      stripe: "Failed to create Stripe Connect account"
    });
  }

  const stripe = getStripe();
  const apiBase = env.API_PUBLIC_URL ?? `http://localhost:${env.PORT}`;

  const link = await stripe.accountLinks.create({
    account: connect.accountId,
    refresh_url: `${apiBase}/v1/payments/connect/return/refresh`,
    return_url: `${env.MOBILE_PUBLIC_URL}/connect-return`,
    type: "account_onboarding"
  });

  logPayment("connect_onboarding_link_created", { workerId, accountId: connect.accountId });
  return { url: link.url, accountId: connect.accountId };
}

export async function getWorkerConnectStatus(workerId: string) {
  const profile = await prisma.workerProfile.findUnique({ where: { userId: workerId } });
  if (!profile) return mapConnectStatus(null, null);

  if (!profile.stripeAccountId || !isStripeConfigured()) {
    return {
      ...mapConnectStatus(null, profile.stripeAccountId),
      stripeOnboardingComplete: profile.stripeOnboardingComplete,
      stripeChargesEnabled: profile.stripeChargesEnabled,
      stripePayoutsEnabled: profile.stripePayoutsEnabled
    };
  }

  const stripe = getStripe();
  const account = await stripe.accounts.retrieve(profile.stripeAccountId);
  await syncWorkerStripeFields(workerId, account);
  return mapConnectStatus(account, profile.stripeAccountId);
}

export async function processWorkerPayout(gigId: string): Promise<void> {
  const { creditWorkerForCompletedGig } = await import("./worker-earnings.service.js");
  await creditWorkerForCompletedGig(gigId);
}

export async function releaseAuthorizedPayment(gigId: string): Promise<void> {
  const gig = await prisma.gig.findUnique({ where: { id: gigId }, include: { payment: true } });
  if (!gig?.payment) return;

  // Captured fixed (or captured timed) bookings need a refund.
  if (isCapturedLifecycle(gig.paymentStatus) && isStripeConfigured()) {
    await createAdminRefund(gig.payment.id, {
      amountCents: gig.payment.amountCents - gig.payment.refundAmountCents,
      reason: "cancelled_gig",
      notes: "Automatic refund on gig cancellation",
      adminId: "system"
    });
    return;
  }

  // Time-based authorization hold — cancel the PaymentIntent to release funds.
  if (gig.paymentStatus === PaymentLifecycle.PAYMENT_AUTHORIZED && gig.payment.stripePaymentIntentId) {
    if (isStripeConfigured()) {
      const stripe = getStripe();
      try {
        await stripe.paymentIntents.cancel(gig.payment.stripePaymentIntentId, undefined, {
          idempotencyKey: `cancel-auth-${gig.id}`
        });
      } catch {
        // ignore already-canceled intents
      }
    }

    await syncGigPaymentState(gigId, PaymentLifecycle.PAYMENT_FAILED, {
      paymentRecord: { paymentId: gig.payment.id }
    });
    await prisma.payment.update({
      where: { id: gig.payment.id },
      data: { authorizationStatus: "CANCELLED" }
    });
    return;
  }

  if (!gig.payment.stripePaymentIntentId) return;

  const stripe = getStripe();
  try {
    await stripe.paymentIntents.cancel(gig.payment.stripePaymentIntentId);
  } catch {
    // ignore
  }

  await syncGigPaymentState(gigId, PaymentLifecycle.PAYMENT_FAILED, {
    paymentRecord: { paymentId: gig.payment.id }
  });
}

export async function createAdminRefund(
  paymentId: string,
  input: { amountCents: number; reason?: string; notes?: string; adminId: string }
) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { gig: true }
  });

  if (!payment) {
    throw new AppError("NOT_FOUND", 404, "NOT_FOUND", { payment: "Payment not found" });
  }

  if (payment.gig.status === GigStatus.COMPLETED && input.adminId !== "system") {
    // Admins may still refund completed gigs explicitly; block accidental auto paths only via notes convention.
  }

  const alreadyRefunded = payment.refundAmountCents;
  const maxRefundable = payment.amountCents - alreadyRefunded;
  if (maxRefundable <= 0) {
    throw new AppError("Nothing left to refund", 409, "ALREADY_REFUNDED");
  }

  const amountCents = Math.min(input.amountCents, maxRefundable);
  if (amountCents <= 0) {
    throw new AppError("Refund amount must be greater than zero", 400, "INVALID_REFUND_AMOUNT");
  }

  if (!isStripeConfigured() || !payment.stripePaymentIntentId) {
    throw new AppError(
      "We couldn’t start the secure payment process. Please try again or contact Duts Support.",
      503,
      "STRIPE_NOT_CONFIGURED"
    );
  }

  const stripe = getStripe();
  const refund = await stripe.refunds.create(
    {
      payment_intent: payment.stripePaymentIntentId,
      amount: amountCents,
      metadata: {
        paymentId: payment.id,
        gigId: payment.gigId,
        adminId: input.adminId,
        reason: input.reason ?? "",
        notes: input.notes ?? ""
      }
    },
    { idempotencyKey: `refund-${payment.id}-${alreadyRefunded}-${amountCents}` }
  );

  const totalRefunded = alreadyRefunded + amountCents;
  const status =
    totalRefunded >= payment.amountCents ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED;

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status,
      refundAmountCents: totalRefunded,
      stripeRefundId: refund.id
    }
  });

  if (status === PaymentStatus.REFUNDED) {
    await prisma.gig.update({
      where: { id: payment.gigId },
      data: { paymentStatus: PaymentLifecycle.PAYMENT_FAILED }
    });
  }

  await recordTransaction(payment.id, TransactionType.REFUND, amountCents, {
    refundId: refund.id,
    adminId: input.adminId,
    reason: input.reason,
    notes: input.notes
  });

  logPayment("admin_refund_created", {
    paymentId: payment.id,
    gigId: payment.gigId,
    amountCents,
    adminId: input.adminId
  });

  return { refundId: refund.id, amountCents, status };
}

/** Transfer worker net earnings after gig completion (separate from customer Checkout). */
export async function releaseWorkerPayment(gigId: string): Promise<{
  transferred: boolean;
  transferId?: string;
  needsConnectOnboarding?: boolean;
}> {
  const gig = await prisma.gig.findUnique({
    where: { id: gigId },
    include: { payment: true, assignments: { orderBy: { acceptedAt: "desc" }, take: 1 } }
  });

  if (!gig?.payment) {
    throw new AppError("NOT_FOUND", 404, "NOT_FOUND", { gig: "Gig not found" });
  }

  if (gig.status !== GigStatus.COMPLETED) {
    throw new AppError("Gig must be completed before releasing worker payment", 409, "INVALID_GIG_STATE");
  }

  if (!isPaidLifecycle(gig.paymentStatus) && gig.payment.status !== PaymentStatus.CAPTURED && gig.payment.status !== PaymentStatus.PAYOUT_PENDING && gig.payment.status !== PaymentStatus.PAID_OUT) {
    throw new AppError("Customer payment is not settled", 409, "PAYMENT_NOT_CAPTURED");
  }

  if (gig.payment.stripeTransferId || gig.payment.status === PaymentStatus.PAID_OUT) {
    return { transferred: true, transferId: gig.payment.stripeTransferId ?? undefined };
  }

  const workerId = gig.assignments[0]?.workerId ?? gig.assignedWorkerId;
  if (!workerId || gig.workerPayoutCents <= 0) {
    throw new AppError("No worker payout due", 409, "NO_WORKER_PAYOUT");
  }

  const connect = await getWorkerConnectStatus(workerId);
  if (!connect.accountId || !connect.payoutsEnabled) {
    await prisma.payment.update({
      where: { id: gig.payment.id },
      data: { status: PaymentStatus.PAYOUT_PENDING }
    });
    await prisma.gig.update({
      where: { id: gigId },
      data: { paymentStatus: PaymentLifecycle.PAYOUT_PENDING }
    });
    return { transferred: false, needsConnectOnboarding: true };
  }

  if (!isStripeConfigured()) {
    await prisma.payment.update({
      where: { id: gig.payment.id },
      data: { status: PaymentStatus.PAID_OUT }
    });
    return { transferred: true };
  }

  const stripe = getStripe();
  const transfer = await stripe.transfers.create(
    {
      amount: gig.workerPayoutCents,
      currency: "usd",
      destination: connect.accountId,
      metadata: {
        gigId: gig.id,
        workerId,
        paymentId: gig.payment.id,
        platformFeeCents: String(gig.platformFeeCents)
      }
    },
    { idempotencyKey: `worker-transfer-${gig.id}` }
  );

  await prisma.payment.update({
    where: { id: gig.payment.id },
    data: {
      status: PaymentStatus.PAID_OUT,
      stripeTransferId: transfer.id
    }
  });
  await prisma.gig.update({
    where: { id: gigId },
    data: { paymentStatus: PaymentLifecycle.PAYOUT_PAID }
  });
  await recordTransaction(gig.payment.id, TransactionType.WORKER_PAYOUT, gig.workerPayoutCents, {
    transferId: transfer.id,
    workerId
  });

  logPayment("worker_transfer_created", { gigId, workerId, transferId: transfer.id });
  return { transferred: true, transferId: transfer.id };
}

export async function assertWorkerCanAcceptGigs(workerId: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: workerId } });
  const { assertWorkerCanAcceptGigs: assertAccess } = await import("../auth/access.service.js");
  assertAccess(user);
}

export async function assertGigIsPaid(gigId: string): Promise<void> {
  if (!isStripeConfigured()) return;

  const gig = await prisma.gig.findUnique({ where: { id: gigId } });
  if (!gig) {
    throw new AppError("PAYMENT_REQUIRED", 402, "PAYMENT_REQUIRED", { payment: "Gig not found" });
  }

  if (!isAuthorizedForWorkerAccept(gig.paymentStatus)) {
    throw new AppError("PAYMENT_REQUIRED", 402, "PAYMENT_REQUIRED", {
      payment: "Gig payment must be completed before workers can accept."
    });
  }
}

export async function publishGigDevWithoutPayment(gigId: string, clientId: string): Promise<void> {
  assertDevOnlyPaymentBypass("Publish without payment");
  if (isStripeConfigured()) {
    throw new AppError("STRIPE_REQUIRED", 400, "STRIPE_REQUIRED", {
      payment: "Use Stripe checkout when payments are enabled."
    });
  }

  const gig = await prisma.gig.findFirst({ where: { id: gigId, clientId }, include: { payment: true } });
  if (!gig?.payment) {
    throw new AppError("NOT_FOUND", 404, "NOT_FOUND", { gig: "Gig not found" });
  }

  await syncGigPaymentState(gigId, PaymentLifecycle.PAYMENT_CAPTURED, {
    paymentRecord: { paymentId: gig.payment.id }
  });

  logPayment("dev_publish_without_stripe", { gigId, clientId });
  await activateGigAfterPayment(gigId);
}

export type CustomerPaymentMethod = {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
};

export async function listCustomerPaymentMethods(userId: string): Promise<{
  methods: CustomerPaymentMethod[];
  stripeConfigured: boolean;
}> {
  if (!isStripeConfigured()) {
    return { methods: [], stripeConfigured: false };
  }

  const customerId = await getOrCreateStripeCustomer(userId);
  const stripe = getStripe();
  const [customer, listed] = await Promise.all([
    stripe.customers.retrieve(customerId),
    stripe.paymentMethods.list({ customer: customerId, type: "card" })
  ]);

  const defaultId =
    !customer.deleted && typeof customer.invoice_settings?.default_payment_method === "string"
      ? customer.invoice_settings.default_payment_method
      : null;

  return {
    stripeConfigured: true,
    methods: listed.data.map((method) => ({
      id: method.id,
      brand: method.card?.brand ?? "card",
      last4: method.card?.last4 ?? "••••",
      expMonth: method.card?.exp_month ?? 0,
      expYear: method.card?.exp_year ?? 0,
      isDefault: method.id === defaultId
    }))
  };
}

export async function detachCustomerPaymentMethod(userId: string, paymentMethodId: string) {
  if (!isStripeConfigured()) {
    throw new AppError("STRIPE_REQUIRED", 503, "STRIPE_REQUIRED", {
      payment: "Card management is unavailable until Stripe is configured."
    });
  }

  const customerId = await getOrCreateStripeCustomer(userId);
  const stripe = getStripe();
  const method = await stripe.paymentMethods.retrieve(paymentMethodId);
  if (method.customer !== customerId) {
    throw new AppError("FORBIDDEN", 403, "FORBIDDEN", { paymentMethod: "Card not found for this account." });
  }

  await stripe.paymentMethods.detach(paymentMethodId);
  return { ok: true as const };
}

export async function setDefaultCustomerPaymentMethod(userId: string, paymentMethodId: string) {
  if (!isStripeConfigured()) {
    throw new AppError("STRIPE_REQUIRED", 503, "STRIPE_REQUIRED", {
      payment: "Card management is unavailable until Stripe is configured."
    });
  }

  const customerId = await getOrCreateStripeCustomer(userId);
  const stripe = getStripe();
  const method = await stripe.paymentMethods.retrieve(paymentMethodId);
  if (method.customer !== customerId) {
    throw new AppError("FORBIDDEN", 403, "FORBIDDEN", { paymentMethod: "Card not found for this account." });
  }

  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId }
  });
  return { ok: true as const };
}

export async function createCustomerBillingPortalSession(userId: string) {
  if (!isStripeConfigured()) {
    throw new AppError("STRIPE_REQUIRED", 503, "STRIPE_REQUIRED", {
      payment: "Card management is unavailable until Stripe is configured."
    });
  }

  const customerId = await getOrCreateStripeCustomer(userId);
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${env.MOBILE_PUBLIC_URL}/`
  });

  return { url: session.url };
}
