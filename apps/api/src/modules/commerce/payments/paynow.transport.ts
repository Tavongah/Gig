/**
 * Paynow HTTP/API transport boundary.
 *
 * Modes:
 * - local  = deterministic in-process simulator (no Paynow network)
 * - test   = REAL Paynow API against an integration still in Paynow Test Mode
 * - live   = production Paynow — FAIL-CLOSED (not enabled)
 *
 * Business mapping lives in paynow.provider.ts.
 */

import { createHash, randomUUID } from "node:crypto";
import { AppError } from "../../../lib/errors.js";
import {
  encodePaynowForm,
  formatPaynowAmount,
  generatePaynowHashFromFields,
  parsePaynowUrlEncoded,
  PAYNOW_MOBILE_INIT_ORDER,
  verifyPaynowHashFromFields
} from "./paynow.hash.js";
import { mapPaynowStatus } from "./paynow.status.js";
import {
  assertSafePaynowPollUrl,
  buildPaynowCallbackUrl,
  buildPaynowReturnUrl
} from "./paynow.urls.js";

export type PaynowMode = "local" | "test" | "live";

export type PaynowPaymentMethodRail = "ECOCASH" | "ONEMONEY";

export type PaynowTransportInitiateInput = {
  commerceOrderId: string;
  orderNumber: number;
  amountCents: number;
  currency: string;
  payerPhoneE164: string;
  /** Local 07… display form preferred for Paynow phone field. */
  payerPhoneLocal?: string;
  attemptId: string;
  paymentMethod: PaynowPaymentMethodRail;
  /** Unique merchant reference (DUTS). */
  merchantReference: string;
};

export type PaynowTransportInitiateResult = {
  providerPaymentId: string;
  status: "PENDING";
  expiresAt: Date | null;
  rawRef?: string;
  merchantReference: string;
  pollUrl?: string | null;
  paynowReference?: string | null;
};

export type PaynowTransportStatus = {
  providerPaymentId: string;
  status: "PENDING" | "PAID" | "FAILED" | "EXPIRED" | "CANCELLED";
  amountCents?: number;
  failureReason?: string | null;
  merchantReference?: string;
};

export type PaynowTransportWebhookResult = {
  providerPaymentId: string;
  commerceOrderId: string;
  amountCents: number;
  status: "PAID" | "FAILED" | "EXPIRED" | "CANCELLED";
  failureReason?: string | null;
  merchantReference?: string;
  paynowReference?: string | null;
};

export interface PaynowTransport {
  readonly mode: PaynowMode;
  initiate(input: PaynowTransportInitiateInput): Promise<PaynowTransportInitiateResult>;
  getStatus(providerPaymentId: string, opts?: { pollUrl?: string | null }): Promise<PaynowTransportStatus | null>;
  handleCallback(input: {
    headers: Record<string, string | string[] | undefined>;
    rawBody: Buffer | string;
    body: unknown;
  }): Promise<PaynowTransportWebhookResult | null>;
}

type LocalRecord = {
  providerPaymentId: string;
  commerceOrderId: string;
  attemptId: string;
  merchantReference: string;
  amountCents: number;
  currency: string;
  payerPhoneE164: string;
  paymentMethod: PaynowPaymentMethodRail;
  status: PaynowTransportStatus["status"];
  failureReason?: string | null;
  expiresAt: Date | null;
};

const localStore = new Map<string, LocalRecord>();
/** Index local records by merchant reference for callback simulation. */
const localByReference = new Map<string, string>();

export function resetPaynowLocalTransportForTests(): void {
  localStore.clear();
  localByReference.clear();
}

/** @deprecated Alias — local simulator reset. */
export function resetPaynowTestTransportForTests(): void {
  resetPaynowLocalTransportForTests();
}

export function getPaynowLocalTransportRecord(
  providerPaymentId: string
): LocalRecord | undefined {
  return localStore.get(providerPaymentId);
}

/** @deprecated Alias */
export function getPaynowTestTransportRecord(providerPaymentId: string) {
  return getPaynowLocalTransportRecord(providerPaymentId);
}

function requirePaynowCredentials(): { integrationId: string; integrationKey: string; authEmail: string } {
  const integrationId = process.env.PAYNOW_INTEGRATION_ID?.trim() ?? "";
  const integrationKey = process.env.PAYNOW_INTEGRATION_KEY?.trim() ?? "";
  const authEmail = process.env.PAYNOW_AUTH_EMAIL?.trim() ?? "";
  if (!integrationId || !integrationKey) {
    throw new AppError(
      "Paynow credentials are not configured.",
      501,
      "PAYNOW_NOT_CONFIGURED",
      {
        payment: "Set PAYNOW_INTEGRATION_ID and PAYNOW_INTEGRATION_KEY in environment secrets."
      }
    );
  }
  if (!authEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authEmail)) {
    throw new AppError(
      "PAYNOW_AUTH_EMAIL is required for Paynow Express Checkout Test Mode.",
      501,
      "PAYNOW_AUTH_EMAIL_MISSING",
      {
        payment:
          "Set PAYNOW_AUTH_EMAIL to a login email on the Paynow merchant account under test."
      }
    );
  }
  return { integrationId, integrationKey, authEmail };
}

function mapMethod(rail: PaynowPaymentMethodRail): "ecocash" | "onemoney" {
  return rail === "ONEMONEY" ? "onemoney" : "ecocash";
}

function phoneForPaynow(input: PaynowTransportInitiateInput): string {
  if (input.payerPhoneLocal && /^0?7\d{8}$/.test(input.payerPhoneLocal.replace(/\s/g, ""))) {
    const d = input.payerPhoneLocal.replace(/\s/g, "");
    return d.startsWith("0") ? d : `0${d}`;
  }
  // +2637XXXXXXXX → 07XXXXXXXX
  const e164 = input.payerPhoneE164.replace(/\s/g, "");
  if (/^\+2637\d{8}$/.test(e164)) return `0${e164.slice(4)}`;
  throw new AppError("Invalid payer phone for Paynow.", 400, "INVALID_PAYER_PHONE");
}

/** Deterministic local Paynow simulator — no network. */
export class LocalPaynowTransport implements PaynowTransport {
  readonly mode = "local" as const;

  async initiate(input: PaynowTransportInitiateInput): Promise<PaynowTransportInitiateResult> {
    const providerPaymentId = input.merchantReference;
    const ttlSec = Number(process.env.COMMERCE_PAYMENT_TTL_SECONDS || 900);
    const expiresAt = new Date(Date.now() + Math.max(60, ttlSec) * 1000);
    localStore.set(providerPaymentId, {
      providerPaymentId,
      commerceOrderId: input.commerceOrderId,
      attemptId: input.attemptId,
      merchantReference: input.merchantReference,
      amountCents: input.amountCents,
      currency: input.currency,
      payerPhoneE164: input.payerPhoneE164,
      paymentMethod: input.paymentMethod,
      status: "PENDING",
      expiresAt
    });
    localByReference.set(input.merchantReference, providerPaymentId);
    return {
      providerPaymentId,
      status: "PENDING",
      expiresAt,
      rawRef: `local:${input.paymentMethod}`,
      merchantReference: input.merchantReference,
      pollUrl: null,
      paynowReference: null
    };
  }

  async getStatus(providerPaymentId: string): Promise<PaynowTransportStatus | null> {
    const row = localStore.get(providerPaymentId);
    if (!row) return null;
    if (row.status === "PENDING" && row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
      row.status = "EXPIRED";
      row.failureReason = "expired";
    }
    return {
      providerPaymentId: row.providerPaymentId,
      status: row.status,
      amountCents: row.amountCents,
      failureReason: row.failureReason,
      merchantReference: row.merchantReference
    };
  }

  async handleCallback(input: {
    headers: Record<string, string | string[] | undefined>;
    rawBody: Buffer | string;
    body: unknown;
  }): Promise<PaynowTransportWebhookResult | null> {
    const body = (input.body ?? {}) as Record<string, unknown>;
    const providerPaymentId = String(
      body.providerPaymentId || body.paymentId || body.reference || ""
    ).trim();
    const commerceOrderId = String(body.commerceOrderId || body.orderId || "").trim();
    const amountCents = Number(body.amountCents);
    const statusRaw = String(body.status || "").trim().toUpperCase();
    if (!providerPaymentId || !commerceOrderId || !Number.isFinite(amountCents)) {
      return null;
    }
    const status =
      statusRaw === "PAID" || statusRaw === "SUCCESS"
        ? "PAID"
        : statusRaw === "FAILED" || statusRaw === "FAILURE"
          ? "FAILED"
          : statusRaw === "EXPIRED"
            ? "EXPIRED"
            : statusRaw === "CANCELLED" || statusRaw === "CANCELED"
              ? "CANCELLED"
              : null;
    if (!status) return null;

    const row = localStore.get(providerPaymentId);
    if (row) {
      row.status = status;
      row.failureReason =
        status === "PAID" ? null : String(body.failureReason || status.toLowerCase());
    }

    return {
      providerPaymentId,
      commerceOrderId,
      amountCents: Math.round(amountCents),
      status,
      failureReason:
        status === "PAID" ? null : String(body.failureReason || status.toLowerCase()),
      merchantReference: row?.merchantReference ?? providerPaymentId
    };
  }
}

/** @deprecated Alias for LocalPaynowTransport */
export class TestPaynowTransport extends LocalPaynowTransport {}

/** Apply a local-only status transition (dev/test routes only). */
export async function simulatePaynowTestOutcome(input: {
  providerPaymentId: string;
  status: "PAID" | "FAILED" | "EXPIRED" | "CANCELLED";
  failureReason?: string;
}): Promise<PaynowTransportWebhookResult | null> {
  const row = localStore.get(input.providerPaymentId);
  if (!row) return null;
  row.status = input.status;
  row.failureReason =
    input.status === "PAID" ? null : input.failureReason || input.status.toLowerCase();
  return {
    providerPaymentId: row.providerPaymentId,
    commerceOrderId: row.commerceOrderId,
    amountCents: row.amountCents,
    status: input.status,
    failureReason: row.failureReason,
    merchantReference: row.merchantReference
  };
}

/**
 * REAL Paynow Express Checkout mobile transport (integration still in Paynow Test Mode).
 * Contacts https://www.paynow.co.zw/interface/remotetransaction — no live money when
 * the Paynow integration itself remains in Test Mode.
 */
export class OfficialPaynowTestTransport implements PaynowTransport {
  readonly mode = "test" as const;
  private readonly endpoint =
    process.env.PAYNOW_REMOTE_TRANSACTION_URL?.trim() ||
    "https://www.paynow.co.zw/interface/remotetransaction";

  async initiate(input: PaynowTransportInitiateInput): Promise<PaynowTransportInitiateResult> {
    const { integrationId, integrationKey, authEmail } = requirePaynowCredentials();
    const resulturl = buildPaynowCallbackUrl();
    const returnurl = buildPaynowReturnUrl();
    const amount = formatPaynowAmount(input.amountCents);
    const phone = phoneForPaynow(input);
    const method = mapMethod(input.paymentMethod);

    const fields: Record<string, string> = {
      id: integrationId,
      reference: input.merchantReference,
      amount,
      additionalinfo: `DUTS order ${input.orderNumber}`,
      returnurl,
      resulturl,
      authemail: authEmail,
      phone,
      method,
      status: "Message"
    };

    const hash = generatePaynowHashFromFields(
      fields,
      integrationKey,
      [...PAYNOW_MOBILE_INIT_ORDER]
    );
    fields.hash = hash;

    const body = encodePaynowForm(fields, [...PAYNOW_MOBILE_INIT_ORDER, "hash"]);
    let responseText: string;
    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body
      });
      responseText = await res.text();
    } catch {
      throw new AppError(
        "Could not reach Paynow. Try again shortly.",
        502,
        "PAYNOW_NETWORK_ERROR"
      );
    }

    const { fields: parsed, order } = parsePaynowUrlEncoded(responseText);
    const statusLower = (parsed.status ?? "").toLowerCase();

    if (statusLower === "error") {
      const errMsg = parsed.error || "Paynow rejected the payment request.";
      // Never echo secrets; provider error strings are controlled enough for ops.
      throw new AppError(errMsg.slice(0, 200), 400, "PAYNOW_INIT_FAILED");
    }

    if (!verifyPaynowHashFromFields(parsed, integrationKey, order.filter((k) => k !== "hash"))) {
      throw new AppError(
        "Paynow initiation response failed hash validation.",
        502,
        "PAYNOW_HASH_INVALID"
      );
    }

    if (statusLower !== "ok") {
      throw new AppError(
        "Unexpected Paynow initiation status.",
        502,
        "PAYNOW_INIT_UNEXPECTED",
        { status: statusLower.slice(0, 40) }
      );
    }

    let pollUrl: string | null = null;
    if (parsed.pollurl) {
      pollUrl = assertSafePaynowPollUrl(parsed.pollurl);
    }

    const ttlSec = Number(process.env.COMMERCE_PAYMENT_TTL_SECONDS || 900);
    const expiresAt = new Date(Date.now() + Math.max(60, ttlSec) * 1000);

    return {
      providerPaymentId: input.merchantReference,
      status: "PENDING",
      expiresAt,
      merchantReference: input.merchantReference,
      pollUrl,
      paynowReference: parsed.paynowreference || null,
      rawRef: method
    };
  }

  async getStatus(
    providerPaymentId: string,
    opts?: { pollUrl?: string | null }
  ): Promise<PaynowTransportStatus | null> {
    const { integrationKey } = requirePaynowCredentials();
    if (!opts?.pollUrl) return null;
    const pollUrl = assertSafePaynowPollUrl(opts.pollUrl);

    let responseText: string;
    try {
      const res = await fetch(pollUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: ""
      });
      responseText = await res.text();
    } catch {
      throw new AppError("Could not poll Paynow status.", 502, "PAYNOW_POLL_NETWORK_ERROR");
    }

    const { fields: parsed, order } = parsePaynowUrlEncoded(responseText);
    if (!verifyPaynowHashFromFields(parsed, integrationKey, order.filter((k) => k !== "hash"))) {
      throw new AppError("Paynow poll response failed hash validation.", 502, "PAYNOW_HASH_INVALID");
    }

    const mapped = mapPaynowStatus(parsed.status);
    if (mapped === "UNKNOWN") {
      return {
        providerPaymentId,
        status: "PENDING",
        failureReason: `unknown_paynow_status:${String(parsed.status ?? "").slice(0, 40)}`,
        merchantReference: parsed.reference || providerPaymentId
      };
    }

    const amountCents = parsed.amount
      ? Math.round(Number(parsed.amount) * 100)
      : undefined;

    return {
      providerPaymentId,
      status: mapped,
      amountCents,
      failureReason: mapped === "PAID" ? null : mapped.toLowerCase(),
      merchantReference: parsed.reference || providerPaymentId
    };
  }

  async handleCallback(input: {
    headers: Record<string, string | string[] | undefined>;
    rawBody: Buffer | string;
    body: unknown;
  }): Promise<PaynowTransportWebhookResult | null> {
    const { integrationKey } = requirePaynowCredentials();

    let raw =
      typeof input.rawBody === "string" || Buffer.isBuffer(input.rawBody)
        ? input.rawBody
        : "";
    if (!raw && input.body && typeof input.body === "object") {
      // Express urlencoded already decoded — rebuild from body keys in insertion order
      const obj = input.body as Record<string, unknown>;
      raw = Object.entries(obj)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v ?? ""))}`)
        .join("&");
    }

    const { fields: parsed, order } = parsePaynowUrlEncoded(raw);
    if (!parsed.reference || !parsed.status || !parsed.amount) {
      return null;
    }

    if (!verifyPaynowHashFromFields(parsed, integrationKey, order.filter((k) => k !== "hash"))) {
      throw new AppError(
        "Paynow callback failed hash validation.",
        401,
        "PAYNOW_HASH_INVALID"
      );
    }

    const mapped = mapPaynowStatus(parsed.status);
    if (mapped === "UNKNOWN") {
      // Fail closed: acknowledge nothing actionable
      return null;
    }
    if (mapped === "PENDING") {
      return null;
    }

    const amountCents = Math.round(Number(parsed.amount) * 100);
    if (!Number.isFinite(amountCents) || amountCents < 1) {
      throw new AppError("Invalid Paynow callback amount.", 400, "PAYNOW_AMOUNT_INVALID");
    }

    // commerceOrderId resolved by payment service via merchantReference
    return {
      providerPaymentId: parsed.reference,
      commerceOrderId: "", // filled by service after lookup
      amountCents,
      status: mapped,
      failureReason: mapped === "PAID" ? null : mapped.toLowerCase(),
      merchantReference: parsed.reference,
      paynowReference: parsed.paynowreference || null
    };
  }
}

/**
 * Live Paynow — intentionally fail-closed.
 */
export class LivePaynowTransport implements PaynowTransport {
  readonly mode = "live" as const;

  async initiate(_input: PaynowTransportInitiateInput): Promise<PaynowTransportInitiateResult> {
    throw new AppError(
      "Paynow live payments are not enabled. Use PAYNOW_MODE=test against a Paynow Test Mode integration.",
      501,
      "PAYNOW_LIVE_NOT_IMPLEMENTED"
    );
  }

  async getStatus(): Promise<PaynowTransportStatus | null> {
    throw new AppError(
      "Paynow live status checks are not enabled.",
      501,
      "PAYNOW_LIVE_NOT_IMPLEMENTED"
    );
  }

  async handleCallback(): Promise<PaynowTransportWebhookResult | null> {
    throw new AppError(
      "Paynow live webhook handling is disabled.",
      503,
      "PAYNOW_WEBHOOK_DISABLED"
    );
  }
}

export function resolvePaynowMode(override?: string | null): PaynowMode {
  const raw = String(override ?? process.env.PAYNOW_MODE ?? "local")
    .trim()
    .toLowerCase();
  if (raw === "live") return "live";
  if (raw === "test") return "test";
  // Backward-compat: older env docs used "test" for local simulator — prefer explicit local.
  if (raw === "local" || raw === "mock" || raw === "simulator") return "local";
  return "local";
}

export function createPaynowTransport(mode?: PaynowMode): PaynowTransport {
  const resolved = mode ?? resolvePaynowMode();
  if (resolved === "live") return new LivePaynowTransport();
  if (resolved === "test") return new OfficialPaynowTestTransport();
  return new LocalPaynowTransport();
}

export function paynowWebhookIdempotencyKey(providerPaymentId: string, status: string): string {
  return createHash("sha256").update(`${providerPaymentId}:${status}`).digest("hex").slice(0, 24);
}

export function newPaynowCorrelationId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}

export function buildPaynowMerchantReference(orderNumber: number, attemptId: string): string {
  const short = attemptId.replace(/-/g, "").slice(0, 12);
  return `DUTS-${orderNumber}-${short}`;
}
