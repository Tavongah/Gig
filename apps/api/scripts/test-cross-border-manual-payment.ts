/**
 * Disposable-database checks for staff-attested cross-border payment confirmation.
 * Refuses every database except postgresql://127.0.0.1:5437/duts_cb22.
 * No ZB network calls.
 *
 * Run: npx tsx scripts/test-cross-border-manual-payment.ts
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const databaseUrl = "postgresql://postgres:postgres@127.0.0.1:5437/duts_cb22";
const database = new URL(databaseUrl);
if (database.hostname !== "127.0.0.1" || database.port !== "5437" || database.pathname !== "/duts_cb22") {
  throw new Error("Manual payment verification refuses to leave the disposable database.");
}

process.env.DATABASE_URL = databaseUrl;
process.env.NODE_ENV = "test";
process.env.APP_ENV = "test";
process.env.JWT_SECRET = "cb22-local-verification-secret-32";
process.env.REDIS_URL = "redis://127.0.0.1:6399";
process.env.API_PUBLIC_URL = "http://127.0.0.1:4000";
process.env.MOBILE_PUBLIC_URL = "http://127.0.0.1:8081";
process.env.ZB_MODE = "sandbox";
process.env.ZB_API_KEY = "cb22-local-key";
process.env.ZB_API_SECRET = "cb22-local-secret-not-live";
process.env.CROSS_BORDER_ENABLED = "true";
process.env.CROSS_BORDER_PAYMENT_LINKS_ENABLED = "true";
process.env.CROSS_BORDER_PAYMENTS_ENABLED = "false";
process.env.CROSS_BORDER_MANUAL_PAYMENTS_ENABLED = "false";
process.env.SELLER_MARKETPLACE_ENABLED = "false";
delete process.env.ZB_API_BASE_URL;

const passed: string[] = [];
const failed: Array<{ name: string; error: string }> = [];

function manualOn(enabled: boolean) {
  process.env.CROSS_BORDER_MANUAL_PAYMENTS_ENABLED = enabled ? "true" : "false";
}

async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed.push(name);
    console.log(`PASS ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failed.push({ name, error: message });
    console.error(`FAIL ${name}: ${message}`);
  }
}

type Json = Record<string, unknown>;

async function main() {
  const express = (await import("express")).default;
  const jwt = (await import("jsonwebtoken")).default;
  const { prisma } = await import("../src/config/prisma.js");
  const { mapErrorToResponse } = await import("../src/lib/errors.js");
  const { createCrossBorderRouter, crossBorderAdminRouter } = await import("../src/modules/cross-border/routes.js");
  const { createCrossBorderRequest } = await import("../src/modules/cross-border/request.service.js");
  const { setZbFetchForTests } = await import("../src/modules/commerce/payments/zb.transport.js");
  const { crossBorderPaymentsEnabled } = await import("../src/modules/cross-border/flag.js");

  await prisma.crossBorderRequest.deleteMany();
  await prisma.user.deleteMany({
    where: { email: { in: ["cb22-admin@example.com", "cb22-customer@example.com", "cb22-courier@example.com", "cb22-merchant@example.com"] } }
  });

  let zbCalls = 0;
  setZbFetchForTests(async () => {
    zbCalls += 1;
    throw new Error("manual confirmation must not call ZB");
  });

  const app = express();
  app.use(express.json());
  app.use("/v1/cross-border", createCrossBorderRouter());
  app.use("/v1/admin/cross-border", crossBorderAdminRouter);
  app.use((error: unknown, _req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }, _next: unknown) => {
    const mapped = mapErrorToResponse(error);
    res.status(mapped.status).json(mapped.body);
  });
  const server = createServer(app);
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", () => resolveListen()));
  const port = (server.address() as AddressInfo).port;

  async function call(path: string, init?: RequestInit) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, init);
    const text = await response.text();
    let body: Json | null = null;
    if (text) {
      try {
        body = JSON.parse(text) as Json;
      } catch {
        body = { raw: text };
      }
    }
    return { status: response.status, body };
  }

  const admin = await prisma.user.create({
    data: { email: "cb22-admin@example.com", fullName: "CB22 Admin", roles: ["ADMIN"], defaultRole: "ADMIN", accountStatus: "ACTIVE" }
  });
  const customer = await prisma.user.create({
    data: { email: "cb22-customer@example.com", fullName: "CB22 Customer", roles: ["CLIENT"], defaultRole: "CLIENT", accountStatus: "ACTIVE" }
  });
  const courier = await prisma.user.create({
    data: { email: "cb22-courier@example.com", fullName: "CB22 Courier", roles: ["WORKER"], defaultRole: "WORKER", accountStatus: "ACTIVE" }
  });
  const merchant = await prisma.user.create({
    data: { email: "cb22-merchant@example.com", fullName: "CB22 Merchant", roles: ["CLIENT"], defaultRole: "CLIENT", accountStatus: "ACTIVE" }
  });
  const sign = (userId: string, role: "ADMIN" | "CLIENT" | "WORKER") =>
    jwt.sign({ sub: userId, roles: [role], accountStatus: "ACTIVE", defaultRole: role }, process.env.JWT_SECRET!, { expiresIn: "1h" });
  const auth = (userId: string, role: "ADMIN" | "CLIENT" | "WORKER") => ({
    authorization: `Bearer ${sign(userId, role)}`,
    "content-type": "application/json"
  });
  const adminAuth = auth(admin.id, "ADMIN");

  const ordersBefore = await prisma.commerceOrder.count();
  const gigsBefore = await prisma.gig.count();
  const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const confirmedAt = new Date(Date.now() - 60_000).toISOString();

  async function quotedRequest(name: string) {
    const created = await createCrossBorderRequest({
      customerName: name,
      email: "cb22-shopper@example.com",
      preferredContactChannel: "EMAIL",
      destinationCity: "Harare",
      deliveryAddress: "Gate test address",
      source: "WEB",
      lines: [{
        retailer: "SHEIN",
        productUrl: "https://www.shein.com/cb22-test-item",
        productName: "CB22 test item",
        quantity: 1
      }]
    });
    const requestId = created.request.id;
    const lineId = created.request.lines[0]?.id ?? "";
    assert.ok(lineId);
    const draft = await call(`/v1/admin/cross-border/requests/${requestId}/quotes`, {
      method: "POST",
      headers: adminAuth,
      body: JSON.stringify({
        merchandiseSubtotalCents: 500,
        saShippingCents: 0,
        crossBorderFreightCents: 0,
        customsCents: 0,
        customsIsEstimate: false,
        serviceFeeCents: 0,
        zimbabweDeliveryCents: 0,
        expiresAt,
        lines: [{ requestLineId: lineId, unitPriceCents: 500 }]
      })
    });
    assert.equal(draft.status, 201);
    const quoteId = String((draft.body?.quote as Json).id);
    return { requestId, quoteId, lineId };
  }

  function confirmBody(quoteId: string, reference: string, patch: Json = {}) {
    return JSON.stringify({
      quoteId,
      transactionReference: reference,
      orderReference: null,
      amountCents: 500,
      currency: "USD",
      confirmedAt,
      attested: true,
      ...patch
    });
  }

  const blocked = await quotedRequest("Flag off");
  await check("manual flag off blocks confirmation", async () => {
    manualOn(false);
    const result = await call(`/v1/admin/cross-border/requests/${blocked.requestId}/confirm-external-payment`, {
      method: "POST",
      headers: adminAuth,
      body: confirmBody(blocked.quoteId, "ZB-FLAG-OFF")
    });
    assert.equal(result.status, 403);
    assert.equal(result.body?.code, "MANUAL_PAYMENTS_DISABLED");
  });

  manualOn(true);
  const ready = await quotedRequest("Manual confirm");
  const approved = await call(`/v1/admin/cross-border/quotes/${ready.quoteId}/approve`, { method: "POST", headers: adminAuth, body: "{}" });
  assert.equal(approved.status, 200);

  await check("manual flag on allows admin confirmation", async () => {
    const result = await call(`/v1/admin/cross-border/requests/${ready.requestId}/confirm-external-payment`, {
      method: "POST",
      headers: adminAuth,
      body: confirmBody(ready.quoteId, "ZB-READY-1", { orderReference: "ZB-ORDER-1" })
    });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.equal(result.body?.duplicate, false);
    assert.equal(result.body?.confirmationMethod, "MANUAL_ZB_PORTAL");
    assert.equal(result.body?.requestStatus, "READY_TO_PURCHASE");
    const row = await prisma.crossBorderPayment.findFirst({ where: { requestId: ready.requestId, status: "PAID" } });
    assert.equal(row?.provider, "MANUAL_ZB_PORTAL");
    assert.equal(row?.confirmationMethod, "MANUAL_ZB_PORTAL");
    assert.equal(row?.providerReference, "ZB-READY-1");
    assert.equal(row?.externalOrderReference, "ZB-ORDER-1");
    assert.equal(row?.amountCents, 500);
    assert.equal(row?.confirmedById, admin.id);
    assert.ok(row?.paidAt);
    assert.ok(row?.portalConfirmedAt);
    const audit = await prisma.crossBorderAuditEvent.findFirst({ where: { requestId: ready.requestId, action: "manual_payment_confirmed" } });
    assert.ok(audit);
    assert.equal(zbCalls, 0);
  });

  await check("direct EcoCash remains off", async () => {
    assert.equal(crossBorderPaymentsEnabled(), false);
    const link = await call(`/v1/admin/cross-border/quotes/${ready.quoteId}/payment-link`, { method: "POST", headers: adminAuth, body: "{}" });
    assert.equal(link.status, 201);
    const token = String(link.body?.paymentLink).split("/").pop();
    const pay = await call(`/v1/cross-border/pay/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accept: true, method: "ECOCASH", payerPhone: "0771009901" })
    });
    assert.equal(pay.status, 403);
    assert.equal(pay.body?.code, "PAYMENTS_DISABLED");
    assert.equal(zbCalls, 0);
  });

  await check("customer courier and merchant cannot confirm", async () => {
    const another = await quotedRequest("Forbidden roles");
    await call(`/v1/admin/cross-border/quotes/${another.quoteId}/approve`, { method: "POST", headers: adminAuth, body: "{}" });
    for (const [userId, role] of [[customer.id, "CLIENT"], [courier.id, "WORKER"], [merchant.id, "CLIENT"]] as const) {
      const result = await call(`/v1/admin/cross-border/requests/${another.requestId}/confirm-external-payment`, {
        method: "POST",
        headers: auth(userId, role),
        body: confirmBody(another.quoteId, `ZB-${role}`)
      });
      assert.equal(result.status, 403, role);
    }
    assert.equal(await prisma.crossBorderPayment.count({ where: { requestId: another.requestId } }), 0);
  });

  await check("draft superseded cancelled amount currency and missing reference are rejected", async () => {
    const draft = await quotedRequest("Draft quote");
    const draftResult = await call(`/v1/admin/cross-border/requests/${draft.requestId}/confirm-external-payment`, {
      method: "POST",
      headers: adminAuth,
      body: confirmBody(draft.quoteId, "ZB-DRAFT")
    });
    assert.equal(draftResult.status, 409);
    assert.equal(draftResult.body?.code, "QUOTE_NOT_APPROVED");

    const replaced = await quotedRequest("Superseded quote");
    await call(`/v1/admin/cross-border/quotes/${replaced.quoteId}/approve`, { method: "POST", headers: adminAuth, body: "{}" });
    const second = await call(`/v1/admin/cross-border/requests/${replaced.requestId}/quotes`, {
      method: "POST",
      headers: adminAuth,
      body: JSON.stringify({
        merchandiseSubtotalCents: 500,
        saShippingCents: 0,
        crossBorderFreightCents: 0,
        customsCents: 0,
        customsIsEstimate: false,
        serviceFeeCents: 0,
        zimbabweDeliveryCents: 0,
        expiresAt,
        lines: [{ requestLineId: replaced.lineId, unitPriceCents: 500 }]
      })
    });
    assert.equal(second.status, 201);
    const old = await call(`/v1/admin/cross-border/requests/${replaced.requestId}/confirm-external-payment`, {
      method: "POST",
      headers: adminAuth,
      body: confirmBody(replaced.quoteId, "ZB-OLD")
    });
    assert.equal(old.status, 409);
    assert.equal(old.body?.code, "QUOTE_SUPERSEDED");

    const cancelled = await quotedRequest("Cancelled request");
    await call(`/v1/admin/cross-border/quotes/${cancelled.quoteId}/approve`, { method: "POST", headers: adminAuth, body: "{}" });
    const cancel = await call(`/v1/admin/cross-border/requests/${cancelled.requestId}/status`, {
      method: "POST",
      headers: adminAuth,
      body: JSON.stringify({ status: "CANCELLED" })
    });
    assert.equal(cancel.status, 200);
    const cancelledPay = await call(`/v1/admin/cross-border/requests/${cancelled.requestId}/confirm-external-payment`, {
      method: "POST",
      headers: adminAuth,
      body: confirmBody(cancelled.quoteId, "ZB-CANCELLED")
    });
    assert.equal(cancelledPay.status, 409);
    assert.equal(cancelledPay.body?.code, "REQUEST_CANCELLED");

    const mismatch = await quotedRequest("Amount mismatch");
    await call(`/v1/admin/cross-border/quotes/${mismatch.quoteId}/approve`, { method: "POST", headers: adminAuth, body: "{}" });
    const amount = await call(`/v1/admin/cross-border/requests/${mismatch.requestId}/confirm-external-payment`, {
      method: "POST",
      headers: adminAuth,
      body: confirmBody(mismatch.quoteId, "ZB-AMOUNT", { amountCents: 499 })
    });
    assert.equal(amount.status, 409);
    assert.equal(amount.body?.code, "AMOUNT_MISMATCH");
    const currency = await call(`/v1/admin/cross-border/requests/${mismatch.requestId}/confirm-external-payment`, {
      method: "POST",
      headers: adminAuth,
      body: confirmBody(mismatch.quoteId, "ZB-CURRENCY", { currency: "ZWL" })
    });
    assert.equal(currency.status, 409);
    assert.equal(currency.body?.code, "CURRENCY_MISMATCH");
    const missing = await call(`/v1/admin/cross-border/requests/${mismatch.requestId}/confirm-external-payment`, {
      method: "POST",
      headers: adminAuth,
      body: confirmBody(mismatch.quoteId, "   ")
    });
    assert.equal(missing.status, 400);
    assert.equal(missing.body?.code, "REFERENCE_REQUIRED");
    assert.equal(await prisma.crossBorderPayment.count({ where: { requestId: mismatch.requestId, status: "PAID" } }), 0);
  });

  await check("expired quotation keeps the reported receipt and does not confirm", async () => {
    const expired = await quotedRequest("Expired quote");
    await call(`/v1/admin/cross-border/quotes/${expired.quoteId}/approve`, { method: "POST", headers: adminAuth, body: "{}" });
    await prisma.crossBorderQuote.update({ where: { id: expired.quoteId }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const result = await call(`/v1/admin/cross-border/requests/${expired.requestId}/confirm-external-payment`, {
      method: "POST",
      headers: adminAuth,
      body: confirmBody(expired.quoteId, "ZB-EXPIRED")
    });
    assert.equal(result.status, 409);
    assert.equal(result.body?.code, "QUOTE_EXPIRED");
    const audit = await prisma.crossBorderAuditEvent.findFirst({ where: { requestId: expired.requestId, action: "manual_payment_reported_expired" } });
    assert.ok(audit);
    assert.equal(await prisma.crossBorderPayment.count({ where: { requestId: expired.requestId, status: "PAID" } }), 0);
  });

  const firstRef = await quotedRequest("Reference owner");
  await call(`/v1/admin/cross-border/quotes/${firstRef.quoteId}/approve`, { method: "POST", headers: adminAuth, body: "{}" });
  const firstPay = await call(`/v1/admin/cross-border/requests/${firstRef.requestId}/confirm-external-payment`, {
    method: "POST",
    headers: adminAuth,
    body: confirmBody(firstRef.quoteId, "ZB-SHARED")
  });
  assert.equal(firstPay.status, 201);

  await check("duplicate transaction reference is kept for review", async () => {
    const second = await quotedRequest("Reference conflict");
    await call(`/v1/admin/cross-border/quotes/${second.quoteId}/approve`, { method: "POST", headers: adminAuth, body: "{}" });
    const result = await call(`/v1/admin/cross-border/requests/${second.requestId}/confirm-external-payment`, {
      method: "POST",
      headers: adminAuth,
      body: confirmBody(second.quoteId, "ZB-SHARED")
    });
    assert.equal(result.status, 409);
    assert.equal(result.body?.code, "REFERENCE_IN_USE");
    const evidence = await prisma.crossBorderPayment.findFirst({ where: { requestId: second.requestId, status: "EXCEPTION" } });
    assert.equal(evidence?.failureReason, "duplicate_reference");
    assert.equal(await prisma.crossBorderPayment.count({ where: { providerReference: "ZB-SHARED", status: "PAID" } }), 1);
  });

  await check("repeated confirmation is idempotent", async () => {
    const again = await call(`/v1/admin/cross-border/requests/${firstRef.requestId}/confirm-external-payment`, {
      method: "POST",
      headers: adminAuth,
      body: confirmBody(firstRef.quoteId, "ZB-SHARED")
    });
    assert.equal(again.status, 201);
    assert.equal(again.body?.duplicate, true);
    assert.equal(await prisma.crossBorderPayment.count({ where: { requestId: firstRef.requestId, status: "PAID" } }), 1);
  });

  await check("concurrent confirmations create one payment", async () => {
    const concurrent = await quotedRequest("Concurrent");
    await call(`/v1/admin/cross-border/quotes/${concurrent.quoteId}/approve`, { method: "POST", headers: adminAuth, body: "{}" });
    const body = confirmBody(concurrent.quoteId, "ZB-RACE");
    const [left, right] = await Promise.all([
      call(`/v1/admin/cross-border/requests/${concurrent.requestId}/confirm-external-payment`, { method: "POST", headers: adminAuth, body }),
      call(`/v1/admin/cross-border/requests/${concurrent.requestId}/confirm-external-payment`, { method: "POST", headers: adminAuth, body })
    ]);
    assert.ok([left.status, right.status].every((status) => status === 201), `${left.status} ${right.status}`);
    assert.equal(await prisma.crossBorderPayment.count({ where: { requestId: concurrent.requestId, status: "PAID" } }), 1);
    const request = await prisma.crossBorderRequest.findUnique({ where: { id: concurrent.requestId } });
    assert.equal(request?.status, "READY_TO_PURCHASE");
  });

  await check("manual confirmation unlocks procurement once", async () => {
    const purchase = await call(`/v1/admin/cross-border/requests/${ready.requestId}/purchase`, {
      method: "POST",
      headers: adminAuth,
      body: JSON.stringify({
        retailerOrderReference: "RETAILER-CB22",
        purchaseAmountCents: 1000,
        purchaseCurrency: "ZAR",
        purchaseDate: new Date().toISOString(),
        receiptReference: "RECEIPT-CB22"
      })
    });
    assert.equal(purchase.status, 200, JSON.stringify(purchase.body));
    const again = await call(`/v1/admin/cross-border/requests/${ready.requestId}/purchase`, {
      method: "POST",
      headers: adminAuth,
      body: JSON.stringify({
        retailerOrderReference: "RETAILER-CB22-B",
        purchaseAmountCents: 1000,
        purchaseCurrency: "ZAR",
        purchaseDate: new Date().toISOString(),
        receiptReference: "RECEIPT-CB22-B"
      })
    });
    assert.equal(again.status, 409);
    assert.equal(await prisma.gig.count(), gigsBefore);
    assert.equal(await prisma.commerceOrder.count(), ordersBefore);
  });

  await check("api verified payment cannot be duplicated manually", async () => {
    const apiPaid = await quotedRequest("API paid");
    await call(`/v1/admin/cross-border/quotes/${apiPaid.quoteId}/approve`, { method: "POST", headers: adminAuth, body: "{}" });
    await prisma.crossBorderPayment.create({
      data: {
        requestId: apiPaid.requestId,
        quoteId: apiPaid.quoteId,
        quoteVersion: 1,
        provider: "zb",
        providerReference: "ZB-API-VERIFIED",
        merchantReference: "CBX-CB22-API",
        paymentMethod: "ECOCASH",
        currency: "USD",
        amountCents: 500,
        status: "PAID",
        idempotencyKey: "cb22-api-paid",
        paidAt: new Date()
      }
    });
    const result = await call(`/v1/admin/cross-border/requests/${apiPaid.requestId}/confirm-external-payment`, {
      method: "POST",
      headers: adminAuth,
      body: confirmBody(apiPaid.quoteId, "ZB-DIFFERENT")
    });
    assert.equal(result.status, 409);
    assert.equal(result.body?.code, "DUPLICATE_PAYMENT");
    const paid = await prisma.crossBorderPayment.findMany({ where: { requestId: apiPaid.requestId, status: "PAID" } });
    assert.equal(paid.length, 1);
    assert.equal(paid[0]?.provider, "zb");
    assert.equal(paid[0]?.confirmationMethod, null);
    const evidence = await prisma.crossBorderPayment.findFirst({ where: { requestId: apiPaid.requestId, status: "EXCEPTION" } });
    assert.equal(evidence?.confirmationMethod, "MANUAL_ZB_PORTAL");
  });

  await check("manual payment is not treated as a provider verified payment", async () => {
    const payment = await prisma.crossBorderPayment.findFirst({ where: { requestId: ready.requestId, status: "PAID" } });
    const reconcile = await call(`/v1/admin/cross-border/payments/${payment?.id}/reconcile`, { method: "POST", headers: adminAuth, body: "{}" });
    assert.equal(reconcile.status, 409);
    assert.equal(reconcile.body?.code, "NOT_CROSS_BORDER_PAYMENT");
    const dispute = await call(`/v1/admin/cross-border/payments/${payment?.id}/dispute`, {
      method: "POST",
      headers: adminAuth,
      body: JSON.stringify({ reason: "WRONG_REFERENCE", note: "Staff correction" })
    });
    assert.equal(dispute.status, 200, JSON.stringify(dispute.body));
    const after = await prisma.crossBorderPayment.findUnique({ where: { id: payment!.id } });
    assert.equal(after?.status, "PAID");
    const request = await prisma.crossBorderRequest.findUnique({ where: { id: ready.requestId } });
    assert.equal(request?.status, "REFUND_PENDING");
    const history = await prisma.crossBorderAuditEvent.count({ where: { requestId: ready.requestId, action: "manual_payment_dispute_opened" } });
    assert.equal(history, 1);
  });

  await check("local orders and provider calls stay untouched", async () => {
    assert.equal(await prisma.commerceOrder.count(), ordersBefore);
    assert.equal(await prisma.gig.count(), gigsBefore);
    assert.equal(zbCalls, 0);
    assert.equal(process.env.CROSS_BORDER_PAYMENTS_ENABLED, "false");
  });

  await server.close();
  await prisma.$disconnect();
  console.log(`manual payment results: ${passed.length} passed, ${failed.length} failed`);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
