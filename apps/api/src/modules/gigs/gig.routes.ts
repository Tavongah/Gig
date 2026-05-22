import { Router } from "express";
import type { Server } from "socket.io";
import { createGigSchema, gigEstimateSchema } from "@gigflow/shared";
import { UserRole } from "@prisma/client";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { acceptGig, createGig, estimateGig, findNearbyGigs, listCategories } from "./gig.service.js";

export function createGigRouter(io: Server): Router {
  const router = Router();

  router.get("/categories", async (_req, res, next) => {
    try {
      const categories = await listCategories();
      res.json({ categories });
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
      const gig = await createGig(req.auth!.userId, req.body, io);
      res.status(201).json({ gig });
    } catch (error) {
      next(error);
    }
  });

  router.get("/nearby", requireAuth, requireRole(UserRole.WORKER), async (req, res, next) => {
    try {
      const gigs = await findNearbyGigs(req.auth!.userId);
      res.json({ gigs });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:gigId/accept", requireAuth, requireRole(UserRole.WORKER), async (req, res, next) => {
    try {
      const { gigId } = req.params;
      if (!gigId || Array.isArray(gigId)) {
        res.status(400).json({ error: "GIG_ID_REQUIRED" });
        return;
      }

      const gig = await acceptGig(gigId, req.auth!.userId);
      io.to(`gig:${gig.id}`).to(`user:${gig.clientId}`).emit("gig:matched", { gig });
      res.json({ gig });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
