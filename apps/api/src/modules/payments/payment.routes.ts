import { Router } from "express";
import type { Request, Response } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { env } from "../../config/env.js";
import { requireAuth, requireApprovedWorker, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { getStripe, getStripePublishableKey, isStripeConfigured } from "../../lib/stripe.js";
import {
  createCheckoutSession,
  createConnectAccountLink,
  getPaymentStatusForGig,
  getWorkerConnectStatus,
  handleAccountUpdated,
  handleCheckoutSessionCompleted,
  handlePaymentIntentAuthorized,
  handlePaymentIntentFailed
} from "./payment.service.js";

const gigIdSchema = z.object({ gigId: z.string().uuid() });

export const paymentRouter = Router();

paymentRouter.get("/config", (_req, res) => {
  res.json({
    stripeConfigured: isStripeConfigured(),
    publishableKey: getStripePublishableKey()
  });
});

paymentRouter.get("/return/success", (req, res) => {
  const gigId = typeof req.query.gigId === "string" ? req.query.gigId : "";
  const target = `${env.MOBILE_PUBLIC_URL}/payment-success?gigId=${encodeURIComponent(gigId)}`;
  res.redirect(target);
});

paymentRouter.get("/return/cancel", (req, res) => {
  const gigId = typeof req.query.gigId === "string" ? req.query.gigId : "";
  const target = `${env.MOBILE_PUBLIC_URL}/payment-failed?gigId=${encodeURIComponent(gigId)}`;
  res.redirect(target);
});

paymentRouter.get("/connect/return/refresh", (_req, res) => {
  res.redirect(`${env.MOBILE_PUBLIC_URL}/connect-return?refresh=1`);
});

paymentRouter.post("/webhook", async (req: Request, res: Response) => {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    res.status(503).json({ error: "STRIPE_WEBHOOK_SECRET_NOT_CONFIGURED" });
    return;
  }

  const signature = req.header("stripe-signature");
  if (!signature) {
    res.status(400).json({ error: "MISSING_STRIPE_SIGNATURE" });
    return;
  }

  try {
    const stripe = getStripe();
    const event = stripe.webhooks.constructEvent(req.body, signature, env.STRIPE_WEBHOOK_SECRET);
    console.info("[stripe] webhook_received", { type: event.type, id: event.id });

    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(event.data.object);
        break;
      case "payment_intent.amount_capturable_updated":
        await handlePaymentIntentAuthorized(event.data.object);
        break;
      case "payment_intent.succeeded":
        await handlePaymentIntentAuthorized(event.data.object);
        break;
      case "payment_intent.payment_failed":
        await handlePaymentIntentFailed(event.data.object);
        break;
      case "account.updated":
        await handleAccountUpdated(event.data.object);
        break;
      default:
        break;
    }

    res.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook error:", error);
    res.status(400).json({ error: "WEBHOOK_ERROR" });
  }
});

paymentRouter.use(requireAuth);

paymentRouter.post("/checkout-session", validateBody(gigIdSchema), async (req, res, next) => {
  try {
    const result = await createCheckoutSession(req.body.gigId, req.auth!.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

paymentRouter.get("/gigs/:gigId/status", async (req, res, next) => {
  try {
    const payment = await getPaymentStatusForGig(String(req.params.gigId), req.auth!.userId);
    res.json({ payment });
  } catch (error) {
    next(error);
  }
});

paymentRouter.post("/connect/account", requireRole(UserRole.WORKER), requireApprovedWorker, async (req, res, next) => {
  try {
    const status = await getWorkerConnectStatus(req.auth!.userId);
    res.json({ connect: status });
  } catch (error) {
    next(error);
  }
});

paymentRouter.post("/connect/account-link", requireRole(UserRole.WORKER), requireApprovedWorker, async (req, res, next) => {
  try {
    const link = await createConnectAccountLink(req.auth!.userId);
    res.json(link);
  } catch (error) {
    next(error);
  }
});

paymentRouter.get("/connect/status", requireRole(UserRole.WORKER), requireApprovedWorker, async (req, res, next) => {
  try {
    const connect = await getWorkerConnectStatus(req.auth!.userId);
    res.json({ connect });
  } catch (error) {
    next(error);
  }
});
