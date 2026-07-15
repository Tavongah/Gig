import type { ApiUser } from "./api";

export type AccountStatus = "ACTIVE" | "SUSPENDED" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED";

export type AuthStep = "account" | "email" | "phone" | "profile" | "ready";

export function isWorkerUser(user: ApiUser): boolean {
  return user.roles.includes("WORKER");
}

export function isCustomerUser(user: ApiUser): boolean {
  return user.roles.includes("CLIENT");
}

export function isApprovedWorker(user: ApiUser): boolean {
  return isWorkerUser(user) && user.accountStatus === "APPROVED";
}

export function workerGateStatus(user: ApiUser): "approved" | "pending" | "rejected" | "suspended" | null {
  if (!isWorkerUser(user)) {
    return null;
  }
  switch (user.accountStatus) {
    case "APPROVED":
      return "approved";
    case "PENDING_APPROVAL":
      return "pending";
    case "REJECTED":
      return "rejected";
    case "SUSPENDED":
      return "suspended";
    default:
      return "pending";
  }
}

export function defaultActiveRole(user: ApiUser): "CLIENT" | "WORKER" {
  if (user.defaultRole === "WORKER" && isWorkerUser(user)) {
    return "WORKER";
  }
  return "CLIENT";
}

export function needsEmailVerification(user: ApiUser): boolean {
  return user.authProvider === "EMAIL" && !user.emailVerified;
}

/** Phone verification is deferred for MVP launch. Kept for a later release. */
export function needsPhoneVerification(_user: ApiUser): boolean {
  return false;
}

export function isApplePlaceholderEmail(email: string): boolean {
  return email.endsWith("@apple.private.gigflow.local");
}

export function needsProfileCompletion(user: ApiUser): boolean {
  return !user.profileCompleted || isApplePlaceholderEmail(user.email);
}

export function getAuthStep(user: ApiUser): AuthStep {
  if (needsEmailVerification(user)) return "email";
  if (needsProfileCompletion(user)) return "profile";
  return "ready";
}

export function canCustomerPostGigs(user: ApiUser): boolean {
  return Boolean(user.emailVerified);
}

export function canWorkerGoOnline(user: ApiUser): boolean {
  return Boolean(user.emailVerified && user.profileCompleted && user.accountStatus === "APPROVED");
}
