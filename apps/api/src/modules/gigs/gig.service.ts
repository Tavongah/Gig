import type { Server } from "socket.io";
import { createGigSchema, gigEstimateSchema, calculatePriceEstimate } from "@gigflow/shared";
import type { CreateGigInput, GigEstimateInput } from "@gigflow/shared";
import { GigStatus, Prisma, UserRole } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { broadcastGigOffer } from "../realtime/realtime.service.js";

async function getActiveCommissionRate(): Promise<number> {
  const setting = await prisma.commissionSetting.findFirst({
    orderBy: { effectiveFrom: "desc" }
  });

  return setting ? Number(setting.rate) : 0.2;
}

export async function listCategories() {
  return prisma.serviceCategory.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" }
  });
}

export async function estimateGig(input: GigEstimateInput) {
  const parsed = gigEstimateSchema.parse(input);
  const category = await prisma.serviceCategory.findUniqueOrThrow({
    where: { id: parsed.serviceCategoryId }
  });
  const commissionRate = await getActiveCommissionRate();

  return calculatePriceEstimate(
    parsed,
    {
      baseRateCents: category.baseRateCents,
      hourlyRateCents: category.hourlyRateCents,
      distanceRateCents: category.distanceRateCents,
      multiplier: Number(category.multiplier)
    },
    commissionRate
  );
}

export async function createGig(clientId: string, input: CreateGigInput, io: Server) {
  const parsed = createGigSchema.parse(input);
  const price = await estimateGig(parsed);

  const gig = await prisma.gig.create({
    data: {
      clientId,
      serviceCategoryId: parsed.serviceCategoryId,
      title: parsed.title,
      description: parsed.description,
      status: GigStatus.OPEN,
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
      latitude: parsed.location.latitude,
      longitude: parsed.location.longitude,
      photoUrls: parsed.photos,
      priceBreakdown: price as unknown as Prisma.InputJsonValue,
      totalCents: price.totalCents,
      platformFeeCents: price.platformFeeCents,
      workerPayoutCents: price.workerPayoutCents,
      payment: {
        create: {
          amountCents: price.totalCents,
          platformFeeCents: price.platformFeeCents,
          workerPayoutCents: price.workerPayoutCents
        }
      },
      chatThread: { create: {} }
    },
    include: { serviceCategory: true }
  });

  broadcastGigOffer(io, {
    gigId: gig.id,
    title: gig.title,
    serviceCategoryId: gig.serviceCategoryId,
    latitude: Number(gig.latitude),
    longitude: Number(gig.longitude),
    totalCents: gig.totalCents,
    workerPayoutCents: gig.workerPayoutCents,
    startsAt: gig.startsAt.toISOString()
  });

  return gig;
}

export async function findNearbyGigs(workerId: string) {
  const worker = await prisma.user.findUniqueOrThrow({
    where: { id: workerId },
    include: { workerProfile: { include: { serviceCategories: true } } }
  });

  if (!worker.roles.includes(UserRole.WORKER) || !worker.workerProfile) {
    return [];
  }

  const serviceCategoryIds = worker.workerProfile.serviceCategories.map((category) => category.id);

  return prisma.gig.findMany({
    where: {
      status: GigStatus.OPEN,
      serviceCategoryId: { in: serviceCategoryIds },
      startsAt: { gte: new Date(Date.now() - 30 * 60 * 1000) }
    },
    include: { serviceCategory: true, client: true },
    orderBy: [{ urgency: "desc" }, { startsAt: "asc" }],
    take: 50
  });
}

export async function acceptGig(gigId: string, workerId: string) {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.gig.updateMany({
      where: { id: gigId, status: GigStatus.OPEN },
      data: { status: GigStatus.MATCHED }
    });

    if (updated.count !== 1) {
      throw new Error("GIG_NOT_AVAILABLE");
    }

    await tx.gigAssignment.create({
      data: {
        gigId,
        workerId
      }
    });

    return tx.gig.findUniqueOrThrow({
      where: { id: gigId },
      include: {
        client: true,
        serviceCategory: true,
        assignments: { include: { worker: true } }
      }
    });
  });
}

const workerTransitions: Partial<Record<GigStatus, GigStatus>> = {
  MATCHED: GigStatus.EN_ROUTE,
  EN_ROUTE: GigStatus.IN_PROGRESS,
  IN_PROGRESS: GigStatus.COMPLETED
};

export async function updateGigStatus(gigId: string, userId: string, nextStatus: GigStatus) {
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
  } else if (nextStatus !== GigStatus.CANCELLED || gig.status === GigStatus.COMPLETED) {
    throw new Error("INVALID_STATUS_TRANSITION");
  }

  if (assignment && nextStatus === GigStatus.IN_PROGRESS) {
    await prisma.gigAssignment.update({
      where: { id: assignment.id },
      data: { startedAt: new Date() }
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

  return prisma.gig.update({
    where: { id: gigId },
    data: { status: nextStatus },
    include: {
      client: true,
      serviceCategory: true,
      assignments: { include: { worker: true } },
      payment: true
    }
  });
}

export async function listClientGigs(clientId: string) {
  return prisma.gig.findMany({
    where: { clientId },
    include: { serviceCategory: true, assignments: { include: { worker: true } } },
    orderBy: { createdAt: "desc" },
    take: 50
  });
}

export async function listWorkerGigs(workerId: string) {
  return prisma.gig.findMany({
    where: { assignments: { some: { workerId } } },
    include: { serviceCategory: true, client: true, assignments: { include: { worker: true } } },
    orderBy: { createdAt: "desc" },
    take: 50
  });
}

const gigDetailInclude = {
  serviceCategory: true,
  client: { select: { id: true, fullName: true, email: true, phoneNumber: true } },
  assignments: { include: { worker: { select: { id: true, fullName: true, email: true, phoneNumber: true } } } },
  payment: { select: { status: true, amountCents: true } },
  chatThread: { select: { id: true } }
} as const;

export async function getGigDetail(gigId: string, userId: string) {
  const gig = await prisma.gig.findUniqueOrThrow({
    where: { id: gigId },
    include: gigDetailInclude
  });

  const isClient = gig.clientId === userId;
  const isWorker = gig.assignments.some((assignment) => assignment.workerId === userId);

  if (!isClient && !isWorker) {
    throw new Error("FORBIDDEN");
  }

  return gig;
}

export async function listChatMessages(gigId: string, userId: string) {
  await getGigDetail(gigId, userId);

  const thread = await prisma.chatThread.findUniqueOrThrow({
    where: { gigId },
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
