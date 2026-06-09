import { AccountStatus, UserRole } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";

const workerUserSelect = {
  id: true,
  email: true,
  fullName: true,
  phoneNumber: true,
  accountStatus: true,
  createdAt: true,
  workerProfile: {
    include: { serviceCategories: true }
  }
} as const;

export async function listPendingWorkers() {
  return prisma.user.findMany({
    where: {
      roles: { has: UserRole.WORKER },
      accountStatus: AccountStatus.PENDING_APPROVAL
    },
    select: workerUserSelect,
    orderBy: { createdAt: "desc" }
  });
}

export async function getWorkerApplication(userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, roles: { has: UserRole.WORKER } },
    select: workerUserSelect
  });
  if (!user) {
    throw new AppError("NOT_FOUND", 404, "NOT_FOUND", { worker: "Worker not found" });
  }
  return user;
}

export async function approveWorker(workerId: string, adminId: string) {
  const user = await prisma.user.update({
    where: { id: workerId },
    data: {
      accountStatus: AccountStatus.APPROVED,
      workerProfile: {
        update: {
          reviewedAt: new Date(),
          reviewedById: adminId,
          rejectionReason: null
        }
      }
    },
    select: workerUserSelect
  });
  return user;
}

export async function rejectWorker(workerId: string, adminId: string, reason?: string) {
  const user = await prisma.user.update({
    where: { id: workerId },
    data: {
      accountStatus: AccountStatus.REJECTED,
      workerProfile: {
        update: {
          reviewedAt: new Date(),
          reviewedById: adminId,
          rejectionReason: reason ?? "Application not approved"
        }
      }
    },
    select: workerUserSelect
  });
  return user;
}

export async function suspendWorker(workerId: string, adminId: string, reason?: string) {
  return prisma.user.update({
    where: { id: workerId },
    data: {
      accountStatus: AccountStatus.SUSPENDED,
      workerProfile: {
        update: {
          reviewedAt: new Date(),
          reviewedById: adminId,
          rejectionReason: reason ?? null
        }
      }
    },
    select: workerUserSelect
  });
}

export async function reactivateWorker(workerId: string, adminId: string) {
  const user = await prisma.user.findUnique({
    where: { id: workerId },
    include: { workerProfile: true }
  });
  if (!user) {
    throw new AppError("NOT_FOUND", 404, "NOT_FOUND", { worker: "User not found" });
  }

  const isWorker = user.roles.includes(UserRole.WORKER);
  const nextStatus = isWorker ? AccountStatus.APPROVED : AccountStatus.ACTIVE;

  return prisma.user.update({
    where: { id: workerId },
    data: {
      accountStatus: nextStatus,
      workerProfile: isWorker && user.workerProfile
        ? { update: { reviewedAt: new Date(), reviewedById: adminId, rejectionReason: null } }
        : undefined
    },
    select: workerUserSelect
  });
}

export async function listAllGigs(status?: string) {
  return prisma.gig.findMany({
    where: status ? { status: status as never } : undefined,
    include: {
      serviceCategory: true,
      client: { select: { id: true, fullName: true, email: true } },
      assignments: { include: { worker: { select: { id: true, fullName: true, email: true } } } }
    },
    orderBy: { createdAt: "desc" },
    take: 100
  });
}
