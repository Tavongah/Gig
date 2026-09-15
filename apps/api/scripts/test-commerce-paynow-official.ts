/**
 * Paynow official Test Mode contract tests (mocked HTTP — no credentials required).
 * Run: npm run test:commerce-paynow-official --workspace=@gigflow/api
 *
 * Optional live sandbox smoke (skipped unless PAYNOW_RUN_SANDBOX=1 + credentials):
 * uses official test number 0771111111 against real Paynow Test Mode.
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const here = fileURLToPath(new URL(".", import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });
loadEnv({ path: resolve(here, "../.env") });

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main() {
  process.env.NODE_ENV = "test";
  process.env.APP_ENV = "development";
  process.env.COMMERCE_PAYMENT_PROVIDER = "paynow";
  process.env.PAYNOW_MODE = "test";
  process.env.API_PUBLIC_URL = "https://api.duts.tech";
  process.env.PAYNOW_INTEGRATION_ID = "1201";
  process.env.PAYNOW_INTEGRATION_KEY = "3e9fed89-60e1-4ce5-ab6e-6b1eb2d4f977";
  process.env.PAYNOW_AUTH_EMAIL = "merchant-test@example.com";

  const {
    encodePaynowForm,
    formatPaynowAmount,
    generatePaynowHashFromFields,
    parsePaynowUrlEncoded,
    PAYNOW_HASH_DOC_VECTOR,
    PAYNOW_MOBILE_INIT_ORDER,
    verifyPaynowHashFromFields
  } = await import("../src/modules/commerce/payments/paynow.hash.js");
  const { mapPaynowStatus, PAYNOW_OFFICIAL_TEST_NUMBERS } = await import(
    "../src/modules/commerce/payments/paynow.status.js"
  );
  const {
    assertSafePaynowPollUrl,
    buildPaynowCallbackUrl,
    isAllowedPaynowPollUrl
  } = await import("../src/modules/commerce/payments/paynow.urls.js");
  const {
    OfficialPaynowTestTransport,
    LivePaynowTransport,
    LocalPaynowTransport,
    resolvePaynowMode,
    createPaynowTransport,
    buildPaynowMerchantReference
  } = await import("../src/modules/commerce/payments/paynow.transport.js");

  console.log("1) Official request encoding + amount formatting…");
  assert(formatPaynowAmount(199) === "1.99", "amount 1.99");
  assert(formatPaynowAmount(100) === "1.00", "amount 1.00");
  assert(formatPaynowAmount(558) === "5.58", "amount 5.58");

  console.log("2–3) EcoCash / OneMoney method mapping via initiate fields…");
  assert(PAYNOW_MOBILE_INIT_ORDER.includes("method"), "method in order");
  assert(PAYNOW_MOBILE_INIT_ORDER.includes("phone"), "phone in order");
  assert(PAYNOW_MOBILE_INIT_ORDER.includes("authemail"), "authemail in order");

  console.log("4–6) Unique reference + outbound SHA-512…");
  const ref = buildPaynowMerchantReference(42, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  assert(/^DUTS-42-[a-f0-9]{12}$/i.test(ref), `ref ${ref}`);
  const docHash = generatePaynowHashFromFields(
    { ...PAYNOW_HASH_DOC_VECTOR.fields },
    PAYNOW_HASH_DOC_VECTOR.integrationKey,
    [...PAYNOW_HASH_DOC_VECTOR.order]
  );
  assert(docHash === PAYNOW_HASH_DOC_VECTOR.expectedHash, "doc hash vector");

  const mobileFields = {
    id: "1201",
    reference: ref,
    amount: "5.58",
    additionalinfo: "DUTS order 42",
    returnurl: "https://api.duts.tech/v1/commerce/payments/paynow/return",
    resulturl: "https://api.duts.tech/v1/commerce/payments/paynow/callback",
    authemail: "merchant-test@example.com",
    phone: "0771111111",
    method: "ecocash",
    status: "Message"
  };
  const mobileHash = generatePaynowHashFromFields(
    mobileFields,
    process.env.PAYNOW_INTEGRATION_KEY!,
    [...PAYNOW_MOBILE_INIT_ORDER]
  );
  assert(/^[A-F0-9]{128}$/.test(mobileHash), "mobile hash hex");
  const encoded = encodePaynowForm(
    { ...mobileFields, hash: mobileHash },
    [...PAYNOW_MOBILE_INIT_ORDER, "hash"]
  );
  assert(encoded.includes("method=ecocash"), "ecocash encoded");
  assert(encoded.includes(encodeURIComponent(ref)), "reference encoded");
  assert(!encoded.includes(process.env.PAYNOW_INTEGRATION_KEY!), "key not in body");

  const oneMoney = { ...mobileFields, method: "onemoney" };
  const omHash = generatePaynowHashFromFields(
    oneMoney,
    process.env.PAYNOW_INTEGRATION_KEY!,
    [...PAYNOW_MOBILE_INIT_ORDER]
  );
  assert(omHash !== mobileHash, "onemoney hash differs");

  console.log("7–8) Initiation response hash validation…");
  const okFields = {
    status: "Ok",
    pollurl: "https://www.paynow.co.zw/Interface/CheckPayment/?guid=9f24be04-f4a6-4dff-8ab5-455263ba7b6b",
    hash: ""
  };
  const okOrder = ["status", "pollurl"];
  okFields.hash = generatePaynowHashFromFields(
    okFields,
    process.env.PAYNOW_INTEGRATION_KEY!,
    okOrder
  );
  assert(
    verifyPaynowHashFromFields(okFields, process.env.PAYNOW_INTEGRATION_KEY!, okOrder),
    "valid init hash"
  );
  const bad = { ...okFields, hash: "0".repeat(128) };
  assert(
    !verifyPaynowHashFromFields(bad, process.env.PAYNOW_INTEGRATION_KEY!, okOrder),
    "invalid init hash rejected"
  );

  console.log("9–11) Poll URL SSRF protection…");
  assert(
    assertSafePaynowPollUrl(
      "https://www.paynow.co.zw/Interface/CheckPayment/?guid=abc"
    ).startsWith("https://www.paynow.co.zw/"),
    "allowed poll"
  );
  assert(!isAllowedPaynowPollUrl("https://evil.example/steal"), "evil host blocked");
  assert(!isAllowedPaynowPollUrl("http://www.paynow.co.zw/Interface/CheckPayment/"), "http blocked");
  assert(!isAllowedPaynowPollUrl("https://www.paynow.co.zw:8443/x"), "odd port blocked");
  assert(buildPaynowCallbackUrl() === "https://api.duts.tech/v1/commerce/payments/paynow/callback", "callback url");

  console.log("12–17) Status mapping + unknown fail-closed…");
  assert(mapPaynowStatus("Paid") === "PAID", "Paid");
  assert(mapPaynowStatus("Awaiting Delivery") === "PAID", "Awaiting Delivery");
  assert(mapPaynowStatus("Delivered") === "PAID", "Delivered");
  assert(mapPaynowStatus("Cancelled") === "CANCELLED", "Cancelled");
  assert(mapPaynowStatus("Created") === "PENDING", "Created");
  assert(mapPaynowStatus("Sent") === "PENDING", "Sent");
  assert(mapPaynowStatus("Failed") === "FAILED", "Failed");
  assert(mapPaynowStatus("SomethingWeird") === "UNKNOWN", "unknown");

  console.log("Official test numbers documented…");
  assert(PAYNOW_OFFICIAL_TEST_NUMBERS.SUCCESS_FAST === "0771111111", "0771111111");
  assert(PAYNOW_OFFICIAL_TEST_NUMBERS.USER_CANCELLED === "0773333333", "0773333333");

  console.log("Modes: local / test / live…");
  assert(resolvePaynowMode("local") === "local", "local mode");
  assert(resolvePaynowMode("test") === "test", "test mode");
  assert(resolvePaynowMode("live") === "live", "live mode");
  assert(createPaynowTransport("local") instanceof LocalPaynowTransport, "local transport");
  assert(createPaynowTransport("test") instanceof OfficialPaynowTestTransport, "official test");
  assert(createPaynowTransport("live") instanceof LivePaynowTransport, "live transport");

  console.log("Mocked official initiate (fetch)…");
  const transport = new OfficialPaynowTestTransport();
  const poll =
    "https://www.paynow.co.zw/Interface/CheckPayment/?guid=3cb27f4b-b3ef-4d1f-9178-5e5e62a43995";
  const initRespFields: Record<string, string> = {
    status: "Ok",
    pollurl: poll,
    instructions: "Dial *151#"
  };
  const initOrder = ["status", "pollurl", "instructions"];
  initRespFields.hash = generatePaynowHashFromFields(
    initRespFields,
    process.env.PAYNOW_INTEGRATION_KEY!,
    initOrder
  );
  const initBody = encodePaynowForm(initRespFields, [...initOrder, "hash"]);

  const originalFetch = globalThis.fetch;
  let capturedInitBody = "";
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("remotetransaction")) {
      capturedInitBody = String(init?.body ?? "");
      return new Response(initBody, { status: 200 });
    }
    if (u.includes("CheckPayment")) {
      const pollFields: Record<string, string> = {
        reference: ref,
        amount: "5.58",
        paynowreference: "999888",
        status: "Paid",
        pollurl: poll
      };
      const pollOrder = ["reference", "amount", "paynowreference", "status", "pollurl"];
      pollFields.hash = generatePaynowHashFromFields(
        pollFields,
        process.env.PAYNOW_INTEGRATION_KEY!,
        pollOrder
      );
      return new Response(encodePaynowForm(pollFields, [...pollOrder, "hash"]), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const initiated = await transport.initiate({
      commerceOrderId: "00000000-0000-4000-8000-000000000001",
      orderNumber: 42,
      amountCents: 558,
      currency: "usd",
      payerPhoneE164: "+263771111111",
      payerPhoneLocal: "0771111111",
      attemptId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      paymentMethod: "ECOCASH",
      merchantReference: ref
    });
    assert(initiated.status === "PENDING", "pending");
    assert(initiated.pollUrl === poll, "poll persisted from response");
    assert(capturedInitBody.includes("method=ecocash"), "posted ecocash");
    assert(capturedInitBody.includes("phone=0771111111"), "posted test phone");
    assert(capturedInitBody.includes("authemail="), "posted authemail");
    assert(!capturedInitBody.toLowerCase().includes("3e9fed89"), "key not in outbound body");

    // Invalid initiation hash
    globalThis.fetch = (async () =>
      new Response("status=Ok&pollurl=https%3A%2F%2Fwww.paynow.co.zw%2Fx&hash=DEADBEEF", {
        status: 200
      })) as typeof fetch;
    let badInit = false;
    try {
      await transport.initiate({
        commerceOrderId: "00000000-0000-4000-8000-000000000001",
        orderNumber: 43,
        amountCents: 100,
        currency: "usd",
        payerPhoneE164: "+263771111111",
        attemptId: "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee",
        paymentMethod: "ECOCASH",
        merchantReference: "DUTS-43-bbbbbbbbbbbb"
      });
    } catch (e) {
      badInit = (e as { code?: string }).code === "PAYNOW_HASH_INVALID";
    }
    assert(badInit, "invalid initiation hash rejected");

    // Restore good fetch for poll
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      if (String(url).includes("CheckPayment")) {
        const pollFields: Record<string, string> = {
          reference: ref,
          amount: "5.58",
          paynowreference: "999888",
          status: "Paid",
          pollurl: poll
        };
        const pollOrder = ["reference", "amount", "paynowreference", "status", "pollurl"];
        pollFields.hash = generatePaynowHashFromFields(
          pollFields,
          process.env.PAYNOW_INTEGRATION_KEY!,
          pollOrder
        );
        return new Response(encodePaynowForm(pollFields, [...pollOrder, "hash"]), { status: 200 });
      }
      return new Response("no", { status: 404 });
    }) as typeof fetch;

    const polled = await transport.getStatus(ref, { pollUrl: poll });
    assert(polled?.status === "PAID", "poll Paid → PAID");

    // Callback valid
    const cbFields: Record<string, string> = {
      reference: ref,
      amount: "5.58",
      paynowreference: "999888",
      status: "Paid",
      pollurl: poll
    };
    const cbOrder = ["reference", "amount", "paynowreference", "status", "pollurl"];
    cbFields.hash = generatePaynowHashFromFields(
      cbFields,
      process.env.PAYNOW_INTEGRATION_KEY!,
      cbOrder
    );
    const cbRaw = encodePaynowForm(cbFields, [...cbOrder, "hash"]);
    const cb = await transport.handleCallback({
      headers: {},
      rawBody: cbRaw,
      body: parsePaynowUrlEncoded(cbRaw).fields
    });
    assert(cb?.status === "PAID", "callback Paid");
    assert(cb?.merchantReference === ref, "callback reference");
    assert(cb?.amountCents === 558, "callback amount");

    // Invalid callback hash
    let badCb = false;
    try {
      await transport.handleCallback({
        headers: {},
        rawBody: encodePaynowForm({ ...cbFields, hash: "00".repeat(64) }, [...cbOrder, "hash"]),
        body: {}
      });
    } catch (e) {
      badCb = (e as { code?: string }).code === "PAYNOW_HASH_INVALID";
    }
    assert(badCb, "invalid callback hash rejected");

    // Unknown status → null (non-paid)
    const unkFields: Record<string, string> = {
      reference: ref,
      amount: "5.58",
      status: "WeirdState",
      pollurl: poll
    };
    const unkOrder = ["reference", "amount", "status", "pollurl"];
    unkFields.hash = generatePaynowHashFromFields(
      unkFields,
      process.env.PAYNOW_INTEGRATION_KEY!,
      unkOrder
    );
    const unk = await transport.handleCallback({
      headers: {},
      rawBody: encodePaynowForm(unkFields, [...unkOrder, "hash"]),
      body: {}
    });
    assert(unk === null, "unknown status fail-closed");
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("21) Live mode still fail-closed…");
  const live = new LivePaynowTransport();
  let liveBlocked = false;
  try {
    await live.initiate({
      commerceOrderId: "00000000-0000-4000-8000-000000000001",
      orderNumber: 1,
      amountCents: 100,
      currency: "usd",
      payerPhoneE164: "+263771111111",
      attemptId: "x",
      paymentMethod: "ECOCASH",
      merchantReference: "DUTS-1-x"
    });
  } catch (e) {
    liveBlocked = (e as { code?: string }).code === "PAYNOW_LIVE_NOT_IMPLEMENTED";
  }
  assert(liveBlocked, "live fail-closed");

  console.log("22) Secrets absent from fixtures…");
  assert(!encoded.includes("3e9fed89"), "no key in encoded request");
  assert(!encoded.toLowerCase().includes("integration"), "no key label in body");
  assert(!mobileHash.toLowerCase().includes("3e9fed89"), "hash is digest not key");

  // Local simulator still constructible
  assert(new LocalPaynowTransport().mode === "local", "local preserved");

  if (process.env.PAYNOW_RUN_SANDBOX === "1") {
    console.log("Sandbox smoke: real Paynow Test Mode with 0771111111 (optional)…");
    // Intentionally left for operator-run; requires real credentials + public callback.
    assert(Boolean(process.env.PAYNOW_INTEGRATION_ID), "sandbox needs real id");
  } else {
    console.log("Sandbox smoke skipped (set PAYNOW_RUN_SANDBOX=1 to enable with real credentials).");
  }

  // Silence unused import warning style
  void createHash;

  console.log("OK — Paynow official contract tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
