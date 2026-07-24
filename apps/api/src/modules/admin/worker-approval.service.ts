import { AccountStatus, UserRole } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import { createDownloadSignedUrl, isSpacesConfigured } from "../../lib/spaces.js";

const workerUserSelect = {
  id: true,
  email: true,
  fullName: true,
  phoneNumber: true,
  avatarUrl: true,
  accountStatus: true,
  city: true,
  region: true,
  createdAt: true,
  workerProfile: {
    include: { serviceCategories: true }
  }
} as const;

async function withIdentityDocumentUrls(user: {
  id: string;
  avatarUrl?: string | null;
  workerProfile?: Record<string, unknown> | null;
  [key: string]: unknown;
}) {
  const profile = (user.workerProfile ?? null) as {
    governmentIdFrontKey?: string | null;
    governmentIdBackKey?: string | null;
    governmentIdType?: string | null;
    identityVerificationStatus?: string | null;
    identityDocumentsUploadedAt?: Date | null;
  } | null;
  let governmentIdFrontUrl: string | null = null;
  let governmentIdBackUrl: string | null = null;

  if (isSpacesConfigured() && profile?.governmentIdFrontKey && !profile.governmentIdFrontKey.startsWith("local-")) {
    try {
      governmentIdFrontUrl = await createDownloadSignedUrl(profile.governmentIdFrontKey, 600);
    } catch {
      governmentIdFrontUrl = null;
    }
  }
  if (isSpacesConfigured() && profile?.governmentIdBackKey && !profile.governmentIdBackKey.startsWith("local-")) {
    try {
      governmentIdBackUrl = await createDownloadSignedUrl(profile.governmentIdBackKey, 600);
    } catch {
      governmentIdBackUrl = null;
    }
  }

  return {
    ...user,
    identity: {
      profilePhotoUrl: user.avatarUrl ?? null,
      governmentIdType: profile?.governmentIdType ?? null,
      governmentIdFrontUrl,
      governmentIdBackUrl,
      uploadStatus:
        profile?.governmentIdFrontKey && user.avatarUrl
          ? "UPLOADED"
          : profile?.governmentIdFrontKey || user.avatarUrl
            ? "PARTIAL"
            : "MISSING",
      verificationStatus: profile?.identityVerificationStatus ?? "PENDING",
      documentsUploadedAt: profile?.identityDocumentsUploadedAt?.toISOString() ?? null
    }
  };
}

export async function listPendingWorkers() {
  const workers = await prisma.user.findMany({
    where: {
      roles: { has: UserRole.WORKER },
      accountStatus: AccountStatus.PENDING_APPROVAL
    },
    select: workerUserSelect,
    orderBy: { createdAt: "desc" }
  });
  return Promise.all(workers.map((worker) => withIdentityDocumentUrls(worker)));
}

export async function getWorkerApplication(userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, roles: { has: UserRole.WORKER } },
    select: workerUserSelect
  });
  if (!user) {
    throw new AppError("NOT_FOUND", 404, "NOT_FOUND", { worker: "Worker not found" });
  }
  return withIdentityDocumentUrls(user);
}

export async function setIdentityVerificationStatus(
  workerId: string,
  status: "PENDING" | "APPROVED" | "REJECTED"
) {
  const user = await getWorkerOrThrow(workerId);
  if (!user.workerProfile) {
    throw new AppError("NOT_FOUND", 404, "NOT_FOUND", { worker: "Worker profile not found" });
  }
  await prisma.workerProfile.update({
    where: { userId: workerId },
    data: { identityVerificationStatus: status }
  });
  return getWorkerApplication(workerId);
}

async function getWorkerOrThrow(workerId: string) {
  const user = await prisma.user.findFirst({
    where: { id: workerId, roles: { has: UserRole.WORKER } },
    include: { workerProfile: true }
  });
  if (!user) {
    throw new AppError("NOT_FOUND", 404, "NOT_FOUND", { worker: "Worker not found" });
  }
  return user;
}

async function applyWorkerReview(
  workerId: string,
  adminId: string,
  status: AccountStatus,
  rejectionReason: string | null
) {
  const user = await getWorkerOrThrow(workerId);

  await prisma.user.update({
    where: { id: workerId },
    data: {
      accountStatus: status,
      isVerified: status === AccountStatus.APPROVED ? true : user.isVerified
    }
  });

  if (user.workerProfile) {
    await prisma.workerProfile.update({
      where: { userId: workerId },
      data: {
        reviewedAt: new Date(),
        reviewedById: adminId,
        rejectionReason
      }
    });
  } else if (status === AccountStatus.APPROVED || status === AccountStatus.REJECTED) {
    // Social / incomplete signups can be pending without a profile row.
    await prisma.workerProfile.create({
      data: {
        userId: workerId,
        bio: "Worker profile created during admin review.",
        city: user.city ?? "Unknown",
        serviceArea: user.region ?? "Unknown",
        workExperience: "Pending",
        platformRulesAgreed: true,
        backgroundCheckConsent: true,
        governmentIdAcknowledged: true,
        proofOfAddressAcknowledged: true,
        reviewedAt: new Date(),
        reviewedById: adminId,
        rejectionReason
      }
    });
  }

  return prisma.user.findUniqueOrThrow({
    where: { id: workerId },
    select: workerUserSelect
  });
}

export async function approveWorker(workerId: string, adminId: string) {
  return applyWorkerReview(workerId, adminId, AccountStatus.APPROVED, null);
}

export async function rejectWorker(workerId: string, adminId: string, reason?: string) {
  return applyWorkerReview(
    workerId,
    adminId,
    AccountStatus.REJECTED,
    reason ?? "Application not approved"
  );
}

export async function suspendWorker(workerId: string, adminId: string, reason?: string) {
  return applyWorkerReview(workerId, adminId, AccountStatus.SUSPENDED, reason ?? null);
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
  if (isWorker) {
    return applyWorkerReview(workerId, adminId, AccountStatus.APPROVED, null);
  }

  return prisma.user.update({
    where: { id: workerId },
    data: { accountStatus: AccountStatus.ACTIVE },
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
