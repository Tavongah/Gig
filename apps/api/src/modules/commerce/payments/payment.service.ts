import {
  CommerceOrderStatus,
  CommercePaymentAttemptStatus,
  CommercePaymentMethod,
  CommercePaymentStatus
} from "@prisma/client";
import { prisma } from "../../../config/prisma.js";
import { AppError } from "../../../lib/errors.js";
import { logDutsFlow } from "../../../lib/flow-log.js";
import { EcoCashCommercePaymentProvider } from "./ecocash.provider.js";
import { MockCommercePaymentProvider } from "./mock.provider.js";
import { PaynowCommercePaymentProvider } from "./paynow.provider.js";
import { resolvePaynowMode } from "./paynow.transport.js";
import {
  resolveCommercePaymentProviderName,
  type CommercePaymentProvider,
  type ProviderWebhookResult
} from "./provider.js";
import { formatZwLocalFromE164, validateZimbabweMobileForEcoCash } from "./zw-phone.js";

let sharedProvider: CommercePaymentProvider | null = null;

export function getCommercePaymentProvider(): CommercePaymentProvider {
  if (sharedProvider) return sharedProvider;
  const name = resolveCommercePaymentProviderName();
  sharedProvider =
    name === "ecocash"
      ? new EcoCashCommercePaymentProvider()
      : name === "paynow"
        ? new PaynowCommercePaymentProvider()
        : new MockCommercePaymentProvider();
  return sharedProvider;
}

export function resetCommercePaymentProviderForTests(): void {
  sharedProvider = null;
}

export function setCommercePaymentProviderForTests(provider: CommercePaymentProvider): void {
  sharedProvider = provider;
}

export type MobileMoneyMethod =
  | typeof CommercePaymentMethod.ECOCASH
  | typeof CommercePaymentMethod.ONEMONEY;

export function isMobileMoneyPaymentMethod(
  method: CommercePaymentMethod | string | null | undefined
): method is MobileMoneyMethod {
  return method === CommercePaymentMethod.ECOCASH || method === CommercePaymentMethod.ONEMONEY;
}

/** True when Paynow is active in local simulator or official Test Mode (not live). */
export function isPaynowTestMode(): boolean {
  if (resolveCommercePaymentProviderName() !== "paynow") return false;
  const mode = resolvePaynowMode();
  return mode === "local" || mode === "test";
}

/** True when using the in-process local Paynow simulator. */
export function isPaynowLocalMode(): boolean {
  return resolveCommercePaymentProviderName() === "paynow" && resolvePaynowMode() === "local";
}

/**
 * Initiate EcoCash or OneMoney via the active CommercePaymentProvider (mock | paynow | ecocash).
 * Sets order paymentMethod and PAYMENT_PENDING. Never marks PAID.
 */
export async function initiateMobileMoneyPaymentForOrder(input: {
  commerceOrderId: string;
  payerPhoneRaw: string;
  paymentMethod?: MobileMoneyMethod;
}): Promise<{
  attempt: Awaited<ReturnType<typeof prisma.commercePaymentAttempt.create>>;
  displayLocal: string;
  expiresAt: Date | null;
  paymentMethod: MobileMoneyMethod;
  providerName: string;
  testMode: boolean;
}> {
  const paymentMethod: MobileMoneyMethod =
    input.paymentMethod === CommercePaymentMethod.ONEMONEY
      ? CommercePaymentMethod.ONEMONEY
      : CommercePaymentMethod.ECOCASH;

  const phone = validateZimbabweMobileForEcoCash(input.payerPhoneRaw);
  if (!phone.ok) {
    throw new AppError(phone.reason, 400, "INVALID_PAYER_PHONE");
  }

  const order = await prisma.commerceOrder.findUniqueOrThrow({
    where: { id: input.commerceOrderId }
  });

  if (order.paymentStatus === CommercePaymentStatus.PAID) {
    throw new AppError("This order is already paid.", 409, "ALREADY_PAID");
  }

  const pending = await prisma.commercePaymentAttempt.findFirst({
    where: {
      commerceOrderId: order.id,
      status: { in: [CommercePaymentAttemptStatus.CREATED, CommercePaymentAttemptStatus.PENDING] }
    },
    orderBy: { createdAt: "desc" }
  });
  if (pending) {
    throw new AppError(
      "A payment request is already pending. Reply RETRY after it fails/expires, or CASH to pay on delivery.",
      409,
      "PAYMENT_ALREADY_PENDING"
    );
  }

  const provider = getCommercePaymentProvider();
  const attempt = await prisma.commercePaymentAttempt.create({
    data: {
      commerceOrderId: order.id,
      provider: provider.name,
      payerPhone: phone.e164,
      amountCents: order.totalCents,
      currency: order.currency,
      status: CommercePaymentAttemptStatus.CREATED
    }
  });

  const initiated = await provider.initiatePayment({
    commerceOrderId: order.id,
    orderNumber: order.orderNumber,
    amountCents: order.totalCents,
    currency: order.currency,
    payerPhoneE164: phone.e164,
    attemptId: attempt.id,
    paymentMethod
  });

  const updated = await prisma.commercePaymentAttempt.update({
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

  await prisma.commerceOrder.update({
    where: { id: order.id },
    data: {
      paymentMethod,
      paymentStatus: CommercePaymentStatus.PAYMENT_PENDING
    }
  });

  logDutsFlow("COMMERCE_PAYMENT_INITIATED", {
    orderId: order.id,
    orderNumber: order.orderNumber,
    provider: provider.name,
    amountCents: order.totalCents,
    paymentMethod
  });

  return {
    attempt: updated,
    displayLocal: phone.displayLocal,
    expiresAt: initiated.expiresAt,
    paymentMethod,
    providerName: provider.name,
    testMode: isPaynowTestMode()
  };
}

/** @deprecated Prefer initiateMobileMoneyPaymentForOrder — kept for existing EcoCash call sites. */
export async function initiateEcoCashPaymentForOrder(input: {
  commerceOrderId: string;
  payerPhoneRaw: string;
}) {
  return initiateMobileMoneyPaymentForOrder({
    ...input,
    paymentMethod: CommercePaymentMethod.ECOCASH
  });
}

/** Switch a pending/failed mobile-money order to cash on delivery and open merchant flow. */
export async function switchOrderToCashOnDelivery(commerceOrderId: string) {
  await cancelPendingPaymentAttempts(commerceOrderId);
  const order = await prisma.commerceOrder.findUniqueOrThrow({
    where: { id: commerceOrderId },
    include: { merchant: true, items: true, customer: true }
  });

  if (order.paymentStatus === CommercePaymentStatus.PAID) {
    throw new AppError("This order is already paid.", 409, "ALREADY_PAID");
  }

  const updated = await prisma.commerceOrder.update({
    where: { id: commerceOrderId },
    data: {
      paymentMethod: CommercePaymentMethod.CASH,
      paymentStatus: CommercePaymentStatus.DUE_ON_DELIVERY,
      status: CommerceOrderStatus.MERCHANT_PENDING,
      confirmedAt: order.confirmedAt ?? new Date(),
      merchantRespondBy: new Date(
        Date.now() + Number(process.env.COMMERCE_MERCHANT_TIMEOUT_SECONDS || 900) * 1000
      )
    },
    include: { merchant: true, items: true, customer: true }
  });

  return updated;
}

/**
 * Apply authoritative provider callback. Idempotent for duplicate PAID events.
 * Revalidates amount + order id / merchant reference. Never trusts customer chat text.
 */
export async function applyProviderPaymentResult(
  result: ProviderWebhookResult
): Promise<{
  applied: boolean;
  duplicate: boolean;
  orderId: string;
  status: string;
}> {
  const attempt = await prisma.commercePaymentAttempt.findFirst({
    where: result.merchantReference
      ? {
          OR: [
            { providerPaymentId: result.providerPaymentId },
            { merchantReference: result.merchantReference }
          ]
        }
      : { providerPaymentId: result.providerPaymentId },
    include: { commerceOrder: { include: { merchant: true, items: true, customer: true } } }
  });

  if (!attempt) {
    throw new AppError("Unknown payment attempt.", 404, "PAYMENT_ATTEMPT_NOT_FOUND");
  }

  if (
    result.commerceOrderId &&
    result.commerceOrderId !== attempt.commerceOrderId
  ) {
    throw new AppError("Order reference mismatch.", 409, "PAYMENT_ORDER_MISMATCH");
  }
  if (attempt.amountCents !== result.amountCents) {
    throw new AppError("Payment amount mismatch.", 409, "PAYMENT_AMOUNT_MISMATCH");
  }

  // Validate Paynow reference when already known on the attempt.
  if (
    result.paynowReference &&
    attempt.paynowReference &&
    attempt.paynowReference !== result.paynowReference
  ) {
    throw new AppError("Paynow reference mismatch.", 409, "PAYMENT_PAYNOW_REF_MISMATCH");
  }

  if (attempt.status === CommercePaymentAttemptStatus.PAID) {
    return {
      applied: false,
      duplicate: true,
      orderId: attempt.commerceOrderId,
      status: "PAID"
    };
  }

  // RETRY / CASH cancels the prior attempt — never revive a superseded attempt.
  if (attempt.status === CommercePaymentAttemptStatus.CANCELLED) {
    throw new AppError(
      "Payment attempt was superseded.",
      409,
      "PAYMENT_ATTEMPT_SUPERSEDED"
    );
  }

  if (result.paynowReference && !attempt.paynowReference) {
    await prisma.commercePaymentAttempt.update({
      where: { id: attempt.id },
      data: { paynowReference: result.paynowReference }
    });
  }

  // Rebuild result with resolved order id for downstream
  const resolved: ProviderWebhookResult = {
    ...result,
    commerceOrderId: attempt.commerceOrderId,
    providerPaymentId: attempt.providerPaymentId || result.providerPaymentId
  };

  if (resolved.status === "PAID") {
    const paidMethod = isMobileMoneyPaymentMethod(attempt.commerceOrder.paymentMethod)
      ? attempt.commerceOrder.paymentMethod
      : CommercePaymentMethod.ECOCASH;

    await prisma.$transaction(async (tx) => {
      await tx.commercePaymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: CommercePaymentAttemptStatus.PAID,
          confirmedAt: new Date(),
          failureReason: null,
          ...(result.paynowReference ? { paynowReference: result.paynowReference } : {})
        }
      });
      await tx.commerceOrder.update({
        where: { id: attempt.commerceOrderId },
        data: {
          paymentStatus: CommercePaymentStatus.PAID,
          paymentMethod: paidMethod,
          status: CommerceOrderStatus.MERCHANT_PENDING,
          confirmedAt: new Date(),
          merchantRespondBy: new Date(
            Date.now() + Number(process.env.COMMERCE_MERCHANT_TIMEOUT_SECONDS || 900) * 1000
          )
        }
      });
    });

    logDutsFlow("COMMERCE_PAYMENT_PAID", {
      orderId: attempt.commerceOrderId,
      orderNumber: attempt.commerceOrder.orderNumber,
      provider: attempt.provider,
      amountCents: attempt.amountCents
    });

    return { applied: true, duplicate: false, orderId: attempt.commerceOrderId, status: "PAID" };
  }

  const attemptStatus =
    resolved.status === "EXPIRED"
      ? CommercePaymentAttemptStatus.EXPIRED
      : resolved.status === "CANCELLED"
        ? CommercePaymentAttemptStatus.CANCELLED
        : CommercePaymentAttemptStatus.FAILED;

  await prisma.commercePaymentAttempt.update({
    where: { id: attempt.id },
    data: {
      status: attemptStatus,
      failureReason: resolved.failureReason || resolved.status.toLowerCase()
    }
  });
  await prisma.commerceOrder.update({
    where: { id: attempt.commerceOrderId },
    data: {
      paymentStatus: CommercePaymentStatus.PAYMENT_FAILED
    }
  });

  logDutsFlow("COMMERCE_PAYMENT_FAILED", {
    orderId: attempt.commerceOrderId,
    orderNumber: attempt.commerceOrder.orderNumber,
    provider: attempt.provider,
    status: resolved.status
  });

  return {
    applied: true,
    duplicate: false,
    orderId: attempt.commerceOrderId,
    status: resolved.status
  };
}

/**
 * Poll Paynow for an attempt status (backup to callback). Only uses stored pollUrl.
 */
export async function pollPaynowPaymentAttempt(attemptId: string) {
  const attempt = await prisma.commercePaymentAttempt.findUniqueOrThrow({
    where: { id: attemptId }
  });
  if (attempt.provider !== "paynow" || !attempt.pollUrl || !attempt.providerPaymentId) {
    throw new AppError("No Paynow poll URL for this attempt.", 400, "PAYNOW_POLL_UNAVAILABLE");
  }
  const provider = getCommercePaymentProvider();
  if (provider.name !== "paynow" || !(provider instanceof PaynowCommercePaymentProvider)) {
    throw new AppError("Paynow provider not active.", 503, "PAYNOW_PROVIDER_INACTIVE");
  }
  const status = await provider.getPaymentStatusWithPollUrl(
    attempt.providerPaymentId,
    attempt.pollUrl
  );
  if (!status || status.status === "PENDING") {
    return { applied: false, status: status?.status ?? "PENDING" };
  }
  return applyProviderPaymentResult({
    providerPaymentId: attempt.providerPaymentId,
    commerceOrderId: attempt.commerceOrderId,
    amountCents: status.amountCents ?? attempt.amountCents,
    status: status.status,
    failureReason: status.failureReason,
    merchantReference: attempt.merchantReference ?? undefined
  });
}

export async function cancelPendingPaymentAttempts(commerceOrderId: string): Promise<void> {
  await prisma.commercePaymentAttempt.updateMany({
    where: {
      commerceOrderId,
      status: { in: [CommercePaymentAttemptStatus.CREATED, CommercePaymentAttemptStatus.PENDING] }
    },
    data: { status: CommercePaymentAttemptStatus.CANCELLED, failureReason: "cancelled_for_retry_or_cash" }
  });
}

export { formatZwLocalFromE164, validateZimbabweMobileForEcoCash };
