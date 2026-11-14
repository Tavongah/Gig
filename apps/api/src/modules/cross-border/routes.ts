import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { UserRole } from "@prisma/client";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { crossBorderEnabled, crossBorderPaymentLinksEnabled, crossBorderPaymentsEnabled } from "./flag.js";
import { createCrossBorderRequest, getCrossBorderRequest, listCrossBorderRequests, publicTracking } from "./request.service.js";
import { approveCrossBorderQuote, createCrossBorderQuote } from "./quote.service.js";
import { acceptAndPayEcoCash, applyCrossBorderProviderResult, generateCrossBorderPaymentLink, parseCrossBorderCallback, publicPaymentView, reconcileCrossBorderPayment } from "./payment.service.js";
import { confirmManualCrossBorderPayment, openManualPaymentDispute } from "./manual-payment.service.js";
import { sendCrossBorderQuote } from "./notify.service.js";
import { recordCrossBorderPurchase, recordCrossBorderShipment } from "./fulfillment.service.js";
import { changeCrossBorderStatus } from "./request.service.js";
import { REQUEST_STATUSES, type RequestStatus } from "./domain.js";

const submitLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });

function routeParam(value: string | string[] | undefined): string {
  const found = Array.isArray(value) ? value[0] : value;
  if (!found) throw new Error("MISSING_PARAM");
  return found;
}

const lineSchema = z.object({
  retailer: z.string().min(2).max(40),
  productUrl: z.string().min(8).max(2000),
  productName: z.string().min(1).max(200),
  quantity: z.number().int().min(1).max(20),
  size: z.string().max(80).nullable().optional(),
  color: z.string().max(80).nullable().optional(),
  variantDetails: z.string().max(200).nullable().optional(),
  notes: z.string().max(500).nullable().optional()
});

const requestSchema = z.object({
  customerName: z.string().min(2).max(120),
  phone: z.string().max(30).nullable().optional(),
  email: z.string().max(200).nullable().optional(),
  preferredContactChannel: z.enum(["WHATSAPP", "EMAIL"]).nullable().optional(),
  destinationCity: z.string().min(2).max(80),
  deliveryAddress: z.string().min(3).max(300),
  deliveryInstructions: z.string().max(500).nullable().optional(),
  lines: z.array(lineSchema).min(1).max(15),
  acceptTerms: z.literal(true)
});

const quoteSchema = z.object({
  merchandiseSubtotalCents: z.number().int().nonnegative(),
  saShippingCents: z.number().int().nonnegative(),
  crossBorderFreightCents: z.number().int().nonnegative(),
  customsCents: z.number().int().nonnegative(),
  customsIsEstimate: z.boolean(),
  serviceFeeCents: z.number().int().nonnegative(),
  zimbabweDeliveryCents: z.number().int().nonnegative(),
  additionalCents: z.number().int().nonnegative().optional(),
  additionalLabel: z.string().max(120).nullable().optional(),
  zarMerchandiseCents: z.number().int().positive().nullable().optional(),
  exchangeRate: z.string().max(32).nullable().optional(),
  exchangeRateSource: z.string().max(120).nullable().optional(),
  exchangeRateAt: z.string().datetime().nullable().optional(),
  expiresAt: z.string().min(8),
  deliveryEstimateNote: z.string().max(300).nullable().optional(),
  lines: z.array(z.object({ requestLineId: z.string().uuid(), unitPriceCents: z.number().int().nonnegative() })).min(1)
});

export function createCrossBorderRouter() {
  const router = Router();

  router.get("/status", (_req, res) => {
    res.json({
      enabled: crossBorderEnabled(),
      paymentLinksEnabled: crossBorderPaymentLinksEnabled(),
      paymentsEnabled: crossBorderPaymentsEnabled(),
      cardPayments: false,
      ecocash: crossBorderPaymentsEnabled()
    });
  });

  router.post("/requests", submitLimiter, validateBody(requestSchema), async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof requestSchema>;
      const result = await createCrossBorderRequest({ ...body, source: "WEB" });
      res.status(201).json({
        reference: result.request.reference,
        requestId: result.request.id,
        trackingToken: result.trackingToken,
        message: result.message
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/track/:token", async (req, res, next) => {
    try {
      res.json(await publicTracking(routeParam(req.params.token)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/pay/:token", async (req, res, next) => {
    try {
      res.json(await publicPaymentView(routeParam(req.params.token)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/pay/:token", async (req, res, next) => {
    try {
      const body = z.object({
        accept: z.literal(true),
        method: z.enum(["ECOCASH", "CARD"]),
        payerPhone: z.string().optional()
      }).parse(req.body);
      if (body.method === "CARD") {
        res.status(400).json({ error: "Card payments are not available.", code: "CARD_NOT_AVAILABLE" });
        return;
      }
      const result = await acceptAndPayEcoCash({
        token: routeParam(req.params.token),
        payerPhone: body.payerPhone ?? "",
        accept: true
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/payments/zb/callback", async (req, res) => {
    try {
      const reference = parseCrossBorderCallback(req.body);
      if (reference) await applyCrossBorderProviderResult(reference);
    } catch {
      /* Acknowledge the gateway. Paid state changes only after a verified status check. */
    }
    res.status(200).json({ ok: true });
  });

  router.get("/payments/zb/return", (_req, res) => {
    res.status(200).send("Return received. DUTS confirms payment only after the provider verifies it.");
  });

  return router;
}

export const crossBorderAdminRouter = Router();
crossBorderAdminRouter.use(requireAuth, requireRole(UserRole.ADMIN));

crossBorderAdminRouter.get("/requests", async (req, res, next) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const requests = await listCrossBorderRequests(status);
    res.json({ requests });
  } catch (error) {
    next(error);
  }
});

crossBorderAdminRouter.get("/requests/:id", async (req, res, next) => {
  try {
    res.json({ request: await getCrossBorderRequest(routeParam(req.params.id)) });
  } catch (error) {
    next(error);
  }
});

crossBorderAdminRouter.post("/requests/:id/quotes", validateBody(quoteSchema), async (req, res, next) => {
  try {
    const quote = await createCrossBorderQuote({
      requestId: routeParam(req.params.id),
      actorId: req.auth!.userId,
      ...(req.body as z.infer<typeof quoteSchema>)
    });
    res.status(201).json({ quote });
  } catch (error) {
    next(error);
  }
});

crossBorderAdminRouter.post("/quotes/:id/approve", async (req, res, next) => {
  try {
    res.json({ quote: await approveCrossBorderQuote(routeParam(req.params.id), req.auth!.userId) });
  } catch (error) {
    next(error);
  }
});

crossBorderAdminRouter.post("/quotes/:id/payment-link", async (req, res, next) => {
  try {
    res.status(201).json(await generateCrossBorderPaymentLink(routeParam(req.params.id), req.auth!.userId));
  } catch (error) {
    next(error);
  }
});

crossBorderAdminRouter.post("/requests/:id/confirm-external-payment", async (req, res, next) => {
  try {
    const body = z.object({
      quoteId: z.string().uuid(),
      transactionReference: z.string(),
      orderReference: z.string().nullable().optional(),
      amountCents: z.number().int(),
      currency: z.string(),
      confirmedAt: z.string(),
      attested: z.literal(true)
    }).parse(req.body);
    res.status(201).json(await confirmManualCrossBorderPayment({
      ...body,
      requestId: routeParam(req.params.id),
      actorId: req.auth!.userId
    }));
  } catch (error) {
    next(error);
  }
});

crossBorderAdminRouter.post("/payments/:id/dispute", async (req, res, next) => {
  try {
    const body = z.object({
      reason: z.string(),
      note: z.string().max(300).nullable().optional()
    }).parse(req.body);
    res.json(await openManualPaymentDispute({
      paymentId: routeParam(req.params.id),
      actorId: req.auth!.userId,
      reason: body.reason,
      note: body.note
    }));
  } catch (error) {
    next(error);
  }
});

crossBorderAdminRouter.post("/payments/:id/reconcile", async (req, res, next) => {
  try {
    res.json(await reconcileCrossBorderPayment(routeParam(req.params.id)));
  } catch (error) {
    next(error);
  }
});

crossBorderAdminRouter.post("/quotes/:id/send", async (req, res, next) => {
  try {
    res.json(await sendCrossBorderQuote(routeParam(req.params.id), req.auth!.userId));
  } catch (error) {
    next(error);
  }
});

crossBorderAdminRouter.post("/requests/:id/status", async (req, res, next) => {
  try {
    const body = z.object({ status: z.string().refine((value): value is RequestStatus => (REQUEST_STATUSES as readonly string[]).includes(value)) }).parse(req.body);
    const request = await changeCrossBorderStatus({
      requestId: routeParam(req.params.id),
      to: body.status as RequestStatus,
      actorId: req.auth!.userId,
      action: "status_changed"
    });
    res.json({ request });
  } catch (error) {
    next(error);
  }
});

crossBorderAdminRouter.post("/requests/:id/purchase", async (req, res, next) => {
  try {
    const body = z.object({
      retailerOrderReference: z.string().min(1).max(120),
      purchaseAmountCents: z.number().int().positive(),
      purchaseCurrency: z.string().min(3).max(3),
      purchaseDate: z.string(),
      receiptReference: z.string().min(1).max(200),
      saReceivingNote: z.string().max(300).nullable().optional()
    }).parse(req.body);
    const request = await recordCrossBorderPurchase({ ...body, requestId: routeParam(req.params.id), actorId: req.auth!.userId });
    res.json({ request });
  } catch (error) {
    next(error);
  }
});

crossBorderAdminRouter.post("/requests/:id/shipment", async (req, res, next) => {
  try {
    const body = z.object({
      to: z.string().refine((value): value is RequestStatus => (REQUEST_STATUSES as readonly string[]).includes(value)),
      retailerTrackingNumber: z.string().max(120).nullable().optional(),
      shippingProvider: z.string().max(120).nullable().optional(),
      trackingNumber: z.string().max(120).nullable().optional(),
      customsNote: z.string().max(300).nullable().optional(),
      saReceivingNote: z.string().max(300).nullable().optional()
    }).parse(req.body);
    const request = await recordCrossBorderShipment({
      ...body,
      to: body.to as RequestStatus,
      requestId: routeParam(req.params.id),
      actorId: req.auth!.userId
    });
    res.json({ request });
  } catch (error) {
    next(error);
  }
});
