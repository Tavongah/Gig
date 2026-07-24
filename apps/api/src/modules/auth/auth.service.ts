import jwt from "jsonwebtoken";
import { AccountStatus, AuthProvider, UserRole } from "@prisma/client";
import {
  changePasswordSchema,
  customerRegisterSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  workerRegisterSchema,
  type CustomerRegisterInput,
  type LoginInput,
  type WorkerRegisterInput
} from "@gigflow/shared";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { createResetToken, hashPassword, hashResetToken, verifyPassword } from "../../lib/password.js";
import { buildSimpleEmail, sendTransactionalEmail } from "../../lib/email.js";
import { isSpacesConfigured, uploadPrivateObject, uploadPublicObject } from "../../lib/spaces.js";
import { normalizePhoneNumber } from "./access.service.js";
import { passwordResetAppUrl, sendEmailVerification } from "./verification.service.js";

export const userInclude = {
  workerProfile: { include: { serviceCategories: true } }
} as const;

export function issueToken(user: {
  id: string;
  roles: UserRole[];
  accountStatus: AccountStatus;
  defaultRole: UserRole;
}): string {
  return jwt.sign(
    { roles: user.roles, accountStatus: user.accountStatus, defaultRole: user.defaultRole },
    env.JWT_SECRET,
    { subject: user.id, expiresIn: "7d" }
  );
}

export function sanitizeUser<T extends { passwordHash?: string | null }>(user: T) {
  const { passwordHash: _removed, ...safe } = user;
  return safe;
}

async function assertEmailAvailable(email: string): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new AppError("EMAIL_IN_USE", 409, "EMAIL_IN_USE", { email: "Email is already registered" });
  }
}

async function assertPhoneAvailable(phoneNumber: string): Promise<void> {
  const normalized = normalizePhoneNumber(phoneNumber);
  const existing = await prisma.user.findFirst({ where: { phoneNumber: normalized } });
  if (existing) {
    throw new AppError("PHONE_IN_USE", 409, "PHONE_IN_USE", {
      phoneNumber: "That phone number is already linked to another account."
    });
  }
}

export async function registerCustomer(input: CustomerRegisterInput) {
  const parsed = customerRegisterSchema.parse(input);
  const email = parsed.email.toLowerCase();

  await assertEmailAvailable(email);
  if (parsed.phoneNumber) {
    await assertPhoneAvailable(parsed.phoneNumber);
  }

  const passwordHash = await hashPassword(parsed.password);
  const user = await prisma.user.create({
    data: {
      email,
      fullName: parsed.fullName.trim(),
      phoneNumber: parsed.phoneNumber ? normalizePhoneNumber(parsed.phoneNumber) : null,
      passwordHash,
      authProvider: AuthProvider.EMAIL,
      roles: [UserRole.CLIENT],
      defaultRole: UserRole.CLIENT,
      accountStatus: AccountStatus.ACTIVE,
      emailVerified: false,
      phoneVerified: false,
      profileCompleted: true,
      isVerified: false
    },
    include: userInclude
  });

  try {
    await sendEmailVerification(user.id, user.email);
  } catch (error) {
    console.error("[auth] verification_email_failed", {
      userId: user.id,
      email: user.email,
      message: error instanceof Error ? error.message : String(error)
    });
  }
  const token = issueToken(user);
  return { token, user: sanitizeUser(user) };
}

export async function registerWorker(input: WorkerRegisterInput) {
  const parsed = workerRegisterSchema.parse(input);
  const email = parsed.email.toLowerCase();

  await assertEmailAvailable(email);
  if (parsed.phoneNumber) {
    await assertPhoneAvailable(parsed.phoneNumber);
  }

  const profilePhoto = parseAvatarDataUrl(parsed.profilePhotoDataUrl);
  const idFront = parseAvatarDataUrl(parsed.governmentIdFrontDataUrl);
  const idBack = parsed.governmentIdBackDataUrl
    ? parseAvatarDataUrl(parsed.governmentIdBackDataUrl)
    : null;

  const passwordHash = await hashPassword(parsed.password);
  const user = await prisma.user.create({
    data: {
      email,
      fullName: parsed.fullName.trim(),
      phoneNumber: parsed.phoneNumber ? normalizePhoneNumber(parsed.phoneNumber) : null,
      passwordHash,
      authProvider: AuthProvider.EMAIL,
      roles: [UserRole.WORKER],
      defaultRole: UserRole.WORKER,
      accountStatus: AccountStatus.PENDING_APPROVAL,
      emailVerified: false,
      phoneVerified: false,
      profileCompleted: true,
      isVerified: false,
      city: parsed.city.trim(),
      region: parsed.serviceArea.trim(),
      workerProfile: {
        create: {
          bio: parsed.bio.trim(),
          city: parsed.city.trim(),
          serviceArea: parsed.serviceArea.trim(),
          workExperience: parsed.workExperience.trim(),
          travelDistanceMiles: parsed.travelDistanceMiles,
          hourlyRateCents: parsed.hourlyRateCents,
          minJobAmountCents: parsed.minJobAmountCents,
          hasVehicle: parsed.hasVehicle,
          backgroundCheckConsent: parsed.backgroundCheckConsent,
          governmentIdAcknowledged: parsed.governmentIdAcknowledged,
          proofOfAddressAcknowledged: parsed.proofOfAddressAcknowledged,
          platformRulesAgreed: parsed.platformRulesAgreed,
          governmentIdType: parsed.governmentIdType,
          identityVerificationStatus: "PENDING",
          serviceCategories: {
            connect: parsed.serviceCategoryIds.map((id) => ({ id }))
          }
        }
      }
    },
    include: userInclude
  });

  try {
    const avatarExt =
      profilePhoto.contentType === "image/png"
        ? "png"
        : profilePhoto.contentType === "image/webp"
          ? "webp"
          : "jpg";
    let avatarUrl: string;
    if (isSpacesConfigured()) {
      const uploaded = await uploadPublicObject({
        purpose: "worker-profile",
        userId: user.id,
        fileName: `avatar.${avatarExt}`,
        contentType: profilePhoto.contentType,
        body: profilePhoto.buffer
      });
      avatarUrl = uploaded.publicUrl;
    } else {
      avatarUrl = `data:${profilePhoto.contentType};base64,${profilePhoto.buffer.toString("base64")}`;
    }

    let frontKey: string;
    let backKey: string | null = null;
    if (isSpacesConfigured()) {
      const front = await uploadPrivateObject({
        purpose: "verification-document",
        userId: user.id,
        fileName: `id-front.${avatarExt}`,
        contentType: idFront.contentType,
        body: idFront.buffer
      });
      frontKey = front.objectKey;
      if (idBack) {
        const back = await uploadPrivateObject({
          purpose: "verification-document",
          userId: user.id,
          fileName: "id-back.jpg",
          contentType: idBack.contentType,
          body: idBack.buffer
        });
        backKey = back.objectKey;
      }
    } else {
      // Dev fallback — store opaque keys pointing at data URLs is unsafe for production;
      // keep private-looking keys and skip public exposure.
      frontKey = `local-verification/${user.id}/id-front`;
      backKey = idBack ? `local-verification/${user.id}/id-back` : null;
      console.warn("[identity] Spaces not configured — identity keys stored as local placeholders.");
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { avatarUrl }
    });
    await prisma.workerProfile.update({
      where: { userId: user.id },
      data: {
        governmentIdFrontKey: frontKey,
        governmentIdBackKey: backKey,
        identityDocumentsUploadedAt: new Date(),
        identityVerificationStatus: "PENDING"
      }
    });
  } catch (error) {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    throw new AppError("UPLOAD_FAILED", 400, "UPLOAD_FAILED", {
      profilePhotoDataUrl:
        error instanceof Error ? error.message : "Identity document upload failed. Try again."
    });
  }

  const refreshed = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    include: userInclude
  });

  try {
    await sendEmailVerification(refreshed.id, refreshed.email);
  } catch (error) {
    console.error("[auth] verification_email_failed", {
      userId: refreshed.id,
      email: refreshed.email,
      message: error instanceof Error ? error.message : String(error)
    });
  }
  const token = issueToken(refreshed);
  return { token, user: sanitizeUser(refreshed) };
}

export async function login(input: LoginInput) {
  const parsed = loginSchema.parse(input);
  const email = parsed.email.toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email },
    include: userInclude
  });

  if (!user?.passwordHash) {
    throw new AppError("INVALID_CREDENTIALS", 401, "INVALID_CREDENTIALS", {
      email: "Invalid email or password"
    });
  }

  if (user.authProvider !== AuthProvider.EMAIL) {
    throw new AppError("USE_SOCIAL_LOGIN", 400, "USE_SOCIAL_LOGIN", {
      email: `This account uses ${user.authProvider.toLowerCase()} sign-in.`
    });
  }

  const valid = await verifyPassword(parsed.password, user.passwordHash);
  if (!valid) {
    throw new AppError("INVALID_CREDENTIALS", 401, "INVALID_CREDENTIALS", {
      email: "Invalid email or password"
    });
  }

  if (user.accountStatus === AccountStatus.SUSPENDED) {
    throw new AppError("ACCOUNT_SUSPENDED", 403, "ACCOUNT_SUSPENDED", {
      status: "Your account has been suspended. Contact support."
    });
  }

  // Unverified users still get a session so they can resend verification from the app.
  const token = issueToken(user);
  return { token, user: sanitizeUser(user) };
}

export async function requestPasswordReset(emailInput: string) {
  const { email } = forgotPasswordSchema.parse({ email: emailInput });
  const normalized = email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalized } });

  if (user && user.accountStatus !== AccountStatus.SUSPENDED && user.passwordHash) {
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });

    const rawToken = createResetToken();
    const tokenHash = hashResetToken(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt }
    });

    const resetUrl = passwordResetAppUrl(rawToken);
    const content = buildSimpleEmail({
      title: "Reset your DUTS password",
      intro: "We received a request to reset your password. Use the button below to choose a new one.",
      actionLabel: "Reset password",
      actionUrl: resetUrl,
      footer: "This link expires in 1 hour. If you didn’t request a reset, you can ignore this email."
    });

    try {
      await sendTransactionalEmail({
        to: normalized,
        subject: "Reset your DUTS password",
        text: content.text,
        html: content.html
      });
    } catch (error) {
      console.error("[auth] password_reset_email_failed", {
        email: normalized,
        message: error instanceof Error ? error.message : String(error)
      });
      // Still return generic success to avoid email enumeration.
    }
  }

  return { ok: true, message: "If that email exists, a reset link has been sent." };
}

export async function resetPassword(token: string, password: string, confirmPassword: string) {
  const parsed = resetPasswordSchema.parse({ token, password, confirmPassword });
  const tokenHash = hashResetToken(parsed.token);
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true }
  });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new AppError("INVALID_RESET_TOKEN", 400, "INVALID_RESET_TOKEN", {
      token: "Reset link is invalid or expired"
    });
  }

  const passwordHash = await hashPassword(parsed.password);
  const [user] = await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash },
      include: userInclude
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() }
    })
  ]);

  const authToken = issueToken(user);
  return { token: authToken, user: sanitizeUser(user) };
}

/** Dev-only legacy session bootstrap. Disabled when ALLOW_DEV_SESSION is not true. */
export async function createDevSession(input: {
  email: string;
  fullName: string;
  role: UserRole;
}) {
  if (env.NODE_ENV === "production" && process.env.ALLOW_DEV_SESSION !== "true") {
    throw new AppError("FORBIDDEN", 403, "FORBIDDEN", { session: "Dev session disabled" });
  }
  if (input.role === UserRole.ADMIN) {
    throw new AppError("FORBIDDEN", 403, "FORBIDDEN", { role: "Cannot self-assign admin" });
  }

  const accountStatus =
    input.role === UserRole.WORKER ? AccountStatus.APPROVED : AccountStatus.ACTIVE;

  const user = await prisma.user.upsert({
    where: { email: input.email.toLowerCase() },
    update: { fullName: input.fullName, defaultRole: input.role, roles: { set: [input.role] }, accountStatus },
    create: {
      email: input.email.toLowerCase(),
      fullName: input.fullName,
      defaultRole: input.role,
      roles: [input.role],
      accountStatus,
      emailVerified: true,
      phoneVerified: true,
      profileCompleted: true,
      isVerified: true
    },
    include: userInclude
  });

  const token = issueToken(user);
  return { token, user: sanitizeUser(user) };
}

export async function getAuthenticatedUser(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: userInclude
  });
  return sanitizeUser(user);
}

export async function getCurrentUser(userId: string) {
  return getAuthenticatedUser(userId);
}

const MAX_AVATAR_DATA_URL_CHARS = 400_000;
const MAX_AVATAR_BYTES = 350_000;

function parseAvatarDataUrl(dataUrl: string): { contentType: string; buffer: Buffer } {
  const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl.trim());
  if (!match) {
    throw new AppError("VALIDATION_ERROR", 400, "INVALID_AVATAR", {
      avatarUrl: "Upload a JPEG, PNG, or WebP photo."
    });
  }

  const contentType = match[1]!.toLowerCase() === "image/jpg" ? "image/jpeg" : match[1]!.toLowerCase();
  const buffer = Buffer.from(match[2]!, "base64");
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_AVATAR_BYTES) {
    throw new AppError("VALIDATION_ERROR", 400, "INVALID_AVATAR", {
      avatarUrl: "Image is too large. Try a smaller photo."
    });
  }

  return { contentType, buffer };
}

export async function updateUserAvatarFromDataUrl(userId: string, dataUrl: string | null) {
  if (dataUrl === null) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: null },
      include: userInclude
    });
    return sanitizeUser(user);
  }

  if (dataUrl.length > MAX_AVATAR_DATA_URL_CHARS) {
    throw new AppError("VALIDATION_ERROR", 400, "INVALID_AVATAR", {
      avatarUrl: "Image is too large. Try a smaller photo."
    });
  }

  const { contentType, buffer } = parseAvatarDataUrl(dataUrl);
  const extension = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";

  let avatarUrl: string;
  if (isSpacesConfigured()) {
    const uploaded = await uploadPublicObject({
      purpose: "worker-profile",
      userId,
      fileName: `avatar.${extension}`,
      contentType,
      body: buffer
    });
    avatarUrl = uploaded.publicUrl;
  } else {
    // Fallback when Spaces keys are not configured yet — keeps beta/profile photos working.
    avatarUrl = `data:${contentType};base64,${buffer.toString("base64")}`;
    console.warn("[avatar] Spaces not configured — storing compressed data URL on user record.");
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl },
    include: userInclude
  });

  return sanitizeUser(user);
}

export async function updateAuthenticatedProfile(
  userId: string,
  input: { fullName?: string; phoneNumber?: string | null; avatarUrl?: string | null }
) {
  const data: {
    fullName?: string;
    phoneNumber?: string | null;
    avatarUrl?: string | null;
  } = {};

  if (typeof input.fullName === "string") {
    const fullName = input.fullName.trim();
    if (fullName.length < 2 || fullName.length > 100) {
      throw new AppError("VALIDATION_ERROR", 400, "INVALID_NAME", { fullName: "Enter a valid name." });
    }
    data.fullName = fullName;
  }

  if (input.phoneNumber !== undefined) {
    if (input.phoneNumber === null || input.phoneNumber.trim() === "") {
      data.phoneNumber = null;
    } else {
      const normalized = normalizePhoneNumber(input.phoneNumber);
      const existing = await prisma.user.findFirst({
        where: { phoneNumber: normalized, NOT: { id: userId } }
      });
      if (existing) {
        throw new AppError("PHONE_IN_USE", 409, "PHONE_IN_USE", {
          phoneNumber: "That phone number is already linked to another account."
        });
      }
      data.phoneNumber = normalized;
    }
  }

  if (input.avatarUrl !== undefined) {
    data.avatarUrl = input.avatarUrl;
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data,
    include: userInclude
  });

  return sanitizeUser(user);
}

export async function changePassword(
  userId: string,
  input: { currentPassword: string; password: string; confirmPassword: string }
) {
  const parsed = changePasswordSchema.parse(input);
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw new AppError("NOT_FOUND", 404, "NOT_FOUND", { user: "User not found" });
  }

  if (!user.passwordHash) {
    throw new AppError("USE_SOCIAL_LOGIN", 400, "USE_SOCIAL_LOGIN", {
      password: "This account uses social sign-in instead of a password."
    });
  }

  const valid = await verifyPassword(parsed.currentPassword, user.passwordHash);
  if (!valid) {
    throw new AppError("VALIDATION_ERROR", 400, "INVALID_PASSWORD", {
      currentPassword: "Current password is incorrect."
    });
  }

  const passwordHash = await hashPassword(parsed.password);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash }
  });

  return { ok: true as const };
}

export async function deleteAuthenticatedAccount(userId: string) {
  const tombstoneEmail = `deleted+${userId}@deleted.local`;

  await prisma.$transaction([
    prisma.emailVerificationToken.deleteMany({ where: { userId } }),
    prisma.passwordResetToken.deleteMany({ where: { userId } }),
    prisma.user.update({
      where: { id: userId },
      data: {
        accountStatus: AccountStatus.SUSPENDED,
        email: tombstoneEmail,
        fullName: "Deleted User",
        phoneNumber: null,
        avatarUrl: null,
        passwordHash: null,
        firebaseUid: null,
        stripeCustomerId: null,
        authProvider: AuthProvider.EMAIL,
        profileCompleted: false,
        emailVerified: false,
        phoneVerified: false,
        isVerified: false,
        formattedAddress: null,
        addressLine1: null,
        city: null,
        region: null,
        postalCode: null,
        latitude: null,
        longitude: null
      }
    }),
    prisma.workerProfile.updateMany({
      where: { userId },
      data: { availabilityStatus: "OFFLINE" }
    })
  ]);

  return { ok: true as const };
}
