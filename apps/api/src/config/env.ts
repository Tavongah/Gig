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
  /** Gig deployment lane: development | test | pilot | staging | production */
  APP_ENV: z
    .enum(["development", "test", "pilot", "staging", "production"])
    .optional(),
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
  /** Set to "false" to disable DUTS Delivery quote/create in this environment. */
  DELIVERY_ENABLED: optionalString,
  /** Seconds before auto-approve after delivery PIN (default 60). */
  DELIVERY_AUTO_APPROVE_SECONDS: optionalString,
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
  /** WhatsApp sender for WHATSAPP_PROVIDER=twilio, e.g. whatsapp:+14155238886 */
  TWILIO_WHATSAPP_FROM: optionalString,
  /** Exact public URL Twilio signs (defaults to {API_PUBLIC_URL}/v1/whatsapp/twilio). */
  TWILIO_WHATSAPP_WEBHOOK_URL: optionalString,
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  SENTRY_DSN: optionalUrl,
  /** Log verification / reset links to API stdout when no email provider is configured (beta). */
  LOG_VERIFICATION_TO_CONSOLE: z
    .string()
    .optional()
    .transform((value) => value === "true" || value === "1")
});

export const env = envSchema.parse(process.env);

function looksLikePlaceholderSecret(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  return /replace|changeme|your-|xxx|example|placeholder|dummy/i.test(v);
}

export function isSpacesConfigured(): boolean {
  const bucket = (env.SPACES_BUCKET ?? env.S3_BUCKET ?? "").trim();
  const key = (env.SPACES_ACCESS_KEY_ID ?? env.AWS_ACCESS_KEY_ID ?? "").trim();
  const secret = (env.SPACES_SECRET_ACCESS_KEY ?? env.AWS_SECRET_ACCESS_KEY ?? "").trim();
  const endpoint = (env.SPACES_ENDPOINT ?? env.S3_ENDPOINT ?? "").trim();
  if (!bucket || !key || !secret || !endpoint) return false;
  if (looksLikePlaceholderSecret(key) || looksLikePlaceholderSecret(secret)) return false;
  return true;
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
