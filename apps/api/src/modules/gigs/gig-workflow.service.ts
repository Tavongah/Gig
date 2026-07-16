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
import { calculatePriceEstimate, estimateResponseMinutes, haversineMiles, isWithinMatchingRadius, getGigMatchingRadiusMiles, workerCancelOutcome, billableSecondsFromWorkWindow, calculateTimeBasedAuthorization, isTimeBasedPricing, roundBillableMinutes } from "@gigflow/shared";
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

export { roundBillableMinutes };

export function isNearGigLocation(
  workerLat: number,
  workerLng: number,
  gigLat: number,
  gigLng: number,
  radiusMiles = GPS_ARRIVAL_RADIUS_MILES
): boolean {
  return haversineMiles(workerLat, workerLng, gigLat, gigLng) <= radiusMiles;
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
  const timed = isTimeBasedPricing(gig.pricingType);
  const auth =
    timed && gig.maximumAuthorizedAmountCents
      ? {
          authorizationBufferCents: gig.authorizationBufferCents,
          maximumAuthorizedAmountCents: gig.maximumAuthorizedAmountCents
        }
      : timed
        ? calculateTimeBasedAuthorization({
            estimatedTotalCents,
            estimatedLaborCents: workerChargeCents,
            hourlyRateCents: gig.serviceCategory.hourlyRateCents
          })
        : { authorizationBufferCents: 0, maximumAuthorizedAmountCents: estimatedTotalCents };

  return {
    gig: {
      id: gig.id,
      title: gig.title,
      serviceCategoryName: gig.serviceCategory.name,
      pricingType: gig.pricingType,
      estimatedHours: Number(interest.estimatedHours ?? gig.estimatedHours),
      paymentStatus: gig.paymentStatus,
      status: gig.status,
      billingIncrementMinutes: gig.billingIncrementMinutes
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
      estimatedTotalCents,
      hourlyRateCents: gig.serviceCategory.hourlyRateCents,
      authorizationBufferCents: auth.authorizationBufferCents,
      maximumAuthorizedAmountCents: auth.maximumAuthorizedAmountCents,
      billingIncrementMinutes: gig.billingIncrementMinutes,
      isTimeBased: timed
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

  const otherInterests = await prisma.gigInterest.findMany({
    where: { gigId, workerId: { not: workerId }, status: GigInterestStatus.INTERESTED },
    select: { workerId: true }
  });

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
      title: "You have been selected for this gig.",
      body: `The customer selected you for "${gig.title}". Complete payment to start.`,
      gigId
    });
    io.to(`user:${workerId}`).emit("worker_selected", {
      gigId,
      workerId,
      status: "SELECTED"
    });

    for (const row of otherInterests) {
      notifyUser(io, row.workerId, {
        type: "WORKER_NOT_SELECTED",
        title: "Another worker was selected",
        body: "Another worker was selected for this gig.",
        gigId
      });
      io.to(`user:${row.workerId}`).emit("worker_not_selected", {
        gigId,
        workerId: row.workerId,
        message: "Another worker was selected for this gig."
      });
    }
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
      paymentStatus: PaymentLifecycle.PAYMENT_CAPTURED,
      authorizedAt: new Date()
    }
  });

  await prisma.payment.update({
    where: { id: gig.payment.id },
    data: { status: PaymentStatus.CAPTURED }
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
    include: {
      assignments: { where: { cancelledAt: null }, orderBy: { acceptedAt: "desc" }, take: 1 },
      serviceCategory: true,
      payment: true
    }
  });

  const assignment = gig.assignments[0];
  if (!assignment?.startedAt) {
    return {
      workerPayoutCents: gig.workerPayoutCents,
      platformFeeCents: gig.platformFeeCents,
      taxCents: gig.taxCents,
      totalCents: gig.totalCents,
      billableMinutes: null as number | null,
      actualWorkedSeconds: null as number | null,
      billableSeconds: null as number | null,
      hourlyRateCents: gig.serviceCategory.hourlyRateCents,
      workStartedAt: null as Date | null,
      workCompletedAt: null as Date | null
    };
  }

  if (!usesTimer(gig.pricingType)) {
    return {
      workerPayoutCents: gig.workerPayoutCents,
      platformFeeCents: gig.platformFeeCents,
      taxCents: gig.taxCents,
      totalCents: gig.totalCents,
      billableMinutes: null as number | null,
      actualWorkedSeconds: null as number | null,
      billableSeconds: null as number | null,
      hourlyRateCents: gig.serviceCategory.hourlyRateCents,
      workStartedAt: assignment.startedAt,
      workCompletedAt: assignment.endedAt ?? assignment.completedAt ?? null
    };
  }

  const endedAt = assignment.endedAt ?? assignment.completedAt ?? new Date();
  const pausedSeconds =
    assignment.totalApprovedPausedSeconds ||
    (assignment.timerPausedAt
      ? Math.max(0, Math.floor((endedAt.getTime() - assignment.timerPausedAt.getTime()) / 1000))
      : 0);
  const actualWorkedSeconds = billableSecondsFromWorkWindow({
    workStartedAt: assignment.startedAt,
    workCompletedAt: endedAt,
    totalApprovedPausedSeconds: pausedSeconds
  });
  const elapsedMinutes =
    Math.max(0, Math.round(actualWorkedSeconds / 60)) + assignment.extraTimeApprovedMinutes;
  const increment = gig.billingIncrementMinutes || 15;
  const billableMinutes = roundBillableMinutes(elapsedMinutes, 60, increment);
  const billableSeconds = billableMinutes * 60;
  const hourlyRateCents = gig.serviceCategory.hourlyRateCents;
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

  let totalCents = estimate.totalCents + gig.taxCents;
  const maxAuthorized = gig.maximumAuthorizedAmountCents ?? gig.payment?.maximumAuthorizedAmountCents;
  if (typeof maxAuthorized === "number" && maxAuthorized > 0) {
    totalCents = Math.min(totalCents, maxAuthorized);
  }

  return {
    workerPayoutCents: estimate.workerPayoutCents,
    platformFeeCents: estimate.platformFeeCents,
    taxCents: gig.taxCents,
    totalCents,
    billableMinutes,
    actualWorkedSeconds,
    billableSeconds,
    hourlyRateCents,
    workStartedAt: assignment.startedAt,
    workCompletedAt: endedAt
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
    where: {
      id: gigId,
      clientId,
      status: { in: [GigStatus.WAITING_CUSTOMER_CONFIRMATION, GigStatus.WAITING_EXTRA_TIME_APPROVAL] }
    },
    include: { assignments: { where: { cancelledAt: null }, orderBy: { acceptedAt: "desc" }, take: 1 }, payment: true }
  });

  if (!gig?.assignments[0]) {
    throw new AppError("INVALID_STATE", 409, "INVALID_GIG_STATE", { gig: "This gig is not waiting for your approval." });
  }

  // Finishing from overtime pause: stop the timer with a server timestamp first.
  if (gig.status === GigStatus.WAITING_EXTRA_TIME_APPROVAL) {
    const now = new Date();
    await prisma.gigAssignment.update({
      where: { id: gig.assignments[0].id },
      data: {
        endedAt: gig.assignments[0].endedAt ?? now,
        completedAt: gig.assignments[0].completedAt ?? now,
        timerPausedAt: null
      }
    });
    await prisma.gig.update({
      where: { id: gigId },
      data: { status: GigStatus.WAITING_CUSTOMER_CONFIRMATION }
    });
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
      billableMinutes: finalAmounts.billableMinutes ?? undefined,
      actualWorkedSeconds: finalAmounts.actualWorkedSeconds ?? undefined,
      billableSeconds: finalAmounts.billableSeconds ?? undefined
    }
  });

  await prisma.workerProfile.updateMany({
    where: { userId: gig.assignments[0].workerId },
    data: { completedGigCount: { increment: 1 } }
  });

  await creditWorkerForCompletedGig(gigId);

  if (io) {
    const billableLabel =
      finalAmounts.billableMinutes != null
        ? `${Math.floor(finalAmounts.billableMinutes / 60)} hour${finalAmounts.billableMinutes >= 120 ? "s" : ""} and ${finalAmounts.billableMinutes % 60} minutes`
        : null;
    notifyUser(io, gig.assignments[0].workerId, {
      type: "GIG_COMPLETED",
      title: "Gig completed",
      body: billableLabel
        ? `Gig completed. Final charge is based on ${billableLabel} of billable work.`
        : `Payment confirmed for "${gig.title}".`,
      gigId
    });
    notifyUser(io, gig.clientId, {
      type: "GIG_COMPLETED",
      title: "Gig completed",
      body: billableLabel
        ? `Gig completed. Your final charge is $${(finalAmounts.totalCents / 100).toFixed(2)} based on ${billableLabel} of billable work.`
        : `Your booking for "${gig.title}" is complete.`,
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
    include: { assignments: { where: { cancelledAt: null }, orderBy: { acceptedAt: "desc" }, take: 1 }, serviceCategory: true }
  });

  if (!gig?.assignments[0]?.startedAt || !usesTimer(gig.pricingType)) return;

  const assignment = gig.assignments[0];
  const elapsedMinutes = getElapsedMinutes(
    assignment.startedAt!,
    new Date(),
    assignment.timerPausedAt,
    assignment.extraTimeApprovedMinutes
  );
  const bookedMinutes = Math.round(Number(gig.estimatedHours) * 60);
  const maxAuthorized = gig.maximumAuthorizedAmountCents ?? 0;
  const projected = calculatePriceEstimate(
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
      estimatedHours: Math.max(elapsedMinutes, bookedMinutes) / 60,
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

  const approachingAuthLimit =
    maxAuthorized > 0 && projected.totalCents + gig.taxCents >= Math.floor(maxAuthorized * 0.9);
  const pastBookedEstimate =
    gig.pricingType === PricingType.ESTIMATE_TIMER && elapsedMinutes >= bookedMinutes;

  if (!approachingAuthLimit && !pastBookedEstimate) return;

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
      title: approachingAuthLimit ? "Approved booking time almost complete" : "Booked time reached",
      body: approachingAuthLimit
        ? "The approved booking time is almost complete. Approve additional time to continue, or finish the job."
        : `Your worker has reached the booked time for "${gig.title}". Approve extra time or finish the job.`,
      gigId
    });
    if (assignment.workerId) {
      notifyUser(io, assignment.workerId, {
        type: "TIMER_PAUSED",
        title: "Timer paused",
        body: "Waiting for the customer to approve more time or finish the job.",
        gigId
      });
    }
  }
}

export { releaseAuthorizedPayment, assertGigPaymentAuthorized };

/** Worker withdraws interest while still matching (before customer selection). */
export async function withdrawWorkerInterest(gigId: string, workerId: string, io?: Server) {
  const interest = await prisma.gigInterest.findFirst({
    where: { gigId, workerId, status: GigInterestStatus.INTERESTED },
    include: { gig: { include: { serviceCategory: true } } }
  });

  if (!interest) {
    throw new AppError("NOT_FOUND", 404, "NOT_FOUND", { interest: "No active matching offer for this gig." });
  }

  if (!OPEN_FOR_INTEREST.includes(interest.gig.status)) {
    throw new AppError("INVALID_STATE", 409, "INVALID_GIG_STATE", {
      gig: "You can only withdraw before the customer selects a worker."
    });
  }

  await prisma.gigInterest.update({
    where: { id: interest.id },
    data: { status: GigInterestStatus.WITHDRAWN }
  });

  if (io) {
    io.to(`user:${interest.gig.clientId}`).emit("worker_withdrew", {
      gigId,
      workerId,
      status: "WITHDRAWN"
    });
    notifyUser(io, interest.gig.clientId, {
      type: "WORKER_WITHDREW",
      title: "Worker withdrew",
      body: `A worker withdrew from "${interest.gig.title}".`,
      gigId
    });
  }

  return { withdrawn: true, gigId };
}

/**
 * Selected worker cancels before IN_PROGRESS → rematch customer on same gig (no new payment).
 * During IN_PROGRESS → DISPUTED (no automatic rematch).
 */
export async function cancelAssignedWorkerAndRematch(
  gigId: string,
  workerId: string,
  reason: string,
  io?: Server
) {
  const trimmedReason = reason.trim();
  if (trimmedReason.length < 3) {
    throw new AppError("VALIDATION_ERROR", 400, "VALIDATION_ERROR", {
      reason: "Please provide a short cancellation reason."
    });
  }

  const gig = await prisma.gig.findUnique({
    where: { id: gigId },
    include: {
      payment: true,
      assignments: { where: { workerId, cancelledAt: null }, orderBy: { acceptedAt: "desc" }, take: 1 },
      serviceCategory: true
    }
  });

  if (!gig) {
    throw new AppError("NOT_FOUND", 404, "NOT_FOUND", { gig: "Gig not found" });
  }

  if (gig.assignedWorkerId !== workerId) {
    throw new AppError("FORBIDDEN", 403, "FORBIDDEN", { worker: "You are not the selected worker for this gig." });
  }

  const outcome = workerCancelOutcome(gig.status);
  if (outcome === "BLOCKED") {
    throw new AppError("INVALID_STATE", 409, "INVALID_GIG_STATE", {
      gig: "This gig can no longer be cancelled by the worker."
    });
  }

  if (outcome === "DISPUTE") {
    await prisma.$transaction(async (tx) => {
      if (gig.assignments[0]) {
        await tx.gigAssignment.update({
          where: { id: gig.assignments[0]!.id },
          data: { cancelledAt: new Date(), completionNotes: trimmedReason }
        });
      }
      await tx.gigInterest.updateMany({
        where: { gigId, workerId },
        data: { status: GigInterestStatus.WITHDRAWN }
      });
      await tx.gig.update({
        where: { id: gigId },
        data: { status: GigStatus.DISPUTED, assignedWorkerId: null }
      });
    });

    if (io) {
      notifyUser(io, gig.clientId, {
        type: "GIG_INTERRUPTED",
        title: "Gig interrupted",
        body: `Your worker cancelled after work started on "${gig.title}". Support has been notified.`,
        gigId
      });
      io.to(`user:${gig.clientId}`).emit("selected_worker_cancelled", {
        gigId,
        cancelledWorkerId: workerId,
        customerId: gig.clientId,
        previousStatus: gig.status,
        newStatus: GigStatus.DISPUTED,
        cancellationReason: trimmedReason,
        cancelledAt: new Date().toISOString(),
        rematching: false
      });
    }

    return { rematching: false, status: GigStatus.DISPUTED };
  }

  const previousStatus = gig.status;

  await prisma.$transaction(async (tx) => {
    if (gig.assignments[0]) {
      await tx.gigAssignment.update({
        where: { id: gig.assignments[0]!.id },
        data: { cancelledAt: new Date(), completionNotes: trimmedReason }
      });
    }

    await tx.gigInterest.updateMany({
      where: { gigId, workerId },
      data: { status: GigInterestStatus.WITHDRAWN }
    });

    // Keep other valid INTERESTED offers; reopen matching on the same gig + payment.
    await tx.gig.update({
      where: { id: gigId },
      data: {
        status: GigStatus.SEARCHING_FOR_WORKER,
        assignedWorkerId: null
      }
    });

    // Cancelled worker must not receive payout; keep customer payment on the gig.
    if (gig.payment?.stripeTransferId == null && gig.payment) {
      await tx.payment.update({
        where: { id: gig.payment.id },
        data: {
          status:
            gig.paymentStatus === PaymentLifecycle.PAYMENT_CAPTURED ||
            gig.paymentStatus === PaymentLifecycle.PAYOUT_PENDING ||
            gig.paymentStatus === PaymentLifecycle.PAYOUT_PAID
              ? PaymentStatus.CAPTURED
              : gig.payment.status
        }
      });
    }
  });

  if (io) {
    const payload = {
      gigId,
      cancelledWorkerId: workerId,
      customerId: gig.clientId,
      previousStatus,
      newStatus: GigStatus.SEARCHING_FOR_WORKER,
      cancellationReason: trimmedReason,
      cancelledAt: new Date().toISOString()
    };
    io.to(`user:${gig.clientId}`).emit("selected_worker_cancelled", { ...payload, rematching: true });
    io.to(`user:${gig.clientId}`).emit("gig_rematching", {
      gigId,
      customerId: gig.clientId,
      status: GigStatus.SEARCHING_FOR_WORKER,
      rematchingStartedAt: new Date().toISOString()
    });
    io.to(`gig:${gigId}`).emit("gig:status", { gigId, status: GigStatus.SEARCHING_FOR_WORKER });
    notifyUser(io, gig.clientId, {
      type: "WORKER_CANCELLED_REMATCH",
      title: "Finding another worker",
      body: "Your previous worker cancelled. We’re searching for another available worker nearby.",
      gigId
    });

    // Re-broadcast to nearby workers (exclude cancelled worker via client filters / interest status).
    const { broadcastGigOffer } = await import("../realtime/realtime.service.js");
    await broadcastGigOffer(io, {
      gigId: gig.id,
      title: gig.title,
      serviceCategoryId: gig.serviceCategoryId,
      serviceCategoryName: gig.serviceCategory.name,
      latitude: Number(gig.latitude),
      longitude: Number(gig.longitude),
      city: gig.city,
      region: gig.region,
      size: gig.size,
      totalCents: gig.totalCents,
      workerPayoutCents: gig.workerPayoutCents,
      startsAt: gig.startsAt.toISOString(),
      urgency: gig.urgency,
      estimatedHours: Number(gig.estimatedHours)
    });
  }

  return { rematching: true, status: GigStatus.SEARCHING_FOR_WORKER };
}

export async function getWorkerMatchingInterest(gigId: string, workerId: string) {
  const interest = await prisma.gigInterest.findFirst({
    where: { gigId, workerId },
    include: {
      gig: {
        include: {
          serviceCategory: true,
          client: { select: { id: true, fullName: true } }
        }
      }
    }
  });

  if (!interest) {
    throw new AppError("NOT_FOUND", 404, "NOT_FOUND", { interest: "Offer not found" });
  }

  const gig = interest.gig;
  return {
    interest: {
      id: interest.id,
      status: interest.status,
      offeredWorkerPayoutCents: interest.offeredWorkerPayoutCents ?? gig.workerPayoutCents,
      estimatedArrivalMinutes: interest.estimatedArrivalMinutes,
      estimatedHours: Number(interest.estimatedHours ?? gig.estimatedHours),
      createdAt: interest.createdAt
    },
    gig: {
      id: gig.id,
      title: gig.title,
      status: gig.status,
      paymentStatus: gig.paymentStatus,
      city: gig.city,
      region: gig.region,
      startsAt: gig.startsAt,
      estimatedHours: Number(gig.estimatedHours),
      workerPayoutCents: interest.offeredWorkerPayoutCents ?? gig.workerPayoutCents,
      totalCents: gig.totalCents,
      urgency: gig.urgency,
      size: gig.size,
      serviceCategory: { id: gig.serviceCategory.id, name: gig.serviceCategory.name },
      assignedWorkerId: gig.assignedWorkerId
    }
  };
}

export async function listWorkerMatchingInterests(workerId: string) {
  const interests = await prisma.gigInterest.findMany({
    where: {
      workerId,
      status: { in: [GigInterestStatus.INTERESTED, GigInterestStatus.SELECTED] }
    },
    include: {
      gig: { include: { serviceCategory: true } }
    },
    orderBy: { updatedAt: "desc" }
  });

  return interests.map((interest) => ({
    id: interest.id,
    status: interest.status,
    offeredWorkerPayoutCents: interest.offeredWorkerPayoutCents ?? interest.gig.workerPayoutCents,
    gig: {
      id: interest.gig.id,
      title: interest.gig.title,
      status: interest.gig.status,
      city: interest.gig.city,
      region: interest.gig.region,
      startsAt: interest.gig.startsAt,
      estimatedHours: Number(interest.gig.estimatedHours),
      workerPayoutCents: interest.offeredWorkerPayoutCents ?? interest.gig.workerPayoutCents,
      serviceCategory: {
        id: interest.gig.serviceCategory.id,
        name: interest.gig.serviceCategory.name
      },
      assignedWorkerId: interest.gig.assignedWorkerId
    }
  }));
}
