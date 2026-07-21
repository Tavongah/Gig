import "dotenv/config";
import { z } from "zod";

function emptyToUndefined(value: unknown): unknown {
  if (value === "" || value === undefined) {
    return undefined;
  }
  return value;
}

const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  JWT_SECRET: z.string().min(24),
  API_PUBLIC_URL: optionalUrl,
  CORS_ORIGINS: z.string().default("*"),
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((value) => value === "true" || value === "1"),
  FIREBASE_PROJECT_ID: optionalString,
  FIREBASE_CLIENT_EMAIL: optionalString,
  FIREBASE_PRIVATE_KEY: optionalString,
  STRIPE_SECRET_KEY: optionalString,
  STRIPE_PUBLISHABLE_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  STRIPE_CONNECT_CLIENT_ID: optionalString,
  MOBILE_PUBLIC_URL: z.string().url().default("http://localhost:8081"),
  GOOGLE_MAPS_API_KEY: optionalString,
  S3_BUCKET: optionalString,
  S3_ENDPOINT: optionalUrl,
  AWS_REGION: optionalString,
  AWS_ACCESS_KEY_ID: optionalString,
  AWS_SECRET_ACCESS_KEY: optionalString,
  SPACES_ENDPOINT: optionalUrl,
  SPACES_REGION: optionalString,
  SPACES_BUCKET: optionalString,
  SPACES_ACCESS_KEY_ID: optionalString,
  SPACES_SECRET_ACCESS_KEY: optionalString,
  SPACES_CDN_URL: optionalUrl,
  /** Preferred free email provider: https://resend.com (100 emails/day free). */
  RESEND_API_KEY: optionalString,
  /** Optional legacy provider. Used only if RESEND_API_KEY is unset. */
  SENDGRID_API_KEY: optionalString,
  EMAIL_FROM: optionalString,
  TWILIO_ACCOUNT_SID: optionalString,
  TWILIO_AUTH_TOKEN: optionalString,
  TWILIO_FROM_NUMBER: optionalString,
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  SENTRY_DSN: optionalUrl,
  /** Log verification / reset links to API stdout when no email provider is configured (beta). */
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
