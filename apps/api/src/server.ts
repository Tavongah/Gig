import http from "node:http";
import { Server } from "socket.io";
import { env } from "./config/env.js";
import { prisma } from "./config/prisma.js";
import { connectRedis } from "./config/redis.js";
import { createApp } from "./app.js";
import { configureRealtime } from "./modules/realtime/realtime.service.js";

const httpServer = http.createServer();
const io = new Server(httpServer, {
  cors: {
    origin: true,
    credentials: true
  }
});

configureRealtime(io);
const app = createApp(io);
httpServer.removeAllListeners("request");
httpServer.on("request", app);

async function bootstrap(): Promise<void> {
  await connectRedis();

  httpServer.listen(env.PORT, () => {
    console.log(`GigFlow API listening on port ${env.PORT}`);
  });
}

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  httpServer.close();
});

void bootstrap();
