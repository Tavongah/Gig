import { Router } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import {
  createDevSession,
  getAuthenticatedUser,
  login,
  registerCustomer,
  registerWorker,
  requestPasswordReset,
  resetPassword
} from "./auth.service.js";
import { customerRegisterSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema, workerRegisterSchema } from "@gigflow/shared";

export const authRouter = Router();

authRouter.post("/register/customer", validateBody(customerRegisterSchema), async (req, res, next) => {
  try {
    const session = await registerCustomer(req.body);
    res.status(201).json(session);
  } catch (error) {
    next(error);
  }
});

authRouter.post("/register/worker", validateBody(workerRegisterSchema), async (req, res, next) => {
  try {
    const session = await registerWorker(req.body);
    res.status(201).json(session);
  } catch (error) {
    next(error);
  }
});

authRouter.post("/login", validateBody(loginSchema), async (req, res, next) => {
  try {
    const session = await login(req.body);
    res.json(session);
  } catch (error) {
    next(error);
  }
});

authRouter.post("/forgot-password", validateBody(forgotPasswordSchema), async (req, res, next) => {
  try {
    const result = await requestPasswordReset(req.body.email);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

authRouter.post("/reset-password", validateBody(resetPasswordSchema), async (req, res, next) => {
  try {
    const session = await resetPassword(req.body.token, req.body.password, req.body.confirmPassword);
    res.json(session);
  } catch (error) {
    next(error);
  }
});

const devSessionSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2).max(100),
  role: z.nativeEnum(UserRole).default(UserRole.CLIENT)
});

authRouter.post("/session", validateBody(devSessionSchema), async (req, res, next) => {
  try {
    const session = await createDevSession(req.body);
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

authRouter.post("/logout", (_req, res) => {
  res.json({ ok: true });
});
