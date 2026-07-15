import type { Server } from "socket.io";
import {
  AccountStatus,
  GigInterestStatus,
  GigStatus,
  PaymentLifecycle,
  PaymentStatus,
  PricingType,
  UserRole
} from "@prisma/client";
import { calculatePriceEstimate, estimateResponseMinutes, haversineMiles, isWithinMatchingRadius, getGigMatchingRadiusMiles } from "@gigflow/shared";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import { assertDevOnlyPaymentBypass } from "../../lib/production-guards.js";
import { isStripeConfigured } from "../../lib/stripe.js";
import { assertWorkerCanAcceptGigs } from "../auth/access.service.js";
import { notifyUser } from "../realtime/realtime.service.js";
import {
  activateGigAfterWorkerPayment,
  assertGigPaymentAuthorized,
  releaseAuthorizedPayment
} from "../payments/payment.service.js";
import { creditWorkerForCompletedGig } from "../payments/worker-earnings.service.js";

const OPEN_FOR_INTEREST: GigStatus[] = [GigStatus.POSTED, GigStatus.SEARCHING_FOR_WORKER];
const GPS_ARRIVAL_RADIUS_MILES = 0.3;

export function isNearGigLocation(
  workerLat: number,
  workerLng: number,
  gigLat: number,
  gigLng: number,
  radiusMiles = GPS_ARRIVAL_RADIUS_MILES
): boolean {
  return haversineMiles(workerLat, workerLng, gigLat, gigLng) <= radiusMiles;
}

export function roundBillableMinutes(elapsedMinutes: number, minimumMinutes = 60, roundTo = 15): number {
  const rounded = Math.ceil(Math.max(0, elapsedMinutes) / roundTo) * roundTo;
  return Math.max(minimumMinutes, rounded);
}

export function usesTimer(pricingType: PricingType): boolean {
  return pricingType === PricingType.HOURLY || pricingType === PricingType.ESTIMATE_TIMER;
}

function formatWorkerInterest(worker: {
  id: string;
  fullName: string;
  email: string;
  phoneNumber: string | null;
  avatarUrl: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  workerProfile: {
    ratingAverage: unknown;
    completedGigCount: number;
    hourlyRateCents: number | null;
    minJobAmountCents: number;
    currentLatitude: unknown;
    currentLongitude: unknown;
  } | null;
}) {
  return {
    id: worker.id,
    fullName: worker.fullName,
    avatarUrl: worker.avatarUrl,
    emailVerified: worker.emailVerified,
    phoneVerified: worker.phoneVerified,
    ratingAverage: worker.workerProfile ? Number(worker.workerProfile.ratingAverage) : 0,
    completedGigCount: worker.workerProfile?.completedGigCount ?? 0,
    hourlyRateCents: worker.workerProfile?.hourlyRateCents ?? null
  };
}

export async function expressWorkerInterest(
  gigId: string,
  workerId: string,
  input?: { message?: string; offeredWorkerPayoutCents?: number; estimatedHours?: number },
  io?: Server
) {
  const worker = await prisma.user.findUnique({
    where: { id: workerId },
    include: { workerProfile: { include: { serviceCategories: true } } }
  });

  if (!worker?.roles.includes(UserRole.WORKER) || worker.accountStatus !== AccountStatus.APPROVED) {
    throw new AppError("FORBIDDEN", 403, "WORKER_NOT_APPROVED", { worker: "Worker account is not approved" });
  }

  await assertWorkerCanAcceptGigs(worker);

  const gig = await prisma.gig.findUnique({ where: { id: gigId }, include: { serviceCategory: true, client: true } });
  if (!gig || !OPEN_FOR_INTEREST.includes(gig.status)) {
    throw new AppError("GIG_NOT_AVAILABLE", 409, "GIG_NOT_AVAILABLE", { gig: "This gig is no longer available." });
  }

  const workerLat = Number(worker.workerProfile?.currentLatitude);
  const workerLng = Number(worker.workerProfile?.currentLongitude);
  const travelRadiusMiles = Number(worker.workerProfile?.travelDistanceMiles ?? 10);

  if (!Number.isFinite(workerLat) || !Number.isFinite(workerLng)) {
    throw new AppError("WORKER_LOCATION_REQUIRED", 400, "WORKER_LOCATION_REQUIRED", {
      location: "Set your current location before responding to gigs."
    });
  }

  const gigRadiusMiles = getGigMatchingRadiusMiles(gig.urgency, gig.size);
  if (
    !isWithinMatchingRadius(
      workerLat,
      workerLng,
      Number(gig.latitude),
      Number(gig.longitude),
      gigRadiusMiles,
      travelRadiusMiles
    )
  ) {
    throw new AppError("GIG_TOO_FAR", 403, "GIG_TOO_FAR", { location: "This gig is outside your travel radius." });
  }

  const distanceMiles = haversineMiles(workerLat, workerLng, Number(gig.latitude), Number(gig.longitude));
  const estimatedArrivalMinutes = estimateResponseMinutes(distanceMiles);

  const interest = await prisma.gigInterest.upsert({
    where: { gigId_workerId: { gigId, workerId } },
    create: {
      gigId,
      workerId,
      status: GigInterestStatus.INTERESTED,
      offeredWorkerPayoutCents: input?.offeredWorkerPayoutCents ?? gig.workerPayoutCents,
      estimatedHours: input?.estimatedHours ?? gig.estimatedHours,
      estimatedArrivalMinutes,
      message: input?.message?.trim() || null
    },
    update: {
      status: GigInterestStatus.INTERESTED,
      offeredWorkerPayoutCents: input?.offeredWorkerPayoutCents ?? gig.workerPayoutCents,
      estimatedHours: input?.estimatedHours ?? gig.estimatedHours,
      estimatedArrivalMinutes,
      message: input?.message?.trim() || null
    },
    include: {
      worker: {
        select: {
          id: true,
          fullName: true,
          email: true,
          phoneNumber: true,
          avatarUrl: true,
          emailVerified: true,
          phoneVerified: true,
          workerProfile: {
            select: {
              ratingAverage: true,
              completedGigCount: true,
              hourlyRateCents: true,
              minJobAmountCents: true,
              currentLatitude: true,
              currentLongitude: true
            }
          }
        }
      }
    }
  });

  if (io) {
    notifyUser(io, gig.clientId, {
      type: "WORKER_INTERESTED",
      title: "Worker interested",
      body: `${worker.fullName} is interested in "${gig.title}".`,
      gigId: gig.id
    });
    io.to(`user:${gig.clientId}`).emit("gig:interest", { gigId: gig.id, interest });
  }

  return {
    ...interest,
    worker: formatWorkerInterest(interest.worker),
    distanceMiles: Math.round(distanceMiles * 10) / 10,
    estimatedArrivalMinutes
  };
}

export async function listGigInterests(gigId: string, clientId: string) {
  const gig = await prisma.gig.findFirst({ where: { id: gigId, clientId } });
  if (!gig) {
    throw new AppError("NOT_FOUND", 404, "NOT_FOUND", { gig: "Gig not found" });
  }

  const interests = await prisma.gigInterest.findMany({
    where: { gigId, status: { in: [GigInterestStatus.INTERESTED, GigInterestStatus.SELECTED] } },
    include: {
      worker: {
        select: {
          id: true,
          fullName: true,
          email: true,
          phoneNumber: true,
          avatarUrl: true,
          emailVerified: true,
          phoneVerified: true,
          workerProfile: {
            select: {
              ratingAverage: true,
              completedGigCount: true,
              hourlyRateCents: true,
              minJobAmountCents: true,
              currentLatitude: true,
              currentLongitude: true
            }
          }
        }
      }
    },
    orderBy: [{ status: "desc" }, { createdAt: "asc" }]
  });

  return interests.map((interest) => {
    const workerLat = Number(interest.worker.workerProfile?.currentLatitude);
    const workerLng = Number(interest.worker.workerProfile?.currentLongitude);
    const distanceMiles =
      Number.isFinite(workerLat) && Number.isFinite(workerLng)
        ? Math.round(haversineMiles(workerLat, workerLng, Number(gig.latitude), Number(gig.longitude)) * 10) / 10
        : null;

    return {
      id: interest.id,
      status: interest.status,
      offeredWorkerPayoutCents: interest.offeredWorkerPayoutCents ?? gig.workerPayoutCents,
      estimatedHours: Number(interest.estimatedHours ?? gig.estimatedHours),
      estimatedArrivalMinutes: interest.estimatedArrivalMinutes,
      message: interest.message,
      worker: formatWorkerInterest(interest.worker),
      distanceMiles
    };
  });
}

export async function getWorkerSelectionSummary(gigId: string, clientId: string, workerId: string) {
  const gig = await prisma.gig.findFirst({
    where: { id: gigId, clientId },
    include: { serviceCategory: true, payment: true }
  });

  if (!gig) {
    throw new AppError("NOT_FOUND", 404, "NOT_FOUND", { gig: "Gig not found" });
  }

  const interest = await prisma.gigInterest.findFirst({
    where: { gigId, workerId, status: { in: [GigInterestStatus.INTERESTED, GigInterestStatus.SELECTED] } },
    include: {
      worker: {
        select: {
          id: true,
          fullName: true,
          avatarUrl: true,
          emailVerified: true,
          phoneVerified: true,
          workerProfile: { select: { ratingAverage: true, completedGigCount: true } }
        }
      }
    }
  });

  if (!interest) {
    throw new AppError("NOT_FOUND", 404, "NOT_FOUND", { worker: "Worker interest not found" });
  }

  const workerChargeCents = interest.offeredWorkerPayoutCents ?? gig.workerPayoutCents;
  const platformFeeCents = gig.platformFeeCents;
  const taxCents = gig.taxCents;
  const estimatedTotalCents = workerChargeCents + platformFeeCents + taxCents;

  return {
    gig: {
      id: gig.id,
      title: gig.title,
      serviceCategoryName: gig.serviceCategory.name,
      pricingType: gig.pricingType,
      estimatedHours: Number(interest.estimatedHours ?? gig.estimatedHours),
      paymentStatus: gig.paymentStatus,
      status: gig.status
    },
    worker: {
      id: interest.worker.id,
      fullName: interest.worker.fullName,
      avatarUrl: interest.worker.avatarUrl,
      ratingAverage: Number(interest.worker.workerProfile?.ratingAverage ?? 0),
      completedGigCount: interest.worker.workerProfile?.completedGigCount ?? 0,
      emailVerified: interest.worker.emailVerified,
      phoneVerified: interest.worker.phoneVerified
    },
    pricing: {
      workerChargeCents,
      platformFeeCents,
      taxCents,
      estimatedTotalCents
    }
  };
}

export async function selectWorkerForGig(gigId: string, clientId: string, workerId: string, io?: Server) {
  const gig = await prisma.gig.findFirst({ where: { id: gigId, clientId } });
  if (!gig || !OPEN_FOR_INTEREST.includes(gig.status)) {
    throw new AppError("INVALID_STATE", 409, "INVALID_GIG_STATE", { gig: "This gig is not open for worker selection." });
  }

  const interest = await prisma.gigInterest.findFirst({
    where: { gigId, workerId, status: GigInterestStatus.INTERESTED }
  });

  if (!interest) {
    throw new AppError("NOT_FOUND", 404, "NOT_FOUND", { worker: "Worker has not expressed interest in this gig." });
  }

  await prisma.$transaction([
    prisma.gigInterest.updateMany({
      where: { gigId, workerId: { not: workerId }, status: GigInterestStatus.INTERESTED },
      data: { status: GigInterestStatus.REJECTED }
    }),
    prisma.gigInterest.update({
      where: { id: interest.id },
      data: { status: GigInterestStatus.SELECTED }
    }),
    prisma.gig.update({
      where: { id: gigId },
      data: {
        status: GigStatus.WORKER_SELECTED,
        assignedWorkerId: workerId,
        workerPayoutCents: interest.offeredWorkerPayoutCents ?? gig.workerPayoutCents
      }
    })
  ]);

  if (io) {
    notifyUser(io, workerId, {
      type: "WORKER_SELECTED",
      title: "You were selected",
      body: `The customer selected you for "${gig.title}". Waiting for payment authorization.`,
      gigId
    });
  }

  return getWorkerSelectionSummary(gigId, clientId, workerId);
}

export async function authorizeWorkerSelectionWithoutStripe(gigId: string, clientId: string, io?: Server) {
  assertDevOnlyPaymentBypass("Authorize without Stripe");
  if (isStripeConfigured()) {
    throw new AppError("STRIPE_REQUIRED", 400, "STRIPE_REQUIRED", {
      payment: "Use Stripe to authorize payment for this gig."
    });
  }

  const gig = await prisma.gig.findFirst({ where: { id: gigId, clientId }, include: { payment: true } });
  if (!gig?.payment || gig.status !== GigStatus.WORKER_SELECTED || !gig.assignedWorkerId) {
    throw new AppError("INVALID_STATE", 409, "INVALID_GIG_STATE", { gig: "Select a worker before authorizing payment." });
  }

  await prisma.gig.update({
    where: { id: gigId },
    data: {
      paymentStatus: PaymentLifecycle.PAYMENT_AUTHORIZED,
      authorizedAt: new Date()
    }
  });

  await prisma.payment.update({
    where: { id: gig.payment.id },
    data: { status: PaymentStatus.AUTHORIZED }
  });

  await activateGigAfterWorkerPayment(gigId, io);
  return getWorkerSelectionSummary(gigId, clientId, gig.assignedWorkerId);
}

function getElapsedMinutes(startedAt: Date, endedAt: Date, pausedAt: Date | null, extraApprovedMinutes: number): number {
  const endMs = endedAt.getTime();
  const startMs = startedAt.getTime();
  const pausedMs = pausedAt ? endMs - pausedAt.getTime() : 0;
  return Math.max(0, Math.round((endMs - startMs - pausedMs) / 60000)) + extraApprovedMinutes;
}

export async function calculateFinalGigAmount(gigId: string) {
  const gig = await prisma.gig.findUniqueOrThrow({
    where: { id: gigId },
    include: { assignments: { orderBy: { acceptedAt: "desc" }, take: 1 }, serviceCategory: true }
  });

  const assignment = gig.assignments[0];
  if (!assignment?.startedAt) {
    return {
      workerPayoutCents: gig.workerPayoutCents,
      platformFeeCents: gig.platformFeeCents,
      taxCents: gig.taxCents,
      totalCents: gig.totalCents
    };
  }

  if (!usesTimer(gig.pricingType)) {
    return {
      workerPayoutCents: gig.workerPayoutCents,
      platformFeeCents: gig.platformFeeCents,
      taxCents: gig.taxCents,
      totalCents: gig.totalCents,
      billableMinutes: null
    };
  }

  const endedAt = assignment.endedAt ?? assignment.completedAt ?? new Date();
  const elapsedMinutes = getElapsedMinutes(
    assignment.startedAt,
    endedAt,
    assignment.timerPausedAt,
    assignment.extraTimeApprovedMinutes
  );
  const billableMinutes = roundBillableMinutes(elapsedMinutes);
  const hourlyRateCents = gig.serviceCategory.hourlyRateCents;
  const workerPayoutCents = Math.round((billableMinutes / 60) * hourlyRateCents);
  const estimate = calculatePriceEstimate(
    {
      serviceCategoryId: gig.serviceCategoryId,
      location: {
        latitude: Number(gig.latitude),
        longitude: Number(gig.longitude),
        formattedAddress: gig.formattedAddress ?? gig.addressLine1,
        addressLine1: gig.addressLine1,
        city: gig.city,
        region: gig.region,
        postalCode: gig.postalCode,
        country: gig.country ?? "US"
      },
      estimatedHours: billableMinutes / 60,
      distanceMiles: Number(gig.distanceMiles),
      urgency: gig.urgency,
      startsAt: gig.startsAt.toISOString(),
      demandMultiplier: Number(gig.demandMultiplier),
      pricingType: gig.pricingType,
      size: gig.size ?? "MEDIUM"
    },
    {
      baseRateCents: gig.serviceCategory.baseRateCents,
      hourlyRateCents: gig.serviceCategory.hourlyRateCents,
      distanceRateCents: gig.serviceCategory.distanceRateCents,
      multiplier: Number(gig.serviceCategory.multiplier)
    }
  );

  return {
    workerPayoutCents: estimate.workerPayoutCents,
    platformFeeCents: estimate.platformFeeCents,
    taxCents: gig.taxCents,
    totalCents: estimate.totalCents + gig.taxCents,
    billableMinutes
  };
}

export async function approveExtraTime(
  gigId: string,
  clientId: string,
  extraMinutes: number,
  io?: Server
) {
  if (extraMinutes <= 0 || extraMinutes > 480) {
    throw new AppError("INVALID_INPUT", 400, "INVALID_INPUT", { minutes: "Enter a valid extra time amount." });
  }

  const gig = await prisma.gig.findFirst({
    where: { id: gigId, clientId, status: GigStatus.WAITING_EXTRA_TIME_APPROVAL },
    include: { assignments: { orderBy: { acceptedAt: "desc" }, take: 1 } }
  });

  if (!gig?.assignments[0]) {
    throw new AppError("INVALID_STATE", 409, "INVALID_GIG_STATE", { gig: "This gig is not waiting for extra time approval." });
  }

  const assignment = gig.assignments[0];
  await prisma.$transaction([
    prisma.gigAssignment.update({
      where: { id: assignment.id },
      data: {
        extraTimeApprovedMinutes: { increment: extraMinutes },
        timerPausedAt: null
      }
    }),
    prisma.gig.update({
      where: { id: gigId },
      data: { status: GigStatus.IN_PROGRESS }
    })
  ]);

  if (io && assignment.workerId) {
    notifyUser(io, assignment.workerId, {
      type: "EXTRA_TIME_APPROVED",
      title: "Extra time approved",
      body: `The customer approved ${extraMinutes} more minutes.`,
      gigId
    });
  }

  return { ok: true, extraMinutes };
}

export async function approveGigCompletion(gigId: string, clientId: string, io?: Server) {
  const gig = await prisma.gig.findFirst({
    where: { id: gigId, clientId, status: GigStatus.WAITING_CUSTOMER_CONFIRMATION },
    include: { assignments: { orderBy: { acceptedAt: "desc" }, take: 1 }, payment: true }
  });

  if (!gig?.assignments[0]) {
    throw new AppError("INVALID_STATE", 409, "INVALID_GIG_STATE", { gig: "This gig is not waiting for your approval." });
  }

  const finalAmounts = await calculateFinalGigAmount(gigId);

  await prisma.gig.update({
    where: { id: gigId },
    data: {
      status: GigStatus.COMPLETED,
      customerApprovedAt: new Date(),
      workerPayoutCents: finalAmounts.workerPayoutCents,
      platformFeeCents: finalAmounts.platformFeeCents,
      totalCents: finalAmounts.totalCents,
      finalTotalCents: finalAmounts.totalCents
    }
  });

  if (gig.payment) {
    await prisma.payment.update({
      where: { id: gig.payment.id },
      data: {
        amountCents: finalAmounts.totalCents,
        workerPayoutCents: finalAmounts.workerPayoutCents,
        platformFeeCents: finalAmounts.platformFeeCents
      }
    });
  }

  await prisma.gigAssignment.update({
    where: { id: gig.assignments[0].id },
    data: {
      completedAt: gig.assignments[0].completedAt ?? new Date(),
      billableMinutes: finalAmounts.billableMinutes ?? undefined
    }
  });

  await prisma.workerProfile.updateMany({
    where: { userId: gig.assignments[0].workerId },
    data: { completedGigCount: { increment: 1 } }
  });

  await creditWorkerForCompletedGig(gigId);

  if (io) {
    notifyUser(io, gig.assignments[0].workerId, {
      type: "GIG_COMPLETED",
      title: "Gig completed",
      body: `Payment captured for "${gig.title}".`,
      gigId
    });
  }

  return { ok: true, finalAmounts };
}

export async function autoApproveStaleGigs(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const gigs = await prisma.gig.findMany({
    where: {
      status: GigStatus.WAITING_CUSTOMER_CONFIRMATION,
      updatedAt: { lte: cutoff }
    },
    select: { id: true, clientId: true }
  });

  let count = 0;
  for (const gig of gigs) {
    try {
      await approveGigCompletion(gig.id, gig.clientId);
      count += 1;
    } catch {
      // skip failures
    }
  }

  return count;
}

export async function assertWorkerNearGig(
  gigId: string,
  workerLat: number,
  workerLng: number,
  action: "arrive" | "start"
): Promise<void> {
  const gig = await prisma.gig.findUniqueOrThrow({ where: { id: gigId } });
  if (
    !isNearGigLocation(workerLat, workerLng, Number(gig.latitude), Number(gig.longitude), GPS_ARRIVAL_RADIUS_MILES)
  ) {
    throw new AppError("GPS_VERIFICATION_FAILED", 400, "GPS_VERIFICATION_FAILED", {
      location: `Move closer to the customer's address before you can ${action === "arrive" ? "mark arrival" : "start the gig"}.`
    });
  }
}

export async function checkTimerThreshold(gigId: string, io?: Server): Promise<void> {
  const gig = await prisma.gig.findUnique({
    where: { id: gigId, status: GigStatus.IN_PROGRESS },
    include: { assignments: { orderBy: { acceptedAt: "desc" }, take: 1 } }
  });

  if (!gig?.assignments[0]?.startedAt || !usesTimer(gig.pricingType)) return;
  if (gig.pricingType !== PricingType.ESTIMATE_TIMER) return;

  const assignment = gig.assignments[0];
  const elapsedMinutes = getElapsedMinutes(
    assignment.startedAt!,
    new Date(),
    assignment.timerPausedAt,
    assignment.extraTimeApprovedMinutes
  );
  const bookedMinutes = Math.round(Number(gig.estimatedHours) * 60);

  if (elapsedMinutes < bookedMinutes) return;

  await prisma.$transaction([
    prisma.gig.update({ where: { id: gigId }, data: { status: GigStatus.WAITING_EXTRA_TIME_APPROVAL } }),
    prisma.gigAssignment.update({
      where: { id: assignment.id },
      data: { timerPausedAt: assignment.timerPausedAt ?? new Date() }
    })
  ]);

  if (io) {
    notifyUser(io, gig.clientId, {
      type: "ESTIMATED_TIME_REACHED",
      title: "Booked time reached",
      body: `Your worker has reached the booked time for "${gig.title}". Approve extra time or finish the job.`,
      gigId
    });
  }
}

export { releaseAuthorizedPayment, assertGigPaymentAuthorized };
