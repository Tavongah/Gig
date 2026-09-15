/**
 * Paynow URL helpers — result URL construction + poll URL SSRF protection.
 */

import { AppError } from "../../../lib/errors.js";

const ALLOWED_POLL_HOSTS = new Set(["www.paynow.co.zw", "paynow.co.zw"]);

export function resolvePaynowPublicApiBase(): string {
  const base = String(process.env.API_PUBLIC_URL ?? "")
    .trim()
    .replace(/\/$/, "");
  if (!base) {
    throw new AppError(
      "API_PUBLIC_URL is required for Paynow official test mode (to build resulturl).",
      500,
      "PAYNOW_RESULT_URL_MISSING",
      {
        payment:
          "Set API_PUBLIC_URL to your public API origin, e.g. https://api.duts.tech"
      }
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    throw new AppError("API_PUBLIC_URL is not a valid URL.", 500, "PAYNOW_RESULT_URL_INVALID");
  }
  if (parsed.protocol !== "https:" && process.env.NODE_ENV === "production") {
    throw new AppError("API_PUBLIC_URL must be https in production.", 500, "PAYNOW_RESULT_URL_INSECURE");
  }
  return base;
}

export function buildPaynowCallbackUrl(): string {
  return `${resolvePaynowPublicApiBase()}/v1/commerce/payments/paynow/callback`;
}

export function buildPaynowReturnUrl(): string {
  // WhatsApp flow does not use browser return; still required by Paynow initiate contract.
  return `${resolvePaynowPublicApiBase()}/v1/commerce/payments/paynow/return`;
}

/**
 * Only allow HTTPS poll URLs on the official Paynow host.
 * Rejects arbitrary URLs (SSRF protection).
 */
export function assertSafePaynowPollUrl(raw: string): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) {
    throw new AppError("Missing Paynow poll URL.", 400, "PAYNOW_POLL_URL_MISSING");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new AppError("Invalid Paynow poll URL.", 400, "PAYNOW_POLL_URL_INVALID");
  }
  if (parsed.protocol !== "https:") {
    throw new AppError("Paynow poll URL must be HTTPS.", 400, "PAYNOW_POLL_URL_INSECURE");
  }
  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_POLL_HOSTS.has(host)) {
    throw new AppError("Paynow poll URL host is not allowed.", 400, "PAYNOW_POLL_URL_HOST");
  }
  // Block credentials / unexpected ports
  if (parsed.username || parsed.password) {
    throw new AppError("Paynow poll URL must not include credentials.", 400, "PAYNOW_POLL_URL_INVALID");
  }
  if (parsed.port && parsed.port !== "443") {
    throw new AppError("Paynow poll URL must use default HTTPS port.", 400, "PAYNOW_POLL_URL_INVALID");
  }
  return parsed.toString();
}

export function isAllowedPaynowPollUrl(raw: string): boolean {
  try {
    assertSafePaynowPollUrl(raw);
    return true;
  } catch {
    return false;
  }
}
