import { CommercePaymentAttemptStatus, UnlistedItemRequestStatus } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import { logDutsFlow } from "../../lib/flow-log.js";
import {
  getCommercePaymentProvider,
  isMobileMoneyPaymentMethod,
  type MobileMoneyMethod
} from "./payments/payment.service.js";
import { assertDutsUsdCurrency } from "./payments/zb.config.js";
import { validateZimbabweMobileForEcoCash } from "./payments/zw-phone.js";
import type { ProviderWebhookResult } from "./payments/provider.js";
import { CommercePaymentMethod } from "@prisma/client";
import { markUnlistedPaidFromAttempt, markUnlistedPaymentFailed } from "./unlisted-item.service.js";

export async function initiateUnlistedEcoCashPayment(input: {
  requestId: string;
  payerPhoneRaw: string;
}) {
  const request = await prisma.unlistedItemRequest.findUniqueOrThrow({ where: { id: input.requestId } });
  if (
    request.status !== UnlistedItemRequestStatus.CUSTOMER_APPROVED &&
    request.status !== UnlistedItemRequestStatus.PAYMENT_PENDING
  ) {
    if (
      request.status === UnlistedItemRequestStatus.PAID ||
      request.status === UnlistedItemRequestStatus.PURCHASED ||
      request.status === UnlistedItemRequestStatus.DELIVERING ||
      request.status === UnlistedItemRequestStatus.COMPLETED
    ) {
      throw new AppError("This request is already paid.", 409, "ALREADY_PAID");
    }
    throw new AppError("Customer approval is required before payment.", 409, "UNLISTED_NOT_APPROVED");
  }
  if (!request.totalCents || request.totalCents < 1) {
    throw new AppError("Quote total is missing.", 409, "UNLISTED_QUOTE_MISSING");
  }

  const phone = validateZimbabweMobileForEcoCash(input.payerPhoneRaw);
  if (!phone.ok) throw new AppError(phone.reason, 400, "INVALID_PAYER_PHONE");

  const provider = getCommercePaymentProvider();
  const paymentMethod: MobileMoneyMethod = CommercePaymentMethod.ECOCASH;
  if (provider.name === "zb" && !isMobileMoneyPaymentMethod(paymentMethod)) {
    throw new AppError("EcoCash USD is required.", 400, "ZB_ECOCASH_USD_ONLY");
  }
  if (provider.name === "zb") assertDutsUsdCurrency("usd");

  const pending = await prisma.unlistedItemPaymentAttempt.findFirst({
    where: {
      requestId: request.id,
      status: { in: [CommercePaymentAttemptStatus.CREATED, CommercePaymentAttemptStatus.PENDING] }
    },
    orderBy: { createdAt: "desc" }
  });
  if (pending?.status === CommercePaymentAttemptStatus.PENDING && pending.providerPaymentId) {
    throw new AppError("Payment is still being confirmed.", 409, "PAYMENT_ALREADY_PENDING");
  }
  if (pending) {
    await prisma.unlistedItemPaymentAttempt.update({
      where: { id: pending.id },
      data: { status: CommercePaymentAttemptStatus.CANCELLED, failureReason: "superseded" }
    });
  }

  const attempt = await prisma.unlistedItemPaymentAttempt.create({
    data: {
      requestId: request.id,
      provider: provider.name,
      payerPhone: phone.e164,
      amountCents: request.totalCents,
      currency: "usd",
      status: CommercePaymentAttemptStatus.CREATED
    }
  });

  let initiated;
  try {
    initiated = await provider.initiatePayment({
      commerceOrderId: request.id,
      orderNumber: request.requestNumber,
      amountCents: request.totalCents,
      currency: "usd",
      payerPhoneE164: phone.e164,
      attemptId: attempt.id,
      paymentMethod
    });
  } catch (err) {
    await prisma.unlistedItemPaymentAttempt.update({
      where: { id: attempt.id },
      data: { status: CommercePaymentAttemptStatus.FAILED, failureReason: "initiate_failed" }
    });
    throw err;
  }

  await prisma.unlistedItemPaymentAttempt.update({
    where: { id: attempt.id },
    data: {
      providerPaymentId: initiated.providerPaymentId,
      merchantReference: initiated.merchantReference ?? initiated.providerPaymentId,
      pollUrl: initiated.pollUrl ?? null,
      paynowReference: initiated.paynowReference ?? null,
      status: CommercePaymentAttemptStatus.PENDING,
      expiresAt: initiated.expiresAt,
      initiatedAt: new Date()
    }
  });
  await prisma.unlistedItemRequest.update({
    where: { id: request.id },
    data: { status: UnlistedItemRequestStatus.PAYMENT_PENDING }
  });
  logDutsFlow("COMMERCE_PAYMENT_INITIATED", { requestId: request.id, attemptId: attempt.id });
  return { attemptId: attempt.id, displayLocal: phone.displayLocal, expiresAt: initiated.expiresAt };
}

export async function applyUnlistedProviderPaymentResult(result: ProviderWebhookResult): Promise<{
  applied: boolean;
  duplicate: boolean;
  orderId: string;
  status: string;
} | null> {
  const attempt = await prisma.unlistedItemPaymentAttempt.findFirst({
    where: result.merchantReference
      ? {
          OR: [
            { providerPaymentId: result.providerPaymentId },
            { merchantReference: result.merchantReference }
          ]
        }
      : { providerPaymentId: result.providerPaymentId }
  });
  if (!attempt) return null;

  if (attempt.amountCents !== result.amountCents) {
    throw new AppError("Payment amount mismatch.", 409, "PAYMENT_AMOUNT_MISMATCH");
  }
  if (attempt.status === CommercePaymentAttemptStatus.PAID) {
    return { applied: false, duplicate: true, orderId: attempt.requestId, status: "PAID" };
  }
  if (attempt.status === CommercePaymentAttemptStatus.CANCELLED) {
    throw new AppError("Payment attempt was superseded.", 409, "PAYMENT_ATTEMPT_SUPERSEDED");
  }

  if (result.status === "PAID") {
    await prisma.unlistedItemPaymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: CommercePaymentAttemptStatus.PAID,
        confirmedAt: new Date(),
        ...(result.paynowReference ? { paynowReference: result.paynowReference } : {})
      }
    });
    await markUnlistedPaidFromAttempt(attempt.requestId, attempt.id);
    return { applied: true, duplicate: false, orderId: attempt.requestId, status: "PAID" };
  }

  await prisma.unlistedItemPaymentAttempt.update({
    where: { id: attempt.id },
    data: {
      status:
        result.status === "EXPIRED"
          ? CommercePaymentAttemptStatus.EXPIRED
          : CommercePaymentAttemptStatus.FAILED,
      failureReason: result.failureReason ?? result.status
    }
  });
  await markUnlistedPaymentFailed(attempt.requestId, result.failureReason ?? result.status);
  return { applied: true, duplicate: false, orderId: attempt.requestId, status: result.status };
}
