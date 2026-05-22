import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import type { Server } from "socket.io";
import { authRouter } from "./modules/auth/auth.routes.js";
import { onboardingRouter } from "./modules/onboarding/onboarding.routes.js";
import { createGigRouter } from "./modules/gigs/gig.routes.js";
import { adminRouter } from "./modules/admin/admin.routes.js";

export function createApp(io: Server) {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: true,
      legacyHeaders: false
    })
  );

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/v1/auth", authRouter);
  app.use("/v1/onboarding", onboardingRouter);
  app.use("/v1/gigs", createGigRouter(io));
  app.use("/v1/admin", adminRouter);

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const status = message === "GIG_NOT_AVAILABLE" ? 409 : 500;
    res.status(status).json({ error: message });
  };

  app.use(errorHandler);

  return app;
}
