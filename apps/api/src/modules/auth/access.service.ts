import { createHash, randomInt } from "node:crypto";
import { AccountStatus, AuthProvider, UserRole, type User } from "@prisma/client";
import { AppError } from "../../lib/errors.js";

export function normalizePhoneNumber(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits.startsWith("+") ? digits : `+${digits}`;
}

export function assertClientCanPostGigs(user: Pick<User, "emailVerified" | "phoneVerified">): void {
  if (!user.emailVerified) {
    throw new AppError("EMAIL_NOT_VERIFIED", 403, "EMAIL_NOT_VERIFIED", {
      email: "Verify your email before posting gigs."
    });
  }
  if (!user.phoneVerified) {
    throw new AppError("PHONE_NOT_VERIFIED", 403, "PHONE_NOT_VERIFIED", {
      phone: "Verify your phone number before posting gigs."
    });
  }
}

export function assertWorkerCanGoOnline(
  user: Pick<User, "emailVerified" | "phoneVerified" | "profileCompleted" | "accountStatus" | "roles">
): void {
  if (!user.roles.includes(UserRole.WORKER)) {
    throw new AppError("FORBIDDEN", 403, "FORBIDDEN", { role: "Worker account required." });
  }
  if (!user.emailVerified) {
    throw new AppError("EMAIL_NOT_VERIFIED", 403, "EMAIL_NOT_VERIFIED", {
      email: "Verify your email before going online."
    });
  }
  if (!user.phoneVerified) {
    throw new AppError("PHONE_NOT_VERIFIED", 403, "PHONE_NOT_VERIFIED", {
      phone: "Verify your phone number before going online."
    });
  }
  if (!user.profileCompleted) {
    throw new AppError("PROFILE_INCOMPLETE", 403, "PROFILE_INCOMPLETE", {
      profile: "Complete your worker profile before going online."
    });
  }
  if (user.accountStatus === AccountStatus.PENDING_APPROVAL) {
    throw new AppError("WORKER_PENDING_APPROVAL", 403, "WORKER_PENDING_APPROVAL", {
      status: "Your worker application is still under review."
    });
  }
  if (user.accountStatus === AccountStatus.REJECTED) {
    throw new AppError("WORKER_REJECTED", 403, "WORKER_REJECTED", {
      status: "Your worker application was not approved."
    });
  }
  if (user.accountStatus !== AccountStatus.APPROVED) {
    throw new AppError("WORKER_NOT_APPROVED", 403, "WORKER_NOT_APPROVED", {
      status: "Admin approval is required before going online."
    });
  }
}

export function assertWorkerCanAcceptGigs(
  user: Pick<User, "emailVerified" | "phoneVerified" | "profileCompleted" | "accountStatus" | "roles">
): void {
  assertWorkerCanGoOnline(user);
}

export function hashOtpCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function generateOtpCode(): string {
  return String(randomInt(100000, 999999));
}

export function mapAuthProvider(provider: "google" | "apple"): AuthProvider {
  return provider === "google" ? AuthProvider.GOOGLE : AuthProvider.APPLE;
}
