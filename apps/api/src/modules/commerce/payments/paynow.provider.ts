/**
 * Paynow CommercePaymentProvider — maps DUTS payment lifecycle to Paynow transport.
 * Does not touch WhatsApp / order / merchant notification logic.
 */

import type {
  CommercePaymentProvider,
  InitiatePaymentInput,
  InitiatePaymentResult,
  ProviderPaymentStatus,
  ProviderWebhookResult
} from "./provider.js";
import {
  buildPaynowMerchantReference,
  createPaynowTransport,
  resolvePaynowMode,
  type PaynowPaymentMethodRail,
  type PaynowTransport
} from "./paynow.transport.js";
import { formatZwLocalFromE164 } from "./zw-phone.js";

export type PaynowInitiatePaymentInput = InitiatePaymentInput & {
  paymentMethod?: PaynowPaymentMethodRail;
};

export class PaynowCommercePaymentProvider implements CommercePaymentProvider {
  readonly name = "paynow" as const;
  private readonly transport: PaynowTransport;

  constructor(transport?: PaynowTransport) {
    this.transport = transport ?? createPaynowTransport(resolvePaynowMode());
  }

  get mode() {
    return this.transport.mode;
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    const extended = input as PaynowInitiatePaymentInput;
    const paymentMethod: PaynowPaymentMethodRail =
      extended.paymentMethod === "ONEMONEY" ? "ONEMONEY" : "ECOCASH";

    const merchantReference = buildPaynowMerchantReference(
      input.orderNumber,
      input.attemptId
    );

    const initiated = await this.transport.initiate({
      commerceOrderId: input.commerceOrderId,
      orderNumber: input.orderNumber,
      amountCents: input.amountCents,
      currency: input.currency,
      payerPhoneE164: input.payerPhoneE164,
      payerPhoneLocal: formatZwLocalFromE164(input.payerPhoneE164),
      attemptId: input.attemptId,
      paymentMethod,
      merchantReference
    });

    return {
      providerPaymentId: initiated.providerPaymentId,
      status: "PENDING",
      expiresAt: initiated.expiresAt,
      rawRef: initiated.rawRef,
      merchantReference: initiated.merchantReference,
      pollUrl: initiated.pollUrl ?? null,
      paynowReference: initiated.paynowReference ?? null
    };
  }

  async getPaymentStatus(providerPaymentId: string): Promise<ProviderPaymentStatus | null> {
    // Poll URL must be supplied via payment.service which loads the attempt row.
    const status = await this.transport.getStatus(providerPaymentId);
    if (!status) return null;
    return {
      providerPaymentId: status.providerPaymentId,
      status: status.status,
      amountCents: status.amountCents,
      failureReason: status.failureReason
    };
  }

  async getPaymentStatusWithPollUrl(
    providerPaymentId: string,
    pollUrl: string | null | undefined
  ): Promise<ProviderPaymentStatus | null> {
    const status = await this.transport.getStatus(providerPaymentId, { pollUrl });
    if (!status) return null;
    return {
      providerPaymentId: status.providerPaymentId,
      status: status.status,
      amountCents: status.amountCents,
      failureReason: status.failureReason
    };
  }

  async handleWebhook(input: {
    headers: Record<string, string | string[] | undefined>;
    rawBody: Buffer | string;
    body: unknown;
  }): Promise<ProviderWebhookResult | null> {
    const parsed = await this.transport.handleCallback(input);
    if (!parsed) return null;
    return {
      providerPaymentId: parsed.providerPaymentId,
      commerceOrderId: parsed.commerceOrderId,
      amountCents: parsed.amountCents,
      status: parsed.status,
      failureReason: parsed.failureReason,
      merchantReference: parsed.merchantReference,
      paynowReference: parsed.paynowReference
    };
  }
}
