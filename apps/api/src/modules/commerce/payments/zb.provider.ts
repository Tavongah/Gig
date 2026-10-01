/**
 * ZB Smile&Pay CommercePaymentProvider — EcoCash USD express checkout only.
 *
 * Official:
 * POST /payments/express-checkout/ecocash
 * GET  /payments/transaction/{orderReference}/status/check
 * resultUrl webhook payload documented under Payment Callback.
 */

import { AppError } from "../../../lib/errors.js";
import { formatZwLocalFromE164 } from "./zw-phone.js";
import type {
  CommercePaymentProvider,
  InitiatePaymentInput,
  InitiatePaymentResult,
  ProviderPaymentStatus,
  ProviderWebhookResult
} from "./provider.js";
import {
  ZB_USD_CURRENCY_CODE,
  assertDutsUsdCurrency,
  buildZbCallbackUrl,
  buildZbReturnUrl,
  isZbUsdCurrency,
  resolveZbCredentials,
  zbAmountFromCents,
  zbCentsFromAmount
} from "./zb.config.js";
import { mapZbProviderStatus } from "./zb.status.js";
import { pickZbString, zbGetJson, zbPostJson, type ZbJson } from "./zb.transport.js";

export function buildZbOrderReference(orderNumber: number, attemptId: string): string {
  const compact = attemptId.replace(/-/g, "").slice(0, 12).toUpperCase();
  return `DUTS-${orderNumber}-${compact}`;
}

function parseCallbackBody(body: unknown): ZbJson | null {
  if (body && typeof body === "object" && !Array.isArray(body)) return body as ZbJson;
  if (typeof body === "string" && body.trim()) {
    try {
      const parsed = JSON.parse(body) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as ZbJson;
    } catch {
      return null;
    }
  }
  return null;
}

export class ZbCommercePaymentProvider implements CommercePaymentProvider {
  readonly name = "zb" as const;

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    if (input.paymentMethod && input.paymentMethod !== "ECOCASH") {
      throw new AppError(
        "EcoCash USD and cash on delivery are available.",
        400,
        "ZB_ECOCASH_USD_ONLY"
      );
    }
    assertDutsUsdCurrency(input.currency);
    resolveZbCredentials();
    const orderReference = buildZbOrderReference(input.orderNumber, input.attemptId);
    const amount = zbAmountFromCents(input.amountCents);
    const ecocashMobile = formatZwLocalFromE164(input.payerPhoneE164);

    const json = await zbPostJson("/payments/express-checkout/ecocash", {
      orderReference,
      amount,
      currencyCode: ZB_USD_CURRENCY_CODE,
      itemName: `DUTS order ${input.orderNumber}`,
      itemDescription: `DUTS order ${input.orderNumber}`,
      resultUrl: buildZbCallbackUrl(),
      returnUrl: buildZbReturnUrl(),
      ecocashMobile
    });

    const providerRef =
      pickZbString(json, ["reference", "transactionReference", "providerReference"]) ??
      orderReference;

    return {
      providerPaymentId: providerRef,
      status: "PENDING",
      expiresAt: new Date(Date.now() + Number(process.env.COMMERCE_PAYMENT_TTL_SECONDS || 900) * 1000),
      merchantReference: orderReference
    };
  }

  async getPaymentStatus(providerPaymentId: string): Promise<ProviderPaymentStatus | null> {
    return this.getPaymentStatusByOrderReference(providerPaymentId);
  }

  async getPaymentStatusByOrderReference(
    orderReference: string
  ): Promise<ProviderPaymentStatus | null> {
    if (!orderReference.trim()) return null;
    const json = await zbGetJson(
      `/payments/transaction/${encodeURIComponent(orderReference)}/status/check`
    );
    const statusRaw = pickZbString(json, ["status", "paymentStatus", "transactionStatus"]);
    const mapped = mapZbProviderStatus(statusRaw);
    const amountCents = zbCentsFromAmount(
      json.amount ?? (json.data as ZbJson | undefined)?.amount
    );
    const currencyOk = isZbUsdCurrency({
      currency: pickZbString(json, ["currency"]),
      currencyCode: pickZbString(json, ["currencyCode"])
    });
    if (mapped === "PAID" && !currencyOk && (json.currency || json.currencyCode)) {
      return {
        providerPaymentId:
          pickZbString(json, ["reference", "transactionReference"]) ?? orderReference,
        status: "PENDING",
        amountCents: amountCents ?? undefined,
        failureReason: "currency_not_usd"
      };
    }
    return {
      providerPaymentId:
        pickZbString(json, ["reference", "transactionReference"]) ?? orderReference,
      status: mapped,
      amountCents: amountCents ?? undefined,
      failureReason: mapped === "PAID" ? null : mapped.toLowerCase()
    };
  }

  async handleWebhook(input: {
    headers: Record<string, string | string[] | undefined>;
    rawBody: Buffer | string;
    body: unknown;
  }): Promise<ProviderWebhookResult | null> {
    void input.headers;
    const payload = parseCallbackBody(input.body) ?? parseCallbackBody(input.rawBody.toString("utf8"));
    if (!payload) return null;

    const orderReference = pickZbString(payload, ["orderReference"]);
    if (!orderReference) return null;

    const paymentOption = pickZbString(payload, ["paymentOption", "paymentMethod"]);
    if (paymentOption && paymentOption.toUpperCase() !== "ECOCASH") return null;

    let verified: ProviderPaymentStatus | null = null;
    try {
      verified = await this.getPaymentStatusByOrderReference(orderReference);
    } catch {
      // Acknowledge webhook; never mark PAID without status/check.
      return null;
    }
    if (!verified || verified.status === "PENDING") return null;

    const amountCents = zbCentsFromAmount(payload.amount) ?? verified.amountCents;
    if (amountCents == null) return null;

    const currencyOk = isZbUsdCurrency({
      currency: pickZbString(payload, ["currency"]),
      currencyCode: pickZbString(payload, ["currencyCode"])
    });
    if (verified.status === "PAID" && !currencyOk) return null;

    return {
      providerPaymentId:
        pickZbString(payload, ["reference"]) ?? verified.providerPaymentId ?? orderReference,
      commerceOrderId: "",
      amountCents,
      status: verified.status,
      failureReason: verified.status === "PAID" ? null : verified.failureReason,
      merchantReference: orderReference
    };
  }
}
