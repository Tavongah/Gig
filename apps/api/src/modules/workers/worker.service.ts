import { workerAvailabilitySchema, haversineMiles, estimateResponseMinutes } from "@gigflow/shared";
import type { WorkerAvailabilityInput } from "@gigflow/shared";
import { AccountStatus, AvailabilityStatus } from "@prisma/client";
import { prisma } from "../../config/prisma.js";

export async function updateWorkerAvailability(userId: string, input: WorkerAvailabilityInput) {
  const parsed = workerAvailabilitySchema.parse(input);

  return prisma.workerProfile.update({
    where: { userId },
    data: {
      availabilityStatus: AvailabilityStatus.AVAILABLE,
      currentLatitude: parsed.latitude,
      currentLongitude: parsed.longitude,
      travelDistanceMiles: parsed.travelDistanceMiles,
      hourlyRateCents: parsed.hourlyRateCents,
      minJobAmountCents: parsed.minJobAmountCents,
      serviceCategories: {
        set: parsed.serviceCategoryIds.map((id) => ({ id }))
      }
    },
    include: {
      user: { select: { id: true, fullName: true } },
      serviceCategories: true
    }
  });
}

export async function setWorkerOffline(userId: string) {
  return prisma.workerProfile.updateMany({
    where: { userId },
    data: { availabilityStatus: AvailabilityStatus.OFFLINE }
  });
}

export async function findAvailableWorkersNearby(latitude: number, longitude: number, radiusMiles = 20) {
  const workers = await prisma.workerProfile.findMany({
    where: {
      availabilityStatus: AvailabilityStatus.AVAILABLE,
      currentLatitude: { not: null },
      currentLongitude: { not: null },
      user: { accountStatus: AccountStatus.APPROVED }
    },
    include: {
      user: { select: { id: true, fullName: true, accountStatus: true } },
      serviceCategories: {
        where: { launchPhase: "MVP", isActive: true },
        select: { id: true, name: true, slug: true }
      }
    },
    take: 100
  });

  return workers
    .map((worker) => {
      const workerLat = Number(worker.currentLatitude);
      const workerLng = Number(worker.currentLongitude);
      const distanceMiles = haversineMiles(latitude, longitude, workerLat, workerLng);
      const travelRadiusMiles = Number(worker.travelDistanceMiles);

      return {
        id: worker.id,
        userId: worker.userId,
        fullName: worker.user.fullName,
        ratingAverage: Number(worker.ratingAverage),
        completedGigCount: worker.completedGigCount,
        distanceMiles: Math.round(distanceMiles * 10) / 10,
        travelRadiusMiles,
        estimatedResponseMinutes: estimateResponseMinutes(distanceMiles),
        hourlyRateCents: worker.hourlyRateCents,
        minJobAmountCents: worker.minJobAmountCents,
        services: worker.serviceCategories
      };
    })
    .filter(
      (worker) =>
        worker.distanceMiles <= radiusMiles &&
        worker.distanceMiles <= worker.travelRadiusMiles &&
        worker.services.length > 0
    )
    .sort((left, right) => left.distanceMiles - right.distanceMiles);
}

export async function getWorkerEarnings(userId: string) {
  const assignments = await prisma.gigAssignment.findMany({
    where: { workerId: userId },
    include: {
      gig: {
        select: {
          id: true,
          title: true,
          status: true,
          workerPayoutCents: true,
          platformFeeCents: true,
          totalCents: true,
          createdAt: true
        }
      }
    },
    orderBy: { acceptedAt: "desc" },
    take: 100
  });

  const completed = assignments.filter((assignment) => assignment.gig.status === "COMPLETED");
  const pending = assignments.filter((assignment) =>
    ["WORKER_ASSIGNED", "WORKER_EN_ROUTE", "WORKER_ARRIVED", "IN_PROGRESS"].includes(assignment.gig.status)
  );

  const totalEarningsCents = completed.reduce((sum, assignment) => sum + assignment.gig.workerPayoutCents, 0);
  const pendingEarningsCents = pending.reduce((sum, assignment) => sum + assignment.gig.workerPayoutCents, 0);
  const platformFeesCents = completed.reduce((sum, assignment) => sum + assignment.gig.platformFeeCents, 0);

  return {
    totalEarningsCents,
    pendingEarningsCents,
    completedGigCount: completed.length,
    platformFeesCents,
    payoutStatus: "Payouts coming soon",
    recentPayouts: completed.slice(0, 20).map((assignment) => ({
      gigId: assignment.gig.id,
      title: assignment.gig.title,
      workerPayoutCents: assignment.gig.workerPayoutCents,
      completedAt: assignment.completedAt?.toISOString() ?? assignment.gig.createdAt.toISOString()
    }))
  };
}
