import { Router } from "express";
import { workerAvailabilitySchema } from "@gigflow/shared";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { requireApprovedWorker, requireAuth, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import {
  findAvailableWorkersNearby,
  getWorkerEarnings,
  setWorkerOffline,
  updateWorkerAvailability
} from "./worker.service.js";

const nearbyQuerySchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radiusMiles: z.coerce.number().min(1).max(50).default(20)
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

workerRouter.get("/earnings", requireAuth, requireRole(UserRole.WORKER), requireApprovedWorker, async (req, res, next) => {
  try {
    const earnings = await getWorkerEarnings(req.auth!.userId);
    res.json({ earnings });
  } catch (error) {
    next(error);
  }
});

workerRouter.post("/offline", requireAuth, requireRole(UserRole.WORKER), requireApprovedWorker, async (req, res, next) => {
  try {
    await setWorkerOffline(req.auth!.userId);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
