/**
 * Commerce payment provider abstraction (mock | paynow | ecocash).
 * Real EcoCash / live Paynow API wiring waits on official merchant docs/credentials.
 */

export type CommercePaymentProviderName = "mock" | "paynow" | "ecocash";

export type InitiatePaymentInput = {
  commerceOrderId: string;
  orderNumber: number;
  amountCents: number;
  currency: string;
  payerPhoneE164: string;
  /** Correlation id for the attempt row (may become providerPaymentId for mock). */
  attemptId: string;
  /** Mobile-money rail when provider is Paynow (ECOCASH | ONEMONEY). */
  paymentMethod?: "ECOCASH" | "ONEMONEY";
};

export type InitiatePaymentResult = {
  providerPaymentId: string;
  status: "PENDING";
  expiresAt: Date | null;
  rawRef?: string;
  merchantReference?: string;
  pollUrl?: string | null;
  paynowReference?: string | null;
};

export type ProviderPaymentStatus = {
  providerPaymentId: string;
  status: "PENDING" | "PAID" | "FAILED" | "EXPIRED" | "CANCELLED";
  amountCents?: number;
  failureReason?: string | null;
};

export type ProviderWebhookResult = {
  providerPaymentId: string;
  commerceOrderId: string;
  amountCents: number;
  status: "PAID" | "FAILED" | "EXPIRED" | "CANCELLED";
  failureReason?: string | null;
  merchantReference?: string;
  paynowReference?: string | null;
};

export interface CommercePaymentProvider {
  readonly name: CommercePaymentProviderName;
  initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentResult>;
  getPaymentStatus(providerPaymentId: string): Promise<ProviderPaymentStatus | null>;
  /**
   * Parse + verify webhook. Real providers must fail closed until signature rules are known.
   * Returns null when the payload is not actionable.
   */
  handleWebhook(input: {
    headers: Record<string, string | string[] | undefined>;
    rawBody: Buffer | string;
    body: unknown;
  }): Promise<ProviderWebhookResult | null>;
}

export function resolveCommercePaymentProviderName(
  override?: string | null
): CommercePaymentProviderName {
  const raw = String(override ?? process.env.COMMERCE_PAYMENT_PROVIDER ?? "mock")
    .trim()
    .toLowerCase();
  if (raw === "ecocash" || raw === "mock" || raw === "paynow") return raw;
  return "mock";
}
