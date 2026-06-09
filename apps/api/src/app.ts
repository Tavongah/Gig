import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import type { Server } from "socket.io";
import { env, resolveCorsOrigin } from "./config/env.js";
import { redis } from "./config/redis.js";
import { mapErrorToResponse } from "./lib/errors.js";
import { getHealthStatus } from "./lib/health.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { onboardingRouter } from "./modules/onboarding/onboarding.routes.js";
import { createGigRouter } from "./modules/gigs/gig.routes.js";
import { workerRouter } from "./modules/workers/worker.routes.js";
import { adminRouter } from "./modules/admin/admin.routes.js";
import { reviewRouter } from "./modules/reviews/review.routes.js";

export function createApp(io: Server) {
  const app = express();

  if (env.TRUST_PROXY) {
    app.set("trust proxy", 1);
  }

  app.use(helmet());

  const corsOrigin = resolveCorsOrigin();
  app.use(
    cors({
      origin: corsOrigin,
      credentials: true
    })
  );

  app.use(express.json({ limit: "1mb" }));

  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: env.NODE_ENV === "production" ? 120 : 300,
      standardHeaders: true,
      legacyHeaders: false,
      store: new RedisStore({
        sendCommand: (command: string, ...args: string[]) => redis.call(command, ...args) as Promise<number>
      })
    })
  );

  app.get("/health", (_req, res) => {
    res.json({ ok: true, uptime: process.uptime(), timestamp: new Date().toISOString() });
  });

  app.get("/ready", async (_req, res) => {
    const health = await getHealthStatus();
    if (!health.ok) {
      res.status(503).json({ ready: false, checks: health.checks });
      return;
    }
    res.json({ ready: true, checks: health.checks });
  });

  app.use("/v1/auth", authRouter);
  app.use("/v1/onboarding", onboardingRouter);
  app.use("/v1/gigs", createGigRouter(io));
  app.use("/v1/workers", workerRouter);
  app.use("/v1", reviewRouter);
  app.use("/v1/admin", adminRouter);

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    const { status, body } = mapErrorToResponse(error);
    if (status >= 500) {
      console.error(error);
    }
    res.status(status).json(body);
  };

  app.use(errorHandler);

  return app;
}
