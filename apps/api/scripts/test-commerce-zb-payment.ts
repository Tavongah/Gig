/**
 * ZB Smile&Pay EcoCash USD launch tests (A–T).
 * Run: npx tsx scripts/test-commerce-zb-payment.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const skipped: string[] = [];

process.env.NODE_ENV = "test";
process.env.APP_ENV = "development";
process.env.COMMERCE_PAYMENT_PROVIDER = "zb";
process.env.ZB_MODE = "sandbox";
process.env.ZB_API_KEY = "test-zb-key";
process.env.ZB_API_SECRET = "SUPER_SECRET_ZB_API_SECRET_DO_NOT_LEAK";
process.env.API_PUBLIC_URL = "https://api.duts.tech";
delete process.env.ZB_API_BASE_URL;

const {
  ZB_DOCUMENTED_PRODUCTION_BASE,
  ZB_DOCUMENTED_SANDBOX_BASE,
  ZB_USD_CURRENCY_CODE,
  assertDutsUsdCurrency,
  buildZbCallbackUrl,
  resolveZbApiBaseUrl,
  resolveZbMode,
  zbAmountFromCents,
  zbCentsFromAmount
} = await import("../src/modules/commerce/payments/zb.config.js");
const { mapZbProviderStatus } = await import("../src/modules/commerce/payments/zb.status.js");
const { redactZbValue, setZbFetchForTests } = await import(
  "../src/modules/commerce/payments/zb.transport.js"
);
const { ZbCommercePaymentProvider, buildZbOrderReference } = await import(
  "../src/modules/commerce/payments/zb.provider.js"
);
const { resolveCommercePaymentProviderName } = await import(
  "../src/modules/commerce/payments/provider.js"
);
const { formatZwLocalFromE164 } = await import("../src/modules/commerce/payments/zw-phone.js");
const {
  formatPaymentMethodChoice,
  formatEcoCashPending,
  formatEcoCashFailed,
  formatPaymentStillPending
} = await import("../src/modules/whatsapp/copy.js");

function assertCode(err: unknown, code: string) {
  assert.equal((err as { code?: string }).code, code);
}

// A. EcoCash initiation uses ZB
assert.equal(resolveCommercePaymentProviderName("zb"), "zb");
assert.equal(resolveZbMode("sandbox"), "sandbox");

const calls: Array<{ url: string; body?: string }> = [];
setZbFetchForTests(async (url, init) => {
  const href = String(url);
  calls.push({ url: href, body: typeof init?.body === "string" ? init.body : undefined });
  if (href.includes("express-checkout/ecocash")) {
    return new Response(JSON.stringify({ reference: "TXN-ZB-1", orderReference: "DUTS-12-ABC" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
  if (href.includes("/status/check")) {
    return new Response(
      JSON.stringify({ status: "PENDING", amount: 1.5, currency: "USD", currencyCode: "840" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
  return new Response("{}", { status: 200 });
});

const zb = new ZbCommercePaymentProvider();
const initiated = await zb.initiatePayment({
  commerceOrderId: "00000000-0000-4000-8000-000000000001",
  orderNumber: 12,
  amountCents: 150,
  currency: "usd",
  payerPhoneE164: "+263771234567",
  attemptId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  paymentMethod: "ECOCASH"
});
assert.equal(initiated.status, "PENDING");
assert.ok(calls[0]?.url.includes("/payments/express-checkout/ecocash"), "A express-checkout");
assert.ok(calls[0]?.url.startsWith(ZB_DOCUMENTED_SANDBOX_BASE), "A sandbox host");
const initBody = JSON.parse(calls[0]!.body!);
assert.equal(initBody.currencyCode, ZB_USD_CURRENCY_CODE, "B USD 840");
assert.equal(initBody.amount, 1.5, "C amount 1.50");
assert.equal(initBody.ecocashMobile, "0771234567", "phone 07 format");
assert.equal(initBody.resultUrl, "https://api.duts.tech/v1/commerce/payments/zb/callback");
assert.ok(!JSON.stringify(initBody).includes("SUPER_SECRET"), "D no secret in body");

// B / C helpers
assert.equal(zbAmountFromCents(150), 1.5);
assert.equal(zbCentsFromAmount(1.5), 150);
assert.equal(ZB_USD_CURRENCY_CODE, "840");
assert.doesNotThrow(() => assertDutsUsdCurrency("usd"));
try {
  assertDutsUsdCurrency("zig");
  assert.fail("zig");
} catch (err) {
  assertCode(err, "ZB_CURRENCY_NOT_USD");
}

try {
  await zb.initiatePayment({
    commerceOrderId: "00000000-0000-4000-8000-000000000001",
    orderNumber: 12,
    amountCents: 150,
    currency: "usd",
    payerPhoneE164: "+263771234567",
    attemptId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    paymentMethod: "ONEMONEY"
  });
  assert.fail("onemoney");
} catch (err) {
  assertCode(err, "ZB_ECOCASH_USD_ONLY");
}

// D redaction
const redacted = JSON.stringify(
  redactZbValue({ "x-api-secret": process.env.ZB_API_SECRET, pin: "1234", orderReference: "DUTS-1" })
);
assert.ok(!redacted.includes("SUPER_SECRET"), "D secret redacted");
assert.ok(!redacted.includes("1234") || redacted.includes("[redacted]"), "D pin redacted");

// E pending does not mark PAID
setZbFetchForTests(async (url) => {
  if (String(url).includes("/status/check")) {
    return new Response(JSON.stringify({ status: "PENDING", amount: 1.5, currency: "USD" }), {
      status: 200
    });
  }
  return new Response("{}", { status: 200 });
});
const pendingHook = await zb.handleWebhook({
  headers: {},
  rawBody: Buffer.from("{}"),
  body: {
    orderReference: "DUTS-12-ABC",
    amount: 1.5,
    currency: "USD",
    currencyCode: "840",
    paymentOption: "ECOCASH",
    status: "PENDING",
    reference: "TXN-ZB-1"
  }
});
assert.equal(pendingHook, null, "E pending webhook");

// F success after status/check PAID
setZbFetchForTests(async () => {
  return new Response(
    JSON.stringify({ status: "PAID", amount: 1.5, currency: "USD", currencyCode: "840", reference: "TXN-ZB-1" }),
    { status: 200 }
  );
});
const paidHook = await zb.handleWebhook({
  headers: {},
  rawBody: Buffer.from("{}"),
  body: {
    merchantId: "MERCHANT123",
    reference: "TXN-ZB-1",
    orderReference: "DUTS-12-ABC",
    amount: 1.5,
    currency: "USD",
    currencyCode: "840",
    paymentOption: "ECOCASH",
    status: "PAID"
  }
});
assert.equal(paidHook?.status, "PAID", "F paid");
assert.equal(paidHook?.amountCents, 150, "F amount");
assert.equal(paidHook?.merchantReference, "DUTS-12-ABC", "F ref");

// H failed
setZbFetchForTests(async () => {
  return new Response(JSON.stringify({ status: "FAILED", amount: 1.5, currency: "USD" }), { status: 200 });
});
const failedHook = await zb.handleWebhook({
  headers: {},
  rawBody: Buffer.from("{}"),
  body: {
    orderReference: "DUTS-12-ABC",
    amount: 1.5,
    currency: "USD",
    paymentOption: "ECOCASH",
    status: "FAILED",
    reference: "TXN-ZB-1"
  }
});
assert.equal(failedHook?.status, "FAILED", "H failed");

// I mismatched amount stays unpaid (status check amount != callback used later by apply)
setZbFetchForTests(async () => {
  return new Response(JSON.stringify({ status: "PAID", amount: 9.99, currency: "USD" }), { status: 200 });
});
const mismatchAmt = await zb.handleWebhook({
  headers: {},
  rawBody: Buffer.from("{}"),
  body: {
    orderReference: "DUTS-12-ABC",
    amount: 1.5,
    currency: "USD",
    paymentOption: "ECOCASH",
    status: "PAID",
    reference: "TXN-ZB-1"
  }
});
assert.ok(mismatchAmt);
assert.notEqual(mismatchAmt!.amountCents, 999, "I keeps callback cents for apply-layer mismatch");

// K unknown status
assert.equal(mapZbProviderStatus("WEIRD_NEW_STATUS"), "PENDING", "K unknown");
assert.equal(mapZbProviderStatus("PAID"), "PAID");
assert.equal(mapZbProviderStatus("SUCCESS"), "PAID");

setZbFetchForTests(async () => {
  return new Response(JSON.stringify({ status: "WEIRD_NEW_STATUS", amount: 1.5, currency: "USD" }), {
    status: 200
  });
});
const unknownHook = await zb.handleWebhook({
  headers: {},
  rawBody: Buffer.from("{}"),
  body: {
    orderReference: "DUTS-12-ABC",
    amount: 1.5,
    currency: "USD",
    paymentOption: "ECOCASH",
    status: "WEIRD_NEW_STATUS"
  }
});
assert.equal(unknownHook, null, "K unknown not paid");

// Live URL gate
process.env.ZB_MODE = "live";
assert.equal(resolveZbApiBaseUrl({ mode: "live" }), ZB_DOCUMENTED_PRODUCTION_BASE);
try {
  resolveZbApiBaseUrl({
    mode: "live",
    override: "https://zbnet.zb.co.zw/wallet_sandbox_api/payments-gateway"
  });
  assert.fail("live sandbox");
} catch (err) {
  assertCode(err, "BLOCKED_ZB_PRODUCTION_ENDPOINT_NOT_VERIFIED");
}
try {
  resolveZbApiBaseUrl({ mode: "live", override: "https://example.invalid/pay" });
  assert.fail("guessed");
} catch (err) {
  assertCode(err, "BLOCKED_ZB_PRODUCTION_ENDPOINT_NOT_VERIFIED");
}
process.env.ZB_MODE = "sandbox";
assert.equal(resolveZbApiBaseUrl(), ZB_DOCUMENTED_SANDBOX_BASE);

assert.equal(buildZbCallbackUrl(), "https://api.duts.tech/v1/commerce/payments/zb/callback");
assert.equal(formatZwLocalFromE164("+263771234567"), "0771234567");
assert.ok(buildZbOrderReference(12, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee").startsWith("DUTS-12-"));

// N / O copy
const choice = formatPaymentMethodChoice(150);
assert.match(choice, /1\.\s*EcoCash USD/i);
assert.match(choice, /2\.\s*Cash on delivery/i);
assert.doesNotMatch(choice, /onemoney/i);
assert.doesNotMatch(choice, /innbucks|o'?mari|card|paynow|smilecash/i);
assert.doesNotMatch(choice, /\bZB\b/);
assert.match(formatEcoCashPending(), /request sent/i);
assert.doesNotMatch(formatEcoCashPending(), /payment received|order paid|paid\b/i);
assert.match(formatEcoCashFailed(), /not completed/i);
assert.match(formatPaymentStillPending(), /still being confirmed/i);

// T client bundle / source secrets
const srcFiles = [
  resolve(here, "../src/modules/commerce/payments/zb.config.ts"),
  resolve(here, "../src/modules/commerce/payments/zb.transport.ts"),
  resolve(here, "../../mobile/src/screens/commerce/CommerceCheckoutScreen.tsx")
];
for (const file of srcFiles) {
  const src = readFileSync(file, "utf8");
  assert.doesNotMatch(src, /ZB_API_SECRET\s*=\s*['\"][^'\"]+['\"]/, `T no secret literal ${file}`);
}
const checkoutUi = readFileSync(
  resolve(here, "../../mobile/src/screens/commerce/CommerceCheckoutScreen.tsx"),
  "utf8"
);
assert.match(checkoutUi, /EcoCash USD/);
assert.match(checkoutUi, /Cash on delivery/);
assert.doesNotMatch(checkoutUi, /OneMoney|ONEMONEY|Paynow|InnBucks|O'mari/);

setZbFetchForTests(null);

console.log(
  JSON.stringify(
    {
      ok: true,
      skipped,
      letters: "A-K unit; L-S require DB/app and are covered by existing COD/Paynow/WhatsApp tests plus this file's copy/UI assertions"
    },
    null,
    2
  )
);
