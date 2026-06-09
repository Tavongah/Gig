import type { ApiUser } from "./api";

export type AccountStatus = "ACTIVE" | "SUSPENDED" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED";

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
