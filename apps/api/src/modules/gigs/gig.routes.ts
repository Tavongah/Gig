import { Router } from "express";

import type { Server } from "socket.io";

import { createGigSchema, gigEstimateSchema } from "@gigflow/shared";

import { UserRole } from "@prisma/client";

import { requireApprovedWorker, requireAuth, requireRole } from "../../middleware/auth.js";

import { validateBody } from "../../middleware/validate.js";
import { assertDevOnlyPaymentBypass } from "../../lib/production-guards.js";

import { z } from "zod";

import {

  acceptGig,

  createGig,

  estimateGig,

  findNearbyGigs,

  getGigDetail,

  listCategories,

  listChatMessages,

  listClientGigs,

  listWorkerGigs,

  publishGigWithoutPayment,

  sendChatMessage,

  updateGigStatus

} from "./gig.service.js";

import {
  approveExtraTime,
  approveGigCompletion,
  authorizeWorkerSelectionWithoutStripe,
  cancelAssignedWorkerAndRematch,
  getWorkerMatchingInterest,
  getWorkerSelectionSummary,
  listGigInterests,
  listWorkerMatchingInterests,
  selectWorkerForGig,
  withdrawWorkerInterest
} from "./gig-workflow.service.js";



const statusUpdateSchema = z.object({

  status: z.enum([

    "WORKER_EN_ROUTE",

    "WORKER_ARRIVED",

    "IN_PROGRESS",

    "WAITING_CUSTOMER_CONFIRMATION",

    "COMPLETED",

    "CANCELLED"

  ]),

  latitude: z.number().min(-90).max(90).optional(),

  longitude: z.number().min(-180).max(180).optional(),

  cancellationReason: z.string().trim().max(500).optional()

});



const selectWorkerSchema = z.object({ workerId: z.string().uuid() });

const approveExtraTimeSchema = z.object({ extraMinutes: z.number().int().min(15).max(480) });

const workerCancelSchema = z.object({
  reason: z.string().min(3).max(500)
});



export function createGigRouter(io: Server): Router {

  const router = Router();



  router.get("/categories", async (_req, res, next) => {

    try {

      const grouped = await listCategories();

      res.json(grouped);

    } catch (error) {

      next(error);

    }

  });

  router.get("/worker/matching", requireAuth, requireRole(UserRole.WORKER), requireApprovedWorker, async (req, res, next) => {
    try {
      const interests = await listWorkerMatchingInterests(req.auth!.userId);
      res.json({ interests });
    } catch (error) {
      next(error);
    }
  });



  router.post("/estimate", requireAuth, validateBody(gigEstimateSchema), async (req, res, next) => {

    try {

      const estimate = await estimateGig(req.body);

      res.json({ estimate });

    } catch (error) {

      next(error);

    }

  });



  router.post("/", requireAuth, requireRole(UserRole.CLIENT, UserRole.ADMIN), validateBody(createGigSchema), async (req, res, next) => {

    try {
      const headerKey = req.get("Idempotency-Key") ?? req.get("idempotency-key");
      const gig = await createGig(req.auth!.userId, req.body, io, {
        idempotencyKey: typeof headerKey === "string" ? headerKey : null
      });

      res.status(201).json({
        success: true,
        gigId: gig.id,
        status: gig.status,
        gig
      });

    } catch (error) {

      next(error);

    }

  });



  router.post("/:gigId/publish", requireAuth, requireRole(UserRole.CLIENT, UserRole.ADMIN), async (req, res, next) => {

    try {

      assertDevOnlyPaymentBypass("Publish without payment");

      const gigId = String(req.params.gigId);

      await publishGigWithoutPayment(gigId, req.auth!.userId);

      const gig = await getGigDetail(gigId, req.auth!.userId);

      res.json({ gig });

    } catch (error) {

      next(error);

    }

  });



  router.get("/nearby", requireAuth, requireRole(UserRole.WORKER), requireApprovedWorker, async (req, res, next) => {

    try {

      const gigs = await findNearbyGigs(req.auth!.userId);

      res.json({ gigs });

    } catch (error) {

      next(error);

    }

  });



  router.get("/mine", requireAuth, async (req, res, next) => {

    try {

      const as = typeof req.query.as === "string" ? req.query.as : undefined;



      if (as === "WORKER") {

        const gigs = await listWorkerGigs(req.auth!.userId);

        res.json({ gigs });

      } else {

        const gigs = await listClientGigs(req.auth!.userId);

        res.json({ gigs });

      }

    } catch (error) {

      next(error);

    }

  });



  router.get("/:gigId/chat", requireAuth, async (req, res, next) => {

    try {

      const { gigId } = req.params;

      if (!gigId || Array.isArray(gigId)) {

        res.status(400).json({ error: "GIG_ID_REQUIRED" });

        return;

      }



      const messages = await listChatMessages(gigId, req.auth!.userId);

      res.json({ messages });

    } catch (error) {

      next(error);

    }

  });



  router.post(
    "/:gigId/chat",
    requireAuth,
    validateBody(z.object({ body: z.string().trim().min(1).max(2000) })),
    async (req, res, next) => {
      try {
        const { gigId } = req.params;
        if (!gigId || Array.isArray(gigId)) {
          res.status(400).json({ error: "GIG_ID_REQUIRED" });
          return;
        }

        const message = await sendChatMessage(gigId, req.auth!.userId, req.body.body, io);
        res.status(201).json({ message });
      } catch (error) {
        next(error);
      }
    }
  );



  router.get("/:gigId/tracking", requireAuth, async (req, res, next) => {

    try {

      const { gigId } = req.params;

      if (!gigId || Array.isArray(gigId)) {

        res.status(400).json({ error: "GIG_ID_REQUIRED" });

        return;

      }



      const gig = await getGigDetail(gigId, req.auth!.userId);

      res.json({ gig });

    } catch (error) {

      next(error);

    }

  });



  router.get("/:gigId", requireAuth, async (req, res, next) => {

    try {

      const { gigId } = req.params;

      if (!gigId || Array.isArray(gigId)) {

        res.status(400).json({ error: "GIG_ID_REQUIRED" });

        return;

      }



      const gig = await getGigDetail(gigId, req.auth!.userId);

      res.json({ gig });

    } catch (error) {

      next(error);

    }

  });



  router.post("/:gigId/accept", requireAuth, requireRole(UserRole.WORKER), requireApprovedWorker, async (req, res, next) => {

    try {

      const { gigId } = req.params;

      if (!gigId || Array.isArray(gigId)) {

        res.status(400).json({ error: "GIG_ID_REQUIRED" });

        return;

      }



      const gig = await acceptGig(gigId, req.auth!.userId, io);

      res.json({ gig });

    } catch (error) {

      next(error);

    }

  });

  router.get("/:gigId/my-interest", requireAuth, requireRole(UserRole.WORKER), requireApprovedWorker, async (req, res, next) => {
    try {
      const result = await getWorkerMatchingInterest(String(req.params.gigId), req.auth!.userId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/:gigId/withdraw-interest", requireAuth, requireRole(UserRole.WORKER), requireApprovedWorker, async (req, res, next) => {
    try {
      const result = await withdrawWorkerInterest(String(req.params.gigId), req.auth!.userId, io);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/:gigId/cancel-by-worker",
    requireAuth,
    requireRole(UserRole.WORKER),
    requireApprovedWorker,
    validateBody(workerCancelSchema),
    async (req, res, next) => {
      try {
        const result = await cancelAssignedWorkerAndRematch(
          String(req.params.gigId),
          req.auth!.userId,
          req.body.reason,
          io
        );
        res.json(result);
      } catch (error) {
        next(error);
      }
    }
  );



  router.patch("/:gigId/status", requireAuth, validateBody(statusUpdateSchema), async (req, res, next) => {

    try {

      const { gigId } = req.params;

      if (!gigId || Array.isArray(gigId)) {

        res.status(400).json({ error: "GIG_ID_REQUIRED" });

        return;

      }



      const gig = await updateGigStatus(
        gigId,
        req.auth!.userId,
        req.body.status,
        io,
        req.body.latitude !== undefined && req.body.longitude !== undefined
          ? { latitude: req.body.latitude, longitude: req.body.longitude }
          : undefined,
        { cancellationReason: req.body.cancellationReason }
      );

      res.json({ gig });

    } catch (error) {

      next(error);

    }

  });



  router.get("/:gigId/interests", requireAuth, requireRole(UserRole.CLIENT, UserRole.ADMIN), async (req, res, next) => {
    try {
      const gigId = String(req.params.gigId);
      const interests = await listGigInterests(gigId, req.auth!.userId);
      res.json({ interests });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:gigId/selection/:workerId", requireAuth, requireRole(UserRole.CLIENT, UserRole.ADMIN), async (req, res, next) => {
    try {
      const summary = await getWorkerSelectionSummary(String(req.params.gigId), req.auth!.userId, String(req.params.workerId));
      res.json(summary);
    } catch (error) {
      next(error);
    }
  });

  router.post("/:gigId/select-worker", requireAuth, requireRole(UserRole.CLIENT, UserRole.ADMIN), validateBody(selectWorkerSchema), async (req, res, next) => {
    try {
      const summary = await selectWorkerForGig(String(req.params.gigId), req.auth!.userId, req.body.workerId, io);
      res.json(summary);
    } catch (error) {
      next(error);
    }
  });

  router.post("/:gigId/authorize-without-stripe", requireAuth, requireRole(UserRole.CLIENT, UserRole.ADMIN), async (req, res, next) => {
    try {
      assertDevOnlyPaymentBypass("Authorize without Stripe");
      const summary = await authorizeWorkerSelectionWithoutStripe(String(req.params.gigId), req.auth!.userId, io);
      res.json(summary);
    } catch (error) {
      next(error);
    }
  });

  router.post("/:gigId/approve-completion", requireAuth, requireRole(UserRole.CLIENT, UserRole.ADMIN), async (req, res, next) => {
    try {
      const result = await approveGigCompletion(String(req.params.gigId), req.auth!.userId, io);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/:gigId/release-worker-payment", requireAuth, requireRole(UserRole.ADMIN), async (req, res, next) => {
    try {
      const { releaseWorkerPayment } = await import("../payments/payment.service.js");
      const result = await releaseWorkerPayment(String(req.params.gigId));
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/:gigId/approve-extra-time", requireAuth, requireRole(UserRole.CLIENT, UserRole.ADMIN), validateBody(approveExtraTimeSchema), async (req, res, next) => {
    try {
      const result = await approveExtraTime(String(req.params.gigId), req.auth!.userId, req.body.extraMinutes, io);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });



  return router;

}


