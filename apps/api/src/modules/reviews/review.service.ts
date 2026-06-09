import { createReviewSchema } from "@gigflow/shared";
import type { CreateReviewInput } from "@gigflow/shared";
import { GigStatus } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";

export async function createGigReview(gigId: string, reviewerId: string, input: CreateReviewInput) {
  const parsed = createReviewSchema.parse(input);

  const gig = await prisma.gig.findUniqueOrThrow({
    where: { id: gigId },
    include: { assignments: true }
  });

  if (gig.clientId !== reviewerId) {
    throw new AppError("FORBIDDEN", 403);
  }

  if (gig.status !== GigStatus.COMPLETED) {
    throw new AppError("GIG_NOT_REVIEWABLE", 400);
  }

  const assignment = gig.assignments[0];
  if (!assignment) {
    throw new AppError("WORKER_NOT_ASSIGNED", 400);
  }

  const review = await prisma.review.create({
    data: {
      gigId,
      reviewerId,
      revieweeId: assignment.workerId,
      rating: parsed.rating,
      comment: parsed.comment
    },
    include: {
      reviewer: { select: { id: true, fullName: true } },
      reviewee: { select: { id: true, fullName: true } }
    }
  });

  const aggregates = await prisma.review.aggregate({
    where: { revieweeId: assignment.workerId },
    _avg: { rating: true },
    _count: { rating: true }
  });

  await prisma.workerProfile.updateMany({
    where: { userId: assignment.workerId },
    data: { ratingAverage: aggregates._avg.rating ?? 0 }
  });

  return review;
}

export async function listGigReviews(gigId: string, userId: string) {
  const gig = await prisma.gig.findUniqueOrThrow({
    where: { id: gigId },
    include: { assignments: true }
  });

  const isClient = gig.clientId === userId;
  const isWorker = gig.assignments.some((assignment) => assignment.workerId === userId);

  if (!isClient && !isWorker) {
    throw new AppError("FORBIDDEN", 403);
  }

  return prisma.review.findMany({
    where: { gigId },
    include: {
      reviewer: { select: { id: true, fullName: true } },
      reviewee: { select: { id: true, fullName: true } }
    },
    orderBy: { createdAt: "desc" }
  });
}
