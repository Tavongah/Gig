import { Router } from "express";
import type { Server } from "socket.io";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { createMerchantSchema, fulfillmentAdminLabel, merchantNotificationAdminLabel, updateMerchantSchema, upsertProductSchema } from "@gigflow/shared";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { prisma } from "../../config/prisma.js";
import {
  archiveProduct,
  createMerchant,
  listMerchantProducts,
  setMerchantAcceptsOrders,
  setProductAvailability,
  updateMerchant,
  upsertProductForMerchant
} from "../commerce/merchant.service.js";
import {
  confirmBulkCatalogImport,
  getMerchantReadiness,
  previewBulkCatalogImport,
  testMerchantBasket
} from "../commerce/merchant-onboarding.service.js";
import { getWhatsAppProvider } from "./provider.js";
import { routeInboundWhatsApp } from "./merchant-handler.js";
import type { InboundWhatsAppMessage } from "./customer-handler.js";
import { extractMetaMessages, type MetaWebhookPayload } from "./meta-payload.js";
import {
  extractTwilioMessage,
  resolveTwilioWebhookUrl,
  resolveTwilioStatusCallbackUrl,
  twilioFormParamsForSignature
} from "./twilio-payload.js";

function appEnvName(): string {
  return (process.env.APP_ENV ?? process.env.NODE_ENV ?? "development").toLowerCase();
}

function isDevOrTestEnv(): boolean {
  const e = appEnvName();
  return e === "development" || e === "test" || process.env.NODE_ENV === "test";
}

export function createWhatsAppRouter(io: Server) {
  const router = Router();

  router.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    const verify = process.env.WHATSAPP_VERIFY_TOKEN || "duts-whatsapp-verify";
    if (mode === "subscribe" && token === verify) {
      res.status(200).send(String(challenge ?? ""));
      return;
    }
    res.sendStatus(403);
  });

  router.post("/webhook", async (req, res) => {
    try {
      const provider = getWhatsAppProvider();
      const rawBody = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}));

      const requireSig =
        provider.name === "meta" &&
        (appEnvName() === "pilot" ||
          appEnvName() === "staging" ||
          appEnvName() === "production" ||
          process.env.NODE_ENV === "production");

      if (requireSig || provider.verifyWebhookSignature) {
        const sig = req.header("x-hub-signature-256") ?? undefined;
        if (!provider.verifyWebhookSignature) {
          res.status(401).json({ error: "Webhook signature verification not configured." });
          return;
        }
        if (!provider.verifyWebhookSignature(rawBody, sig)) {
          res.sendStatus(401);
          return;
        }
      }

      let payload: MetaWebhookPayload;
      try {
        payload = JSON.parse(rawBody.toString("utf8")) as MetaWebhookPayload;
      } catch {
        res.status(400).json({ error: "Malformed JSON body." });
        return;
      }

      for (const msg of extractMetaMessages(payload)) {
        await routeInboundWhatsApp(msg, io);
      }
      res.sendStatus(200);
    } catch (error) {
      console.error("[whatsapp] webhook error", error instanceof Error ? error.message : "unknown");
      res.sendStatus(200);
    }
  });

  /**
   * Twilio WhatsApp inbound webhook (testing transport).
   * Configure Twilio console → Messaging → WhatsApp sandbox/number webhook:
   *   POST {API_PUBLIC_URL}/v1/whatsapp/twilio
   */
  router.post("/twilio", async (req, res) => {
    try {
      const provider = getWhatsAppProvider();
      const params = twilioFormParamsForSignature(
        (req.body ?? {}) as Record<string, unknown>
      );
      const sig = req.header("x-twilio-signature") ?? undefined;
      const webhookUrl = resolveTwilioWebhookUrl(req.protocol, req.get("host") ?? undefined);

      // Signature required outside development/test. In development/test, verify whenever
      // TWILIO_AUTH_TOKEN is configured (never log the token).
      const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
      const requireTwilioSig = !isDevOrTestEnv() || Boolean(authToken);

      if (requireTwilioSig) {
        if (!authToken) {
          res.status(401).type("text/plain").send("Twilio auth token not configured");
          return;
        }
        const ok =
          provider.verifyTwilioSignature?.({
            signatureHeader: sig,
            url: webhookUrl,
            params
          }) ??
          (await import("./twilio-payload.js")).validateTwilioRequest({
            authToken,
            signatureHeader: sig,
            url: webhookUrl,
            params
          });
        if (!ok) {
          res.sendStatus(403);
          return;
        }
      }

      const msg = extractTwilioMessage(params);
      if (!msg) {
        res.status(200).type("text/xml").send("<Response></Response>");
        return;
      }

      await routeInboundWhatsApp(msg, io);
      // Empty TwiML — DUTS replies asynchronously via Messaging API.
      res.status(200).type("text/xml").send("<Response></Response>");
    } catch (error) {
      console.error("[whatsapp:twilio] webhook error", error instanceof Error ? error.message : "unknown");
      res.status(200).type("text/xml").send("<Response></Response>");
    }
  });

  router.post("/twilio/status", async (req, res) => {
    try {
      const provider = getWhatsAppProvider();
      const params = twilioFormParamsForSignature((req.body ?? {}) as Record<string, unknown>);
      const sig = req.header("x-twilio-signature") ?? undefined;
      const webhookUrl = resolveTwilioStatusCallbackUrl();
      const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
      const requireTwilioSig = !isDevOrTestEnv() || Boolean(authToken);
      if (requireTwilioSig) {
        if (!authToken) {
          res.status(401).type("text/plain").send("Twilio auth token not configured");
          return;
        }
        const ok =
          provider.verifyTwilioSignature?.({
            signatureHeader: sig,
            url: webhookUrl,
            params
          }) ??
          (await import("./twilio-payload.js")).validateTwilioRequest({
            authToken,
            signatureHeader: sig,
            url: webhookUrl,
            params
          });
        if (!ok) {
          res.sendStatus(403);
          return;
        }
      }
      const messageSid = params.MessageSid || params.SmsSid || "";
      const messageStatus = params.MessageStatus || params.SmsStatus || "";
      if (messageSid && messageStatus) {
        const { applyTwilioMessageStatus } = await import("../commerce/merchant-notification.service.js");
        await applyTwilioMessageStatus({
          messageSid,
          messageStatus,
          errorCode: params.ErrorCode
        });
      }
      res.status(200).type("text/plain").send("ok");
    } catch {
      res.status(200).type("text/plain").send("ok");
    }
  });

  router.post("/mock/inbound", async (req, res, next) => {
    try {
      const { assertWhatsAppMockInboundAllowed } = await import("../commerce/payment-mode.js");
      assertWhatsAppMockInboundAllowed();
      const body = z
        .object({
          providerMessageId: z.string().min(3),
          from: z.string().min(7),
          text: z.string().optional(),
          buttonId: z.string().optional(),
          location: z
            .object({
              latitude: z.number(),
              longitude: z.number(),
              name: z.string().optional(),
              address: z.string().optional()
            })
            .optional(),
          profileName: z.string().optional()
        })
        .parse(req.body);

      const result = await routeInboundWhatsApp(body as InboundWhatsAppMessage, io);
      const provider = getWhatsAppProvider();
      res.json({
        ok: true,
        ...result,
        outbound: "sent" in provider ? (provider as { sent: unknown[] }).sent.slice(-5) : undefined
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const commerceAdminRouter = Router();
commerceAdminRouter.use(requireAuth, requireRole(UserRole.ADMIN));

commerceAdminRouter.get("/merchants", async (_req, res, next) => {
  try {
    const merchants = await prisma.merchant.findMany({
      include: {
        _count: { select: { products: true, orders: true } },
        products: { where: { archived: false, available: true }, select: { id: true } }
      },
      orderBy: { createdAt: "desc" }
    });
    res.json({
      merchants: merchants.map(({ products, ...m }) => ({
        ...m,
        availableProductCount: products.length
      }))
    });
  } catch (e) {
    next(e);
  }
});

commerceAdminRouter.get("/merchants/:id", async (req, res, next) => {
  try {
    const merchant = await prisma.merchant.findUnique({
      where: { id: String(req.params.id) },
      include: { _count: { select: { products: true, orders: true } } }
    });
    if (!merchant) {
      res.status(404).json({ error: "Merchant not found." });
      return;
    }
    const readiness = await getMerchantReadiness(merchant.id);
    res.json({ merchant, readiness });
  } catch (e) {
    next(e);
  }
});

commerceAdminRouter.post("/merchants", validateBody(createMerchantSchema), async (req, res, next) => {
  try {
    const merchant = await createMerchant(req.body);
    const readiness = await getMerchantReadiness(merchant.id);
    res.status(201).json({ merchant, readiness });
  } catch (e) {
    next(e);
  }
});

commerceAdminRouter.patch("/merchants/:id", validateBody(updateMerchantSchema), async (req, res, next) => {
  try {
    const merchant = await updateMerchant(String(req.params.id), req.body);
    const readiness = await getMerchantReadiness(merchant.id);
    res.json({ merchant, readiness });
  } catch (e) {
    next(e);
  }
});

commerceAdminRouter.get("/merchants/:id/readiness", async (req, res, next) => {
  try {
    const readiness = await getMerchantReadiness(String(req.params.id));
    res.json({ readiness });
  } catch (e) {
    next(e);
  }
});

commerceAdminRouter.get("/merchants/:id/products", async (req, res, next) => {
  try {
    const merchantId = String(req.params.id);
    const products = await listMerchantProducts(merchantId, true);
    res.json({ products });
  } catch (e) {
    next(e);
  }
});

commerceAdminRouter.post(
  "/merchants/:id/products",
  validateBody(upsertProductSchema),
  async (req, res, next) => {
    try {
      const product = await upsertProductForMerchant(String(req.params.id), req.body);
      res.status(201).json({ product });
    } catch (e) {
      next(e);
    }
  }
);

commerceAdminRouter.patch("/merchants/:id/products/:productId", async (req, res, next) => {
  try {
    const merchantId = String(req.params.id);
    const productId = String(req.params.productId);
    if (typeof req.body?.available === "boolean" && Object.keys(req.body).length === 1) {
      const product = await setProductAvailability(merchantId, productId, req.body.available);
      res.json({ product });
      return;
    }
    if (req.body?.archived === true) {
      const product = await archiveProduct(merchantId, productId);
      res.json({ product });
      return;
    }
    const product = await upsertProductForMerchant(merchantId, req.body, productId);
    res.json({ product });
  } catch (e) {
    next(e);
  }
});

commerceAdminRouter.patch("/merchants/:id/accepts-orders", async (req, res, next) => {
  try {
    const merchant = await setMerchantAcceptsOrders(String(req.params.id), Boolean(req.body?.acceptsOrders));
    res.json({ merchant });
  } catch (e) {
    next(e);
  }
});

commerceAdminRouter.post("/merchants/:id/catalog/preview", async (req, res, next) => {
  try {
    const merchantId = String(req.params.id);
    const text = String(req.body?.text ?? "");
    const existing = await listMerchantProducts(merchantId, true);
    const preview = previewBulkCatalogImport(
      text,
      existing.map((p) => p.name)
    );
    res.json({ preview });
  } catch (e) {
    next(e);
  }
});

commerceAdminRouter.post("/merchants/:id/catalog/import", async (req, res, next) => {
  try {
    const merchantId = String(req.params.id);
    const text = String(req.body?.text ?? "");
    const confirm = Boolean(req.body?.confirm);
    if (!confirm) {
      res.status(400).json({ error: "Set confirm=true after reviewing the preview." });
      return;
    }
    const result = await confirmBulkCatalogImport(merchantId, text);
    const readiness = await getMerchantReadiness(merchantId);
    res.json({ ...result, readiness });
  } catch (e) {
    next(e);
  }
});

commerceAdminRouter.post("/merchants/:id/test-basket", async (req, res, next) => {
  try {
    const body = z
      .object({
        customerLat: z.number().min(-90).max(90),
        customerLng: z.number().min(-180).max(180),
        items: z
          .array(
            z.object({
              query: z.string().min(1).max(120),
              quantity: z.number().int().min(1).max(50).default(1)
            })
          )
          .min(1)
          .max(30)
      })
      .parse(req.body);
    const result = await testMerchantBasket({
      merchantId: String(req.params.id),
      customerLat: body.customerLat,
      customerLng: body.customerLng,
      items: body.items
    });
    res.json({ result });
  } catch (e) {
    next(e);
  }
});

commerceAdminRouter.get("/orders", async (_req, res, next) => {
  try {
    const raw = await prisma.commerceOrder.findMany({
      take: 100,
      orderBy: { createdAt: "desc" },
      include: {
        merchant: { select: { id: true, name: true } },
        customer: { select: { id: true, fullName: true, phoneNumber: true } },
        commerceCustomer: { select: { id: true, displayName: true, whatsappPhone: true } },
        items: true,
        checkout: { select: { id: true, checkoutNumber: true, status: true, totalCents: true, paymentStatus: true } },
        linkedDeliveryGig: { select: { id: true, status: true, assignedWorkerId: true, updatedAt: true } },
        notificationAttempts: { orderBy: { updatedAt: "desc" }, take: 1 }
      }
    });
    const orderIds = raw.map((o) => o.id);
    const gigIds = raw.map((o) => o.linkedDeliveryGig?.id).filter((id): id is string => Boolean(id));
    const releases = await prisma.courierDeliveryRelease.findMany({
      where: {
        OR: [
          ...(orderIds.length ? [{ commerceOrderId: { in: orderIds } }] : []),
          ...(gigIds.length ? [{ gigId: { in: gigIds } }] : [])
        ]
      },
      orderBy: { createdAt: "desc" }
    });
    const releaseByOrder = new Map<string, (typeof releases)[number]>();
    const releaseByGig = new Map<string, (typeof releases)[number]>();
    for (const r of releases) {
      if (r.commerceOrderId && !releaseByOrder.has(r.commerceOrderId)) releaseByOrder.set(r.commerceOrderId, r);
      if (!releaseByGig.has(r.gigId)) releaseByGig.set(r.gigId, r);
    }
    const orders = raw.map((o) => {
      const latestNotify = o.notificationAttempts[0] ?? null;
      const release =
        (o.id ? releaseByOrder.get(o.id) : undefined) ??
        (o.linkedDeliveryGig?.id ? releaseByGig.get(o.linkedDeliveryGig.id) : undefined) ??
        null;
      return {
      ...o,
      displayNumber: o.checkout
        ? `${o.checkout.checkoutNumber}-${o.fulfillmentLabel ?? "?"}`
        : o.orderNumber,
      parentCheckout: o.checkout
        ? {
            id: o.checkout.id,
            orderNumber: o.checkout.checkoutNumber,
            status: o.checkout.status,
            paymentStatus: o.checkout.paymentStatus,
            totalCents: o.checkout.totalCents,
            shopCount: undefined as number | undefined
          }
        : null,
      fulfillmentIssue: fulfillmentAdminLabel({
        notes: o.notes,
        status: o.status,
        hasCourier: Boolean(o.linkedDeliveryGig?.assignedWorkerId)
      }),
      merchantNotification: latestNotify
        ? {
            status: latestNotify.status,
            label: merchantNotificationAdminLabel(latestNotify.status),
            attemptCount: latestNotify.attemptCount,
            lastErrorCategory: latestNotify.lastErrorCategory,
            providerMessageSid: latestNotify.providerMessageSid,
            deliveredAt: latestNotify.deliveredAt
          }
        : null,
      courierRelease: release
        ? {
            reason: release.reason,
            stage: release.stage,
            outcome: release.outcome,
            createdAt: release.createdAt
          }
        : null,
      waitingSince: o.confirmedAt ?? o.createdAt
    };
    });
    res.json({ orders });
  } catch (e) {
    next(e);
  }
});

commerceAdminRouter.post("/orders/:id/retry-whatsapp", async (req, res, next) => {
  try {
    const order = await prisma.commerceOrder.findUnique({
      where: { id: String(req.params.id) },
      select: { id: true, paymentStatus: true, orderNumber: true }
    });
    if (!order) {
      res.status(404).json({ error: "ORDER_NOT_FOUND" });
      return;
    }
    if (order.orderNumber === 2) {
      res.status(409).json({ error: "ORDER_LOCKED", message: "This historical order cannot be retried." });
      return;
    }
    const { retryMerchantNewOrderNotification } = await import("../commerce/merchant-notification.service.js");
    const result = await retryMerchantNewOrderNotification(order.id);
    res.json({
      ok: true,
      orderId: order.id,
      notification: {
        status: result.status,
        providerMessageSid: result.providerMessageSid ?? null
      }
    });
  } catch (e) {
    next(e);
  }
});

export type { MetaWebhookPayload };
