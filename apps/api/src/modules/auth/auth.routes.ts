import { Router } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { env } from "../../config/env.js";
import { isFirebaseConfigured } from "../../lib/firebase-admin.js";
import { requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import {
  createDevSession,
  changePassword,
  getAuthenticatedUser,
  login,
  registerCustomer,
  registerWorker,
  requestPasswordReset,
  resetPassword,
  updateAuthenticatedProfile,
  deleteAuthenticatedAccount
} from "./auth.service.js";
import { completeUserProfile, loginWithSocialProvider } from "./social-auth.service.js";
import {
  requestPhoneOtp,
  requestEmailVerificationByEmail,
  resendEmailVerification,
  sendEmailVerification,
  verifyEmailToken,
  verifyPhoneOtp
} from "./verification.service.js";
import {
  changePasswordSchema,
  completeProfileSchema,
  customerRegisterSchema,
  forgotPasswordSchema,
  loginSchema,
  phoneOtpRequestSchema,
  phoneOtpVerifySchema,
  resetPasswordSchema,
  socialLoginSchema,
  workerRegisterSchema
} from "@gigflow/shared";

export const authRouter = Router();

authRouter.get("/config", (_req, res) => {
  res.json({
    firebaseConfigured: isFirebaseConfigured(),
    socialProviders: {
      google: isFirebaseConfigured(),
      apple: isFirebaseConfigured()
    }
  });
});

authRouter.get("/verify-email", async (req, res, next) => {
  try {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    await verifyEmailToken(token);
    const target = `${env.MOBILE_PUBLIC_URL}/?emailVerified=1`;
    res.redirect(target);
  } catch (error) {
    next(error);
  }
});

authRouter.post("/verify-email/request", validateBody(forgotPasswordSchema), async (req, res, next) => {
  try {
    const result = await requestEmailVerificationByEmail(req.body.email);
    res.json({
      ...result,
      message: "If that email needs verification, a new link has been sent."
    });
  } catch (error) {
    next(error);
  }
});

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

authRouter.post("/social", validateBody(socialLoginSchema), async (req, res, next) => {
  try {
    const session = await loginWithSocialProvider(req.body);
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

authRouter.use(requireAuth);

authRouter.get("/me", async (req, res, next) => {
  try {
    const user = await getAuthenticatedUser(req.auth!.userId);
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(100).optional(),
  phoneNumber: z.string().trim().min(7).max(24).nullable().optional(),
  avatarUrl: z
    .string()
    .url("Avatar must be a valid URL")
    .max(2048, "Avatar URL is too long")
    .refine((value) => !value.toLowerCase().startsWith("data:"), {
      message: "Inline image uploads are not supported for avatars"
    })
    .nullable()
    .optional()
});

authRouter.patch("/me", validateBody(updateProfileSchema), async (req, res, next) => {
  try {
    const user = await updateAuthenticatedProfile(req.auth!.userId, req.body);
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/change-password", validateBody(changePasswordSchema), async (req, res, next) => {
  try {
    const result = await changePassword(req.auth!.userId, req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

authRouter.delete("/me", async (req, res, next) => {
  try {
    const result = await deleteAuthenticatedAccount(req.auth!.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

authRouter.post("/verify-email/resend", async (req, res, next) => {
  try {
    const result = await resendEmailVerification(req.auth!.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

authRouter.post("/verify-email/send", async (req, res, next) => {
  try {
    const user = await getAuthenticatedUser(req.auth!.userId);
    const result = await sendEmailVerification(user.id, user.email);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

authRouter.post("/verify-phone/request", validateBody(phoneOtpRequestSchema), async (req, res, next) => {
  try {
    const result = await requestPhoneOtp(req.auth!.userId, req.body.phoneNumber);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

authRouter.post("/verify-phone/confirm", validateBody(phoneOtpVerifySchema), async (req, res, next) => {
  try {
    const result = await verifyPhoneOtp(req.auth!.userId, req.body.phoneNumber, req.body.code);
    const user = await getAuthenticatedUser(req.auth!.userId);
    res.json({ ...result, user });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/complete-profile", validateBody(completeProfileSchema), async (req, res, next) => {
  try {
    const user = await completeUserProfile(req.auth!.userId, req.body);
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/logout", (_req, res) => {
  res.json({ ok: true });
});
