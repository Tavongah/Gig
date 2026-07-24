import { createHash, randomBytes } from "node:crypto";
import { AccountStatus } from "@prisma/client";
import { env } from "../../config/env.js";
import { prisma } from "../../config/prisma.js";
import { redis } from "../../config/redis.js";
import { AppError } from "../../lib/errors.js";
import { buildSimpleEmail, sendTransactionalEmail } from "../../lib/email.js";
import { createResetToken, hashResetToken } from "../../lib/password.js";
import { generateOtpCode, hashOtpCode, normalizePhoneNumber } from "./access.service.js";

const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const EMAIL_RESEND_RATE_LIMIT_SECONDS = 60 * 60;
const EMAIL_RESEND_MAX_PER_HOUR = 5;
const OTP_TTL_SECONDS = 10 * 60;
const OTP_RATE_LIMIT_SECONDS = 60 * 60;
const OTP_MAX_REQUESTS_PER_HOUR = 5;
const OTP_VERIFY_MAX_ATTEMPTS = 5;

function hashEmailToken(token: string): string {
  return hashResetToken(token);
}

function appBaseUrl(): string {
  return (env.MOBILE_PUBLIC_URL ?? "http://localhost:8081").replace(/\/$/, "");
}

function apiBaseUrl(): string {
  return (env.API_PUBLIC_URL ?? `http://localhost:${env.PORT}`).replace(/\/$/, "");
}

export async function sendEmailVerification(userId: string, email: string): Promise<{ ok: true }> {
  await prisma.emailVerificationToken.deleteMany({ where: { userId, usedAt: null } });

  const rawToken = createResetToken();
  const tokenHash = hashEmailToken(rawToken);
  const expiresAt = new Date(Date.now() + EMAIL_TOKEN_TTL_MS);

  await prisma.emailVerificationToken.create({
    data: { userId, tokenHash, expiresAt }
  });

  const verifyUrl = `${apiBaseUrl()}/v1/auth/verify-email?token=${encodeURIComponent(rawToken)}`;
  const content = buildSimpleEmail({
    title: "Verify your DUTS email",
    intro: "Thanks for joining DUTS. Confirm your email address to finish setting up your account.",
    actionLabel: "Verify email",
    actionUrl: verifyUrl,
    footer: "This link expires in 24 hours. If you didn’t create a DUTS account, you can ignore this email."
  });

  await sendTransactionalEmail({
    to: email,
    subject: "Verify your DUTS email",
    text: content.text,
    html: content.html
  });

  return { ok: true };
}

export async function verifyEmailToken(rawToken: string): Promise<{ userId: string }> {
  const tokenHash = hashEmailToken(rawToken);
  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash },
    include: { user: true }
  });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new AppError("INVALID_VERIFICATION_TOKEN", 400, "INVALID_VERIFICATION_TOKEN", {
      token: "Verification link is invalid or expired."
    });
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: {
        emailVerified: true,
        // Email verification is the MVP gate; phoneVerified remains available for a later release.
        isVerified: true
      }
    }),
    prisma.emailVerificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() }
    })
  ]);

  return { userId: record.userId };
}

export async function resendEmailVerification(userId: string): Promise<{ ok: true }> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.emailVerified) {
    return { ok: true };
  }

  const rateKey = `email:verify:rate:${userId}`;
  const requestCount = await redis.incr(rateKey);
  if (requestCount === 1) {
    await redis.expire(rateKey, EMAIL_RESEND_RATE_LIMIT_SECONDS);
  }
  if (requestCount > EMAIL_RESEND_MAX_PER_HOUR) {
    throw new AppError("EMAIL_RESEND_RATE_LIMITED", 429, "EMAIL_RESEND_RATE_LIMITED", {
      email: "Too many verification emails sent. Please try again in an hour."
    });
  }

  return sendEmailVerification(userId, user.email);
}

/** Public resend by email (for users who signed out before verifying). Always returns ok. */
export async function requestEmailVerificationByEmail(emailInput: string): Promise<{ ok: true }> {
  const email = emailInput.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.emailVerified || user.accountStatus === AccountStatus.SUSPENDED) {
    return { ok: true };
  }

  const rateKey = `email:verify:public:${email}`;
  const requestCount = await redis.incr(rateKey);
  if (requestCount === 1) {
    await redis.expire(rateKey, EMAIL_RESEND_RATE_LIMIT_SECONDS);
  }
  if (requestCount > EMAIL_RESEND_MAX_PER_HOUR) {
    return { ok: true };
  }

  try {
    await sendEmailVerification(user.id, user.email);
  } catch (error) {
    console.error("[verification] public_resend_failed", {
      email,
      message: error instanceof Error ? error.message : String(error)
    });
  }

  return { ok: true };
}

export function passwordResetAppUrl(rawToken: string): string {
  return `${appBaseUrl()}/reset-password?token=${encodeURIComponent(rawToken)}`;
}

async function assertPhoneAvailable(phoneNumber: string, userId: string): Promise<void> {
  const normalized = normalizePhoneNumber(phoneNumber);
  const existing = await prisma.user.findFirst({
    where: {
      phoneNumber: normalized,
      NOT: { id: userId }
    }
  });
  if (existing) {
    throw new AppError("PHONE_IN_USE", 409, "PHONE_IN_USE", {
      phoneNumber: "That phone number is already linked to another account."
    });
  }
}

export async function requestPhoneOtp(userId: string, phoneNumber: string): Promise<{ ok: true; devCode?: string }> {
  const normalized = normalizePhoneNumber(phoneNumber);
  await assertPhoneAvailable(normalized, userId);

  const rateKey = `otp:rate:${normalized}`;
  const requestCount = await redis.incr(rateKey);
  if (requestCount === 1) {
    await redis.expire(rateKey, OTP_RATE_LIMIT_SECONDS);
  }
  if (requestCount > OTP_MAX_REQUESTS_PER_HOUR) {
    throw new AppError("OTP_RATE_LIMITED", 429, "OTP_RATE_LIMITED", {
      phoneNumber: "Too many code requests. Try again in an hour."
    });
  }

  const code = generateOtpCode();
  const codeHash = hashOtpCode(code);
  await redis.set(`otp:phone:${userId}`, JSON.stringify({ codeHash, phoneNumber: normalized, attempts: 0 }), "EX", OTP_TTL_SECONDS);

  await prisma.user.update({
    where: { id: userId },
    data: { phoneNumber: normalized }
  });

  if (env.NODE_ENV === "development" || env.LOG_VERIFICATION_TO_CONSOLE) {
    console.info(`[verification] Phone OTP for ${normalized}: ${code}`);
    return { ok: true, devCode: code };
  }

  return { ok: true };
}

export async function verifyPhoneOtp(userId: string, phoneNumber: string, code: string): Promise<{ ok: true }> {
  const normalized = normalizePhoneNumber(phoneNumber);
  const payload = await redis.get(`otp:phone:${userId}`);
  if (!payload) {
    throw new AppError("OTP_EXPIRED", 400, "OTP_EXPIRED", {
      code: "Verification code expired. Request a new one."
    });
  }

  const parsed = JSON.parse(payload) as { codeHash: string; phoneNumber: string; attempts: number };
  if (parsed.phoneNumber !== normalized) {
    throw new AppError("OTP_PHONE_MISMATCH", 400, "OTP_PHONE_MISMATCH", {
      phoneNumber: "Phone number does not match the latest verification request."
    });
  }

  if (parsed.attempts >= OTP_VERIFY_MAX_ATTEMPTS) {
    await redis.del(`otp:phone:${userId}`);
    throw new AppError("OTP_LOCKED", 429, "OTP_LOCKED", {
      code: "Too many failed attempts. Request a new code."
    });
  }

  const codeHash = hashOtpCode(code);
  if (codeHash !== parsed.codeHash) {
    parsed.attempts += 1;
    await redis.set(`otp:phone:${userId}`, JSON.stringify(parsed), "EX", OTP_TTL_SECONDS);
    throw new AppError("OTP_INVALID", 400, "OTP_INVALID", {
      code: "Invalid verification code."
    });
  }

  await assertPhoneAvailable(normalized, userId);
  await prisma.user.update({
    where: { id: userId },
    data: {
      phoneNumber: normalized,
      phoneVerified: true,
      isVerified: true
    }
  });
  await redis.del(`otp:phone:${userId}`);

  return { ok: true };
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
