import { Router } from "express";
import { workerAvailabilitySchema, workerPreferencesSchema, MAX_WORKER_TRAVEL_MILES } from "@gigflow/shared";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { requireApprovedWorker, requireAuth, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import {
  getWorkerWithdrawalOnboardingLink,
  requestWorkerWithdrawal
} from "../payments/worker-earnings.service.js";
import {
  findAvailableWorkersNearby,
  getWorkerEarnings,
  setWorkerOffline,
  updateWorkerAvailability,
  updateWorkerLocation,
  updateWorkerPreferences
} from "./worker.service.js";

const nearbyQuerySchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radiusMiles: z.coerce.number().min(1).max(MAX_WORKER_TRAVEL_MILES).default(20)
});

const withdrawBodySchema = z.object({
  amountCents: z.number().int().positive().optional()
});

const workerLocationBodySchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  query: z.string().trim().min(8).max(240).optional(),
  placeId: z.string().trim().min(3).max(200).optional(),
  formattedAddress: z.string().trim().min(8).max(240).optional()
});

export const workerRouter = Router();

workerRouter.get("/available-nearby", requireAuth, requireRole(UserRole.CLIENT, UserRole.ADMIN), async (req, res, next) => {
  try {
    const query = nearbyQuerySchema.parse(req.query);
    const workers = await findAvailableWorkersNearby(query.latitude, query.longitude, query.radiusMiles);
    res.json({ workers });
  } catch (error) {
    next(error);
  }
});

workerRouter.patch(
  "/preferences",
  requireAuth,
  requireRole(UserRole.WORKER),
  validateBody(workerPreferencesSchema),
  async (req, res, next) => {
    try {
      const profile = await updateWorkerPreferences(req.auth!.userId, req.body);
      res.json({ profile });
    } catch (error) {
      next(error);
    }
  }
);

workerRouter.patch(
  "/availability",
  requireAuth,
  requireRole(UserRole.WORKER),
  requireApprovedWorker,
  validateBody(workerAvailabilitySchema),
  async (req, res, next) => {
    try {
      const profile = await updateWorkerAvailability(req.auth!.userId, req.body);
      res.json({ profile });
    } catch (error) {
      next(error);
    }
  }
);

workerRouter.patch(
  "/location",
  requireAuth,
  requireRole(UserRole.WORKER),
  requireApprovedWorker,
  validateBody(workerLocationBodySchema),
  async (req, res, next) => {
    try {
      const profile = await updateWorkerLocation(req.auth!.userId, req.body);
      res.json({ profile });
    } catch (error) {
      next(error);
    }
  }
);

workerRouter.get("/earnings", requireAuth, requireRole(UserRole.WORKER), requireApprovedWorker, async (req, res, next) => {
  try {
    const earnings = await getWorkerEarnings(req.auth!.userId);
    res.json({ earnings });
  } catch (error) {
    next(error);
  }
});

workerRouter.post(
  "/withdraw",
  requireAuth,
  requireRole(UserRole.WORKER),
  requireApprovedWorker,
  validateBody(withdrawBodySchema),
  async (req, res, next) => {
    try {
      const result = await requestWorkerWithdrawal(req.auth!.userId, req.body.amountCents);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

workerRouter.post(
  "/withdraw/onboarding-link",
  requireAuth,
  requireRole(UserRole.WORKER),
  requireApprovedWorker,
  async (req, res, next) => {
    try {
      const link = await getWorkerWithdrawalOnboardingLink(req.auth!.userId);
      res.json(link);
    } catch (error) {
      next(error);
    }
  }
);

workerRouter.post("/offline", requireAuth, requireRole(UserRole.WORKER), requireApprovedWorker, async (req, res, next) => {
  try {
    await setWorkerOffline(req.auth!.userId);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
