import http from "node:http";
import { Server } from "socket.io";
import { env, resolveCorsOrigin } from "./config/env.js";
import { prisma } from "./config/prisma.js";
import { connectRedis, redis } from "./config/redis.js";
import { createApp } from "./app.js";
import { logProductionReadinessWarnings } from "./lib/production-guards.js";
import { assertStripeConfiguredForProduction } from "./lib/stripe.js";
import { setSocketServer } from "./lib/socket.js";
import { configureRealtime } from "./modules/realtime/realtime.service.js";

const corsOrigin = resolveCorsOrigin();

const httpServer = http.createServer();
const io = new Server(httpServer, {
  cors: {
    origin: corsOrigin,
    credentials: true
  }
});

configureRealtime(io);
setSocketServer(io);
const app = createApp(io);
httpServer.removeAllListeners("request");
httpServer.on("request", app);

async function shutdown(): Promise<void> {
  console.log("Shutting down...");
  await new Promise<void>((resolve) => {
    httpServer.close(() => resolve());
  });
  io.close();
  await redis.quit();
  await prisma.$disconnect();
  process.exit(0);
}

async function connectRedisWithRetry(maxAttempts = 30, delayMs = 5000): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await connectRedis();
      console.log("Redis connected");
      return;
    } catch (error) {
      console.error(`Redis connection failed (attempt ${attempt}/${maxAttempts}):`, error);
      if (attempt === maxAttempts) {
        console.error("Continuing without Redis — rate limiting and realtime may be degraded.");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function bootstrap(): Promise<void> {
  assertStripeConfiguredForProduction();
  logProductionReadinessWarnings();

  httpServer.listen(env.PORT, "0.0.0.0", () => {
    console.log(`DUTS API listening on 0.0.0.0:${env.PORT} (${env.NODE_ENV})`);
  });

  void connectRedisWithRetry();

  setInterval(() => {
    void import("./modules/gigs/gig-workflow.service.js").then(({ autoApproveStaleGigs }) => autoApproveStaleGigs());
  }, 60 * 60 * 1000);

  // Poll active timers so ESTIMATE_TIMER / auth-limit pauses do not depend only on Start Gig.
  setInterval(() => {
    void import("./modules/gigs/gig-workflow.service.js").then(async ({ checkTimerThreshold }) => {
      const { prisma } = await import("./config/prisma.js");
      const { GigStatus } = await import("@prisma/client");
      const active = await prisma.gig.findMany({
        where: { status: GigStatus.IN_PROGRESS },
        select: { id: true },
        take: 100
      });
      for (const gig of active) {
        await checkTimerThreshold(gig.id).catch(() => undefined);
      }
    });
  }, 60 * 1000);
}

bootstrap().catch((error) => {
  console.error("Failed to start API:", error);
  process.exit(1);
});

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
