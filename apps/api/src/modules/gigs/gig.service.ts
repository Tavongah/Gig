import type { Server } from "socket.io";

import {
  GIG_VALIDATION_MESSAGES,
  calculatePriceEstimate,
  calculateTimeBasedAuthorization,
  createGigSchema,
  gigEstimateSchema,
  haversineMiles,
  estimateResponseMinutes,
  getGigMatchingRadiusMiles,
  isWithinMatchingRadius,
  isTimeBasedPricing,
  resolvePricingType
} from "@gigflow/shared";

import type { CreateGigInput, GigEstimateInput } from "@gigflow/shared";

import { AccountStatus, AvailabilityStatus, GigStatus, LaunchPhase, PaymentLifecycle, PricingType, Prisma, UserRole } from "@prisma/client";

import { prisma } from "../../config/prisma.js";

import { AppError } from "../../lib/errors.js";
import { broadcastGigOffer, notifyUser } from "../realtime/realtime.service.js";
import {
  processWorkerPayout,
  publishGigDevWithoutPayment,
  publishPostedGig,
  releaseAuthorizedPayment,
  assertGigPaymentAuthorized
} from "../payments/payment.service.js";
import {
  approveExtraTime,
  approveGigCompletion,
  assertWorkerNearGig,
  checkTimerThreshold,
  expressWorkerInterest
} from "./gig-workflow.service.js";
import { resolveGeocodedLocation } from "../location/geocoding.service.js";
import { sanitizeGigForViewer, toGeoPointInput } from "../location/gig-privacy.js";
import { assertClientCanPostGigs } from "../auth/access.service.js";



const SEARCHING_STATUSES: GigStatus[] = [GigStatus.POSTED, GigStatus.SEARCHING_FOR_WORKER];



export async function listCategories() {

  const categories = await prisma.serviceCategory.findMany({

    where: { isActive: true },

    orderBy: [{ launchPhase: "asc" }, { name: "asc" }]

  });



  const mvp = categories.filter((category) => category.launchPhase === LaunchPhase.MVP);

  const comingSoon = categories.filter((category) => category.launchPhase === LaunchPhase.PHASE_2);



  return { categories: mvp, mvp, comingSoon };

}



async function getMvpCategory(serviceCategoryId: string) {

  const category = await prisma.serviceCategory.findUniqueOrThrow({

    where: { id: serviceCategoryId }

  });



  if (category.launchPhase !== LaunchPhase.MVP || !category.isActive) {

    throw new AppError("CATEGORY_NOT_AVAILABLE", 422, "CATEGORY_NOT_AVAILABLE", {

      serviceType: GIG_VALIDATION_MESSAGES.serviceType

    });

  }



  return category;

}



export async function estimateGig(input: GigEstimateInput) {

  const parsed = gigEstimateSchema.parse(input);

  const category = await getMvpCategory(parsed.serviceCategoryId);

  parsed.pricingType = resolvePricingType({
    slug: category.slug,
    description: parsed.description,
    estimatedHours: parsed.estimatedHours,
    size: parsed.size
  });

  const validatedLocation = await resolveGeocodedLocation({
    latitude: parsed.location.latitude,
    longitude: parsed.location.longitude,
    formattedAddress: parsed.location.formattedAddress,
    addressLine1: parsed.location.addressLine1,
    city: parsed.location.city,
    region: parsed.location.region,
    postalCode: parsed.location.postalCode,
    country: parsed.location.country,
    query: parsed.location.formattedAddress
  });

  parsed.location = toGeoPointInput(validatedLocation);

  return calculatePriceEstimate(parsed, {

    baseRateCents: category.baseRateCents,

    hourlyRateCents: category.hourlyRateCents,

    distanceRateCents: category.distanceRateCents,

    multiplier: Number(category.multiplier)

  });

}



export async function createGig(clientId: string, input: CreateGigInput, _io: Server) {

  const parsed = createGigSchema.parse(input);

  const client = await prisma.user.findUniqueOrThrow({ where: { id: clientId } });
  assertClientCanPostGigs(client);

  const category = await getMvpCategory(parsed.serviceCategoryId);

  parsed.pricingType = resolvePricingType({
    slug: category.slug,
    description: parsed.description,
    estimatedHours: parsed.estimatedHours,
    size: parsed.size
  });

  const validatedLocation = await resolveGeocodedLocation({
    latitude: parsed.location.latitude,
    longitude: parsed.location.longitude,
    formattedAddress: parsed.location.formattedAddress,
    addressLine1: parsed.location.addressLine1,
    city: parsed.location.city,
    region: parsed.location.region,
    postalCode: parsed.location.postalCode,
    country: parsed.location.country,
    query: parsed.location.formattedAddress
  });

  parsed.location = toGeoPointInput(validatedLocation);

  const price = await estimateGig(parsed);

  const timed = isTimeBasedPricing(String(parsed.pricingType));
  const auth = timed
    ? calculateTimeBasedAuthorization({
        estimatedTotalCents: price.totalCents,
        estimatedLaborCents: price.laborCents ?? price.workerPayoutCents,
        hourlyRateCents: price.hourlyRateCents
      })
    : { authorizationBufferCents: 0, maximumAuthorizedAmountCents: price.totalCents };

  const gig = await prisma.gig.create({

    data: {

      clientId,

      serviceCategoryId: parsed.serviceCategoryId,

      title: parsed.title,

      description: parsed.description,

      status: GigStatus.POSTED,

      paymentStatus: PaymentLifecycle.PAYMENT_PENDING,

      publishedAt: new Date(),

      pricingType: parsed.pricingType as PricingType,

      urgency: parsed.urgency,

      size: parsed.size,

      estimatedHours: parsed.estimatedHours,

      distanceMiles: parsed.distanceMiles,

      demandMultiplier: parsed.demandMultiplier,

      startsAt: new Date(parsed.startsAt),

      addressLine1: parsed.location.addressLine1,

      addressLine2: parsed.location.addressLine2,

      city: parsed.location.city,

      region: parsed.location.region,

      postalCode: parsed.location.postalCode,

      country: parsed.location.country,

      formattedAddress: parsed.location.formattedAddress,

      latitude: parsed.location.latitude,

      longitude: parsed.location.longitude,

      photoUrls: parsed.photos,

      priceBreakdown: {
        ...price,
        authorizationBufferCents: auth.authorizationBufferCents,
        maximumAuthorizedAmountCents: auth.maximumAuthorizedAmountCents,
        billingIncrementMinutes: 15
      } as unknown as Prisma.InputJsonValue,

      totalCents: price.totalCents,

      platformFeeCents: price.platformFeeCents,

      workerPayoutCents: price.workerPayoutCents,

      authorizationBufferCents: auth.authorizationBufferCents,

      maximumAuthorizedAmountCents: auth.maximumAuthorizedAmountCents,

      billingIncrementMinutes: 15,

      payment: {

        create: {

          amountCents: timed ? auth.maximumAuthorizedAmountCents : price.totalCents,

          platformFeeCents: price.platformFeeCents,

          workerPayoutCents: price.workerPayoutCents,

          maximumAuthorizedAmountCents: auth.maximumAuthorizedAmountCents

        }

      },

      chatThread: { create: {} }

    },

    include: { serviceCategory: true, payment: true }

  });

  await publishPostedGig(gig.id);

  return gig;
}

export async function publishGigWithoutPayment(gigId: string, clientId: string): Promise<void> {
  await publishGigDevWithoutPayment(gigId, clientId);
}



export async function findNearbyGigs(workerId: string) {

  const worker = await prisma.user.findUniqueOrThrow({

    where: { id: workerId },

    include: { workerProfile: { include: { serviceCategories: true } } }

  });



  if (!worker.roles.includes(UserRole.WORKER) || !worker.workerProfile) {

    return [];

  }

  if (worker.accountStatus !== AccountStatus.APPROVED) {

    return [];

  }

  if (worker.workerProfile.availabilityStatus !== AvailabilityStatus.AVAILABLE) {

    return [];

  }



  const workerLat = Number(worker.workerProfile.currentLatitude);
  const workerLng = Number(worker.workerProfile.currentLongitude);

  if (!Number.isFinite(workerLat) || !Number.isFinite(workerLng)) {
    return [];
  }

  const travelRadiusMiles = Number(worker.workerProfile.travelDistanceMiles);

  const serviceCategoryIds = worker.workerProfile.serviceCategories.map((category) => category.id);



  const gigs = await prisma.gig.findMany({

    where: {

      status: { in: SEARCHING_STATUSES },

      serviceCategoryId: { in: serviceCategoryIds },

      startsAt: { gte: new Date(Date.now() - 30 * 60 * 1000) }

    },

    include: { serviceCategory: true, client: true },

    orderBy: [{ createdAt: "desc" }, { workerPayoutCents: "desc" }],

    take: 50

  });



  return gigs

    .map((gig) => {

      const distanceMiles = haversineMiles(workerLat, workerLng, Number(gig.latitude), Number(gig.longitude));
      const gigRadiusMiles = getGigMatchingRadiusMiles(gig.urgency, gig.size);
      const roundedDistance = Math.round(distanceMiles * 10) / 10;

      return {
        gig,
        distanceMiles: roundedDistance,
        gigRadiusMiles,
        estimatedResponseMinutes: estimateResponseMinutes(distanceMiles)
      };

    })

    .filter((item) =>
      isWithinMatchingRadius(
        workerLat,
        workerLng,
        Number(item.gig.latitude),
        Number(item.gig.longitude),
        item.gigRadiusMiles,
        travelRadiusMiles
      )
    )

    .sort((left, right) => {

      if (left.distanceMiles !== right.distanceMiles) {
        return left.distanceMiles - right.distanceMiles;
      }

      if (right.gig.workerPayoutCents !== left.gig.workerPayoutCents) {
        return right.gig.workerPayoutCents - left.gig.workerPayoutCents;
      }

      return right.gig.createdAt.getTime() - left.gig.createdAt.getTime();

    })

    .map((item) => ({
      ...sanitizeGigForViewer(item.gig, workerId, { distanceMiles: item.distanceMiles }),
      distanceMiles: item.distanceMiles,
      estimatedResponseMinutes: item.estimatedResponseMinutes
    }));

}



export async function acceptGig(gigId: string, workerId: string, io?: Server) {
  return expressWorkerInterest(gigId, workerId, undefined, io);
}



const workerTransitions: Partial<Record<GigStatus, GigStatus>> = {

  WORKER_ASSIGNED: GigStatus.WORKER_EN_ROUTE,

  WORKER_EN_ROUTE: GigStatus.WORKER_ARRIVED,

  WORKER_ARRIVED: GigStatus.IN_PROGRESS,

  IN_PROGRESS: GigStatus.WAITING_CUSTOMER_CONFIRMATION

};



const CANCELLABLE_STATUSES: GigStatus[] = [

  GigStatus.POSTED,

  GigStatus.SEARCHING_FOR_WORKER,

  GigStatus.WORKER_SELECTED,

  GigStatus.WORKER_ASSIGNED

];



function notificationForStatus(status: GigStatus, gigTitle: string): NotificationPayload | null {

  switch (status) {

    case GigStatus.WORKER_EN_ROUTE:

      return { type: "WORKER_EN_ROUTE", title: "Worker on the way", body: `Your worker is heading to "${gigTitle}".`, gigId: undefined };

    case GigStatus.WORKER_ARRIVED:

      return { type: "WORKER_ARRIVED", title: "Worker arrived", body: `Your worker has arrived for "${gigTitle}".`, gigId: undefined };

    case GigStatus.IN_PROGRESS:

      return { type: "GIG_STARTED", title: "Gig started", body: `Work has started on "${gigTitle}".`, gigId: undefined };

    case GigStatus.WAITING_CUSTOMER_CONFIRMATION:

      return { type: "GIG_REVIEW", title: "Review completion", body: `Please review and approve completion for "${gigTitle}".`, gigId: undefined };

    case GigStatus.WAITING_EXTRA_TIME_APPROVAL:

      return { type: "ESTIMATED_TIME_REACHED", title: "Booked time reached", body: `Approve extra time or finish "${gigTitle}".`, gigId: undefined };

    case GigStatus.COMPLETED:

      return { type: "GIG_COMPLETED", title: "Gig completed", body: `"${gigTitle}" was completed successfully.`, gigId: undefined };

    default:

      return null;

  }

}



interface NotificationPayload {

  type: string;

  title: string;

  body: string;

  gigId?: string;

}



export async function updateGigStatus(
  gigId: string,
  userId: string,
  nextStatus: GigStatus,
  io?: Server,
  location?: { latitude: number; longitude: number }
) {

  const gig = await prisma.gig.findUniqueOrThrow({

    where: { id: gigId },

    include: { assignments: true }

  });



  const assignment = gig.assignments.find((item) => item.workerId === userId);

  const isClient = gig.clientId === userId;

  const isAssignedWorker = Boolean(assignment);



  if (!isClient && !isAssignedWorker) {

    throw new Error("FORBIDDEN");

  }



  if (isAssignedWorker) {

    const expected = workerTransitions[gig.status];

    if (expected !== nextStatus) {

      throw new Error("INVALID_STATUS_TRANSITION");

    }

    if (nextStatus === GigStatus.WORKER_EN_ROUTE) {
      await assertGigPaymentAuthorized(gigId);
    }

    if (nextStatus === GigStatus.WORKER_ARRIVED || nextStatus === GigStatus.IN_PROGRESS) {
      if (!location) {
        throw new AppError("GPS_REQUIRED", 400, "GPS_REQUIRED", { location: "Location is required for this action." });
      }
      await assertWorkerNearGig(gigId, location.latitude, location.longitude, nextStatus === GigStatus.WORKER_ARRIVED ? "arrive" : "start");
    }

  } else if (nextStatus === GigStatus.CANCELLED) {

    if (!CANCELLABLE_STATUSES.includes(gig.status)) {

      throw new AppError("CANCEL_NOT_ALLOWED", 409, "CANCEL_NOT_ALLOWED", {

        status: "This gig can no longer be cancelled."

      });

    }

  } else {

    throw new Error("INVALID_STATUS_TRANSITION");

  }



  if (isClient && nextStatus === GigStatus.CANCELLED && gig.assignments[0]) {

    await prisma.gigAssignment.update({

      where: { id: gig.assignments[0]!.id },

      data: { cancelledAt: new Date() }

    });



    if (io) {

      for (const item of gig.assignments) {

        notifyUser(io, item.workerId, {

          type: "GIG_CANCELLED",

          title: "Gig cancelled",

          body: `The client cancelled "${gig.title}".`,

          gigId: gig.id

        });

      }

    }

  }



  if (assignment && nextStatus === GigStatus.WORKER_EN_ROUTE) {
    await prisma.gigAssignment.update({
      where: { id: assignment.id },
      data: { enRouteAt: new Date() }
    });
  }

  if (assignment && nextStatus === GigStatus.WORKER_ARRIVED) {
    await prisma.gigAssignment.update({
      where: { id: assignment.id },
      data: { arrivedAt: new Date() }
    });
  }

  if (assignment && nextStatus === GigStatus.IN_PROGRESS) {

    await prisma.gigAssignment.update({

      where: { id: assignment.id },

      data: {
        startedAt: new Date(),
        startLatitude: location?.latitude,
        startLongitude: location?.longitude
      }

    });

  }



  if (assignment && nextStatus === GigStatus.WAITING_CUSTOMER_CONFIRMATION) {

    await prisma.gigAssignment.update({

      where: { id: assignment.id },

      data: {
        endedAt: new Date(),
        completedAt: new Date(),
        endLatitude: location?.latitude,
        endLongitude: location?.longitude
      }

    });

    await prisma.gig.update({
      where: { id: gigId },
      data: { autoApproveAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }
    });

  }



  if (assignment && nextStatus === GigStatus.COMPLETED) {

    await prisma.gigAssignment.update({

      where: { id: assignment.id },

      data: { completedAt: new Date() }

    });



    await prisma.workerProfile.updateMany({

      where: { userId },

      data: { completedGigCount: { increment: 1 } }

    });

  }



  if (isClient && nextStatus === GigStatus.CANCELLED) {
    await releaseAuthorizedPayment(gigId);
  }



  const updatedGig = await prisma.gig.update({

    where: { id: gigId },

    data: { status: nextStatus },

    include: {

      client: true,

      serviceCategory: true,

      assignments: {

        include: {

          worker: {

            select: {

              id: true,

              fullName: true,

              email: true,

              phoneNumber: true,

              workerProfile: {

                select: {

                  ratingAverage: true,

                  completedGigCount: true,

                  currentLatitude: true,

                  currentLongitude: true

                }

              }

            }

          }

        }

      },

      payment: true

    }

  });



  if (nextStatus === GigStatus.COMPLETED) {
    await processWorkerPayout(gigId);
  }



  if (nextStatus === GigStatus.IN_PROGRESS && io) {
    void checkTimerThreshold(gigId, io);
  }

  if (io) {

    const notice = notificationForStatus(nextStatus, updatedGig.title);

    if (notice) {

      notifyUser(io, updatedGig.clientId, { ...notice, gigId: updatedGig.id });

    }

    io.to(`gig:${updatedGig.id}`).to(`user:${updatedGig.clientId}`).emit("gig:status", { gig: updatedGig });

  }



  return updatedGig;

}



export async function listClientGigs(clientId: string) {

  return prisma.gig.findMany({

    where: { clientId },

    include: {
      serviceCategory: true,
      payment: { select: { status: true, amountCents: true } },
      assignments: { where: { cancelledAt: null }, include: { worker: true } }
    },

    orderBy: { createdAt: "desc" },

    take: 50

  });

}



export async function listWorkerGigs(workerId: string) {

  return prisma.gig.findMany({

    where: {
      OR: [
        { assignments: { some: { workerId, cancelledAt: null } } },
        {
          assignedWorkerId: workerId,
          status: { in: [GigStatus.WORKER_SELECTED, GigStatus.WORKER_ASSIGNED, GigStatus.WORKER_EN_ROUTE, GigStatus.WORKER_ARRIVED, GigStatus.IN_PROGRESS, GigStatus.WAITING_EXTRA_TIME_APPROVAL, GigStatus.WAITING_CUSTOMER_CONFIRMATION, GigStatus.COMPLETED, GigStatus.DISPUTED] }
        }
      ]
    },

    include: {
      serviceCategory: true,
      client: true,
      assignments: { where: { workerId, cancelledAt: null }, include: { worker: true } }
    },

    orderBy: { createdAt: "desc" },

    take: 50

  });

}



const gigDetailInclude = {

  serviceCategory: true,

  client: { select: { id: true, fullName: true, email: true, phoneNumber: true } },

  assignments: {

    where: { cancelledAt: null },

    orderBy: { acceptedAt: "desc" },

    include: {

      worker: {

        select: {

          id: true,

          fullName: true,

          email: true,

          phoneNumber: true,

          workerProfile: {

            select: {

              ratingAverage: true,

              completedGigCount: true,

              currentLatitude: true,

              currentLongitude: true

            }

          }

        }

      }

    }

  },

  payment: { select: { status: true, amountCents: true } },

  chatThread: { select: { id: true } }

} as const;



export async function getGigDetail(gigId: string, userId: string) {

  const gig = await prisma.gig.findUniqueOrThrow({

    where: { id: gigId },

    include: gigDetailInclude

  });



  const isClient = gig.clientId === userId;

  const isAssignedWorker = gig.assignments.some((assignment) => assignment.workerId === userId);

  const isSearchingGig = SEARCHING_STATUSES.includes(gig.status);

  const viewer = await prisma.user.findUnique({

    where: { id: userId },

    include: { workerProfile: true }

  });

  const isApprovedWorker =
    Boolean(viewer?.roles.includes(UserRole.WORKER)) &&
    viewer?.accountStatus === AccountStatus.APPROVED &&
    Boolean(viewer.workerProfile);



  if (!isClient && !isAssignedWorker) {

    if (!(isApprovedWorker && isSearchingGig)) {

      throw new Error("FORBIDDEN");

    }

    const workerLat = Number(viewer!.workerProfile!.currentLatitude);
    const workerLng = Number(viewer!.workerProfile!.currentLongitude);
    const travelRadiusMiles = Number(viewer!.workerProfile!.travelDistanceMiles);

    if (!Number.isFinite(workerLat) || !Number.isFinite(workerLng)) {
      throw new AppError("WORKER_LOCATION_REQUIRED", 400, "WORKER_LOCATION_REQUIRED", {
        location: "Set your current location before viewing nearby gigs."
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
      throw new AppError("GIG_TOO_FAR", 403, "GIG_TOO_FAR", {
        location: "This gig is outside your travel radius."
      });
    }

    const distanceMiles = Math.round(
      haversineMiles(workerLat, workerLng, Number(gig.latitude), Number(gig.longitude)) * 10
    ) / 10;

    return sanitizeGigForViewer(gig, userId, { distanceMiles });

  }



  return sanitizeGigForViewer(gig, userId);

}



export async function listChatMessages(gigId: string, userId: string) {
  await getGigDetail(gigId, userId);

  const thread = await prisma.chatThread.upsert({
    where: { gigId },
    create: { gigId },
    update: {},
    include: {
      messages: {
        include: { sender: { select: { id: true, fullName: true } } },
        orderBy: { createdAt: "asc" },
        take: 200
      }
    }
  });

  return thread.messages;
}

export async function sendChatMessage(gigId: string, userId: string, body: string, io: Server) {
  const { persistAndBroadcastChatMessage } = await import("../realtime/realtime.service.js");
  return persistAndBroadcastChatMessage(io, { gigId, senderId: userId, body });
}


