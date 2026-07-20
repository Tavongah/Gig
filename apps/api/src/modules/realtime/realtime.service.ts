import type { Server, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import jwt from "jsonwebtoken";
import { z } from "zod";
import {
  getGigMatchingRadiusMiles,
  haversineMiles,
  isWithinMatchingRadius,
  MAX_CHAT_MESSAGE_LENGTH
} from "@gigflow/shared";
import type { GigSize, GigUrgency, UserRole } from "@prisma/client";
import { redis } from "../../config/redis.js";
import { env } from "../../config/env.js";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";

const coordsSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180)
});

const workerAvailableSchema = z.object({
  serviceCategoryIds: z.array(z.string().uuid()).max(50).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional()
}).refine(
  (value) =>
    (value.latitude === undefined && value.longitude === undefined) ||
    (value.latitude !== undefined && value.longitude !== undefined),
  { message: "latitude and longitude must be provided together" }
);

const gigJoinSchema = z.object({
  gigId: z.string().uuid()
});

const locationUpdateSchema = z.object({
  gigId: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180)
});

const chatMessageSchema = z.object({
  gigId: z.string().uuid(),
  body: z.string().trim().min(1).max(MAX_CHAT_MESSAGE_LENGTH)
});

async function assertGigParticipant(userId: string, gigId: string): Promise<boolean> {
  const gig = await prisma.gig.findUnique({
    where: { id: gigId },
    select: {
      clientId: true,
      assignedWorkerId: true,
      assignments: {
        where: { cancelledAt: null },
        orderBy: { acceptedAt: "desc" },
        take: 1,
        select: { workerId: true }
      }
    }
  });

  if (!gig) {
    return false;
  }

  const activeWorkerId = gig.assignments[0]?.workerId ?? gig.assignedWorkerId;
  return userId === gig.clientId || (Boolean(activeWorkerId) && userId === activeWorkerId);
}

interface SocketAuthPayload {
  sub: string;
  roles: UserRole[];
}

export interface GigOfferPayload {
  gigId: string;
  title: string;
  serviceCategoryId: string;
  serviceCategoryName: string;
  latitude: number;
  longitude: number;
  city: string;
  region: string;
  size: GigSize;
  totalCents: number;
  workerPayoutCents: number;
  startsAt: string;
  urgency: GigUrgency | string;
  estimatedHours: number;
  distanceMiles?: number;
  locationSummary?: string;
}

export interface NotificationPayload {
  type: string;
  title: string;
  body: string;
  gigId?: string;
}

async function resolveWorkerCategoryIds(userId: string, provided: string[]): Promise<string[]> {
  if (provided.length > 0) {
    return provided;
  }

  const profile = await prisma.workerProfile.findUnique({
    where: { userId },
    include: { serviceCategories: true }
  });

  return profile?.serviceCategories.map((category) => category.id) ?? [];
}

export function notifyUser(io: Server, userId: string, payload: NotificationPayload): void {
  io.to(`user:${userId}`).emit("notification", payload);
}

export interface ChatMessagePayload {
  id: string;
  gigId: string;
  senderId: string;
  body: string;
  createdAt: string;
  sender?: { id: string; fullName: string };
}

/** Persist a gig chat message and deliver it to both participants (room + user sockets). */
export async function persistAndBroadcastChatMessage(
  io: Server,
  params: { gigId: string; senderId: string; body: string }
): Promise<ChatMessagePayload> {
  const body = params.body.trim();
  if (!body) {
    throw new AppError("MESSAGE_REQUIRED", 400, "MESSAGE_REQUIRED", {
      body: "Message cannot be empty."
    });
  }
  if (body.length > MAX_CHAT_MESSAGE_LENGTH) {
    throw new AppError("MESSAGE_TOO_LONG", 400, "MESSAGE_TOO_LONG", {
      body: `Message cannot exceed ${MAX_CHAT_MESSAGE_LENGTH} characters.`
    });
  }

  const gig = await prisma.gig.findUnique({
    where: { id: params.gigId },
    include: {
      assignments: {
        where: { cancelledAt: null },
        orderBy: { acceptedAt: "desc" },
        take: 1,
        select: { workerId: true }
      }
    }
  });

  if (!gig) {
    throw new AppError("GIG_NOT_FOUND", 404, "GIG_NOT_FOUND");
  }

  const activeWorkerId = gig.assignments[0]?.workerId ?? gig.assignedWorkerId ?? null;
  const isClient = params.senderId === gig.clientId;
  const isWorker = Boolean(activeWorkerId && params.senderId === activeWorkerId);
  if (!isClient && !isWorker) {
    throw new AppError("FORBIDDEN", 403, "FORBIDDEN");
  }

  const thread = await prisma.chatThread.upsert({
    where: { gigId: params.gigId },
    create: { gigId: params.gigId },
    update: {}
  });

  const sender = await prisma.user.findUnique({
    where: { id: params.senderId },
    select: { id: true, fullName: true }
  });

  const message = await prisma.chatMessage.create({
    data: {
      threadId: thread.id,
      senderId: params.senderId,
      body
    }
  });

  const chatPayload: ChatMessagePayload = {
    id: message.id,
    gigId: params.gigId,
    senderId: message.senderId,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
    sender: sender ?? undefined
  };

  // Gig room (anyone currently viewing) + both participants' personal rooms.
  io.to(`gig:${params.gigId}`).emit("chat:message", chatPayload);
  io.to(`user:${gig.clientId}`).emit("chat:message", chatPayload);
  if (activeWorkerId) {
    io.to(`user:${activeWorkerId}`).emit("chat:message", chatPayload);
  }

  const recipientId = isClient ? activeWorkerId : gig.clientId;
  if (recipientId && recipientId !== params.senderId) {
    notifyUser(io, recipientId, {
      type: "NEW_MESSAGE",
      title: "New message",
      body: body.length > 80 ? `${body.slice(0, 77)}...` : body,
      gigId: params.gigId
    });
  }

  return chatPayload;
}

export function broadcastGigStatus(io: Server, gig: { id: string; clientId: string; status: string }, gigPayload: unknown): void {
  io.to(`gig:${gig.id}`).to(`user:${gig.clientId}`).emit("gig:status", { gig: gigPayload });
}

export function configureRealtime(io: Server): void {
  const pubClient = redis.duplicate();
  const subClient = redis.duplicate();
  io.adapter(createAdapter(pubClient, subClient));

  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (typeof token !== "string") {
      next(new Error("AUTH_REQUIRED"));
      return;
    }

    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as SocketAuthPayload;
      socket.data.userId = payload.sub;
      socket.data.roles = payload.roles;
      next();
    } catch {
      next(new Error("INVALID_TOKEN"));
    }
  });

  io.on("connection", (socket: Socket) => {
    socket.join(`user:${socket.data.userId}`);

    socket.on("worker:available", async (payload: unknown) => {
      const parsed = workerAvailableSchema.safeParse(payload ?? {});
      if (!parsed.success) {
        return;
      }

      const categoryIds = await resolveWorkerCategoryIds(socket.data.userId, parsed.data.serviceCategoryIds ?? []);

      for (const categoryId of categoryIds) {
        socket.join(`category:${categoryId}`);
      }

      const coords =
        parsed.data.latitude !== undefined && parsed.data.longitude !== undefined
          ? coordsSchema.safeParse({
              latitude: parsed.data.latitude,
              longitude: parsed.data.longitude
            })
          : null;

      await prisma.workerProfile.updateMany({
        where: { userId: socket.data.userId },
        data: {
          availabilityStatus: "AVAILABLE",
          ...(coords?.success
            ? {
                currentLatitude: coords.data.latitude,
                currentLongitude: coords.data.longitude,
                locationUpdatedAt: new Date()
              }
            : {})
        }
      });

      await redis.set(`worker:available:${socket.data.userId}`, JSON.stringify({ categoryIds, at: Date.now() }), "EX", 3600);
    });

    socket.on("worker:offline", async () => {
      await prisma.workerProfile.updateMany({
        where: { userId: socket.data.userId },
        data: { availabilityStatus: "OFFLINE" }
      });
      await redis.del(`worker:available:${socket.data.userId}`);
    });

    socket.on("gig:join", async (payload: unknown) => {
      const parsed = gigJoinSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      const allowed = await assertGigParticipant(socket.data.userId, parsed.data.gigId);
      if (!allowed) {
        return;
      }
      socket.join(`gig:${parsed.data.gigId}`);
    });

    socket.on("location:update", async (payload: unknown) => {
      const parsed = locationUpdateSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }

      const allowed = await assertGigParticipant(socket.data.userId, parsed.data.gigId);
      if (!allowed) {
        return;
      }

      await prisma.workerProfile.updateMany({
        where: { userId: socket.data.userId },
        data: {
          currentLatitude: parsed.data.latitude,
          currentLongitude: parsed.data.longitude,
          locationUpdatedAt: new Date()
        }
      });

      io.to(`gig:${parsed.data.gigId}`).emit("location:updated", {
        workerId: socket.data.userId,
        latitude: parsed.data.latitude,
        longitude: parsed.data.longitude,
        updatedAt: new Date().toISOString()
      });
    });

    socket.on("chat:message", async (payload: unknown, ack?: (result: unknown) => void) => {
      try {
        const parsed = chatMessageSchema.safeParse(payload);
        if (!parsed.success) {
          ack?.({ ok: false, error: "INVALID_PAYLOAD" });
          return;
        }

        const message = await persistAndBroadcastChatMessage(io, {
          gigId: parsed.data.gigId,
          senderId: socket.data.userId,
          body: parsed.data.body
        });
        ack?.({ ok: true, message });
      } catch (error) {
        const code = error instanceof AppError ? error.code ?? error.message : "SEND_FAILED";
        ack?.({ ok: false, error: code });
        const gigId =
          payload && typeof payload === "object" && "gigId" in payload
            ? String((payload as { gigId?: string }).gigId ?? "")
            : "";
        if (gigId) {
          socket.emit("chat:error", { error: code, gigId });
        }
      }
    });
  });
}

export async function broadcastGigOffer(io: Server, payload: GigOfferPayload): Promise<void> {
  const gigRadiusMiles = getGigMatchingRadiusMiles(payload.urgency as GigUrgency, payload.size);
  const locationSummary = `${payload.city}, ${payload.region}`;

  const workers = await prisma.workerProfile.findMany({
    where: {
      availabilityStatus: "AVAILABLE",
      currentLatitude: { not: null },
      currentLongitude: { not: null },
      user: { accountStatus: "APPROVED" },
      serviceCategories: { some: { id: payload.serviceCategoryId } }
    },
    select: {
      userId: true,
      currentLatitude: true,
      currentLongitude: true,
      travelDistanceMiles: true
    }
  });

  for (const worker of workers) {
    const distanceMiles = haversineMiles(
      Number(worker.currentLatitude),
      Number(worker.currentLongitude),
      payload.latitude,
      payload.longitude
    );
    const travelRadiusMiles = Number(worker.travelDistanceMiles);

    if (!isWithinMatchingRadius(
      Number(worker.currentLatitude),
      Number(worker.currentLongitude),
      payload.latitude,
      payload.longitude,
      gigRadiusMiles,
      travelRadiusMiles
    )) {
      continue;
    }

    const roundedDistance = Math.round(distanceMiles * 10) / 10;
    const notificationBody = `$${(payload.workerPayoutCents / 100).toFixed(0)} • ${roundedDistance} miles away • ${locationSummary}`;
    const offer = {
      gigId: payload.gigId,
      title: payload.title,
      serviceCategoryId: payload.serviceCategoryId,
      serviceCategoryName: payload.serviceCategoryName,
      totalCents: payload.totalCents,
      workerPayoutCents: payload.workerPayoutCents,
      startsAt: payload.startsAt,
      urgency: payload.urgency,
      estimatedHours: payload.estimatedHours,
      distanceMiles: roundedDistance,
      locationSummary
    };

    io.to(`user:${worker.userId}`).emit("gig:offer", offer);
    notifyUser(io, worker.userId, {
      type: "NEW_GIG_AVAILABLE",
      title: `New ${payload.serviceCategoryName} Gig Available`,
      body: notificationBody,
      gigId: payload.gigId
    });
  }
}
