import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { getAppEnv, isPilotOrStagingEnv, isProductionEnv } from "../../../lib/production-guards.js";
import { AppError } from "../../../lib/errors.js";
import { prisma } from "../../../config/prisma.js";
import {
  applyProviderPaymentResult,
  getCommercePaymentProvider,
  pollPaynowPaymentAttempt,
  pollZbPaymentAttempt
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
    try {
      const { notifyAfterPaidCommerceOrder } = await import("../merchant-notification.service.js");
      await notifyAfterPaidCommerceOrder(result.orderId);
    } catch {
      /* merchant WhatsApp is not a payment persistence gate */
    }
    return;
  }

  if (result.applied && result.status !== "PAID") {
    try {
      const order = await prisma.commerceOrder.findUnique({ where: { id: result.orderId } });
      if (order?.customerWhatsAppPhone) {
        const { WhatsAppParty } = await import("@prisma/client");
        const conv = await prisma.whatsAppConversation.findUnique({
          where: {
            phoneNormalized_party: {
              phoneNormalized: order.customerWhatsAppPhone,
              party: WhatsAppParty.CUSTOMER
            }
          }
        });
        let promptRetry = true;
        if (conv) {
          const { readContext } = await import("../../whatsapp/conversation.service.js");
          const { applyFailedPaymentToConversation } = await import("../../whatsapp/checkout-session.js");
          const { WhatsAppConversationState } = await import("@prisma/client");
          const current = readContext(conv);
          const phase =
            result.status === "EXPIRED" ? ("EXPIRED" as const) : ("FAILED" as const);
          const applied = applyFailedPaymentToConversation(current, result.orderId, phase);
          promptRetry = applied.updateCurrent;
          if (applied.updateCurrent || applied.ctx !== current) {
            await prisma.whatsAppConversation.update({
              where: { id: conv.id },
              data: {
                state: applied.updateCurrent
                  ? WhatsAppConversationState.AWAITING_PAYMENT
                  : conv.state,
                contextJson: applied.ctx as Prisma.InputJsonValue
              }
            });
          }
        }
        if (promptRetry) {
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
        }
      } else {
        const { prisma: db } = await import("../../../config/prisma.js");
        const unlisted = await db.unlistedItemRequest.findUnique({ where: { id: result.orderId } });
        if (unlisted?.whatsappPhone) {
          const { notifyCustomerStatus } = await import("../../whatsapp/merchant-handler.js");
          const { formatEcoCashExpired, formatEcoCashFailed, formatMobileMoneyCancelled } = await import(
            "../../whatsapp/copy.js"
          );
          const msg =
            result.status === "EXPIRED"
              ? formatEcoCashExpired()
              : result.status === "CANCELLED"
                ? formatMobileMoneyCancelled()
                : formatEcoCashFailed();
          await notifyCustomerStatus(unlisted.whatsappPhone, msg);
        }
      }
    } catch {
      /* customer WhatsApp is not a payment-state gate */
    }
  }
}

export function createCommercePaymentsRouter() {
  const router = Router();

  /**
   * Official Smile&Pay resultUrl webhook.
   * Always HTTP 200 after parse so the gateway does not retry forever.
   * PAID only after status/check verification inside the ZB provider.
   */
  router.post("/zb/callback", async (req, res) => {
    try {
      const provider = getCommercePaymentProvider();
      if (provider.name !== "zb") {
        res.status(200).json({ ok: true });
        return;
      }
      const rawBody = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}));
      const parsed = await provider.handleWebhook({
        headers: req.headers as Record<string, string | string[] | undefined>,
        rawBody,
        body: req.body
      });
      if (!parsed) {
        res.status(200).json({ ok: true });
        return;
      }
      try {
        const result = await applyProviderPaymentResult({
          ...parsed,
          commerceOrderId: parsed.commerceOrderId || "",
          merchantReference: parsed.merchantReference ?? parsed.providerPaymentId
        });
        await notifyAfterProviderResult(result);
      } catch (err) {
        const code = err instanceof Error ? (err as { code?: string }).code : undefined;
        if (
          code === "PAYMENT_AMOUNT_MISMATCH" ||
          code === "PAYMENT_REFERENCE_MISMATCH" ||
          code === "PAYMENT_ORDER_MISMATCH" ||
          code === "PAYMENT_ATTEMPT_NOT_FOUND" ||
          code === "PAYMENT_ATTEMPT_SUPERSEDED"
        ) {
          console.warn("zb_callback_not_applied", { code });
        } else {
          console.warn("zb_callback_not_applied");
        }
      }
      res.status(200).json({ ok: true });
    } catch {
      res.status(200).json({ ok: true });
    }
  });

  router.get("/zb/return", (_req, res) => {
    res.status(200).send("Payment return received.");
  });
  router.post("/zb/return", (_req, res) => {
    res.status(200).send("Payment return received.");
  });

  router.post("/zb/poll", async (req, res, next) => {
    try {
      const body = z.object({ attemptId: z.string().uuid() }).parse(req.body);
      const result = await pollZbPaymentAttempt(body.attemptId);
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
