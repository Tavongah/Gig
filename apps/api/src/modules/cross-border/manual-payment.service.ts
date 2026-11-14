import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import { type RequestStatus, assertTransition, canTransition } from "./domain.js";
import { crossBorderEnabled, crossBorderManualPaymentsEnabled } from "./flag.js";

const MANUAL_METHOD = "MANUAL_ZB_PORTAL";
const PAYABLE_QUOTES = new Set(["APPROVED", "SENT", "ACCEPTED"]);
const UNLOCK_PATH: RequestStatus[] = ["AWAITING_PAYMENT", "PAYMENT_PENDING", "PAID", "READY_TO_PURCHASE"];

export type ManualPaymentInput = {
  requestId: string;
  quoteId: string;
  actorId: string;
  transactionReference: string;
  orderReference?: string | null;
  amountCents: number;
  currency: string;
  confirmedAt: string;
  attested: boolean;
};

function cleanReference(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function unlockAfterVerifiedPayment(tx: Prisma.TransactionClient, requestId: string): Promise<RequestStatus> {
  let current = (await tx.crossBorderRequest.findUnique({ where: { id: requestId } }))?.status as RequestStatus;
  for (const next of UNLOCK_PATH) {
    if (current === "READY_TO_PURCHASE") return current;
    if (current === next) continue;
    if (!canTransition(current, next)) break;
    assertTransition(current, next);
    await tx.crossBorderRequest.update({ where: { id: requestId }, data: { status: next } });
    current = next;
  }
  if (current !== "READY_TO_PURCHASE") {
    throw new AppError("Payment was recorded, but procurement could not be unlocked.", 409, "PROCUREMENT_NOT_UNLOCKED");
  }
  return current;
}

export async function confirmManualCrossBorderPayment(input: ManualPaymentInput) {
  if (!crossBorderEnabled()) throw new AppError("South African shopping is not available yet.", 404, "CROSS_BORDER_DISABLED");
  if (!crossBorderManualPaymentsEnabled()) {
    throw new AppError("Manual payment confirmation is not available yet.", 403, "MANUAL_PAYMENTS_DISABLED");
  }
  if (input.attested !== true) {
    throw new AppError("Confirm that you verified this payment in the ZB Smile&Pay merchant portal.", 400, "PORTAL_ATTESTATION_REQUIRED");
  }
  const transactionReference = cleanReference(input.transactionReference ?? "");
  if (!transactionReference || transactionReference.length > 120) {
    throw new AppError("Enter the ZB payment transaction reference.", 400, "REFERENCE_REQUIRED");
  }
  const orderReference = input.orderReference ? cleanReference(input.orderReference) : "";
  if (orderReference.length > 120) throw new AppError("The ZB order reference is too long.", 400, "ORDER_REFERENCE_INVALID");
  if (!Number.isInteger(input.amountCents) || input.amountCents < 1) {
    throw new AppError("Enter the confirmed amount in cents.", 400, "AMOUNT_MISMATCH");
  }
  const portalConfirmedAt = new Date(input.confirmedAt);
  if (Number.isNaN(portalConfirmedAt.getTime()) || portalConfirmedAt.getTime() > Date.now() + 5 * 60_000) {
    throw new AppError("Enter the payment confirmation time from the ZB portal.", 400, "CONFIRMATION_TIME_INVALID");
  }

  type Outcome =
    | { kind: "paid"; paymentId: string; duplicate: boolean; requestStatus: string; confirmationMethod: string | null }
    | { kind: "reject"; statusCode: number; code: string; message: string };

  let outcome: Outcome;
  try {
    outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
      await tx.$queryRaw`SELECT id FROM "CrossBorderRequest" WHERE id = ${input.requestId} FOR UPDATE`;
      const request = await tx.crossBorderRequest.findUnique({
        where: { id: input.requestId },
        include: { quotes: true, payments: true }
      });
      if (!request) throw new AppError("Shopping request not found.", 404, "REQUEST_NOT_FOUND");
      if (request.status === "CANCELLED") throw new AppError("This request was cancelled.", 409, "REQUEST_CANCELLED");
      const quote = request.quotes.find((item) => item.id === input.quoteId);
      if (!quote) throw new AppError("Quotation not found.", 404, "QUOTE_NOT_FOUND");
      const currentVersion = request.quotes.reduce((max, item) => Math.max(max, item.version), 0);
      if (quote.version !== currentVersion || quote.status === "SUPERSEDED") {
        throw new AppError("Confirm payment against the current quotation.", 409, "QUOTE_SUPERSEDED");
      }
      if (quote.status === "DRAFT") {
        throw new AppError("Approve the quotation before confirming payment.", 409, "QUOTE_NOT_APPROVED");
      }
      if (quote.status === "EXPIRED" || (PAYABLE_QUOTES.has(quote.status) && quote.expiresAt.getTime() <= Date.now())) {
        await tx.crossBorderAuditEvent.create({
          data: {
            requestId: request.id,
            actorId: input.actorId,
            action: "manual_payment_reported_expired",
            payload: {
              quoteId: quote.id,
              quoteVersion: quote.version,
              transactionReference,
              orderReference: orderReference || null,
              amountCents: input.amountCents,
              currency: input.currency,
              confirmationMethod: MANUAL_METHOD
            }
          }
        });
        return {
          kind: "reject",
          statusCode: 409,
          code: "QUOTE_EXPIRED",
          message: "This quotation has expired. Review it and approve a current quotation before confirming payment."
        };
      }
      if (!PAYABLE_QUOTES.has(quote.status)) {
        throw new AppError("Approve the quotation before confirming payment.", 409, "QUOTE_NOT_APPROVED");
      }
      if (input.amountCents !== quote.totalCents) {
        throw new AppError("The confirmed amount must match the quotation exactly.", 409, "AMOUNT_MISMATCH");
      }
      if (input.currency !== quote.currency) {
        throw new AppError("The confirmed currency must match the quotation exactly.", 409, "CURRENCY_MISMATCH");
      }

      const paidHere = request.payments.find((payment) => payment.status === "PAID");
      if (paidHere) {
        const sameReference = paidHere.providerReference === transactionReference;
        const sameAmount = paidHere.amountCents === input.amountCents && paidHere.currency === input.currency;
        if (sameReference && sameAmount && paidHere.quoteId === quote.id) {
          return { kind: "paid", paymentId: paidHere.id, duplicate: true, requestStatus: request.status, confirmationMethod: paidHere.confirmationMethod };
        }
        await tx.crossBorderPayment.create({
          data: {
            requestId: request.id,
            quoteId: quote.id,
            quoteVersion: quote.version,
            provider: MANUAL_METHOD,
            providerReference: transactionReference,
            externalOrderReference: orderReference || null,
            merchantReference: `MANUAL-REVIEW-${randomUUID()}`,
            paymentMethod: MANUAL_METHOD,
            confirmationMethod: MANUAL_METHOD,
            currency: input.currency,
            amountCents: input.amountCents,
            status: "EXCEPTION",
            idempotencyKey: `manual-conflict:${randomUUID()}`,
            failureReason: "duplicate_payment",
            confirmedById: input.actorId,
            portalConfirmedAt
          }
        });
        await tx.crossBorderAuditEvent.create({
          data: {
            requestId: request.id,
            actorId: input.actorId,
            action: "manual_payment_conflict",
            payload: { transactionReference, existingPaymentId: paidHere.id, reason: "duplicate_payment" }
          }
        });
        return {
          kind: "reject",
          statusCode: 409,
          code: "DUPLICATE_PAYMENT",
          message: "This request already has a confirmed payment. The extra receipt was kept for review."
        };
      }

      const paidElsewhere = await tx.crossBorderPayment.findFirst({
        where: {
          status: "PAID",
          requestId: { not: request.id },
          OR: [
            { providerReference: transactionReference },
            ...(orderReference ? [{ externalOrderReference: orderReference }, { providerReference: orderReference }] : [])
          ]
        }
      });
      if (paidElsewhere) {
        await tx.crossBorderPayment.create({
          data: {
            requestId: request.id,
            quoteId: quote.id,
            quoteVersion: quote.version,
            provider: MANUAL_METHOD,
            providerReference: transactionReference,
            externalOrderReference: orderReference || null,
            merchantReference: `MANUAL-REVIEW-${randomUUID()}`,
            paymentMethod: MANUAL_METHOD,
            confirmationMethod: MANUAL_METHOD,
            currency: quote.currency,
            amountCents: quote.totalCents,
            status: "EXCEPTION",
            idempotencyKey: `manual-conflict:${randomUUID()}`,
            failureReason: "duplicate_reference",
            confirmedById: input.actorId,
            portalConfirmedAt
          }
        });
        await tx.crossBorderAuditEvent.create({
          data: {
            requestId: request.id,
            actorId: input.actorId,
            action: "manual_payment_conflict",
            payload: { transactionReference, otherRequestId: paidElsewhere.requestId, reason: "duplicate_reference" }
          }
        });
        return {
          kind: "reject",
          statusCode: 409,
          code: "REFERENCE_IN_USE",
          message: "That ZB reference is already allocated to another DUTS order. The attempt was kept for review."
        };
      }

      const payment = await tx.crossBorderPayment.create({
        data: {
          requestId: request.id,
          quoteId: quote.id,
          quoteVersion: quote.version,
          provider: MANUAL_METHOD,
          providerReference: transactionReference,
          externalOrderReference: orderReference || null,
          merchantReference: `MANUAL-${request.reference}-v${quote.version}`,
          paymentMethod: MANUAL_METHOD,
          confirmationMethod: MANUAL_METHOD,
          currency: quote.currency,
          amountCents: quote.totalCents,
          status: "PAID",
          idempotencyKey: `manual:${request.id}:${quote.id}`,
          paidAt: new Date(),
          confirmedById: input.actorId,
          portalConfirmedAt
        }
      });
      const requestStatus = await unlockAfterVerifiedPayment(tx, request.id);
      await tx.crossBorderAuditEvent.create({
        data: {
          requestId: request.id,
          actorId: input.actorId,
          action: "manual_payment_confirmed",
          payload: {
            paymentId: payment.id,
            quoteId: quote.id,
            quoteVersion: quote.version,
            amountCents: quote.totalCents,
            currency: quote.currency,
            transactionReference,
            orderReference: orderReference || null,
            confirmationMethod: MANUAL_METHOD,
            portalConfirmedAt: portalConfirmedAt.toISOString(),
            requestStatus
          }
        }
      });
      return { kind: "paid", paymentId: payment.id, duplicate: false, requestStatus, confirmationMethod: MANUAL_METHOD };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (!isUniqueConflict(error)) throw error;
    const existing = await prisma.crossBorderPayment.findFirst({
      where: { requestId: input.requestId, status: "PAID", providerReference: transactionReference }
    });
    if (existing && existing.amountCents === input.amountCents) {
      const request = await prisma.crossBorderRequest.findUnique({ where: { id: input.requestId } });
      return { paymentId: existing.id, duplicate: true, requestStatus: request?.status ?? "PAID", confirmationMethod: existing.confirmationMethod };
    }
    await prisma.crossBorderPayment.create({
      data: {
        requestId: input.requestId,
        quoteId: input.quoteId,
        quoteVersion: 0,
        provider: MANUAL_METHOD,
        providerReference: transactionReference,
        externalOrderReference: orderReference || null,
        merchantReference: `MANUAL-REVIEW-${randomUUID()}`,
        paymentMethod: MANUAL_METHOD,
        confirmationMethod: MANUAL_METHOD,
        currency: input.currency,
        amountCents: input.amountCents,
        status: "EXCEPTION",
        idempotencyKey: `manual-conflict:${randomUUID()}`,
        failureReason: "duplicate_reference",
        confirmedById: input.actorId,
        portalConfirmedAt
      }
    }).catch(() => undefined);
    throw new AppError("That ZB reference is already allocated. The attempt was kept for review.", 409, "REFERENCE_IN_USE");
  }
  if (outcome.kind === "reject") throw new AppError(outcome.message, outcome.statusCode, outcome.code);
  return {
    paymentId: outcome.paymentId,
    duplicate: outcome.duplicate,
    requestStatus: outcome.requestStatus,
    confirmationMethod: outcome.confirmationMethod
  };
}

const DISPUTE_REASONS = new Set([
  "WRONG_REFERENCE",
  "INCORRECT_CONFIRMATION",
  "DUPLICATE_RECEIPT",
  "REFUND_REQUIRED",
  "REVERSAL_OR_DISPUTE"
]);

export async function openManualPaymentDispute(input: { paymentId: string; actorId: string; reason: string; note?: string | null }) {
  if (!crossBorderEnabled()) throw new AppError("South African shopping is not available yet.", 404, "CROSS_BORDER_DISABLED");
  if (!crossBorderManualPaymentsEnabled()) {
    throw new AppError("Manual payment confirmation is not available yet.", 403, "MANUAL_PAYMENTS_DISABLED");
  }
  if (!DISPUTE_REASONS.has(input.reason)) throw new AppError("Choose a correction reason.", 400, "DISPUTE_REASON_REQUIRED");
  return prisma.$transaction(async (tx) => {
    const payment = await tx.crossBorderPayment.findUnique({ where: { id: input.paymentId } });
    if (!payment) throw new AppError("Payment not found.", 404, "PAYMENT_NOT_FOUND");
    if (payment.confirmationMethod !== MANUAL_METHOD && payment.provider !== MANUAL_METHOD) {
      throw new AppError("Only a staff-attested payment can be corrected here.", 409, "NOT_MANUAL_PAYMENT");
    }
    if (payment.status !== "PAID") throw new AppError("This payment is not a confirmed receipt.", 409, "PAYMENT_NOT_CONFIRMED");
    const request = await tx.crossBorderRequest.findUnique({ where: { id: payment.requestId } });
    if (!request) throw new AppError("Shopping request not found.", 404, "REQUEST_NOT_FOUND");
    let requestStatus = request.status as RequestStatus;
    if (requestStatus !== "REFUND_PENDING" && canTransition(requestStatus, "REFUND_PENDING")) {
      assertTransition(requestStatus, "REFUND_PENDING");
      await tx.crossBorderRequest.update({ where: { id: request.id }, data: { status: "REFUND_PENDING" } });
      requestStatus = "REFUND_PENDING";
    }
    await tx.crossBorderAuditEvent.create({
      data: {
        requestId: request.id,
        actorId: input.actorId,
        action: "manual_payment_dispute_opened",
        payload: {
          paymentId: payment.id,
          reason: input.reason,
          note: input.note?.trim().slice(0, 300) || null,
          confirmationMethod: MANUAL_METHOD,
          requestStatus
        }
      }
    });
    return { paymentId: payment.id, paymentStatus: payment.status, requestStatus };
  });
}
