import { Router } from "express";
import { validateBody } from "../../middleware/validate.js";
import { requireAuth } from "../../middleware/auth.js";
import { createSession, getAuthenticatedUser, sessionRequestSchema } from "./auth.service.js";

export const authRouter = Router();

authRouter.post("/session", validateBody(sessionRequestSchema), async (req, res, next) => {
  try {
    const session = await createSession(req.body);
    res.status(201).json(session);
  } catch (error) {
    next(error);
  }
});

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await getAuthenticatedUser(req.auth!.userId);
    res.json({ user });
  } catch (error) {
    next(error);
  }
});
