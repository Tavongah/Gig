import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  JWT_SECRET: z.string().min(24),
  API_PUBLIC_URL: z.string().url().optional(),
  CORS_ORIGINS: z.string().default("*"),
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((value) => value === "true" || value === "1"),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_CONNECT_CLIENT_ID: z.string().optional(),
  MOBILE_PUBLIC_URL: z.string().url().default("http://localhost:8081"),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  AWS_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional()
});

export const env = envSchema.parse(process.env);

export function getCorsOrigins(): string[] | true {
  if (env.CORS_ORIGINS === "*") {
    return true;
  }

  return env.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean);
}

export function resolveCorsOrigin(): string[] | boolean {
  const origins = getCorsOrigins();
  return origins === true ? true : origins;
}
