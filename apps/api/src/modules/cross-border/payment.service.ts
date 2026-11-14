import { randomUUID } from "node:crypto";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import { isEmailConfigured } from "../../lib/email.js";
import {
  CROSS_BORDER_CALLBACK_PATH,
  CROSS_BORDER_TERMS,
  CROSS_BORDER_TERMS_VERSION,
  type RequestStatus,
  assertTransition,
  canTransition,
  crossBorderMerchantReference,
  decidePaymentOutcome
} from "./domain.js";
import { hashToken, newPublicToken } from "./request.service.js";
import { crossBorderEnabled, crossBorderPaymentLinksEnabled, crossBorderPaymentsEnabled } from "./flag.js";
import { duplicateFundsAction, paymentLinkBlockReason, planPaymentInitiation, type PaymentAttemptSnap, type QuotePayStatus } from "./payment-policy.js";
import { validateZimbabweMobileForEcoCash } from "../commerce/payments/zw-phone.js";
import { ZbCommercePaymentProvider } from "../commerce/payments/zb.provider.js";
import { ZB_USD_CURRENCY_CODE, assertDutsUsdCurrency, zbAmountFromCents } from "../commerce/payments/zb.config.js";
import { pickZbString, zbPostJson } from "../commerce/payments/zb.transport.js";

export function crossBorderCallbackUrl(): string {
  const base = String(process.env.API_PUBLIC_URL ?? "").trim().replace(/\/$/, "");
  if (!base) throw new AppError("Payment confirmation is not configured.", 503, "ZB_RESULT_URL_MISSING");
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    throw new AppError("API_PUBLIC_URL is not a valid URL.", 500, "ZB_RESULT_URL_INVALID");
  }
  const localHost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1" || parsed.hostname === "0.0.0.0";
  if (process.env.NODE_ENV === "production" && (parsed.protocol !== "https:" || localHost)) {
    throw new AppError(
      parsed.protocol === "https:" ? "API_PUBLIC_URL must be the public API origin." : "API_PUBLIC_URL must be https in production.",
      500,
      parsed.protocol === "https:" ? "ZB_RESULT_URL_INVALID" : "ZB_RESULT_URL_INSECURE"
    );
  }
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  if (databaseUrl) {
    try {
      const database = new URL(databaseUrl);
      const sameHost = database.hostname === parsed.hostname;
      const samePort = (database.port || "5432") === (parsed.port || (parsed.protocol === "https:" ? "443" : "80"));
      if (sameHost && samePort) {
        throw new AppError("API_PUBLIC_URL must be the public API origin.", 500, "ZB_RESULT_URL_INVALID");
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
    }
  }
  return `${parsed.origin}${CROSS_BORDER_CALLBACK_PATH}`;
}

function appBase(): string {
  return String(process.env.MOBILE_PUBLIC_URL ?? process.env.PUBLIC_APP_URL ?? "https://app.duts.tech").replace(/\/$/, "");
}

export function paymentLinkForToken(token: string): string {
  return `${appBase()}/pay/${token}`;
}

export async function publicPaymentView(token: string) {
  const row = await prisma.crossBorderPaymentToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { quote: { include: { lines: true } }, request: true }
  });
  if (!row) throw new AppError("This payment link is not valid.", 404, "PAYMENT_TOKEN_INVALID");
  const expired = row.expiresAt.getTime() <= Date.now() || row.quote.expiresAt.getTime() <= Date.now() || row.quote.status === "EXPIRED";
  const payable = !expired && (row.quote.status === "APPROVED" || row.quote.status === "SENT" || row.quote.status === "ACCEPTED");
  return {
    reference: row.request.reference,
    currency: row.quote.currency,
    totalCents: row.quote.totalCents,
    expiresAt: row.quote.expiresAt,
    quoteVersion: row.quote.version,
    quoteStatus: expired && row.quote.status !== "SUPERSEDED" ? "EXPIRED" : row.quote.status,
    payable,
    lines: row.quote.lines.map((line) => ({
      productName: line.productName,
      retailer: line.retailer,
      quantity: line.quantity,
      size: line.size,
      color: line.color,
      variantDetails: line.variantDetails,
      lineTotalCents: line.lineTotalCents
    })),
    charges: {
      merchandiseSubtotalCents: row.quote.merchandiseSubtotalCents,
      saShippingCents: row.quote.saShippingCents,
      crossBorderFreightCents: row.quote.crossBorderFreightCents,
      customsCents: row.quote.customsCents,
      customsIsEstimate: row.quote.customsIsEstimate,
      serviceFeeCents: row.quote.serviceFeeCents,
      zimbabweDeliveryCents: row.quote.zimbabweDeliveryCents,
      additionalCents: row.quote.additionalCents,
      additionalLabel: row.quote.additionalLabel
    },
    methods: { ecocash: payable && crossBorderPaymentsEnabled(), card: false },
    paymentsEnabled: crossBorderPaymentsEnabled(),
    paymentNotice: crossBorderPaymentsEnabled() ? null : "Payment is not yet available.",
    cardUnavailableReason: crossBorderPaymentsEnabled()
      ? "Card payments are not available until ZB confirms an official hosted checkout."
      : null,
    terms: CROSS_BORDER_TERMS,
    termsVersion: CROSS_BORDER_TERMS_VERSION,
    emailConfigured: isEmailConfigured()
  };
}

export async function generateCrossBorderPaymentLink(quoteId: string, actorId: string) {
  if (!crossBorderEnabled()) throw new AppError("South African shopping is not available yet.", 404, "CROSS_BORDER_DISABLED");
  const block = paymentLinkBlockReason({
    linksEnabled: crossBorderPaymentLinksEnabled(),
    quoteStatus: "APPROVED",
    expiresAt: new Date(Date.now() + 60_000),
    now: new Date()
  });
  if (block === "LINKS_DISABLED") {
    throw new AppError("Payment links are not available yet.", 403, "LINKS_DISABLED");
  }
  const quote = await prisma.crossBorderQuote.findUnique({ where: { id: quoteId }, include: { request: true } });
  if (!quote) throw new AppError("Quotation not found.", 404, "QUOTE_NOT_FOUND");
  const reason = paymentLinkBlockReason({
    linksEnabled: true,
    quoteStatus: quote.status as QuotePayStatus,
    expiresAt: quote.expiresAt,
    now: new Date()
  });
  if (reason) throw new AppError("This quotation cannot have a payment link.", 409, reason);
  const token = newPublicToken();
  await prisma.crossBorderPaymentToken.create({
    data: { requestId: quote.requestId, quoteId: quote.id, tokenHash: hashToken(token), expiresAt: quote.expiresAt }
  });
  await prisma.crossBorderAuditEvent.create({
    data: {
      requestId: quote.requestId,
      actorId,
      action: "payment_link_generated",
      payload: { quoteId: quote.id, quoteVersion: quote.version, amountCents: quote.totalCents, currency: quote.currency }
    }
  });
  if (quote.request.status === "QUOTED") {
    await prisma.crossBorderRequest.update({ where: { id: quote.requestId }, data: { status: "AWAITING_PAYMENT" } });
  }
  return {
    paymentLink: paymentLinkForToken(token),
    reference: quote.request.reference,
    quoteVersion: quote.version,
    amountCents: quote.totalCents,
    currency: quote.currency,
    expiresAt: quote.expiresAt
  };
}

export async function acceptAndPayEcoCash(input: { token: string; payerPhone: string; accept: boolean }) {
  if (!crossBorderPaymentsEnabled()) throw new AppError("Payment is not yet available.", 403, "PAYMENTS_DISABLED");
  if (input.accept !== true) throw new AppError("Accept the quotation before payment.", 409, "QUOTE_NOT_ACCEPTED");
  const phone = validateZimbabweMobileForEcoCash(input.payerPhone);
  if (!phone.ok) throw new AppError(phone.reason, 400, "INVALID_PAYER_PHONE");
  const view = await prisma.crossBorderPaymentToken.findUnique({
    where: { tokenHash: hashToken(input.token) },
    include: { quote: true, request: true }
  });
  if (!view) throw new AppError("This payment link is not valid.", 404, "PAYMENT_TOKEN_INVALID");
  if (view.quote.status === "SUPERSEDED") throw new AppError("This quotation was replaced. Use the latest link.", 409, "QUOTE_SUPERSEDED");
  if (view.expiresAt.getTime() <= Date.now() || view.quote.expiresAt.getTime() <= Date.now()) {
    throw new AppError("This quotation has expired.", 409, "QUOTE_EXPIRED");
  }
  if (view.quote.status !== "APPROVED" && view.quote.status !== "SENT" && view.quote.status !== "ACCEPTED") {
    throw new AppError("This quotation cannot be paid.", 409, "QUOTE_NOT_PAYABLE");
  }
  assertDutsUsdCurrency(view.quote.currency.toLowerCase());
  const existingPaid = await prisma.crossBorderPayment.findFirst({
    where: { requestId: view.requestId, status: "PAID" }
  });
  if (existingPaid) throw new AppError("This request is already paid.", 409, "ALREADY_PAID");

  const attempts = await prisma.crossBorderPayment.findMany({ where: { requestId: view.requestId } });
  for (const attempt of attempts) {
    if (!attempt.merchantReference) continue;
    if (attempt.status === "PAID" || attempt.status === "EXCEPTION") continue;
    try {
      const recovered = await applyCrossBorderProviderResult(attempt.merchantReference);
      if (recovered.reason === "PAID" || recovered.reason === "DUPLICATE" || recovered.reason === "DUPLICATE_FUNDS") {
        return { paymentId: attempt.id, merchantReference: attempt.merchantReference, status: "PAID" as const, duplicate: true };
      }
    } catch (error) {
      if (error instanceof AppError && error.code === "ZB_NETWORK_ERROR") {
        throw new AppError("The earlier payment could not be checked. No second charge was sent.", 503, "PAYMENT_RECONCILE_UNAVAILABLE");
      }
      throw error;
    }
  }
  const fresh = await prisma.crossBorderPayment.findMany({ where: { requestId: view.requestId } });
  const plan = planPaymentInitiation({
    paymentsEnabled: true,
    quoteStatus: view.quote.status as QuotePayStatus,
    expiresAt: view.quote.expiresAt,
    now: new Date(),
    attempts: fresh.map(attemptSnap)
  });
  if (plan.action === "BLOCK") throw new AppError("This quotation cannot be paid.", 409, plan.code);
  if (plan.action === "ALREADY_PAID") {
    return { paymentId: plan.attemptId, merchantReference: fresh.find((row) => row.id === plan.attemptId)?.merchantReference ?? "", status: "PAID" as const, duplicate: true };
  }
  if (plan.action === "AWAIT_PENDING") {
    return { paymentId: plan.attemptId, merchantReference: plan.merchantReference, status: "PENDING" as const, duplicate: true };
  }

  const paymentId = randomUUID();
  const merchantReference = crossBorderMerchantReference(view.request.reference, paymentId);
  const idempotencyKey = `cbx:${view.quoteId}:${view.quote.version}:${paymentId}`;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "CrossBorderRequest" WHERE id = ${view.requestId} FOR UPDATE`;
      const locked = await tx.crossBorderPayment.findMany({ where: { requestId: view.requestId } });
      const lockedPlan = planPaymentInitiation({
        paymentsEnabled: true,
        quoteStatus: view.quote.status as QuotePayStatus,
        expiresAt: view.quote.expiresAt,
        now: new Date(),
        attempts: locked.map(attemptSnap)
      });
      if (lockedPlan.action !== "CREATE") throw new AppError("A payment is already in progress.", 409, "PAYMENT_ALREADY_PENDING");
      if (view.quote.status === "SENT" || view.quote.status === "APPROVED") {
        await tx.crossBorderQuote.update({ where: { id: view.quoteId }, data: { status: "ACCEPTED", acceptedAt: new Date() } });
      }
      const from = view.request.status as RequestStatus;
      if (canTransition(from, "PAYMENT_PENDING")) {
        assertTransition(from, "PAYMENT_PENDING");
        await tx.crossBorderRequest.update({ where: { id: view.requestId }, data: { status: "PAYMENT_PENDING" } });
      }
      await tx.crossBorderPayment.create({
        data: {
          id: paymentId,
          requestId: view.requestId,
          quoteId: view.quoteId,
          quoteVersion: view.quote.version,
          provider: "zb",
          merchantReference,
          paymentMethod: "ECOCASH",
          currency: "USD",
          amountCents: view.quote.totalCents,
          status: "PENDING",
          idempotencyKey,
          payerPhone: phone.e164
        }
      });
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    const pending = await prisma.crossBorderPayment.findFirst({
      where: { requestId: view.requestId, status: { in: ["PENDING", "CREATED"] } }
    });
    if (pending) {
      return { paymentId: pending.id, merchantReference: pending.merchantReference, status: pending.status, duplicate: true };
    }
    throw error;
  }

  try {
    const json = await zbPostJson("/payments/express-checkout/ecocash", {
      orderReference: merchantReference,
      amount: zbAmountFromCents(view.quote.totalCents),
      currencyCode: ZB_USD_CURRENCY_CODE,
      itemName: `DUTS ${view.request.reference}`,
      itemDescription: `DUTS South Africa shopping ${view.request.reference}`,
      resultUrl: crossBorderCallbackUrl(),
      returnUrl: crossBorderCallbackUrl().replace("/callback", "/return"),
      ecocashMobile: phone.displayLocal
    });
    const providerReference = pickZbString(json, ["reference", "transactionReference"]) ?? merchantReference;
    await prisma.crossBorderPayment.update({
      where: { id: paymentId },
      data: { providerReference }
    });
    return { paymentId, merchantReference, status: "PENDING" as const, duplicate: false };
  } catch (error) {
    await prisma.crossBorderPayment.update({
      where: { id: paymentId },
      data: { status: "FAILED", failureReason: "provider_unavailable" }
    });
    const current = await prisma.crossBorderRequest.findUnique({ where: { id: view.requestId } });
    if (current && canTransition(current.status as RequestStatus, "AWAITING_PAYMENT")) {
      await prisma.crossBorderRequest.update({ where: { id: view.requestId }, data: { status: "AWAITING_PAYMENT" } });
    }
    if (error instanceof AppError) throw error;
    throw new AppError("EcoCash could not be started. No purchase was made.", 502, "ZB_REQUEST_FAILED");
  }
}

export async function applyCrossBorderProviderResult(merchantReference: string) {
  const payment = await prisma.crossBorderPayment.findUnique({
    where: { merchantReference },
    include: { quote: true, request: true }
  });
  if (!payment || !merchantReference.startsWith("CBX-")) return { applied: false, reason: "not_cross_border" };
  const provider = new ZbCommercePaymentProvider();
  const verified = await provider.getPaymentStatusByOrderReference(merchantReference);
  if (!verified) return { applied: false, reason: "unverified" };
  const decision = decidePaymentOutcome({
    paymentStatus: payment.status,
    paymentAmountCents: payment.amountCents,
    paymentCurrency: payment.currency,
    paymentQuoteVersion: payment.quoteVersion,
    paymentCreatedAt: payment.createdAt,
    providerStatus: verified.status === "PAID" || verified.status === "FAILED" || verified.status === "CANCELLED" || verified.status === "EXPIRED" ? verified.status : "PENDING",
    providerAmountCents: verified.amountCents ?? null,
    providerCurrencyUsd: verified.failureReason !== "currency_not_usd",
    quoteStatus: payment.quote.status,
    quoteVersion: payment.quote.version,
    quoteTotalCents: payment.quote.totalCents,
    quoteCurrency: payment.quote.currency,
    quoteExpiresAt: payment.quote.expiresAt,
    now: new Date()
  });
  if (decision.action === "DUPLICATE" || decision.action === "PENDING") return { applied: decision.action === "DUPLICATE", reason: decision.action };
  if (decision.action === "EXCEPTION") {
    await prisma.$transaction(async (tx) => {
      await tx.crossBorderPayment.update({
        where: { id: payment.id },
        data: { status: "EXCEPTION", failureReason: decision.reason }
      });
      const from = payment.request.status as RequestStatus;
      if (canTransition(from, "REFUND_PENDING")) {
        await tx.crossBorderRequest.update({ where: { id: payment.requestId }, data: { status: "REFUND_PENDING" } });
      }
      await tx.crossBorderAuditEvent.create({
        data: { requestId: payment.requestId, action: "payment_exception", payload: { reason: decision.reason, merchantReference } }
      });
    });
    return { applied: false, reason: decision.reason };
  }
  if (decision.action === "FAILED") {
    await prisma.$transaction(async (tx) => {
      await tx.crossBorderPayment.update({
        where: { id: payment.id },
        data: { status: decision.paymentStatus, failureReason: decision.paymentStatus.toLowerCase() }
      });
      const from = payment.request.status as RequestStatus;
      if (canTransition(from, decision.requestStatus)) {
        await tx.crossBorderRequest.update({ where: { id: payment.requestId }, data: { status: decision.requestStatus } });
      }
    });
    return { applied: true, reason: decision.paymentStatus };
  }
  const funds = duplicateFundsAction({
    providerPaid: true,
    anotherAttemptPaid: Boolean(await prisma.crossBorderPayment.findFirst({
      where: { requestId: payment.requestId, status: "PAID", id: { not: payment.id } }
    })),
    thisAttemptPaid: payment.status === "PAID"
  });
  if (funds === "ALREADY_RECORDED") return { applied: true, reason: "DUPLICATE" };
  if (funds === "RECORD_DUPLICATE") {
    await prisma.$transaction(async (tx) => {
      await tx.crossBorderPayment.update({
        where: { id: payment.id },
        data: { status: "EXCEPTION", failureReason: "duplicate_funds", providerReference: verified.providerPaymentId }
      });
      await tx.crossBorderAuditEvent.create({
        data: {
          requestId: payment.requestId,
          action: "duplicate_funds_received",
          payload: { merchantReference, amountCents: payment.amountCents, currency: payment.currency, quoteVersion: payment.quoteVersion }
        }
      });
    });
    return { applied: true, reason: "DUPLICATE_FUNDS" };
  }
  try {
  await prisma.$transaction(async (tx) => {
    const winner = await tx.crossBorderPayment.findFirst({
      where: { requestId: payment.requestId, status: "PAID", id: { not: payment.id } }
    });
    if (winner) throw new Error("DUPLICATE_FUNDS");
    await tx.crossBorderPayment.update({
      where: { id: payment.id },
      data: { status: "PAID", paidAt: new Date(), providerReference: verified.providerPaymentId }
    });
    const from = (await tx.crossBorderRequest.findUnique({ where: { id: payment.requestId } }))?.status as RequestStatus;
    if (canTransition(from, "PAID")) {
      assertTransition(from, "PAID");
      await tx.crossBorderRequest.update({ where: { id: payment.requestId }, data: { status: "PAID" } });
    }
    const paid = (await tx.crossBorderRequest.findUnique({ where: { id: payment.requestId } }))?.status as RequestStatus;
    if (canTransition(paid, "READY_TO_PURCHASE")) {
      await tx.crossBorderRequest.update({ where: { id: payment.requestId }, data: { status: "READY_TO_PURCHASE" } });
    }
    await tx.crossBorderAuditEvent.create({
      data: {
        requestId: payment.requestId,
        action: "payment_verified",
        payload: { merchantReference, amountCents: payment.amountCents, currency: "USD", quoteVersion: payment.quoteVersion }
      }
    });
  });
  } catch (error) {
    const duplicate = error instanceof Error && error.message === "DUPLICATE_FUNDS";
    const unique = typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
    if (!duplicate && !unique) throw error;
    await prisma.crossBorderPayment.update({
      where: { id: payment.id },
      data: { status: "EXCEPTION", failureReason: "duplicate_funds", providerReference: verified.providerPaymentId }
    });
    await prisma.crossBorderAuditEvent.create({
      data: {
        requestId: payment.requestId,
        action: "duplicate_funds_received",
        payload: { merchantReference, amountCents: payment.amountCents, currency: payment.currency, quoteVersion: payment.quoteVersion }
      }
    });
    return { applied: true, reason: "DUPLICATE_FUNDS" };
  }
  return { applied: true, reason: "PAID" };
}

export async function reconcileCrossBorderPayment(paymentId: string) {
  const payment = await prisma.crossBorderPayment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new AppError("Payment not found.", 404, "PAYMENT_NOT_FOUND");
  if (!payment.merchantReference.startsWith("CBX-")) {
    throw new AppError("This payment cannot be checked.", 409, "NOT_CROSS_BORDER_PAYMENT");
  }
  return applyCrossBorderProviderResult(payment.merchantReference);
}

function attemptSnap(attempt: { id: string; status: string; quoteId: string; quoteVersion: number; merchantReference: string }): PaymentAttemptSnap {
  return {
    id: attempt.id,
    status: attempt.status as PaymentAttemptSnap["status"],
    quoteId: attempt.quoteId,
    quoteVersion: attempt.quoteVersion,
    merchantReference: attempt.merchantReference
  };
}

export function parseCrossBorderCallback(body: unknown): string | null {
  const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const reference = payload && typeof payload.orderReference === "string" ? payload.orderReference : "";
  return reference.startsWith("CBX-") ? reference : null;
}
