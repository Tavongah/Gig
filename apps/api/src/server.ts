import http from "node:http";
import { Server } from "socket.io";
import { env, resolveCorsOrigin } from "./config/env.js";
import { prisma } from "./config/prisma.js";
import { connectRedis, redis } from "./config/redis.js";
import { createApp } from "./app.js";
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
  await connectRedis();

  httpServer.listen(env.PORT, () => {
    console.log(`GigFlow API listening on port ${env.PORT} (${env.NODE_ENV})`);
  });
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

void bootstrap();
