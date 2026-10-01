/**
 * ZB Smile&Pay HTTP transport.
 * Auth headers from official Authentication docs: x-api-key + x-api-secret.
 * Never log the API secret. Redact sensitive fields from any diagnostic.
 */

import { AppError } from "../../../lib/errors.js";
import {
  resolveZbApiBaseUrl,
  resolveZbCredentials,
  type ZbMode
} from "./zb.config.js";

export type ZbJson = Record<string, unknown>;

type ZbFetch = typeof fetch;

let zbFetchOverride: ZbFetch | null = null;

export function setZbFetchForTests(fn: ZbFetch | null): void {
  zbFetchOverride = fn;
}

const REDACT_KEY = /api.?secret|x-api-secret|secret|authorization|pin|otp|password|passcode/i;

export function redactZbValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    if (value.length > 24 && /[A-Za-z0-9]{16,}/.test(value)) return "[redacted]";
    return value;
  }
  if (Array.isArray(value)) return value.map(redactZbValue);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_KEY.test(k) ? "[redacted]" : redactZbValue(v);
    }
    return out;
  }
  return value;
}

export function zbAuthHeaders(): Record<string, string> {
  const { apiKey, apiSecret } = resolveZbCredentials();
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "x-api-secret": apiSecret
  };
}

async function zbFetch(path: string, init: RequestInit, mode?: ZbMode): Promise<ZbJson> {
  const base = resolveZbApiBaseUrl({ mode });
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const run = zbFetchOverride ?? fetch;
  let response: Response;
  try {
    response = await run(url, {
      ...init,
      headers: {
        ...zbAuthHeaders(),
        ...(init.headers ?? {})
      }
    });
  } catch {
    throw new AppError(
      "Payment was not completed. Try again or choose cash on delivery.",
      502,
      "ZB_NETWORK_ERROR"
    );
  }

  const text = await response.text();
  let json: ZbJson = {};
  if (text) {
    try {
      json = JSON.parse(text) as ZbJson;
    } catch {
      json = {};
    }
  }

  if (!response.ok) {
    throw new AppError(
      "Payment was not completed. Try again or choose cash on delivery.",
      502,
      "ZB_REQUEST_FAILED"
    );
  }
  return json;
}

export async function zbPostJson(path: string, body: unknown, mode?: ZbMode): Promise<ZbJson> {
  return zbFetch(
    path,
    {
      method: "POST",
      body: JSON.stringify(body)
    },
    mode
  );
}

export async function zbGetJson(path: string, mode?: ZbMode): Promise<ZbJson> {
  return zbFetch(path, { method: "GET" }, mode);
}

export function pickZbString(obj: ZbJson | null | undefined, keys: string[]): string | null {
  if (!obj) return null;
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  const nested = obj.data;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return pickZbString(nested as ZbJson, keys);
  }
  return null;
}
