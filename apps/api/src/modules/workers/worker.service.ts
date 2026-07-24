import {
  workerAvailabilitySchema,
  workerPreferencesSchema,
  haversineMiles,
  estimateResponseMinutes,
  compareWorkersForMatching
} from "@gigflow/shared";
import type { WorkerAvailabilityInput, WorkerPreferencesInput } from "@gigflow/shared";
import { AccountStatus, AvailabilityStatus, GigStatus } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { getWorkerConnectStatus } from "../payments/payment.service.js";
import { resolveGeocodedLocation, reverseGeocodeCoordinates } from "../location/geocoding.service.js";
import { assertWorkerCanGoOnline } from "../auth/access.service.js";

const IN_PROGRESS_GIG_STATUSES: GigStatus[] = [
  GigStatus.WORKER_ASSIGNED,
  GigStatus.WORKER_EN_ROUTE,
  GigStatus.WORKER_ARRIVED,
  GigStatus.IN_PROGRESS
];

function formatTransactionType(type: string): string {
  if (type === "CANCELLATION_FEE_CREDIT") return "Cancellation Fee";
  return type
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export async function updateWorkerPreferences(userId: string, input: WorkerPreferencesInput) {
  const parsed = workerPreferencesSchema.parse(input);

  return prisma.workerProfile.update({
    where: { userId },
    data: {
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

export async function updateWorkerAvailability(userId: string, input: WorkerAvailabilityInput) {
  const parsed = workerAvailabilitySchema.parse(input);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  assertWorkerCanGoOnline(user);

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
    .sort((left, right) =>
      compareWorkersForMatching(
        {
          userId: left.userId,
          distanceMiles: left.distanceMiles,
          ratingAverage: left.ratingAverage,
          completedGigCount: left.completedGigCount
        },
        {
          userId: right.userId,
          distanceMiles: right.distanceMiles,
          ratingAverage: right.ratingAverage,
          completedGigCount: right.completedGigCount
        }
      )
    );
}

export async function updateWorkerLocation(
  userId: string,
  input: {
    latitude: number;
    longitude: number;
    formattedAddress?: string;
    query?: string;
    placeId?: string;
  }
) {
  const address = input.query || input.placeId
    ? await resolveGeocodedLocation(input)
    : await reverseGeocodeCoordinates(input.latitude, input.longitude);

  return prisma.workerProfile.update({
    where: { userId },
    data: {
      currentLatitude: address.latitude,
      currentLongitude: address.longitude,
      formattedAddress: address.formattedAddress,
      city: address.city,
      serviceArea: `${address.city}, ${address.region}`,
      locationUpdatedAt: new Date()
    },
    include: {
      user: { select: { id: true, fullName: true } },
      serviceCategories: true
    }
  });
}

export async function getWorkerEarnings(userId: string) {
  const [profile, assignments, transactions] = await Promise.all([
    prisma.workerProfile.findUnique({ where: { userId } }),
    prisma.gigAssignment.findMany({
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
    }),
    prisma.workerEarningsTransaction.findMany({
      where: { workerId: userId },
      include: {
        gig: { select: { id: true, title: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 50
    })
  ]);

  const connect = await getWorkerConnectStatus(userId);

  const completed = assignments.filter((assignment) => assignment.gig.status === GigStatus.COMPLETED);
  const pending = assignments.filter((assignment) => IN_PROGRESS_GIG_STATUSES.includes(assignment.gig.status));

  const pendingEarningsCents = pending.reduce((sum, assignment) => sum + assignment.gig.workerPayoutCents, 0);
  const platformFeesCents = completed.reduce((sum, assignment) => sum + assignment.gig.platformFeeCents, 0);

  const availableBalanceCents = profile?.availableBalanceCents ?? 0;
  const withdrawnBalanceCents = profile?.withdrawnBalanceCents ?? 0;
  const totalEarnedCents = profile?.totalEarnedCents ?? 0;

  return {
    totalEarningsCents: totalEarnedCents,
    availableBalanceCents,
    withdrawnBalanceCents,
    pendingEarningsCents,
    completedGigCount: completed.length,
    platformFeesCents,
    payoutStatus: connect.payoutsEnabled
      ? availableBalanceCents > 0
        ? "Ready to withdraw"
        : "Stripe connected — earnings credit after gig completion"
      : connect.accountId
        ? "Finish Stripe setup to withdraw earnings"
        : "Connect Stripe to withdraw earnings",
    stripeConnect: connect,
    transactions: transactions.map((transaction) => ({
      id: transaction.id,
      type: transaction.type,
      label: formatTransactionType(transaction.type),
      status: transaction.status,
      amountCents: transaction.amountCents,
      gigId: transaction.gigId,
      gigTitle: transaction.gig?.title ?? null,
      failureReason: transaction.failureReason,
      createdAt: transaction.createdAt.toISOString()
    })),
    recentPayouts: completed.slice(0, 20).map((assignment) => ({
      gigId: assignment.gig.id,
      title: assignment.gig.title,
      workerPayoutCents: assignment.gig.workerPayoutCents,
      completedAt: assignment.completedAt?.toISOString() ?? assignment.gig.createdAt.toISOString()
    }))
  };
}
