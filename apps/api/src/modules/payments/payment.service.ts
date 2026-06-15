import { GigStatus, PaymentLifecycle, PaymentStatus, TransactionType, UserRole } from "@prisma/client";
import type Stripe from "stripe";
import { env } from "../../config/env.js";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import { getSocketServer } from "../../lib/socket.js";
import { getStripe, isStripeConfigured } from "../../lib/stripe.js";
import { broadcastGigOffer } from "../realtime/realtime.service.js";
import {
  formatPaymentStatusResponse,
  isAuthorizedForWorkerAccept,
  isPaidLifecycle,
  lifecycleToPaymentStatus
} from "./payment-status.js";

const AWAITING_PAYMENT_GIG_STATUSES: GigStatus[] = [GigStatus.DRAFT, GigStatus.POSTED];

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

export async function createCheckoutSession(gigId: string, clientId: string) {
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
      return {
        alreadyPaid: true,
        payment: formatPaymentStatusResponse({
          id: gig.payment.id,
          paymentStatus: gig.paymentStatus,
          amountCents: gig.totalCents,
          platformFeeCents: gig.platformFeeCents,
          workerPayoutCents: gig.workerPayoutCents,
          paymentIntentId: gig.paymentIntentId,
          checkoutSessionId: gig.checkoutSessionId,
          stripeTransferId: gig.payment.stripeTransferId,
          gigStatus: gig.status
        }),
        checkoutUrl: null
      };
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
  }

  const stripe = getStripe();
  const customerId = await getOrCreateStripeCustomer(clientId);
  const apiBase = env.API_PUBLIC_URL ?? `http://localhost:${env.PORT}`;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: gig.totalCents,
          product_data: {
            name: gig.title,
            description: `${gig.serviceCategory.name} gig — ${formatCentsLabel(gig.totalCents)}`
          }
        },
        quantity: 1
      }
    ],
    payment_intent_data: {
      capture_method: "manual",
      metadata: {
        gigId: gig.id,
        clientId,
        platformFeeCents: String(gig.platformFeeCents),
        workerPayoutCents: String(gig.workerPayoutCents),
        totalCents: String(gig.totalCents)
      }
    },
    metadata: { gigId: gig.id, clientId },
    success_url: `${apiBase}/v1/payments/return/success?gigId=${gig.id}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${apiBase}/v1/payments/return/cancel?gigId=${gig.id}`
  });

  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;

  await syncGigPaymentState(gigId, PaymentLifecycle.PAYMENT_PENDING, {
    paymentIntentId,
    checkoutSessionId: session.id,
    paymentRecord: {
      paymentId: gig.payment.id,
      stripePaymentIntentId: paymentIntentId,
      stripeCheckoutSessionId: session.id
    }
  });

  logPayment("checkout_session_created", { gigId, sessionId: session.id, amountCents: gig.totalCents, clientId });

  return {
    alreadyPaid: false,
    sessionId: session.id,
    checkoutUrl: session.url,
    payment: formatPaymentStatusResponse({
      id: gig.payment.id,
      paymentStatus: PaymentLifecycle.PAYMENT_PENDING,
      amountCents: gig.totalCents,
      platformFeeCents: gig.platformFeeCents,
      workerPayoutCents: gig.workerPayoutCents,
      paymentIntentId,
      checkoutSessionId: session.id,
      gigStatus: gig.status
    })
  };
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
    gigStatus: gig.status
  });
}

export async function activateGigAfterPayment(gigId: string): Promise<void> {
  const gig = await prisma.gig.findUnique({
    where: { id: gigId },
    include: { serviceCategory: true, payment: true }
  });

  if (!gig?.payment || gig.status !== GigStatus.DRAFT) return;

  const ready = !isStripeConfigured() || gig.paymentStatus === PaymentLifecycle.PAYMENT_AUTHORIZED;
  if (!ready) return;

  await prisma.gig.update({
    where: { id: gigId },
    data: { status: GigStatus.SEARCHING_FOR_WORKER, paymentStatus: PaymentLifecycle.PAYMENT_AUTHORIZED }
  });

  await prisma.payment.update({
    where: { id: gig.payment.id },
    data: { status: PaymentStatus.AUTHORIZED }
  });

  logPayment("payment_authorized", { gigId, paymentStatus: "payment_authorized" });

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

export async function handlePaymentIntentAuthorized(paymentIntent: Stripe.PaymentIntent): Promise<void> {
  const gigId = paymentIntent.metadata.gigId;
  if (!gigId) return;

  const gig = await prisma.gig.findUnique({ where: { id: gigId }, include: { payment: true } });
  if (!gig?.payment) return;

  if (gig.paymentStatus === PaymentLifecycle.PAYMENT_AUTHORIZED) {
    logPayment("payment_authorized_skipped_duplicate", { gigId });
    return;
  }

  await syncGigPaymentState(gigId, PaymentLifecycle.PAYMENT_AUTHORIZED, {
    paymentIntentId: paymentIntent.id,
    paymentRecord: {
      paymentId: gig.payment.id,
      stripePaymentIntentId: paymentIntent.id,
      stripeCheckoutSessionId: gig.checkoutSessionId
    }
  });

  await recordTransaction(gig.payment.id, TransactionType.CLIENT_CHARGE, gig.totalCents, {
    paymentIntentId: paymentIntent.id,
    state: "authorized"
  });

  logPayment("payment_authorized", { gigId, paymentIntentId: paymentIntent.id });
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

  const gig = await prisma.gig.findUnique({ where: { id: gigId }, include: { payment: true } });
  if (!gig?.payment) return;

  await syncGigPaymentState(gigId, gig.paymentStatus, {
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
    if (paymentIntent.status === "requires_capture" || paymentIntent.status === "succeeded") {
      await handlePaymentIntentAuthorized(paymentIntent);
    }
  }
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
  if (!gig?.payment?.stripePaymentIntentId || gig.paymentStatus !== PaymentLifecycle.PAYMENT_AUTHORIZED) return;

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

export async function assertWorkerCanAcceptGigs(_workerId: string): Promise<void> {
  // Stripe Connect is only required when withdrawing earnings, not when accepting gigs.
}

export async function assertGigIsPaid(gigId: string): Promise<void> {
  if (!isStripeConfigured()) return;

  const gig = await prisma.gig.findUnique({ where: { id: gigId } });
  if (!gig) {
    throw new AppError("PAYMENT_REQUIRED", 402, "PAYMENT_REQUIRED", { payment: "Gig not found" });
  }

  if (!isAuthorizedForWorkerAccept(gig.paymentStatus)) {
    throw new AppError("PAYMENT_REQUIRED", 402, "PAYMENT_REQUIRED", {
      payment: "Gig payment must be payment_authorized before workers can accept."
    });
  }
}

export async function publishGigDevWithoutPayment(gigId: string, clientId: string): Promise<void> {
  if (isStripeConfigured()) {
    throw new AppError("STRIPE_REQUIRED", 400, "STRIPE_REQUIRED", {
      payment: "Use Stripe checkout when payments are enabled."
    });
  }

  const gig = await prisma.gig.findFirst({ where: { id: gigId, clientId }, include: { payment: true } });
  if (!gig?.payment) {
    throw new AppError("NOT_FOUND", 404, "NOT_FOUND", { gig: "Gig not found" });
  }

  await syncGigPaymentState(gigId, PaymentLifecycle.PAYMENT_AUTHORIZED, {
    paymentRecord: { paymentId: gig.payment.id }
  });

  logPayment("dev_publish_without_stripe", { gigId, clientId });
  await activateGigAfterPayment(gigId);
}
