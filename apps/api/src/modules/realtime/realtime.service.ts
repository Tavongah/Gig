import type { Server, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import jwt from "jsonwebtoken";
import type { UserRole } from "@prisma/client";
import { redis } from "../../config/redis.js";
import { env } from "../../config/env.js";

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

    socket.on("worker:available", (payload: { serviceCategoryIds: string[] }) => {
      for (const categoryId of payload.serviceCategoryIds) {
        socket.join(`category:${categoryId}`);
      }
    });

    socket.on("gig:join", (payload: { gigId: string }) => {
      socket.join(`gig:${payload.gigId}`);
    });

    socket.on("location:update", (payload: { gigId: string; latitude: number; longitude: number }) => {
      socket.to(`gig:${payload.gigId}`).emit("location:updated", {
        workerId: socket.data.userId,
        latitude: payload.latitude,
        longitude: payload.longitude
      });
    });

    socket.on("chat:message", (payload: { gigId: string; body: string }) => {
      socket.to(`gig:${payload.gigId}`).emit("chat:message", {
        senderId: socket.data.userId,
        body: payload.body,
        createdAt: new Date().toISOString()
      });
    });
  });
}

export function broadcastGigOffer(io: Server, payload: GigOfferPayload): void {
  io.to(`category:${payload.serviceCategoryId}`).emit("gig:offer", payload);
}
