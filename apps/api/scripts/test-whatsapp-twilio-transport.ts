/**
 * Twilio WhatsApp transport adapter tests (testing only).
 * Run: npm run test:whatsapp-twilio --workspace=@gigflow/api
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import type { Express } from "express";
import { Server } from "socket.io";

const here = fileURLToPath(new URL(".", import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });
loadEnv({ path: resolve(here, "../.env") });

if (process.env.GIG_TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.GIG_TEST_DATABASE_URL;
} else if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("duts_gig_dev")) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(/\/[^/?]+(\?|$)/, "/duts_gig_dev$1");
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

let seq = 0;
function mid(prefix: string) {
  seq += 1;
  return `${prefix}${Date.now()}${seq}`;
}

async function withServer<T>(app: Express, fn: (port: number) => Promise<T>): Promise<T> {
  return new Promise((resolvePromise, reject) => {
    const srv = app.listen(0, "127.0.0.1", async () => {
      try {
        const addr = srv.address();
        assert(addr && typeof addr === "object", "listen");
        resolvePromise(await fn(addr.port));
      } catch (e) {
        reject(e);
      } finally {
        srv.close();
      }
    });
  });
}

async function main() {
  process.env.APP_ENV = "test";
  process.env.NODE_ENV = "test";
  process.env.COMMERCE_PAYMENT_METHOD = "CASH";
  process.env.WHATSAPP_DISABLE_AI = "true";
  process.env.API_PUBLIC_URL = "https://example.test";
  process.env.TWILIO_WHATSAPP_WEBHOOK_URL = "https://example.test/v1/whatsapp/twilio";
  process.env.TWILIO_ACCOUNT_SID = "ACtest0000000000000000000000000000";
  process.env.TWILIO_AUTH_TOKEN = "test_auth_token_do_not_log";
  process.env.TWILIO_WHATSAPP_FROM = "whatsapp:+14155238886";
  process.env.WHATSAPP_PROVIDER = "twilio";

  const {
    extractTwilioMessage,
    getExpectedTwilioSignature,
    validateTwilioRequest,
    stripTwilioWhatsAppAddress
  } = await import("../src/modules/whatsapp/twilio-payload.js");
  const {
    TwilioWhatsAppProvider,
    resetWhatsAppProviderForTests,
    setWhatsAppProviderForTests,
    getWhatsAppProvider
  } = await import("../src/modules/whatsapp/provider.js");
  const { createWhatsAppRouter } = await import("../src/modules/whatsapp/whatsapp.routes.js");
  const express = (await import("express")).default;
  const { createMerchant, setMerchantAcceptsOrders, upsertProductForMerchant } = await import(
    "../src/modules/commerce/merchant.service.js"
  );
  const { handleMerchantWhatsAppMessage } = await import(
    "../src/modules/whatsapp/merchant-handler.js"
  );

  console.log("0) Payload normalize…");
  assert(stripTwilioWhatsAppAddress("whatsapp:+263771234567") === "+263771234567", "strip");
  const parsed = extractTwilioMessage({
    MessageSid: "SMabc123",
    From: "whatsapp:+263771111111",
    To: "whatsapp:+14155238886",
    Body: "I need bread",
    ProfileName: "Tariro",
    NumMedia: "1",
    MediaUrl0: "https://example.test/media/1.jpg",
    MediaContentType0: "image/jpeg",
    Latitude: "-17.8252",
    Longitude: "31.0335",
    Address: "Highfield"
  });
  assert(parsed?.providerMessageId === "SMabc123", "sid");
  assert(parsed?.from === "+263771111111", "from");
  assert(parsed?.text === "I need bread", "text");
  assert(parsed?.location?.latitude === -17.8252, "lat");
  assert(parsed?.media?.[0]?.contentType === "image/jpeg", "media meta");

  console.log("1) Signature validation…");
  const webhookUrl = "https://example.test/v1/whatsapp/twilio";
  const form = {
    MessageSid: "SMsig1",
    AccountSid: process.env.TWILIO_ACCOUNT_SID!,
    From: "whatsapp:+263772222222",
    To: "whatsapp:+14155238886",
    Body: "hello",
    NumMedia: "0"
  };
  const goodSig = getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN!, webhookUrl, form);
  assert(
    validateTwilioRequest({
      authToken: process.env.TWILIO_AUTH_TOKEN!,
      signatureHeader: goodSig,
      url: webhookUrl,
      params: form
    }),
    "valid signature"
  );
  assert(
    !validateTwilioRequest({
      authToken: process.env.TWILIO_AUTH_TOKEN!,
      signatureHeader: "bogus",
      url: webhookUrl,
      params: form
    }),
    "invalid signature rejected"
  );

  console.log("2) Outbound uses Twilio Messaging API…");
  resetWhatsAppProviderForTests();
  const outboundCalls: Array<{ url: string; body: string; auth?: string | null }> = [];
  const twilio = new TwilioWhatsAppProvider({
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
    authToken: process.env.TWILIO_AUTH_TOKEN!,
    fromWhatsApp: process.env.TWILIO_WHATSAPP_FROM!,
    fetchImpl: (async (url, init) => {
      const headers = init?.headers as Record<string, string> | undefined;
      outboundCalls.push({
        url: String(url),
        body: String(init?.body ?? ""),
        auth: headers?.Authorization ?? null
      });
      return new Response(JSON.stringify({ sid: "SMout1" }), { status: 201 });
    }) as typeof fetch
  });
  setWhatsAppProviderForTests(twilio);
  assert(getWhatsAppProvider().name === "twilio", "provider name");
  await twilio.sendText("+263773333333", "Milk added. Your total is now $8.70.");
  assert(outboundCalls.length === 1, "one Twilio API call");
  assert(/api\.twilio\.com.*Messages\.json/.test(outboundCalls[0]!.url), "Messages.json");
  assert(outboundCalls[0]!.body.includes("Body="), "form body");
  assert(
    outboundCalls[0]!.body.includes("whatsapp%3A%2B263773333333") ||
      outboundCalls[0]!.body.includes("To=whatsapp"),
    "To whatsapp"
  );
  assert(outboundCalls[0]!.auth?.startsWith("Basic "), "basic auth");
  assert(!outboundCalls[0]!.body.includes(process.env.TWILIO_AUTH_TOKEN!), "token not in body");

  const httpServer = createServer();
  const io = new Server(httpServer);
  const { setSocketServer } = await import("../src/lib/socket.js");
  setSocketServer(io);

  const app = express();
  app.use("/v1/whatsapp/twilio", express.urlencoded({ extended: false }));
  app.use("/v1/whatsapp", createWhatsAppRouter(io));

  console.log("3) HTTP: invalid signature → 403…");
  await withServer(app, async (port) => {
    const r = await fetch(`http://127.0.0.1:${port}/v1/whatsapp/twilio`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Twilio-Signature": "invalid"
      },
      body: new URLSearchParams(form).toString()
    });
    assert(r.status === 403, `expected 403 got ${r.status}`);
  });

  console.log("4) Inbound text → customer conversation…");
  const customerPhone = `+26378${String(Date.now()).slice(-7)}`;
  const merchantPhone = `+26377${String(Date.now()).slice(-7)}`;
  const lat = -17.8665;
  const lng = 30.9925;

  const merchant = await createMerchant({
    name: "Twilio Transport Tuck",
    contactName: "Owner",
    phone: merchantPhone,
    whatsappPhone: merchantPhone,
    locationLabel: "Highfield",
    latitude: lat,
    longitude: lng,
    category: "GROCERY"
  });
  await setMerchantAcceptsOrders(merchant.id, true);
  await upsertProductForMerchant(merchant.id, {
    name: "Bread",
    priceCents: 120,
    available: true,
    searchAliases: ["bread"]
  });

  resetWhatsAppProviderForTests();
  const conversationOutbound: string[] = [];
  const twilioLive = new TwilioWhatsAppProvider({
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
    authToken: process.env.TWILIO_AUTH_TOKEN!,
    fromWhatsApp: process.env.TWILIO_WHATSAPP_FROM!,
    fetchImpl: (async (_url, init) => {
      conversationOutbound.push(String(init?.body ?? ""));
      return new Response(JSON.stringify({ sid: "SMout2" }), { status: 201 });
    }) as typeof fetch
  });
  setWhatsAppProviderForTests(twilioLive);

  const messageSid = mid("SM");
  const inboundParams: Record<string, string> = {
    MessageSid: messageSid,
    AccountSid: process.env.TWILIO_ACCOUNT_SID!,
    From: `whatsapp:${customerPhone}`,
    To: process.env.TWILIO_WHATSAPP_FROM!,
    Body: "hello",
    NumMedia: "0",
    ProfileName: "Customer"
  };
  const inboundSig = getExpectedTwilioSignature(
    process.env.TWILIO_AUTH_TOKEN!,
    webhookUrl,
    inboundParams
  );

  await withServer(app, async (port) => {
    const r = await fetch(`http://127.0.0.1:${port}/v1/whatsapp/twilio`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Twilio-Signature": inboundSig
      },
      body: new URLSearchParams(inboundParams).toString()
    });
    assert(r.status === 200, `inbound status ${r.status}`);
  });
  assert(conversationOutbound.length >= 1, "customer got Twilio outbound");
  assert(
    conversationOutbound.some((b) => /location|shop|cart|buy|deliver/i.test(decodeURIComponent(b))),
    `conversation reply missing: ${conversationOutbound[0]?.slice(0, 160)}`
  );

  console.log("5) Duplicate MessageSid ignored…");
  const beforeDup = conversationOutbound.length;
  await withServer(app, async (port) => {
    const r = await fetch(`http://127.0.0.1:${port}/v1/whatsapp/twilio`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Twilio-Signature": inboundSig
      },
      body: new URLSearchParams(inboundParams).toString()
    });
    assert(r.status === 200, "dup status");
  });
  assert(conversationOutbound.length === beforeDup, "duplicate produced no new outbound");

  console.log("6) Merchant WhatsApp commands route correctly…");
  const mBefore = conversationOutbound.length;
  await handleMerchantWhatsAppMessage(
    {
      providerMessageId: mid("SMm"),
      from: merchantPhone,
      text: "products"
    },
    io
  );
  assert(conversationOutbound.length > mBefore, "merchant products reply via Twilio");
  assert(
    conversationOutbound.some((b) => /bread|product/i.test(decodeURIComponent(b))),
    "merchant catalog reply"
  );

  console.log("7) Unauthorized merchant number rejected…");
  const stranger = `+26379${String(Date.now()).slice(-7)}`;
  const uBefore = conversationOutbound.length;
  const unauth = await handleMerchantWhatsAppMessage(
    {
      providerMessageId: mid("SMu"),
      from: stranger,
      text: "products"
    },
    io
  );
  assert(unauth.unauthorized === true, "unauthorized flag");
  assert(conversationOutbound.length > uBefore, "rejection message sent");
  assert(
    conversationOutbound.some((b) => /not linked|inactive|merchant/i.test(decodeURIComponent(b))),
    "unauthorized copy"
  );

  httpServer.close();
  console.log("✅ Twilio WhatsApp transport tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
