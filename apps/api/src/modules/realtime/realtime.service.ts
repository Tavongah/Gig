import type { Server, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import jwt from "jsonwebtoken";
import type { UserRole } from "@prisma/client";
import { redis } from "../../config/redis.js";
import { env } from "../../config/env.js";
import { prisma } from "../../config/prisma.js";

interface SocketAuthPayload {
  sub: string;
  roles: UserRole[];
}

export interface GigOfferPayload {
  gigId: string;
  title: string;
  serviceCategoryId: string;
  latitude: number;
  longitude: number;
  totalCents: number;
  workerPayoutCents: number;
  startsAt: string;
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

    socket.on("worker:available", async (payload: { serviceCategoryIds?: string[]; latitude?: number; longitude?: number }) => {
      const categoryIds = await resolveWorkerCategoryIds(socket.data.userId, payload.serviceCategoryIds ?? []);

      for (const categoryId of categoryIds) {
        socket.join(`category:${categoryId}`);
      }

      await prisma.workerProfile.updateMany({
        where: { userId: socket.data.userId },
        data: {
          availabilityStatus: "AVAILABLE",
          ...(payload.latitude !== undefined && payload.longitude !== undefined
            ? {
                currentLatitude: payload.latitude,
                currentLongitude: payload.longitude
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

    socket.on("gig:join", (payload: { gigId: string }) => {
      socket.join(`gig:${payload.gigId}`);
    });

    socket.on("location:update", async (payload: { gigId: string; latitude: number; longitude: number }) => {
      await prisma.workerProfile.updateMany({
        where: { userId: socket.data.userId },
        data: {
          currentLatitude: payload.latitude,
          currentLongitude: payload.longitude
        }
      });

      socket.to(`gig:${payload.gigId}`).emit("location:updated", {
        workerId: socket.data.userId,
        latitude: payload.latitude,
        longitude: payload.longitude
      });
    });

    socket.on("chat:message", async (payload: { gigId: string; body: string }) => {
      const thread = await prisma.chatThread.findUnique({ where: { gigId: payload.gigId } });
      if (!thread) {
        return;
      }

      const message = await prisma.chatMessage.create({
        data: {
          threadId: thread.id,
          senderId: socket.data.userId,
          body: payload.body
        }
      });

      io.to(`gig:${payload.gigId}`).emit("chat:message", {
        id: message.id,
        senderId: message.senderId,
        body: message.body,
        createdAt: message.createdAt.toISOString()
      });

      socket.emit("chat:message", {
        id: message.id,
        senderId: message.senderId,
        body: message.body,
        createdAt: message.createdAt.toISOString()
      });
    });
  });
}

export function broadcastGigOffer(io: Server, payload: GigOfferPayload): void {
  io.to(`category:${payload.serviceCategoryId}`).emit("gig:offer", payload);
}
