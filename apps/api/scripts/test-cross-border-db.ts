/**
 * Disposable-database verification for cross-border shopping.
 * Refuses every database except postgresql://127.0.0.1:5435/duts_cb17.
 * ZB calls stay inside the test fetch hook. No live provider traffic.
 *
 * Run: npx tsx scripts/test-cross-border-db.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

const databaseUrl = "postgresql://postgres:postgres@127.0.0.1:5436/duts_cb18";
const database = new URL(databaseUrl);
if (database.hostname !== "127.0.0.1" || database.port !== "5436" || database.pathname !== "/duts_cb18") {
  throw new Error("Cross-border verification refuses to leave the disposable database.");
}

process.env.DATABASE_URL = databaseUrl;
process.env.NODE_ENV = "test";
process.env.APP_ENV = "test";
process.env.JWT_SECRET = "cb17-local-verification-secret-32";
process.env.REDIS_URL = "redis://127.0.0.1:6399";
process.env.API_PUBLIC_URL = "http://127.0.0.1:4000";
process.env.MOBILE_PUBLIC_URL = "http://127.0.0.1:8081";
process.env.ZB_MODE = "sandbox";
process.env.ZB_API_KEY = "cb17-local-key";
process.env.ZB_API_SECRET = "cb17-local-secret-not-live";
process.env.CROSS_BORDER_ENABLED = "true";
process.env.CROSS_BORDER_PAYMENT_LINKS_ENABLED = "false";
process.env.CROSS_BORDER_PAYMENTS_ENABLED = "false";
process.env.SELLER_MARKETPLACE_ENABLED = "false";
process.env.COMMERCE_PAYMENT_PROVIDER = "zb";
process.env.RESEND_API_KEY = "";
process.env.SENDGRID_API_KEY = "";
process.env.EMAIL_FROM = "";
process.env.TWILIO_ACCOUNT_SID = "";
process.env.TWILIO_AUTH_TOKEN = "";
delete process.env.ZB_API_BASE_URL;

const here = fileURLToPath(new URL(".", import.meta.url));
const passed: string[] = [];
const failed: Array<{ name: string; error: string }> = [];

function linksOn(enabled: boolean) {
  process.env.CROSS_BORDER_PAYMENT_LINKS_ENABLED = enabled ? "true" : "false";
}

function paymentsOn(enabled: boolean) {
  process.env.CROSS_BORDER_PAYMENTS_ENABLED = enabled ? "true" : "false";
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
  const { Prisma } = await import("@prisma/client");
  const { prisma } = await import("../src/config/prisma.js");
  const { mapErrorToResponse } = await import("../src/lib/errors.js");
  const { createCrossBorderRouter, crossBorderAdminRouter } = await import("../src/modules/cross-border/routes.js");
  const { hashToken } = await import("../src/modules/cross-border/request.service.js");
  const { applyCrossBorderProviderResult } = await import("../src/modules/cross-border/payment.service.js");
  const { sendCrossBorderQuote } = await import("../src/modules/cross-border/notify.service.js");
  const { tryHandleCrossBorderWhatsApp } = await import("../src/modules/cross-border/whatsapp.js");
  const { crossBorderPaymentsEnabled } = await import("../src/modules/cross-border/flag.js");
  const { MockWhatsAppProvider, setWhatsAppProviderForTests } = await import("../src/modules/whatsapp/provider.js");
  const { getOrCreateConversation, readContext } = await import("../src/modules/whatsapp/conversation.service.js");
  const { WhatsAppParty } = await import("@prisma/client");
  const { setZbFetchForTests } = await import("../src/modules/commerce/payments/zb.transport.js");
  const { applyProviderPaymentResult } = await import("../src/modules/commerce/payments/payment.service.js");

  await prisma.crossBorderRequest.deleteMany();
  await prisma.whatsAppConversation.deleteMany({ where: { phoneNormalized: { contains: "77100990" } } });
  await prisma.user.deleteMany({ where: { email: { in: ["cb17-admin@example.com", "cb17-client@example.com"] } } });
  assert.equal(crossBorderPaymentsEnabled(), false);
  assert.equal(process.env.SELLER_MARKETPLACE_ENABLED, "false");

  const zbCalls: Array<{ url: string; body?: string }> = [];
  let statusPayload: Json = { status: "PENDING", amount: 70, currency: "USD", currencyCode: "840" };
  let transport: "ok" | "timeout" | "http_fail" = "ok";
  setZbFetchForTests(async (url, init) => {
    const href = String(url);
    if (!href.includes("127.0.0.1") && !href.includes("zbnet.zb.co.zw")) {
      throw new Error(`Unexpected ZB host: ${href}`);
    }
    zbCalls.push({ url: href, body: typeof init?.body === "string" ? init.body : undefined });
    if (transport === "timeout") throw new Error("simulated timeout");
    if (href.includes("express-checkout/ecocash")) {
      if (transport === "http_fail") return new Response("{}", { status: 502 });
      const body = JSON.parse(String(init?.body ?? "{}")) as Json;
      return new Response(JSON.stringify({ reference: "ZB-LOCAL-1", orderReference: body.orderReference }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (href.includes("/status/check")) {
      return new Response(JSON.stringify(statusPayload), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("{}", { status: 200 });
  });

  const whatsapp = new MockWhatsAppProvider();
  setWhatsAppProviderForTests(whatsapp);

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
  const base = `http://127.0.0.1:${port}`;

  async function call(path: string, init?: RequestInit) {
    const response = await fetch(`${base}${path}`, init);
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
    data: {
      email: "cb17-admin@example.com",
      fullName: "CB17 Admin",
      roles: ["ADMIN"],
      defaultRole: "ADMIN",
      accountStatus: "ACTIVE"
    }
  });
  const client = await prisma.user.create({
    data: {
      email: "cb17-client@example.com",
      fullName: "CB17 Client",
      roles: ["CLIENT"],
      defaultRole: "CLIENT",
      accountStatus: "ACTIVE"
    }
  });
  const sign = (userId: string, role: "ADMIN" | "CLIENT") =>
    jwt.sign(
      { sub: userId, roles: [role], accountStatus: "ACTIVE", defaultRole: role },
      process.env.JWT_SECRET!,
      { expiresIn: "1h" }
    );
  const adminAuth = { authorization: `Bearer ${sign(admin.id, "ADMIN")}`, "content-type": "application/json" };
  const clientAuth = { authorization: `Bearer ${sign(client.id, "CLIENT")}`, "content-type": "application/json" };

  const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const requestBody = {
    customerName: "Verification Customer",
    phone: "+263771009901",
    email: "cb17-customer@example.com",
    preferredContactChannel: "EMAIL",
    destinationCity: "Harare",
    deliveryAddress: "12 Example Close",
    acceptTerms: true,
    lines: [
      {
        retailer: "SHEIN",
        productUrl: "https://www.shein.com/example-dress",
        productName: "Example dress",
        quantity: 1,
        size: "M",
        color: "Black"
      },
      {
        retailer: "TAKEALOT",
        productUrl: "https://www.takealot.com/example-shoes",
        productName: "Example shoes",
        quantity: 2,
        size: "8",
        color: "White"
      }
    ]
  };

  let requestId = "";
  let reference = "";
  let quoteId = "";
  let paymentLink = "";
  let paymentToken = "";
  let retryToken = "";

  await check("schema migrations and foreign keys", async () => {
    const migrations = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name::text AS migration_name FROM "_prisma_migrations" ORDER BY finished_at ASC
    `;
    const names = migrations.map((row) => row.migration_name);
    const first = names.indexOf("20261114190000_cross_border_shopping");
    const second = names.indexOf("20261114203000_cross_border_one_active_payment");
    assert.ok(first >= 0 && second > first, "cross-border migrations were not applied in order");
    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name::text AS table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name LIKE 'CrossBorder%'
      ORDER BY table_name
    `;
    assert.deepEqual(tables.map((row) => row.table_name), [
      "CrossBorderAuditEvent",
      "CrossBorderNotification",
      "CrossBorderPayment",
      "CrossBorderPaymentToken",
      "CrossBorderQuote",
      "CrossBorderQuoteLine",
      "CrossBorderReferenceCounter",
      "CrossBorderRequest",
      "CrossBorderRequestLine",
      "CrossBorderShipment"
    ]);
    const keys = await prisma.$queryRaw<Array<{ constraint_name: string }>>`
      SELECT constraint_name::text AS constraint_name FROM information_schema.table_constraints
      WHERE constraint_type = 'FOREIGN KEY' AND table_name LIKE 'CrossBorder%'
    `;
    assert.ok(keys.length >= 8, `expected cross-border foreign keys, found ${keys.length}`);
    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname::text AS indexname FROM pg_indexes
      WHERE indexname IN (
        'CrossBorderRequest_reference_key',
        'CrossBorderPayment_one_active_per_request',
        'CrossBorderPayment_one_paid_per_request'
      )
    `;
    assert.equal(indexes.length, 3);
    const shoppingSql = readFileSync(resolve(here, "../prisma/migrations/20261114190000_cross_border_shopping/migration.sql"), "utf8");
    const activeSql = readFileSync(resolve(here, "../prisma/migrations/20261114203000_cross_border_one_active_payment/migration.sql"), "utf8");
    assert.doesNotMatch(`${shoppingSql}\n${activeSql}`, /DROP |CommerceOrder|CommercePayment|ALTER TABLE "(?!CrossBorder)/);
    await assert.rejects(
      prisma.crossBorderRequestLine.create({
        data: {
          requestId: "00000000-0000-4000-8000-000000000099",
          retailer: "SHEIN",
          productUrl: "https://www.shein.com/x",
          productName: "Missing parent",
          quantity: 1
        }
      })
    );
  });

  await check("customer submits two products", async () => {
    const created = await call("/v1/cross-border/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody)
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    requestId = String(created.body?.requestId);
    reference = String(created.body?.reference);
    assert.match(reference, /^CB-\d+$/);
    const stored = await prisma.crossBorderRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: { lines: true }
    });
    assert.equal(stored.lines.length, 2);
    assert.equal(stored.phone, "+263771009901");
    assert.equal(stored.email, "cb17-customer@example.com");
    assert.equal(stored.status, "REQUESTED");
  });

  await check("unique request references under concurrency", async () => {
    const [first, second] = await Promise.all([
      call("/v1/cross-border/requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...requestBody, customerName: "Concurrent A" }) }),
      call("/v1/cross-border/requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...requestBody, customerName: "Concurrent B" }) })
    ]);
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.notEqual(first.body?.reference, second.body?.reference);
  });

  await check("admin quote, approval, and audit", async () => {
    const request = await prisma.crossBorderRequest.findUniqueOrThrow({ where: { id: requestId }, include: { lines: true } });
    const quote = await call(`/v1/admin/cross-border/requests/${requestId}/quotes`, {
      method: "POST",
      headers: adminAuth,
      body: JSON.stringify({
        merchandiseSubtotalCents: 5500,
        saShippingCents: 200,
        crossBorderFreightCents: 300,
        customsCents: 100,
        customsIsEstimate: true,
        serviceFeeCents: 400,
        zimbabweDeliveryCents: 500,
        additionalCents: 0,
        zarMerchandiseCents: 100000,
        exchangeRate: "18.5",
        exchangeRateSource: "staff snapshot",
        exchangeRateAt: new Date().toISOString(),
        expiresAt,
        lines: [
          { requestLineId: request.lines[0]!.id, unitPriceCents: 1500 },
          { requestLineId: request.lines[1]!.id, unitPriceCents: 2000 }
        ]
      })
    });
    assert.equal(quote.status, 201, JSON.stringify(quote.body));
    const saved = quote.body?.quote as Json;
    quoteId = String(saved.id);
    assert.equal(saved.version, 1);
    assert.equal(saved.totalCents, 7000);
    assert.equal(saved.currency, "USD");
    assert.equal(saved.status, "DRAFT");
    const anonymous = await call(`/v1/admin/cross-border/quotes/${quoteId}/payment-link`, { method: "POST", body: "{}" });
    assert.equal(anonymous.status, 401);
    const customer = await call(`/v1/admin/cross-border/quotes/${quoteId}/payment-link`, { method: "POST", headers: clientAuth, body: "{}" });
    assert.equal(customer.status, 403);
    const draftLink = await call(`/v1/admin/cross-border/quotes/${quoteId}/payment-link`, { method: "POST", headers: adminAuth, body: "{}" });
    assert.equal(draftLink.status, 403, JSON.stringify(draftLink.body));
    assert.equal(draftLink.body?.code, "LINKS_DISABLED");
    linksOn(true);
    paymentsOn(false);
    const stillDraft = await call(`/v1/admin/cross-border/quotes/${quoteId}/payment-link`, { method: "POST", headers: adminAuth, body: "{}" });
    assert.equal(stillDraft.status, 409);
    assert.equal(stillDraft.body?.code, "QUOTE_NOT_APPROVED");
    const approved = await call(`/v1/admin/cross-border/quotes/${quoteId}/approve`, { method: "POST", headers: adminAuth, body: "{}" });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    const audits = await prisma.crossBorderAuditEvent.findMany({ where: { requestId }, orderBy: { createdAt: "asc" } });
    assert.ok(audits.some((event) => event.action === "request_created"));
    assert.ok(audits.some((event) => event.action === "quote_drafted"));
    assert.ok(audits.some((event) => event.action === "quote_approved"));
  });

  await check("quotation message does not include a payment link", async () => {
    linksOn(true);
    paymentsOn(false);
    const sent = await sendCrossBorderQuote(quoteId, admin.id);
    assert.equal(sent.sent, false);
    await prisma.crossBorderRequest.update({ where: { id: requestId }, data: { preferredContactChannel: "WHATSAPP" } });
    const delivered = await sendCrossBorderQuote(quoteId, admin.id);
    assert.equal(delivered.sent, true);
    const message = whatsapp.sent.map((item) => item.body ?? "").join("\n");
    assert.match(message, /does not take payment/);
    assert.doesNotMatch(message, /\/pay\/|paymentLink|cb17/);
    const notifications = await prisma.crossBorderNotification.findMany({ where: { quoteId } });
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]?.status, "ACCEPTED");
  });

  await check("generate, copy target, and hashed token", async () => {
    linksOn(true);
    paymentsOn(false);
    const generated = await call(`/v1/admin/cross-border/quotes/${quoteId}/payment-link`, { method: "POST", headers: adminAuth, body: "{}" });
    assert.equal(generated.status, 201, JSON.stringify(generated.body));
    paymentLink = String(generated.body?.paymentLink);
    assert.equal(generated.body?.amountCents, 7000);
    assert.equal(generated.body?.currency, "USD");
    assert.equal(generated.body?.quoteVersion, 1);
    const token = paymentLink.split("/pay/")[1] ?? "";
    paymentToken = token;
    assert.equal(token.length, 43);
    assert.match(token, /^[A-Za-z0-9_-]+$/);
    assert.equal(paymentLink, `http://127.0.0.1:8081/pay/${token}`);
    assert.doesNotMatch(paymentLink, /771009901|example.com|7000|amount/i);
    const stored = await prisma.crossBorderPaymentToken.findFirstOrThrow({ where: { quoteId } });
    assert.equal(stored.tokenHash, hashToken(token));
    assert.equal(stored.tokenHash, createHash("sha256").update(token).digest("hex"));
    assert.notEqual(stored.tokenHash, token);
    const leaked = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n FROM "CrossBorderPaymentToken" WHERE "tokenHash" = ${token}
    `;
    assert.equal(leaked[0]?.n, 0);
    const panel = readFileSync(resolve(here, "../../admin/src/CrossBorderPanel.tsx"), "utf8");
    assert.match(panel, /navigator\.clipboard\.writeText\(staffLink\)/);
    assert.match(panel, /value=\{staffLink\}/);
    const audit = await prisma.crossBorderAuditEvent.findFirst({ where: { requestId, action: "payment_link_generated" } });
    assert.ok(audit);
    assert.equal((audit?.payload as Json | null)?.amountCents, 7000);
  });

  await check("customer can read the quote while payment is off", async () => {
    paymentsOn(false);
    const view = await call(`/v1/cross-border/pay/${paymentToken}`);
    assert.equal(view.status, 200, JSON.stringify(view.body));
    assert.equal(view.body?.totalCents, 7000);
    assert.equal(view.body?.currency, "USD");
    assert.equal(view.body?.quoteVersion, 1);
    assert.equal(view.body?.paymentsEnabled, false);
    assert.equal(view.body?.paymentNotice, "Payment is not yet available.");
    assert.equal((view.body?.methods as Json).ecocash, false);
    assert.equal((view.body?.methods as Json).card, false);
    assert.equal((view.body?.lines as unknown[]).length, 2);
    assert.equal(view.body?.reference, reference);
    const before = zbCalls.length;
    const pay = await call(`/v1/cross-border/pay/${paymentToken}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accept: true, method: "ECOCASH", payerPhone: "0771009901", amountCents: 1 })
    });
    assert.equal(pay.status, 403);
    assert.equal(pay.body?.code, "PAYMENTS_DISABLED");
    assert.equal(zbCalls.length, before);
    const card = await call(`/v1/cross-border/pay/${paymentToken}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accept: true, method: "CARD" })
    });
    assert.equal(card.status, 400);
    assert.equal(card.body?.code, "CARD_NOT_AVAILABLE");
  });

  await check("EcoCash initiation uses the quote amount and CBX callback", async () => {
    paymentsOn(true);
    transport = "ok";
    statusPayload = { status: "PENDING", amount: 70, currency: "USD", currencyCode: "840" };
    const before = zbCalls.length;
    const pay = await call(`/v1/cross-border/pay/${paymentToken}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accept: true, method: "ECOCASH", payerPhone: "0771009902", amountCents: 1 })
    });
    assert.equal(pay.status, 200, JSON.stringify(pay.body));
    assert.equal(pay.body?.status, "PENDING");
    assert.equal(pay.body?.duplicate, false);
    const initiation = zbCalls.slice(before).find((callRecord) => callRecord.url.includes("express-checkout/ecocash"));
    assert.ok(initiation?.body);
    const sent = JSON.parse(initiation.body) as Json;
    assert.equal(sent.amount, 70);
    assert.equal(sent.currencyCode, "840");
    assert.match(String(sent.orderReference), /^CBX-/);
    assert.equal(sent.resultUrl, "http://127.0.0.1:4000/v1/cross-border/payments/zb/callback");
    assert.doesNotMatch(String(sent.resultUrl), /5435|5432/);
    assert.equal(sent.ecocashMobile, "0771009902");
    const row = await prisma.crossBorderPayment.findFirstOrThrow({ where: { requestId, status: "PENDING" } });
    assert.equal(row.amountCents, 7000);
    assert.equal(row.currency, "USD");
    assert.equal(row.quoteVersion, 1);
    assert.equal(row.merchantReference, sent.orderReference);
  });

  await check("a second EcoCash number cannot start another charge", async () => {
    const before = zbCalls.filter((callRecord) => callRecord.url.includes("express-checkout/ecocash")).length;
    const second = await call(`/v1/cross-border/pay/${paymentToken}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accept: true, method: "ECOCASH", payerPhone: "0771009903" })
    });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body?.duplicate, true);
    assert.equal(second.body?.status, "PENDING");
    const after = zbCalls.filter((callRecord) => callRecord.url.includes("express-checkout/ecocash")).length;
    assert.equal(after, before);
    const active = await prisma.crossBorderPayment.count({ where: { requestId, status: { in: ["CREATED", "PENDING"] } } });
    assert.equal(active, 1);
  });

  await check("concurrent initiation leaves one active attempt", async () => {
    const concurrentRequest = await call("/v1/cross-border/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...requestBody, customerName: "Concurrent Payer", email: "cb17-concurrent@example.com" })
    });
    const concurrentId = String(concurrentRequest.body?.requestId);
    const lines = await prisma.crossBorderRequestLine.findMany({ where: { requestId: concurrentId } });
    const quoted = await call(`/v1/admin/cross-border/requests/${concurrentId}/quotes`, {
      method: "POST",
      headers: adminAuth,
      body: JSON.stringify({
        merchandiseSubtotalCents: 5500,
        saShippingCents: 200,
        crossBorderFreightCents: 300,
        customsCents: 100,
        customsIsEstimate: true,
        serviceFeeCents: 400,
        zimbabweDeliveryCents: 500,
        expiresAt,
        lines: [
          { requestLineId: lines[0]!.id, unitPriceCents: 1500 },
          { requestLineId: lines[1]!.id, unitPriceCents: 2000 }
        ]
      })
    });
    const concurrentQuoteId = String((quoted.body?.quote as Json).id);
    await call(`/v1/admin/cross-border/quotes/${concurrentQuoteId}/approve`, { method: "POST", headers: adminAuth, body: "{}" });
    const link = await call(`/v1/admin/cross-border/quotes/${concurrentQuoteId}/payment-link`, { method: "POST", headers: adminAuth, body: "{}" });
    const token = String(link.body?.paymentLink).split("/pay/")[1];
    const before = zbCalls.filter((callRecord) => callRecord.url.includes("express-checkout/ecocash")).length;
    const [first, second] = await Promise.all([
      call(`/v1/cross-border/pay/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accept: true, method: "ECOCASH", payerPhone: "0771009904" }) }),
      call(`/v1/cross-border/pay/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accept: true, method: "ECOCASH", payerPhone: "0771009905" }) })
    ]);
    const statuses = [first.status, second.status].sort();
    assert.ok(statuses.includes(200), JSON.stringify([first.body, second.body]));
    const after = zbCalls.filter((callRecord) => callRecord.url.includes("express-checkout/ecocash")).length;
    assert.equal(after - before, 1);
    const active = await prisma.crossBorderPayment.count({ where: { requestId: concurrentId, status: { in: ["CREATED", "PENDING"] } } });
    assert.equal(active, 1);
  });

  await check("database allows one active and one paid payment", async () => {
    const sample = await prisma.crossBorderPayment.findFirstOrThrow({ where: { requestId } });
    await assert.rejects(
      prisma.crossBorderPayment.create({
        data: {
          requestId: sample.requestId,
          quoteId: sample.quoteId,
          quoteVersion: sample.quoteVersion,
          provider: "zb",
          merchantReference: "CBX-1-SECONDWAITING",
          paymentMethod: "ECOCASH",
          currency: "USD",
          amountCents: sample.amountCents,
          status: "PENDING",
          idempotencyKey: "cb17-second-pending"
        }
      }),
      (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
    );
    await prisma.$transaction(async (tx) => {
      await tx.crossBorderAuditEvent.create({ data: { requestId, action: "rollback_probe" } });
      throw new Error("rollback");
    }).catch((error: unknown) => {
      assert.equal(error instanceof Error ? error.message : "", "rollback");
    });
    const rolled = await prisma.crossBorderAuditEvent.count({ where: { requestId, action: "rollback_probe" } });
    assert.equal(rolled, 0);
  });

  await check("pending, success, duplicate callback, and local isolation", async () => {
    const payment = await prisma.crossBorderPayment.findFirstOrThrow({ where: { requestId, status: "PENDING" } });
    statusPayload = { status: "PENDING", amount: 70, currency: "USD", currencyCode: "840" };
    const pending = await applyCrossBorderProviderResult(payment.merchantReference);
    assert.equal(pending.reason, "PENDING");
    assert.equal((await prisma.crossBorderRequest.findUniqueOrThrow({ where: { id: requestId } })).status, "PAYMENT_PENDING");
    const ordersBefore = await prisma.commerceOrder.count();
    const attemptsBefore = await prisma.commercePaymentAttempt.count();
    const callbackIgnored = await call("/v1/cross-border/payments/zb/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderReference: "LOCAL-ORDER-1", status: "PAID", amount: 70 })
    });
    assert.equal(callbackIgnored.status, 200);
    assert.equal(await prisma.commerceOrder.count(), ordersBefore);
    statusPayload = { status: "SUCCESS", amount: 70, currency: "USD", currencyCode: "840", reference: "ZB-PAID-1" };
    paymentsOn(false);
    const missed = await call(`/v1/admin/cross-border/payments/${payment.id}/reconcile`, { method: "POST", headers: adminAuth, body: "{}" });
    paymentsOn(true);
    assert.equal(missed.status, 200, JSON.stringify(missed.body));
    assert.equal(missed.body?.reason, "PAID");
    const ready = await prisma.crossBorderRequest.findUniqueOrThrow({ where: { id: requestId } });
    assert.equal(ready.status, "READY_TO_PURCHASE");
    const paidRows = await prisma.crossBorderPayment.count({ where: { requestId, status: "PAID" } });
    assert.equal(paidRows, 1);
    const again = await applyCrossBorderProviderResult(payment.merchantReference);
    assert.equal(again.reason, "DUPLICATE");
    assert.equal(await prisma.crossBorderPayment.count({ where: { requestId, status: "PAID" } }), 1);
    await assert.rejects(
      applyProviderPaymentResult({
        providerPaymentId: "ZB-PAID-1",
        commerceOrderId: "",
        amountCents: 7000,
        status: "PAID",
        failureReason: null,
        merchantReference: payment.merchantReference
      }),
      (error: unknown) => (error as { code?: string }).code === "PAYMENT_ATTEMPT_NOT_FOUND"
    );
    assert.equal(await prisma.commerceOrder.count(), ordersBefore);
    assert.equal(await prisma.commercePaymentAttempt.count(), attemptsBefore);
    assert.equal((await prisma.crossBorderRequest.findUniqueOrThrow({ where: { id: requestId } })).status, "READY_TO_PURCHASE");
    const paid = await prisma.crossBorderPayment.findFirstOrThrow({ where: { requestId, status: "PAID" } });
    await assert.rejects(
      prisma.crossBorderPayment.create({
        data: {
          requestId,
          quoteId: paid.quoteId,
          quoteVersion: paid.quoteVersion,
          provider: "zb",
          merchantReference: "CBX-1-SECONDPAID01",
          paymentMethod: "ECOCASH",
          currency: "USD",
          amountCents: paid.amountCents,
          status: "PAID",
          idempotencyKey: "cb17-second-paid"
        }
      }),
      (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
    );
    const duplicate = await prisma.crossBorderPayment.create({
      data: {
        requestId,
        quoteId: paid.quoteId,
        quoteVersion: paid.quoteVersion,
        provider: "zb",
        merchantReference: "CBX-1-LATEFUNDS001",
        paymentMethod: "ECOCASH",
        currency: "USD",
        amountCents: paid.amountCents,
        status: "FAILED",
        idempotencyKey: "cb17-late-funds",
        failureReason: "failed"
      }
    });
    const recorded = await applyCrossBorderProviderResult(duplicate.merchantReference);
    assert.equal(recorded.reason, "DUPLICATE_FUNDS");
    const storedDuplicate = await prisma.crossBorderPayment.findUniqueOrThrow({ where: { id: duplicate.id } });
    assert.equal(storedDuplicate.status, "EXCEPTION");
    assert.equal(storedDuplicate.failureReason, "duplicate_funds");
    const duplicateAudit = await prisma.crossBorderAuditEvent.findFirst({ where: { requestId, action: "duplicate_funds_received" } });
    assert.ok(duplicateAudit);
    assert.equal((await prisma.crossBorderRequest.findUniqueOrThrow({ where: { id: requestId } })).status, "READY_TO_PURCHASE");
    assert.equal(await prisma.crossBorderPayment.count({ where: { requestId, status: "PAID" } }), 1);
  });

  await check("failed payment can be retried once the provider confirms failure", async () => {
    const failedRequest = await call("/v1/cross-border/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...requestBody, customerName: "Retry Customer", email: "cb17-retry@example.com" })
    });
    const failedId = String(failedRequest.body?.requestId);
    const lines = await prisma.crossBorderRequestLine.findMany({ where: { requestId: failedId } });
    const quoted = await call(`/v1/admin/cross-border/requests/${failedId}/quotes`, {
      method: "POST",
      headers: adminAuth,
      body: JSON.stringify({
        merchandiseSubtotalCents: 5500,
        saShippingCents: 200,
        crossBorderFreightCents: 300,
        customsCents: 100,
        customsIsEstimate: true,
        serviceFeeCents: 400,
        zimbabweDeliveryCents: 500,
        expiresAt,
        lines: [
          { requestLineId: lines[0]!.id, unitPriceCents: 1500 },
          { requestLineId: lines[1]!.id, unitPriceCents: 2000 }
        ]
      })
    });
    const failedQuoteId = String((quoted.body?.quote as Json).id);
    await call(`/v1/admin/cross-border/quotes/${failedQuoteId}/approve`, { method: "POST", headers: adminAuth, body: "{}" });
    const link = await call(`/v1/admin/cross-border/quotes/${failedQuoteId}/payment-link`, { method: "POST", headers: adminAuth, body: "{}" });
    const token = String(link.body?.paymentLink).split("/pay/")[1];
    retryToken = token;
    transport = "http_fail";
    const timedOut = await call(`/v1/cross-border/pay/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accept: true, method: "ECOCASH", payerPhone: "0771009906" })
    });
    assert.equal(timedOut.status, 502);
    const failedRow = await prisma.crossBorderPayment.findFirstOrThrow({ where: { requestId: failedId } });
    assert.equal(failedRow.status, "FAILED");
    transport = "ok";
    statusPayload = { status: "FAILED", amount: 70, currency: "USD", currencyCode: "840" };
    const before = zbCalls.filter((callRecord) => callRecord.url.includes("express-checkout/ecocash") && callRecord.body?.includes("0771009907")).length;
    const retried = await call(`/v1/cross-border/pay/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accept: true, method: "ECOCASH", payerPhone: "0771009907" })
    });
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    assert.equal(retried.body?.duplicate, false);
    const after = zbCalls.filter((callRecord) => callRecord.url.includes("express-checkout/ecocash") && callRecord.body?.includes("0771009907")).length;
    assert.equal(after - before, 1);
    const rows = await prisma.crossBorderPayment.findMany({ where: { requestId: failedId } });
    assert.equal(rows.length, 2);
    assert.equal(rows.filter((row) => row.status === "PENDING").length, 1);
  });

  await check("provider timeout does not open a second charge", async () => {
    const payment = await prisma.crossBorderPayment.findFirstOrThrow({
      where: { payerPhone: "+263771009907", status: "PENDING" }
    });
    transport = "timeout";
    const before = zbCalls.filter((callRecord) => callRecord.url.includes("express-checkout/ecocash")).length;
    const direct = await import("../src/modules/cross-border/payment.service.js");
    await assert.rejects(
      direct.acceptAndPayEcoCash({ token: retryToken, payerPhone: "0771009908", accept: true }),
      (error: unknown) => (error as { code?: string }).code === "PAYMENT_RECONCILE_UNAVAILABLE"
    );
    const after = zbCalls.filter((callRecord) => callRecord.url.includes("express-checkout/ecocash")).length;
    assert.equal(after, before);
    assert.equal(await prisma.crossBorderPayment.count({ where: { requestId: payment.requestId, status: "PENDING" } }), 1);
    transport = "ok";
  });

  await check("wrong amount, wrong currency, and unknown references", async () => {
    const unknown = await applyCrossBorderProviderResult("LOCAL-ORDER-9");
    assert.equal(unknown.reason, "not_cross_border");
    const missing = await applyCrossBorderProviderResult("CBX-999-DOESNOTEXIST");
    assert.equal(missing.reason, "not_cross_border");
    const pending = await prisma.crossBorderPayment.findFirstOrThrow({
      where: { status: "PENDING", payerPhone: { in: ["+263771009904", "+263771009905"] } },
      include: { request: true }
    });
    statusPayload = { status: "SUCCESS", amount: 1, currency: "USD", currencyCode: "840" };
    const wrongAmount = await applyCrossBorderProviderResult(pending.merchantReference);
    assert.equal(wrongAmount.reason, "amount");
    const amountRow = await prisma.crossBorderPayment.findUniqueOrThrow({ where: { id: pending.id } });
    assert.equal(amountRow.status, "EXCEPTION");
    assert.notEqual((await prisma.crossBorderRequest.findUniqueOrThrow({ where: { id: pending.requestId } })).status, "READY_TO_PURCHASE");

    transport = "ok";
    statusPayload = { status: "SUCCESS", amount: 70, currency: "ZWL", currencyCode: "932" };
    const currencyPayment = await prisma.crossBorderPayment.findFirstOrThrow({ where: { payerPhone: "+263771009907", status: "PENDING" } });
    const wrongCurrency = await applyCrossBorderProviderResult(currencyPayment.merchantReference);
    assert.equal(wrongCurrency.reason, "PENDING");
    assert.equal((await prisma.crossBorderPayment.findUniqueOrThrow({ where: { id: currencyPayment.id } })).status, "PENDING");
    assert.notEqual((await prisma.crossBorderRequest.findUniqueOrThrow({ where: { id: currencyPayment.requestId } })).status, "READY_TO_PURCHASE");
  });

  await check("expired and superseded links cannot be paid", async () => {
    const created = await call("/v1/cross-border/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...requestBody, customerName: "Expiry Customer", email: "cb17-expiry@example.com" })
    });
    const expiryId = String(created.body?.requestId);
    const lines = await prisma.crossBorderRequestLine.findMany({ where: { requestId: expiryId } });
    const quoted = await call(`/v1/admin/cross-border/requests/${expiryId}/quotes`, {
      method: "POST",
      headers: adminAuth,
      body: JSON.stringify({
        merchandiseSubtotalCents: 5500,
        saShippingCents: 200,
        crossBorderFreightCents: 300,
        customsCents: 100,
        customsIsEstimate: true,
        serviceFeeCents: 400,
        zimbabweDeliveryCents: 500,
        expiresAt,
        lines: [
          { requestLineId: lines[0]!.id, unitPriceCents: 1500 },
          { requestLineId: lines[1]!.id, unitPriceCents: 2000 }
        ]
      })
    });
    const firstQuoteId = String((quoted.body?.quote as Json).id);
    await call(`/v1/admin/cross-border/quotes/${firstQuoteId}/approve`, { method: "POST", headers: adminAuth, body: "{}" });
    const link = await call(`/v1/admin/cross-border/quotes/${firstQuoteId}/payment-link`, { method: "POST", headers: adminAuth, body: "{}" });
    const token = String(link.body?.paymentLink).split("/pay/")[1];
    await prisma.crossBorderQuote.update({ where: { id: firstQuoteId }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    await prisma.crossBorderPaymentToken.updateMany({ where: { quoteId: firstQuoteId }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const expired = await call(`/v1/cross-border/pay/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accept: true, method: "ECOCASH", payerPhone: "0771009901" })
    });
    assert.equal(expired.status, 409);
    assert.equal(expired.body?.code, "QUOTE_EXPIRED");

    const replacementRequest = await call("/v1/cross-border/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...requestBody, customerName: "Version Customer", email: "cb17-version@example.com" })
    });
    const versionId = String(replacementRequest.body?.requestId);
    const versionLines = await prisma.crossBorderRequestLine.findMany({ where: { requestId: versionId } });
    const first = await call(`/v1/admin/cross-border/requests/${versionId}/quotes`, {
      method: "POST",
      headers: adminAuth,
      body: JSON.stringify({
        merchandiseSubtotalCents: 5500,
        saShippingCents: 200,
        crossBorderFreightCents: 300,
        customsCents: 100,
        customsIsEstimate: true,
        serviceFeeCents: 400,
        zimbabweDeliveryCents: 500,
        expiresAt,
        lines: [
          { requestLineId: versionLines[0]!.id, unitPriceCents: 1500 },
          { requestLineId: versionLines[1]!.id, unitPriceCents: 2000 }
        ]
      })
    });
    const oldQuoteId = String((first.body?.quote as Json).id);
    await call(`/v1/admin/cross-border/quotes/${oldQuoteId}/approve`, { method: "POST", headers: adminAuth, body: "{}" });
    const oldLink = await call(`/v1/admin/cross-border/quotes/${oldQuoteId}/payment-link`, { method: "POST", headers: adminAuth, body: "{}" });
    const oldToken = String(oldLink.body?.paymentLink).split("/pay/")[1];
    const second = await call(`/v1/admin/cross-border/requests/${versionId}/quotes`, {
      method: "POST",
      headers: adminAuth,
      body: JSON.stringify({
        merchandiseSubtotalCents: 5500,
        saShippingCents: 200,
        crossBorderFreightCents: 300,
        customsCents: 100,
        customsIsEstimate: true,
        serviceFeeCents: 400,
        zimbabweDeliveryCents: 500,
        expiresAt,
        lines: [
          { requestLineId: versionLines[0]!.id, unitPriceCents: 1500 },
          { requestLineId: versionLines[1]!.id, unitPriceCents: 2000 }
        ]
      })
    });
    assert.equal((second.body?.quote as Json).version, 2);
    assert.equal((await prisma.crossBorderQuote.findUniqueOrThrow({ where: { id: oldQuoteId } })).status, "SUPERSEDED");
    const superseded = await call(`/v1/cross-border/pay/${oldToken}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accept: true, method: "ECOCASH", payerPhone: "0771009901" })
    });
    assert.equal(superseded.status, 409);
    assert.equal(superseded.body?.code, "QUOTE_SUPERSEDED");
    await assert.rejects(
      prisma.crossBorderQuote.create({
        data: {
          requestId: versionId,
          version: 2,
          currency: "USD",
          merchandiseSubtotalCents: 5500,
          saShippingCents: 200,
          crossBorderFreightCents: 300,
          customsCents: 100,
          serviceFeeCents: 400,
          zimbabweDeliveryCents: 500,
          totalCents: 7000,
          expiresAt: new Date(expiresAt),
          status: "DRAFT",
          termsVersion: "cb-terms-2026-11-14",
          createdById: admin.id
        }
      }),
      (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
    );
  });

  await check("WhatsApp intake is separate from local shopping", async () => {
    const local = await getOrCreateConversation("+263771009902", WhatsAppParty.CUSTOMER);
    await prisma.whatsAppConversation.update({
      where: { id: local.id },
      data: { contextJson: { requestedItems: [{ name: "Bread", quantity: 1 }], expectedInput: "NONE" } }
    });
    const blocked = await tryHandleCrossBorderWhatsApp({
      phone: "+263771009902",
      conversationId: local.id,
      ctx: readContext(await prisma.whatsAppConversation.findUniqueOrThrow({ where: { id: local.id } })),
      text: "Shop South Africa"
    });
    assert.equal(blocked.handled, false);
    const stillLocal = readContext(await prisma.whatsAppConversation.findUniqueOrThrow({ where: { id: local.id } }));
    assert.equal(stillLocal.requestedItems?.length, 1);

    process.env.CROSS_BORDER_ENABLED = "false";
    const disabled = await tryHandleCrossBorderWhatsApp({
      phone: "+263771009903",
      conversationId: local.id,
      ctx: {},
      text: "Shop South Africa"
    });
    assert.equal(disabled.handled, false);
    process.env.CROSS_BORDER_ENABLED = "true";

    const conv = await getOrCreateConversation("+263771009904", WhatsAppParty.CUSTOMER);
    const steps = [
      "Shop South Africa",
      "https://www.shein.com/example-dress",
      "1",
      "M",
      "Black",
      "1",
      "https://www.takealot.com/example-shoes",
      "2",
      "skip",
      "skip",
      "2",
      "Harare",
      "12 Example Close",
      "1",
      "WhatsApp Customer",
      "YES"
    ];
    let current = conv;
    for (const text of steps) {
      const result = await tryHandleCrossBorderWhatsApp({
        phone: "+263771009904",
        conversationId: current.id,
        ctx: readContext(current),
        text
      });
      assert.equal(result.handled, true, text);
      current = await prisma.whatsAppConversation.findUniqueOrThrow({ where: { id: current.id } });
    }
    const created = await prisma.crossBorderRequest.findFirstOrThrow({
      where: { phone: "+263771009904", source: "WHATSAPP" },
      include: { lines: true }
    });
    assert.equal(created.lines.length, 2);
    assert.equal(created.customerName, "WhatsApp Customer");
    const replies = whatsapp.sent.map((item) => item.body ?? "").join("\n");
    assert.match(replies, /No payment is taken now/);
    assert.doesNotMatch(replies, /\/pay\//);
  });

  await serverClose(server);
  setZbFetchForTests(null);
  await prisma.$disconnect();
  console.log(JSON.stringify({ passed: passed.length, failed: failed.length, failures: failed }, null, 2));
  if (failed.length) process.exitCode = 1;
}

function serverClose(server: Server) {
  return new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
