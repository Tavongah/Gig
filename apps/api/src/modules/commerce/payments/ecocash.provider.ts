import { AppError } from "../../../lib/errors.js";
import type {
  CommercePaymentProvider,
  InitiatePaymentInput,
  InitiatePaymentResult,
  ProviderPaymentStatus,
  ProviderWebhookResult
} from "./provider.js";

/**
 * Bounded EcoCash adapter stub.
 * Does not guess production endpoints, auth, or webhook signatures.
 * Remains disabled until official merchant API docs + credentials are available.
 */
export class EcoCashCommercePaymentProvider implements CommercePaymentProvider {
  readonly name = "ecocash" as const;

  async initiatePayment(_input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    throw new AppError(
      "EcoCash live payments are not configured yet. Use COMMERCE_PAYMENT_PROVIDER=mock for testing.",
      501,
      "ECOCASH_NOT_CONFIGURED",
      {
        payment:
          "Waiting on official EcoCash merchant API credentials and documented initiate/callback contracts."
      }
    );
  }

  async getPaymentStatus(_providerPaymentId: string): Promise<ProviderPaymentStatus | null> {
    throw new AppError(
      "EcoCash live status checks are not configured yet.",
      501,
      "ECOCASH_NOT_CONFIGURED"
    );
  }

  async handleWebhook(_input: {
    headers: Record<string, string | string[] | undefined>;
    rawBody: Buffer | string;
    body: unknown;
  }): Promise<ProviderWebhookResult | null> {
    // Fail closed: no official signing rules yet.
    throw new AppError(
      "EcoCash webhook handling is disabled until official signature verification is documented.",
      503,
      "ECOCASH_WEBHOOK_DISABLED"
    );
  }
}
