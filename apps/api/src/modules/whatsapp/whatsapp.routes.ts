import { Router } from "express";
import type { Server } from "socket.io";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { createMerchantSchema, upsertProductSchema } from "@gigflow/shared";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { prisma } from "../../config/prisma.js";
import {
  archiveProduct,
  createMerchant,
  listMerchantProducts,
  setMerchantAcceptsOrders,
  setProductAvailability,
  upsertProductForMerchant
} from "../commerce/merchant.service.js";
import { getWhatsAppProvider } from "./provider.js";
import { routeInboundWhatsApp } from "./merchant-handler.js";
import type { InboundWhatsAppMessage } from "./customer-handler.js";
import { extractMetaMessages, type MetaWebhookPayload } from "./meta-payload.js";
import {
  extractTwilioMessage,
  resolveTwilioWebhookUrl,
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
      include: { _count: { select: { products: true, orders: true } } },
      orderBy: { createdAt: "desc" }
    });
    res.json({ merchants });
  } catch (e) {
    next(e);
  }
});

commerceAdminRouter.post("/merchants", validateBody(createMerchantSchema), async (req, res, next) => {
  try {
    const merchant = await createMerchant(req.body);
    res.status(201).json({ merchant });
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

commerceAdminRouter.get("/orders", async (_req, res, next) => {
  try {
    const orders = await prisma.commerceOrder.findMany({
      take: 100,
      orderBy: { createdAt: "desc" },
      include: {
        merchant: { select: { id: true, name: true } },
        customer: { select: { id: true, fullName: true, phoneNumber: true } },
        items: true,
        linkedDeliveryGig: { select: { id: true, status: true } }
      }
    });
    res.json({ orders });
  } catch (e) {
    next(e);
  }
});

export type { MetaWebhookPayload };
