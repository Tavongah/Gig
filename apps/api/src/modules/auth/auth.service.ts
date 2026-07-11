import jwt from "jsonwebtoken";
import { AccountStatus, AuthProvider, UserRole } from "@prisma/client";
import {
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
import { normalizePhoneNumber } from "./access.service.js";
import { sendEmailVerification } from "./verification.service.js";

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
  await assertPhoneAvailable(parsed.phoneNumber);

  const passwordHash = await hashPassword(parsed.password);
  const user = await prisma.user.create({
    data: {
      email,
      fullName: parsed.fullName.trim(),
      phoneNumber: normalizePhoneNumber(parsed.phoneNumber),
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

  await sendEmailVerification(user.id, user.email);
  const token = issueToken(user);
  return { token, user: sanitizeUser(user) };
}

export async function registerWorker(input: WorkerRegisterInput) {
  const parsed = workerRegisterSchema.parse(input);
  const email = parsed.email.toLowerCase();

  await assertEmailAvailable(email);
  await assertPhoneAvailable(parsed.phoneNumber);

  const passwordHash = await hashPassword(parsed.password);
  const user = await prisma.user.create({
    data: {
      email,
      fullName: parsed.fullName.trim(),
      phoneNumber: normalizePhoneNumber(parsed.phoneNumber),
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
          serviceCategories: {
            connect: parsed.serviceCategoryIds.map((id) => ({ id }))
          }
        }
      }
    },
    include: userInclude
  });

  await sendEmailVerification(user.id, user.email);
  const token = issueToken(user);
  return { token, user: sanitizeUser(user) };
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

  const token = issueToken(user);
  return { token, user: sanitizeUser(user) };
}

export async function requestPasswordReset(emailInput: string) {
  const { email } = forgotPasswordSchema.parse({ email: emailInput });
  const normalized = email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalized } });

  if (user) {
    const rawToken = createResetToken();
    const tokenHash = hashResetToken(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt }
    });
    if (env.NODE_ENV === "development") {
      console.info(`[dev] Password reset token for ${normalized}: ${rawToken}`);
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
