import http from "node:http";
import { Server } from "socket.io";
import { env, resolveCorsOrigin } from "./config/env.js";
import { prisma } from "./config/prisma.js";
import { connectRedis, redis } from "./config/redis.js";
import { createApp } from "./app.js";
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

async function bootstrap(): Promise<void> {
  try {
    await connectRedis();
    console.log("Redis connected");
  } catch (error) {
    console.error("Redis connection failed:", error);
    throw error;
  }

  httpServer.listen(env.PORT, "0.0.0.0", () => {
    console.log(`GIGFLOW API listening on 0.0.0.0:${env.PORT} (${env.NODE_ENV})`);
  });
}

bootstrap().catch((error) => {
  console.error("Failed to start API:", error);
  process.exit(1);
});

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
