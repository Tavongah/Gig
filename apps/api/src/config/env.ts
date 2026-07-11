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
  S3_ENDPOINT: z.string().url().optional(),
  AWS_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  SPACES_ENDPOINT: z.string().url().optional(),
  SPACES_REGION: z.string().optional(),
  SPACES_BUCKET: z.string().optional(),
  SPACES_ACCESS_KEY_ID: z.string().optional(),
  SPACES_SECRET_ACCESS_KEY: z.string().optional(),
  SPACES_CDN_URL: z.string().url().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  SENTRY_DSN: z.string().url().optional(),
  /** Beta only: log email verification links and phone OTP codes to API stdout (no SendGrid/Twilio yet). */
  LOG_VERIFICATION_TO_CONSOLE: z
    .string()
    .optional()
    .transform((value) => value === "true" || value === "1")
});

export const env = envSchema.parse(process.env);

export function isSpacesConfigured(): boolean {
  const bucket = env.SPACES_BUCKET ?? env.S3_BUCKET;
  const key = env.SPACES_ACCESS_KEY_ID ?? env.AWS_ACCESS_KEY_ID;
  const secret = env.SPACES_SECRET_ACCESS_KEY ?? env.AWS_SECRET_ACCESS_KEY;
  const endpoint = env.SPACES_ENDPOINT ?? env.S3_ENDPOINT;
  return Boolean(bucket && key && secret && endpoint);
}

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
