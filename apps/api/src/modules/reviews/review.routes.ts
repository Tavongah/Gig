import { Router } from "express";
import { createReviewSchema } from "@gigflow/shared";
import { requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { createGigReview, listGigReviews } from "./review.service.js";

export const reviewRouter = Router();

reviewRouter.post(
  "/gigs/:gigId/reviews",
  requireAuth,
  validateBody(createReviewSchema),
  async (req, res, next) => {
    try {
      const { gigId } = req.params;
      if (!gigId || Array.isArray(gigId)) {
        res.status(400).json({ success: false, error: "GIG_ID_REQUIRED" });
        return;
      }

      const review = await createGigReview(gigId, req.auth!.userId, req.body);
      res.status(201).json({ review });
    } catch (error) {
      next(error);
    }
  }
);

reviewRouter.get("/gigs/:gigId/reviews", requireAuth, async (req, res, next) => {
  try {
    const { gigId } = req.params;
    if (!gigId || Array.isArray(gigId)) {
      res.status(400).json({ success: false, error: "GIG_ID_REQUIRED" });
      return;
    }

    const reviews = await listGigReviews(gigId, req.auth!.userId);
    res.json({ reviews });
  } catch (error) {
    next(error);
  }
});
