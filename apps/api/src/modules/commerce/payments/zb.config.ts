/**
 * ZB Smile&Pay environment + credentials.
 * Authority: https://smileandpay.zb.co.zw/documentation (Environments, Authentication).
 * Do not invent hostnames. Do not derive production from sandbox by stripping "sandbox".
 */

import { AppError } from "../../../lib/errors.js";

/** Official sandbox base — Environments → Development. */
export const ZB_DOCUMENTED_SANDBOX_BASE =
  "https://zbnet.zb.co.zw/wallet_sandbox_api/payments-gateway";

/** Official production base — Environments → Live Transactions. */
export const ZB_DOCUMENTED_PRODUCTION_BASE =
  "https://zbnet.zb.co.zw/wallet_gateway/payments-gateway";

/** ISO 4217 numeric USD as used in official Smile&Pay request examples. */
export const ZB_USD_CURRENCY_CODE = "840";

export type ZbMode = "sandbox" | "live";

export function resolveZbMode(override?: string | null): ZbMode {
  const raw = String(override ?? process.env.ZB_MODE ?? "sandbox")
    .trim()
    .toLowerCase();
  if (raw === "live") return "live";
  return "sandbox";
}

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

function isDocumentedProductionBase(url: string): boolean {
  return normalizeBaseUrl(url) === ZB_DOCUMENTED_PRODUCTION_BASE;
}

function isDocumentedSandboxBase(url: string): boolean {
  return normalizeBaseUrl(url) === ZB_DOCUMENTED_SANDBOX_BASE;
}

/**
 * Live activation may only use the production URL published on the official Environments page.
 * Any other live URL is blocked — never guess or strip "sandbox" from the hostname.
 */
export function resolveZbApiBaseUrl(input?: { mode?: ZbMode; override?: string | null }): string {
  const mode = input?.mode ?? resolveZbMode();
  const override = normalizeBaseUrl(
    String(input?.override ?? process.env.ZB_API_BASE_URL ?? "")
  );

  if (mode === "live") {
    if (!override) return ZB_DOCUMENTED_PRODUCTION_BASE;
    if (isDocumentedProductionBase(override)) return override;
    throw new AppError(
      "ZB live payments are blocked until the production API base URL matches official Smile&Pay documentation.",
      503,
      "BLOCKED_ZB_PRODUCTION_ENDPOINT_NOT_VERIFIED"
    );
  }

  if (!override) return ZB_DOCUMENTED_SANDBOX_BASE;
  if (isDocumentedSandboxBase(override)) return override;
  if (isDocumentedProductionBase(override)) {
    throw new AppError(
      "ZB sandbox mode cannot use the production Smile&Pay endpoint. Set ZB_MODE=live only after credentials are ready.",
      503,
      "BLOCKED_ZB_PRODUCTION_ENDPOINT_NOT_VERIFIED"
    );
  }
  throw new AppError(
    "ZB_API_BASE_URL must be the official Smile&Pay sandbox or production base URL.",
    503,
    "BLOCKED_ZB_PRODUCTION_ENDPOINT_NOT_VERIFIED"
  );
}

export function resolveZbCredentials(): { apiKey: string; apiSecret: string } {
  const apiKey = String(process.env.ZB_API_KEY ?? "").trim();
  const apiSecret = String(process.env.ZB_API_SECRET ?? "").trim();
  if (!apiKey || !apiSecret) {
    throw new AppError(
      "EcoCash is not configured yet. Choose cash on delivery, or try again later.",
      503,
      "ZB_NOT_CONFIGURED"
    );
  }
  if (/replace|changeme|your_|xxx|example|placeholder|dummy/i.test(apiKey) ||
      /replace|changeme|your_|xxx|example|placeholder|dummy/i.test(apiSecret)) {
    throw new AppError(
      "EcoCash is not configured yet. Choose cash on delivery, or try again later.",
      503,
      "ZB_NOT_CONFIGURED"
    );
  }
  return { apiKey, apiSecret };
}

export function buildZbCallbackUrl(): string {
  const base = String(process.env.API_PUBLIC_URL ?? "")
    .trim()
    .replace(/\/$/, "");
  if (!base) {
    throw new AppError(
      "API_PUBLIC_URL is required to receive EcoCash payment confirmation.",
      500,
      "ZB_RESULT_URL_MISSING"
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    throw new AppError("API_PUBLIC_URL is not a valid URL.", 500, "ZB_RESULT_URL_INVALID");
  }
  if (parsed.protocol !== "https:" && process.env.NODE_ENV === "production") {
    throw new AppError("API_PUBLIC_URL must be https in production.", 500, "ZB_RESULT_URL_INSECURE");
  }
  return `${base}/v1/commerce/payments/zb/callback`;
}

export function buildZbReturnUrl(): string {
  const base = String(process.env.API_PUBLIC_URL ?? "")
    .trim()
    .replace(/\/$/, "");
  if (!base) {
    throw new AppError(
      "API_PUBLIC_URL is required for EcoCash return handling.",
      500,
      "ZB_RETURN_URL_MISSING"
    );
  }
  return `${base}/v1/commerce/payments/zb/return`;
}

/** Official express-checkout amount is a decimal (e.g. 100.00), not cents. */
export function zbAmountFromCents(amountCents: number): number {
  if (!Number.isFinite(amountCents) || amountCents < 1) {
    throw new AppError("Invalid payment amount.", 400, "ZB_AMOUNT_INVALID");
  }
  return Math.round(amountCents) / 100;
}

export function zbCentsFromAmount(amount: unknown): number | null {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function isZbUsdCurrency(input: { currency?: string | null; currencyCode?: string | null }): boolean {
  const currency = String(input.currency ?? "").trim().toUpperCase();
  const code = String(input.currencyCode ?? "").trim();
  if (code && code !== ZB_USD_CURRENCY_CODE) return false;
  if (currency && currency !== "USD") return false;
  return true;
}

export function assertDutsUsdCurrency(currency: string): void {
  if (String(currency ?? "").trim().toLowerCase() !== "usd") {
    throw new AppError(
      "EcoCash USD cannot be used for this order currency.",
      409,
      "ZB_CURRENCY_NOT_USD"
    );
  }
}
