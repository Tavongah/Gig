/**
 * Cross-border shopping rules. No database and no live payment provider.
 * Run: npx tsx scripts/test-cross-border.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { crossBorderEnabled, crossBorderPaymentLinksEnabled, crossBorderPaymentsEnabled } from "../src/modules/cross-border/flag.js";
import { duplicateFundsAction, paymentLinkBlockReason, planPaymentInitiation } from "../src/modules/cross-border/payment-policy.js";
import {
  assertPublicProductUrl,
  canTransition,
  crossBorderMerchantReference,
  customerStatusMessage,
  decidePaymentOutcome,
  isCrossBorderEntry,
  lineTotalCents,
  localDeliveryCoverage,
  normalizeContactPhone,
  normalizeCustomer,
  normalizeEmail,
  normalizeLines,
  quoteTotalCents,
  reduceCrossBorderDraft,
  shouldEnterCrossBorder,
  CROSS_BORDER_CALLBACK_PATH
} from "../src/modules/cross-border/domain.js";

const now = new Date("2026-11-14T12:00:00.000Z");
const later = new Date("2026-11-16T12:00:00.000Z");

assert.equal(quoteTotalCents({
  merchandiseSubtotalCents: 350,
  saShippingCents: 100,
  crossBorderFreightCents: 200,
  customsCents: 50,
  serviceFeeCents: 75,
  zimbabweDeliveryCents: 100,
  additionalCents: 25
}), 900);
assert.throws(() => quoteTotalCents({
  merchandiseSubtotalCents: 1.5,
  saShippingCents: 0,
  crossBorderFreightCents: 0,
  customsCents: 0,
  serviceFeeCents: 0,
  zimbabweDeliveryCents: 0,
  additionalCents: 0
}));
assert.equal(lineTotalCents(175, 2), 350);

assert.equal(normalizeContactPhone("0772123456"), "+263772123456");
assert.equal(normalizeContactPhone("not a phone"), null);
assert.equal(normalizeEmail("Person@Example.com"), "person@example.com");
assert.equal(normalizeEmail("bad"), null);
const both = normalizeCustomer({
  customerName: "Amina",
  phone: "0772123456",
  email: "amina@example.com",
  preferredContactChannel: "EMAIL",
  destinationCity: "Harare",
  deliveryAddress: "Avondale shops"
});
assert.equal(both.preferredContactChannel, "EMAIL");
assert.throws(() => normalizeCustomer({
  customerName: "Amina",
  destinationCity: "Harare",
  deliveryAddress: "Avondale shops"
}));

assert.equal(assertPublicProductUrl("https://www.shein.com/item/123"), "https://www.shein.com/item/123");
assert.throws(() => assertPublicProductUrl("http://169.254.169.254/latest"));
assert.throws(() => assertPublicProductUrl("https://localhost/admin"));
assert.throws(() => assertPublicProductUrl("file:///etc/passwd"));
const lines = normalizeLines([
  { retailer: "SHEIN", productUrl: "https://shein.com/a", productName: "Dress", quantity: 2, size: "M", color: "Red", variantDetails: "bow" },
  { retailer: "TAKEALOT", productUrl: "https://www.takealot.com/b", productName: "Kettle", quantity: 1 }
]);
assert.equal(lines[0].size, "M");
assert.equal(lines[0].color, "Red");
assert.equal(lines[0].variantDetails, "bow");
assert.equal(lines[1].quantity, 1);

assert.equal(canTransition("REQUESTED", "PURCHASED"), false);
assert.equal(canTransition("READY_TO_PURCHASE", "PURCHASED"), true);
assert.equal(canTransition("PAYMENT_PENDING", "PAID"), true);
assert.equal(localDeliveryCoverage("Gweru"), "SUPPORTED");
assert.equal(localDeliveryCoverage("Bulawayo"), "STAFF_CONFIRM");

const basePay = {
  paymentStatus: "PENDING" as const,
  paymentAmountCents: 900,
  paymentCurrency: "USD",
  paymentQuoteVersion: 1,
  paymentCreatedAt: now,
  providerStatus: "PAID" as const,
  providerAmountCents: 900,
  providerCurrencyUsd: true,
  quoteStatus: "ACCEPTED" as const,
  quoteVersion: 1,
  quoteTotalCents: 900,
  quoteCurrency: "USD",
  quoteExpiresAt: later,
  now
};
assert.equal(decidePaymentOutcome(basePay).action, "PAID_READY");
assert.equal(decidePaymentOutcome({ ...basePay, paymentStatus: "PAID" }).action, "DUPLICATE");
assert.equal(decidePaymentOutcome({ ...basePay, providerAmountCents: 100 }).action, "EXCEPTION");
assert.equal((decidePaymentOutcome({ ...basePay, providerAmountCents: 100 }) as { reason?: string }).reason, "amount");
assert.equal((decidePaymentOutcome({ ...basePay, quoteCurrency: "ZAR" }) as { reason?: string }).reason, "currency");
assert.equal((decidePaymentOutcome({ ...basePay, quoteStatus: "SUPERSEDED" }) as { reason?: string }).reason, "quote_not_payable");
assert.equal((decidePaymentOutcome({ ...basePay, paymentQuoteVersion: 2 }) as { reason?: string }).reason, "quote_version");
assert.equal(decidePaymentOutcome({ ...basePay, providerStatus: "PENDING" }).action, "PENDING");
assert.equal(decidePaymentOutcome({ ...basePay, providerStatus: "FAILED" }).action, "FAILED");
assert.equal(decidePaymentOutcome({
  ...basePay,
  now: new Date("2026-11-17T12:00:00.000Z"),
  paymentCreatedAt: now
}).action, "PAID_READY");
assert.equal((decidePaymentOutcome({
  ...basePay,
  paymentCreatedAt: new Date("2026-11-17T12:00:00.000Z"),
  quoteExpiresAt: later,
  now: new Date("2026-11-17T12:00:00.000Z")
}) as { reason?: string }).reason, "expired_or_not_accepted");
assert.equal(crossBorderMerchantReference("CB-1024", "bdd5be44-49ee-40de-b2c8-ec717151619a").startsWith("CBX-1024-"), true);
assert.equal(CROSS_BORDER_CALLBACK_PATH.includes("commerce/payments"), false);

assert.equal(isCrossBorderEntry("Shop South Africa"), true);
assert.equal(shouldEnterCrossBorder({
  enabled: false,
  text: "Shop South Africa",
  draftActive: false,
  protectedTransaction: false,
  expectedInput: "NONE",
  hasBasket: false
}), false);
assert.equal(shouldEnterCrossBorder({
  enabled: true,
  text: "Shop South Africa",
  draftActive: false,
  protectedTransaction: true,
  expectedInput: "NONE",
  hasBasket: false
}), false);
assert.equal(shouldEnterCrossBorder({
  enabled: true,
  text: "Shop South Africa",
  draftActive: false,
  protectedTransaction: false,
  expectedInput: "PAYMENT_METHOD",
  hasBasket: true
}), false);

let draft = reduceCrossBorderDraft(null, "Shop South Africa", "+263772123456", "draft-1").draft;
assert.ok(draft);
let step = reduceCrossBorderDraft(draft, "https://shein.com/dress", "+263772123456", "draft-1");
step = reduceCrossBorderDraft(step.draft, "2", "+263772123456", "draft-1");
step = reduceCrossBorderDraft(step.draft, "M", "+263772123456", "draft-1");
step = reduceCrossBorderDraft(step.draft, "Red", "+263772123456", "draft-1");
assert.match(step.reply, /size M/);
assert.match(step.reply, /colour Red/);
step = reduceCrossBorderDraft(step.draft, "2", "+263772123456", "draft-1");
step = reduceCrossBorderDraft(step.draft, "Harare", "+263772123456", "draft-1");
step = reduceCrossBorderDraft(step.draft, "Avondale shops", "+263772123456", "draft-1");
step = reduceCrossBorderDraft(step.draft, "1", "+263772123456", "draft-1");
step = reduceCrossBorderDraft(step.draft, "Amina", "+263772123456", "draft-1");
const submitted = reduceCrossBorderDraft(step.draft, "YES", "+263772123456", "draft-1");
assert.equal(submitted.submit?.lines[0].size, "M");
assert.equal(submitted.submit?.lines[0].color, "Red");
assert.equal(submitted.submit?.lines[0].quantity, 2);
assert.equal(submitted.submit?.preferredContactChannel, "WHATSAPP");
assert.equal(submitted.submit?.draftId, "draft-1");
const cancelled = reduceCrossBorderDraft(step.draft, "menu", "+263772123456", "draft-1");
assert.equal(cancelled.exitToMenu, true);
assert.equal(cancelled.draft, null);
assert.match(customerStatusMessage("PAID"), /Payment received/);
assert.match(customerStatusMessage("REQUESTED"), /checking the products/);

const root = resolve(import.meta.dirname, "..");
const payment = readFileSync(resolve(root, "src/modules/cross-border/payment.service.ts"), "utf8");
const localCallback = readFileSync(resolve(root, "src/modules/commerce/payments/payments.routes.ts"), "utf8");
const folder = [
  "domain.ts",
  "request.service.ts",
  "quote.service.ts",
  "payment.service.ts",
  "notify.service.ts",
  "fulfillment.service.ts",
  "routes.ts",
  "whatsapp.ts"
].map((name) => readFileSync(resolve(root, "src/modules/cross-border", name), "utf8")).join("\n");
assert.match(payment, /express-checkout\/ecocash/);
assert.match(payment, /CARD_NOT_AVAILABLE|card: false/);
assert.doesNotMatch(payment, /CommerceOrder|prisma\.gig\.create|commerceCheckout/);
assert.doesNotMatch(folder, /prisma\.commerceOrder|prisma\.gig\.create|SELLER_MARKETPLACE_ENABLED\s*=\s*true/);
assert.doesNotMatch(localCallback, /CBX-|cross-border/);
assert.match(readFileSync(resolve(root, "src/modules/cross-border/routes.ts"), "utf8"), /CARD_NOT_AVAILABLE/);

const savedFlags = {
  enabled: process.env.CROSS_BORDER_ENABLED,
  links: process.env.CROSS_BORDER_PAYMENT_LINKS_ENABLED,
  payments: process.env.CROSS_BORDER_PAYMENTS_ENABLED,
  nodeEnv: process.env.NODE_ENV,
  apiUrl: process.env.API_PUBLIC_URL,
  databaseUrl: process.env.DATABASE_URL
};
delete process.env.CROSS_BORDER_ENABLED;
delete process.env.CROSS_BORDER_PAYMENT_LINKS_ENABLED;
delete process.env.CROSS_BORDER_PAYMENTS_ENABLED;
assert.equal(crossBorderEnabled(), false);
assert.equal(crossBorderPaymentLinksEnabled(), false);
assert.equal(crossBorderPaymentsEnabled(), false);
process.env.CROSS_BORDER_ENABLED = "true";
process.env.CROSS_BORDER_PAYMENT_LINKS_ENABLED = "true";
assert.equal(crossBorderPaymentLinksEnabled(), true);
assert.equal(crossBorderPaymentsEnabled(), false);
process.env.CROSS_BORDER_PAYMENTS_ENABLED = "true";
assert.equal(crossBorderPaymentsEnabled(), true);
delete process.env.CROSS_BORDER_ENABLED;
assert.equal(crossBorderPaymentsEnabled(), false);
process.env.CROSS_BORDER_ENABLED = "true";

assert.equal(paymentLinkBlockReason({ linksEnabled: false, quoteStatus: "APPROVED", expiresAt: later, now }), "LINKS_DISABLED");
assert.equal(paymentLinkBlockReason({ linksEnabled: true, quoteStatus: "APPROVED", expiresAt: later, now }), null);
assert.equal(paymentLinkBlockReason({ linksEnabled: true, quoteStatus: "DRAFT", expiresAt: later, now }), "QUOTE_NOT_APPROVED");
assert.equal(paymentLinkBlockReason({ linksEnabled: true, quoteStatus: "SUPERSEDED", expiresAt: later, now }), "QUOTE_SUPERSEDED");
assert.equal(paymentLinkBlockReason({ linksEnabled: true, quoteStatus: "APPROVED", expiresAt: now, now }), "QUOTE_EXPIRED");
assert.equal(planPaymentInitiation({
  paymentsEnabled: true,
  quoteStatus: "APPROVED",
  expiresAt: later,
  now,
  attempts: [{ id: "pending", status: "PENDING", quoteId: "q", quoteVersion: 1, merchantReference: "CBX-8-AAA" }]
}).action, "AWAIT_PENDING");
assert.equal(planPaymentInitiation({
  paymentsEnabled: true,
  quoteStatus: "ACCEPTED",
  expiresAt: later,
  now,
  attempts: [{ id: "failed", status: "FAILED", quoteId: "q", quoteVersion: 1, merchantReference: "CBX-8-AAA" }]
}).action, "CREATE");
assert.equal(planPaymentInitiation({
  paymentsEnabled: false,
  quoteStatus: "APPROVED",
  expiresAt: later,
  now,
  attempts: []
}).action, "BLOCK");
assert.equal(duplicateFundsAction({ providerPaid: true, anotherAttemptPaid: true, thisAttemptPaid: false }), "RECORD_DUPLICATE");
assert.equal(duplicateFundsAction({ providerPaid: true, anotherAttemptPaid: false, thisAttemptPaid: true }), "ALREADY_RECORDED");
assert.equal(decidePaymentOutcome({ ...basePay, paymentStatus: "FAILED" }).action, "PAID_READY");
assert.equal(decidePaymentOutcome({ ...basePay, paymentStatus: "PAID" }).action, "DUPLICATE");
assert.match(payment, /amountCents: view\.quote\.totalCents/);
assert.match(payment, /PAYMENTS_DISABLED/);
assert.match(payment, /duplicate_funds/);
assert.match(payment, /applyCrossBorderProviderResult/);
const notify = readFileSync(resolve(root, "src/modules/cross-border/notify.service.ts"), "utf8");
assert.doesNotMatch(notify, /paymentLink|CrossBorderPaymentToken/);
assert.match(readFileSync(resolve(root, "prisma/migrations/20261114203000_cross_border_one_active_payment/migration.sql"), "utf8"), /one_active_per_request/);
assert.doesNotMatch(readFileSync(resolve(root, "src/modules/commerce/payments/payments.routes.ts"), "utf8"), /crossBorderPayment|CBX-/);
assert.match(readFileSync(resolve(root, "src/modules/cross-border/routes.ts"), "utf8"), /crossBorderPaymentsEnabled\(\)/);
assert.match(readFileSync(resolve(root, "src/modules/cross-border/routes.ts"), "utf8"), /crossBorderPaymentLinksEnabled\(\)/);

const { crossBorderCallbackUrl } = await import("../src/modules/cross-border/payment.service.js");
const { buildZbCallbackUrl } = await import("../src/modules/commerce/payments/zb.config.js");
process.env.NODE_ENV = "production";
process.env.DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5435/duts_cb17";
process.env.API_PUBLIC_URL = "http://127.0.0.1:5435";
assert.throws(() => crossBorderCallbackUrl(), (error: unknown) => (error as { code?: string }).code === "ZB_RESULT_URL_INSECURE");
process.env.API_PUBLIC_URL = "https://127.0.0.1:5435";
assert.throws(() => crossBorderCallbackUrl(), (error: unknown) => (error as { code?: string }).code === "ZB_RESULT_URL_INVALID");
process.env.API_PUBLIC_URL = "https://api.duts.tech";
assert.equal(crossBorderCallbackUrl(), "https://api.duts.tech/v1/cross-border/payments/zb/callback");
assert.equal(buildZbCallbackUrl(), "https://api.duts.tech/v1/commerce/payments/zb/callback");
process.env.NODE_ENV = "test";
process.env.API_PUBLIC_URL = "http://127.0.0.1:4000";
assert.equal(crossBorderCallbackUrl(), "http://127.0.0.1:4000/v1/cross-border/payments/zb/callback");
assert.doesNotMatch(crossBorderCallbackUrl(), /5435|5432/);
for (const [key, value] of Object.entries(savedFlags)) {
  const envKey = key === "enabled" ? "CROSS_BORDER_ENABLED"
    : key === "links" ? "CROSS_BORDER_PAYMENT_LINKS_ENABLED"
    : key === "payments" ? "CROSS_BORDER_PAYMENTS_ENABLED"
    : key === "nodeEnv" ? "NODE_ENV"
    : key === "apiUrl" ? "API_PUBLIC_URL"
    : "DATABASE_URL";
  if (value === undefined) delete process.env[envKey];
  else process.env[envKey] = value;
}

console.log("cross border ok");
