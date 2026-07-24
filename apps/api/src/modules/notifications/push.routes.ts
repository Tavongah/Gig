import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { AppError } from "../../lib/errors.js";
import {
  disableAllPushTokensForUser,
  registerDevicePushToken,
  unregisterDevicePushToken
} from "./push.service.js";

const registerSchema = z.object({
  token: z.string().min(20).max(200),
  platform: z.enum(["ios", "android", "web"])
});

const unregisterSchema = z.object({
  token: z.string().min(20).max(200).optional()
});

export const pushRouter = Router();

pushRouter.post("/register", requireAuth, validateBody(registerSchema), async (req, res, next) => {
  try {
    const device = await registerDevicePushToken(req.auth!.userId, req.body);
    res.status(201).json({ ok: true, deviceId: device.id });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_PUSH_TOKEN") {
      next(new AppError("INVALID_PUSH_TOKEN", 400, "INVALID_PUSH_TOKEN", {
        token: "Push token is invalid."
      }));
      return;
    }
    next(error);
  }
});

pushRouter.post("/unregister", requireAuth, validateBody(unregisterSchema), async (req, res, next) => {
  try {
    if (req.body.token) {
      await unregisterDevicePushToken(req.auth!.userId, req.body.token);
    } else {
      await disableAllPushTokensForUser(req.auth!.userId);
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
