/**
 * Applies an authoritative provider result to a seller payment attempt.
 * Called only after no merchant CommercePaymentAttempt matches the reference.
 * The fulfillment id on the attempt must equal the provider order reference.
 */

import { CommercePaymentAttemptStatus } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import type { ProviderWebhookResult } from "./payments/provider.js";
import { confirmSellerFulfillmentPayment, failSellerFulfillmentPayment } from "./seller-fulfillment.service.js";
import { dispatchSellerPurchaseDelivery } from "./seller-customer.service.js";

export async function applySellerProviderPaymentResult(result: ProviderWebhookResult): Promise<{
  applied: boolean;
  duplicate: boolean;
  orderId: string;
  status: string;
} | null> {
  const attempt = await prisma.sellerPaymentAttempt.findFirst({
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
  if (result.commerceOrderId && result.commerceOrderId !== attempt.sellerFulfillmentId) {
    throw new AppError("Order reference mismatch.", 409, "PAYMENT_ORDER_MISMATCH");
  }
  if (attempt.amountCents !== result.amountCents) {
    throw new AppError("Payment amount mismatch.", 409, "PAYMENT_AMOUNT_MISMATCH");
  }
  if (attempt.status === CommercePaymentAttemptStatus.PAID) {
    await confirmSellerFulfillmentPayment(attempt.sellerFulfillmentId, {
      paymentReference: attempt.providerPaymentId ?? result.providerPaymentId
    });
    await dispatchSellerPurchaseDelivery(attempt.sellerFulfillmentId);
    return { applied: false, duplicate: true, orderId: attempt.sellerFulfillmentId, status: "PAID" };
  }
  if (attempt.status === CommercePaymentAttemptStatus.CANCELLED) {
    throw new AppError("Payment attempt was superseded.", 409, "PAYMENT_ATTEMPT_SUPERSEDED");
  }

  if (result.status === "PAID") {
    const marked = await prisma.sellerPaymentAttempt.updateMany({
      where: {
        id: attempt.id,
        status: { in: [CommercePaymentAttemptStatus.CREATED, CommercePaymentAttemptStatus.PENDING] }
      },
      data: { status: CommercePaymentAttemptStatus.PAID, confirmedAt: new Date(), failureReason: null }
    });
    if (marked.count === 0) {
      await dispatchSellerPurchaseDelivery(attempt.sellerFulfillmentId);
      return { applied: false, duplicate: true, orderId: attempt.sellerFulfillmentId, status: "PAID" };
    }
    await confirmSellerFulfillmentPayment(attempt.sellerFulfillmentId, {
      paymentReference: attempt.providerPaymentId ?? result.providerPaymentId
    });
    await dispatchSellerPurchaseDelivery(attempt.sellerFulfillmentId);
    return { applied: true, duplicate: false, orderId: attempt.sellerFulfillmentId, status: "PAID" };
  }

  await prisma.sellerPaymentAttempt.update({
    where: { id: attempt.id },
    data: {
      status:
        result.status === "EXPIRED"
          ? CommercePaymentAttemptStatus.EXPIRED
          : result.status === "CANCELLED"
            ? CommercePaymentAttemptStatus.CANCELLED
            : CommercePaymentAttemptStatus.FAILED,
      failureReason: result.failureReason ?? result.status
    }
  });
  await failSellerFulfillmentPayment(attempt.sellerFulfillmentId);
  return { applied: true, duplicate: false, orderId: attempt.sellerFulfillmentId, status: result.status };
}
