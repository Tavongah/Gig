import { prisma } from "../config/prisma.js";
import { redis } from "../config/redis.js";

export interface HealthStatus {
  ok: boolean;
  uptime: number;
  timestamp: string;
  checks: {
    database: "up" | "down";
    redis: "up" | "down";
  };
}

export async function getHealthStatus(): Promise<HealthStatus> {
  let database: "up" | "down" = "down";
  let redisStatus: "up" | "down" = "down";

  try {
    await prisma.$queryRaw`SELECT 1`;
    database = "up";
  } catch {
    // database unavailable
  }

  try {
    const pong = await redis.ping();
    if (pong === "PONG") {
      redisStatus = "up";
    }
  } catch {
    // redis unavailable
  }

  const ok = database === "up" && redisStatus === "up";

  return {
    ok,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    checks: {
      database,
      redis: redisStatus
    }
  };
}
