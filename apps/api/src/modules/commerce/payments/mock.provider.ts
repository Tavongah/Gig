import { createHash, randomUUID } from "node:crypto";
import type {
  CommercePaymentProvider,
  InitiatePaymentInput,
  InitiatePaymentResult,
  ProviderPaymentStatus,
  ProviderWebhookResult
} from "./provider.js";

type MockRecord = {
  providerPaymentId: string;
  commerceOrderId: string;
  attemptId: string;
  amountCents: number;
  currency: string;
  payerPhoneE164: string;
  status: ProviderPaymentStatus["status"];
  failureReason?: string | null;
  expiresAt: Date | null;
};

/** In-memory mock EcoCash rail for development/test. */
const store = new Map<string, MockRecord>();

export function resetMockCommercePaymentsForTests(): void {
  store.clear();
}

export function getMockCommercePaymentRecord(providerPaymentId: string): MockRecord | undefined {
  return store.get(providerPaymentId);
}

export class MockCommercePaymentProvider implements CommercePaymentProvider {
  readonly name = "mock" as const;

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    const providerPaymentId = `mock_${input.attemptId}`;
    const ttlSec = Number(process.env.COMMERCE_PAYMENT_TTL_SECONDS || 900);
    const expiresAt = new Date(Date.now() + Math.max(60, ttlSec) * 1000);
    store.set(providerPaymentId, {
      providerPaymentId,
      commerceOrderId: input.commerceOrderId,
      attemptId: input.attemptId,
      amountCents: input.amountCents,
      currency: input.currency,
      payerPhoneE164: input.payerPhoneE164,
      status: "PENDING",
      expiresAt
    });
    return { providerPaymentId, status: "PENDING", expiresAt };
  }

  async getPaymentStatus(providerPaymentId: string): Promise<ProviderPaymentStatus | null> {
    const row = store.get(providerPaymentId);
    if (!row) return null;
    if (
      row.status === "PENDING" &&
      row.expiresAt &&
      row.expiresAt.getTime() <= Date.now()
    ) {
      row.status = "EXPIRED";
      row.failureReason = "expired";
    }
    return {
      providerPaymentId: row.providerPaymentId,
      status: row.status,
      amountCents: row.amountCents,
      failureReason: row.failureReason
    };
  }

  async handleWebhook(input: {
    headers: Record<string, string | string[] | undefined>;
    rawBody: Buffer | string;
    body: unknown;
  }): Promise<ProviderWebhookResult | null> {
    const body = (input.body ?? {}) as Record<string, unknown>;
    const providerPaymentId = String(body.providerPaymentId || body.paymentId || "").trim();
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
            : statusRaw === "CANCELLED"
              ? "CANCELLED"
              : null;
    if (!status) return null;

    const row = store.get(providerPaymentId);
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
        status === "PAID" ? null : String(body.failureReason || status.toLowerCase())
    };
  }
}

/** Deterministic helper for tests — simulate provider outcome. */
export async function simulateMockPaymentOutcome(input: {
  providerPaymentId: string;
  status: "PAID" | "FAILED" | "EXPIRED";
  failureReason?: string;
}): Promise<ProviderWebhookResult | null> {
  const row = store.get(input.providerPaymentId);
  if (!row) return null;
  row.status = input.status;
  row.failureReason = input.status === "PAID" ? null : input.failureReason || input.status.toLowerCase();
  return {
    providerPaymentId: row.providerPaymentId,
    commerceOrderId: row.commerceOrderId,
    amountCents: row.amountCents,
    status: input.status,
    failureReason: row.failureReason
  };
}

export function mockWebhookIdempotencyKey(providerPaymentId: string, status: string): string {
  return createHash("sha256").update(`${providerPaymentId}:${status}`).digest("hex").slice(0, 24);
}

export function newMockCorrelationId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}
