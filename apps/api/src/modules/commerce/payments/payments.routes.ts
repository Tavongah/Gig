import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { getAppEnv, isPilotOrStagingEnv, isProductionEnv } from "../../../lib/production-guards.js";
import { AppError } from "../../../lib/errors.js";
import { prisma } from "../../../config/prisma.js";
import {
  applyProviderPaymentResult,
  getCommercePaymentProvider,
  pollPaynowPaymentAttempt
} from "./payment.service.js";
import { simulateMockPaymentOutcome } from "./mock.provider.js";
import { simulatePaynowTestOutcome } from "./paynow.transport.js";

function assertDevPaymentCallbacksAllowed(kind: "mock" | "paynow_test"): void {
  const appEnv = getAppEnv();
  // Hard-block pilot/staging/production regardless of NODE_ENV (tests may set NODE_ENV=test).
  if (
    appEnv === "production" ||
    appEnv === "pilot" ||
    appEnv === "staging" ||
    isPilotOrStagingEnv() ||
    isProductionEnv()
  ) {
    throw new AppError(
      kind === "paynow_test"
        ? "Paynow test callbacks are forbidden in pilot/staging/production."
        : "Mock commerce payment callbacks are disabled in this environment.",
      403,
      kind === "paynow_test" ? "PAYNOW_TEST_CALLBACK_FORBIDDEN" : "PAYMENT_MOCK_DISABLED"
    );
  }
  if (appEnv === "development" || appEnv === "test" || process.env.NODE_ENV === "test") return;
  if (process.env.ALLOW_COMMERCE_PAYMENT_MOCK === "true") return;
  throw new AppError(
    kind === "paynow_test"
      ? "Paynow test callbacks are disabled in this environment."
      : "Mock commerce payment callbacks are disabled in this environment.",
    403,
    kind === "paynow_test" ? "PAYNOW_TEST_CALLBACK_DISABLED" : "PAYMENT_MOCK_DISABLED"
  );
}

async function notifyAfterProviderResult(result: {
  applied: boolean;
  duplicate: boolean;
  orderId: string;
  status: string;
}) {
  if (result.applied && result.status === "PAID" && !result.duplicate) {
    const order = await prisma.commerceOrder.findUnique({
      where: { id: result.orderId },
      include: { merchant: true, items: true, customer: true }
    });
    if (order?.customerWhatsAppPhone) {
      const { notifyCustomerStatus, notifyMerchantNewOrder } = await import(
        "../../whatsapp/merchant-handler.js"
      );
      const { formatEcoCashPaid } = await import("../../whatsapp/copy.js");
      await notifyCustomerStatus(
        order.customerWhatsAppPhone,
        formatEcoCashPaid(order.totalCents)
      );
      await notifyMerchantNewOrder(order);

      const { WhatsAppConversationState, WhatsAppParty } = await import("@prisma/client");
      const conv = await prisma.whatsAppConversation.findUnique({
        where: {
          phoneNormalized_party: {
            phoneNormalized: order.customerWhatsAppPhone,
            party: WhatsAppParty.CUSTOMER
          }
        }
      });
      if (conv) {
        const ctx =
          conv.contextJson && typeof conv.contextJson === "object" && !Array.isArray(conv.contextJson)
            ? { ...(conv.contextJson as Record<string, unknown>) }
            : {};
        delete ctx.paymentPhase;
        delete ctx.paymentAttemptId;
        delete ctx.pendingPaymentOrderId;
        delete ctx.payerPhoneDisplay;
        delete ctx.selectedPaymentMethod;
        ctx.activeOrderId = order.id;
        await prisma.whatsAppConversation.update({
          where: { id: conv.id },
          data: {
            state: WhatsAppConversationState.ORDER_ACTIVE,
            contextJson: ctx as Prisma.InputJsonValue
          }
        });
      }
    }
    return;
  }

  if (result.applied && result.status !== "PAID") {
    const order = await prisma.commerceOrder.findUnique({ where: { id: result.orderId } });
    if (order?.customerWhatsAppPhone) {
      const { notifyCustomerStatus } = await import("../../whatsapp/merchant-handler.js");
      const {
        formatEcoCashExpired,
        formatEcoCashFailed,
        formatMobileMoneyCancelled
      } = await import("../../whatsapp/copy.js");
      const msg =
        result.status === "EXPIRED"
          ? formatEcoCashExpired()
          : result.status === "CANCELLED"
            ? formatMobileMoneyCancelled()
            : formatEcoCashFailed();
      await notifyCustomerStatus(order.customerWhatsAppPhone, msg);

      const { WhatsAppParty } = await import("@prisma/client");
      const conv = await prisma.whatsAppConversation.findUnique({
        where: {
          phoneNormalized_party: {
            phoneNormalized: order.customerWhatsAppPhone,
            party: WhatsAppParty.CUSTOMER
          }
        }
      });
      if (conv) {
        const ctx =
          conv.contextJson && typeof conv.contextJson === "object" && !Array.isArray(conv.contextJson)
            ? { ...(conv.contextJson as Record<string, unknown>) }
            : {};
        ctx.paymentPhase =
          result.status === "EXPIRED"
            ? "EXPIRED"
            : result.status === "CANCELLED"
              ? "FAILED"
              : "FAILED";
        await prisma.whatsAppConversation.update({
          where: { id: conv.id },
          data: { contextJson: ctx as Prisma.InputJsonValue }
        });
      }
    }
  }
}

export function createCommercePaymentsRouter() {
  const router = Router();

  /** Real EcoCash webhook — fail closed until official signature rules exist. */
  router.post("/webhook/ecocash", async (req, res, next) => {
    try {
      const provider = getCommercePaymentProvider();
      if (provider.name !== "ecocash") {
        res.status(503).json({ error: "EcoCash provider not active." });
        return;
      }
      const rawBody = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}));
      await provider.handleWebhook({
        headers: req.headers as Record<string, string | string[] | undefined>,
        rawBody,
        body: req.body
      });
      res.sendStatus(200);
    } catch (error) {
      next(error);
    }
  });

  /** Official Paynow resulturl callback (hash-validated). */
  router.post("/paynow/callback", async (req, res, next) => {
    try {
      const provider = getCommercePaymentProvider();
      if (provider.name !== "paynow") {
        res.status(503).send("Paynow provider not active.");
        return;
      }
      const rawBody =
        typeof req.body === "string"
          ? req.body
          : Buffer.isBuffer(req.body)
            ? req.body
            : Object.entries((req.body ?? {}) as Record<string, unknown>)
                .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v ?? ""))}`)
                .join("&");

      const parsed = await provider.handleWebhook({
        headers: req.headers as Record<string, string | string[] | undefined>,
        rawBody,
        body: req.body
      });

      if (!parsed) {
        // Pending / non-actionable — acknowledge so Paynow stops retrying unnecessarily
        res.status(200).send("OK");
        return;
      }

      const result = await applyProviderPaymentResult({
        ...parsed,
        commerceOrderId: parsed.commerceOrderId || "",
        merchantReference: parsed.merchantReference ?? parsed.providerPaymentId
      });
      await notifyAfterProviderResult(result);
      res.status(200).send("OK");
    } catch (error) {
      next(error);
    }
  });

  /** Alias kept for older docs naming. */
  router.post("/webhook/paynow", async (req, res, next) => {
    try {
      // Delegate to the same handler logic by rewriting URL is awkward — call through.
      req.url = "/paynow/callback";
      const provider = getCommercePaymentProvider();
      if (provider.name !== "paynow") {
        res.status(503).send("Paynow provider not active.");
        return;
      }
      const rawBody =
        typeof req.body === "string"
          ? req.body
          : Buffer.isBuffer(req.body)
            ? req.body
            : Object.entries((req.body ?? {}) as Record<string, unknown>)
                .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v ?? ""))}`)
                .join("&");
      const parsed = await provider.handleWebhook({
        headers: req.headers as Record<string, string | string[] | undefined>,
        rawBody,
        body: req.body
      });
      if (!parsed) {
        res.status(200).send("OK");
        return;
      }
      const result = await applyProviderPaymentResult({
        ...parsed,
        commerceOrderId: parsed.commerceOrderId || "",
        merchantReference: parsed.merchantReference ?? parsed.providerPaymentId
      });
      await notifyAfterProviderResult(result);
      res.status(200).send("OK");
    } catch (error) {
      next(error);
    }
  });

  /** Browser returnurl stub (WhatsApp does not use this). */
  router.get("/paynow/return", (_req, res) => {
    res.status(200).send("Payment return received.");
  });
  router.post("/paynow/return", (_req, res) => {
    res.status(200).send("Payment return received.");
  });

  /**
   * Backup reconciliation: poll Paynow using the hash-validated poll URL stored on the attempt.
   * Does not accept an arbitrary poll URL from the client.
   * POST /v1/commerce/payments/paynow/poll  { "attemptId": "<uuid>" }
   */
  router.post("/paynow/poll", async (req, res, next) => {
    try {
      const body = z.object({ attemptId: z.string().uuid() }).parse(req.body);
      const result = await pollPaynowPaymentAttempt(body.attemptId);
      if (
        "orderId" in result &&
        result.applied &&
        result.status === "PAID" &&
        !result.duplicate
      ) {
        await notifyAfterProviderResult(result);
      }
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Dev/test only: simulate mock provider callback.
   * POST /v1/commerce/payments/mock/callback
   */
  router.post("/mock/callback", async (req, res, next) => {
    try {
      assertDevPaymentCallbacksAllowed("mock");
      const body = z
        .object({
          providerPaymentId: z.string().min(3),
          commerceOrderId: z.string().uuid(),
          amountCents: z.number().int().positive(),
          status: z.enum(["PAID", "FAILED", "EXPIRED", "CANCELLED"]),
          failureReason: z.string().optional()
        })
        .parse(req.body);

      const provider = getCommercePaymentProvider();
      if (provider.name === "mock") {
        await simulateMockPaymentOutcome({
          providerPaymentId: body.providerPaymentId,
          status: body.status === "CANCELLED" ? "FAILED" : body.status,
          failureReason: body.failureReason
        });
      }

      const result = await applyProviderPaymentResult({
        providerPaymentId: body.providerPaymentId,
        commerceOrderId: body.commerceOrderId,
        amountCents: body.amountCents,
        status: body.status,
        failureReason: body.failureReason
      });

      await notifyAfterProviderResult(result);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Dev only: simulate LOCAL Paynow transport callback (PAYNOW_MODE=local).
   * POST /v1/commerce/payments/paynow/test/callback
   * Unavailable in production/pilot and when not in local mode.
   */
  router.post("/paynow/test/callback", async (req, res, next) => {
    try {
      assertDevPaymentCallbacksAllowed("paynow_test");
      const { resolvePaynowMode } = await import("./paynow.transport.js");
      if (resolvePaynowMode() !== "local") {
        throw new AppError(
          "Local Paynow simulator callback is only available when PAYNOW_MODE=local.",
          403,
          "PAYNOW_LOCAL_CALLBACK_DISABLED"
        );
      }

      const body = z
        .object({
          providerPaymentId: z.string().min(3),
          commerceOrderId: z.string().uuid(),
          amountCents: z.number().int().positive(),
          status: z.enum(["PAID", "FAILED", "EXPIRED", "CANCELLED", "SUCCESS"]),
          failureReason: z.string().optional()
        })
        .parse(req.body);

      const status =
        body.status === "SUCCESS" ? "PAID" : (body.status as "PAID" | "FAILED" | "EXPIRED" | "CANCELLED");

      const provider = getCommercePaymentProvider();
      if (provider.name !== "paynow") {
        throw new AppError(
          "Paynow provider is not active. Set COMMERCE_PAYMENT_PROVIDER=paynow.",
          503,
          "PAYNOW_PROVIDER_INACTIVE"
        );
      }

      await simulatePaynowTestOutcome({
        providerPaymentId: body.providerPaymentId,
        status,
        failureReason: body.failureReason
      });

      const result = await applyProviderPaymentResult({
        providerPaymentId: body.providerPaymentId,
        commerceOrderId: body.commerceOrderId,
        amountCents: body.amountCents,
        status,
        failureReason: body.failureReason,
        merchantReference: body.providerPaymentId
      });

      await notifyAfterProviderResult(result);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
