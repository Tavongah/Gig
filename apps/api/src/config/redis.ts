import { Redis } from "ioredis";
import { env } from "./env.js";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  family: 0,
  connectTimeout: 10_000,
  retryStrategy: (times) => Math.min(times * 500, 5_000)
});

export async function connectRedis(): Promise<void> {
  if (redis.status === "wait") {
    await redis.connect();
  }
}
