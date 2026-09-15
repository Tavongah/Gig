import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { readFileSync } from "node:fs";

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

async function main() {
  process.env.WHATSAPP_PROVIDER = "mock";
  process.env.COMMERCE_PAYMENT_METHOD = "CASH";
  process.env.COMMERCE_PAYMENT_PROVIDER = "mock";
  process.env.NODE_ENV = "test";
  process.env.APP_ENV = "development";

  const { prisma } = await import("../src/config/prisma.js");
  const { createMerchant, upsertProductForMerchant } = await import(
    "../src/modules/commerce/merchant.service.js"
  );
  const {
    applyProviderPaymentResult,
    initiateEcoCashPaymentForOrder,
    resetCommercePaymentProviderForTests,
    validateZimbabweMobileForEcoCash
  } = await import("../src/modules/commerce/payments/payment.service.js");
  const {
    resetMockCommercePaymentsForTests,
    getMockCommercePaymentRecord
  } = await import("../src/modules/commerce/payments/mock.provider.js");
  const { EcoCashCommercePaymentProvider } = await import(
    "../src/modules/commerce/payments/ecocash.provider.js"
  );
  const { getMockWhatsAppProvider, resetWhatsAppProviderForTests } = await import(
    "../src/modules/whatsapp/provider.js"
  );
  const { handleCustomerWhatsAppMessage } = await import(
    "../src/modules/whatsapp/customer-handler.js"
  );
  const {
    classifyShoppingIntent,
    isClaimPaidIntent,
    isSelectCashIntent,
    isSelectEcoCashIntent
  } = await import("../src/modules/whatsapp/shopping-intent.js");
  const { setSocketServer } = await import("../src/lib/socket.js");

  resetWhatsAppProviderForTests();
  resetCommercePaymentProviderForTests();
  resetMockCommercePaymentsForTests();
  const mock = getMockWhatsAppProvider();
  mock.clear();

  const httpServer = createServer();
  const io = new Server(httpServer);
  setSocketServer(io);

  const suffix = String(Date.now()).slice(-7);
  const merchantPhone = `+26377${suffix}`;
  const customerPhone = `+26378${suffix}`;
  const lat = -17.8665;
  const lng = 30.9925;

  const merchant = await createMerchant({
    name: `EcoCash Test Shop ${suffix}`,
    contactName: "Owner",
    phone: merchantPhone,
    whatsappPhone: merchantPhone,
    locationLabel: "Highfield",
    latitude: lat,
    longitude: lng,
    category: "TUCK_SHOP"
  });
  await upsertProductForMerchant(merchant.id, {
    name: "Lobels Bread White",
    priceCents: 100,
    available: true,
    searchAliases: ["bread"]
  });
  await upsertProductForMerchant(merchant.id, {
    name: "Eggs 6 Pack",
    priceCents: 250,
    available: true,
    searchAliases: ["eggs"]
  });
  await prisma.merchant.updateMany({
    where: { id: { not: merchant.id } },
    data: { acceptsOrders: false }
  });

  async function shopToPaymentChoice() {
    mock.clear();
    await handleCustomerWhatsAppMessage(
      {
        providerMessageId: `eco-loc-${Date.now()}-${Math.random()}`,
        from: customerPhone,
        location: { latitude: lat + 0.001, longitude: lng + 0.001, name: "Home" },
        profileName: "Eco Customer"
      },
      io
    );
    await handleCustomerWhatsAppMessage(
      {
        providerMessageId: `eco-shop-${Date.now()}-${Math.random()}`,
        from: customerPhone,
        text: "1 bread and eggs"
      },
      io
    );
    await handleCustomerWhatsAppMessage(
      {
        providerMessageId: `eco-confirm-${Date.now()}-${Math.random()}`,
        from: customerPhone,
        buttonId: "confirm_order"
      },
      io
    );
  }

  console.log("1) Customer selects EcoCash…");
  assert(isSelectEcoCashIntent("EcoCash"), "select ecocash intent");
  assert(classifyShoppingIntent("EcoCash").kind === "SELECT_ECOCASH", "EcoCash intent");
  await shopToPaymentChoice();
  const choiceMsg = mock.sent.filter((m) => m.to === customerPhone).map((m) => m.body).join("\n");
  assert(/Choose payment method|EcoCash|Cash on delivery/i.test(choiceMsg), "payment choice shown");
  await handleCustomerWhatsAppMessage(
    {
      providerMessageId: `eco-sel-${Date.now()}`,
      from: customerPhone,
      text: "1"
    },
    io
  );
  const askPhone = mock.sent.filter((m) => m.to === customerPhone).pop()?.body ?? "";
  assert(/Enter the EcoCash number/i.test(askPhone), `ask phone: ${askPhone}`);

  console.log("2) Valid Zimbabwe payer number…");
  const okPhone = validateZimbabweMobileForEcoCash("0772123456");
  assert(okPhone.ok && okPhone.e164 === "+263772123456", `normalize ${JSON.stringify(okPhone)}`);

  console.log("3) Invalid phone rejected…");
  const bad = validateZimbabweMobileForEcoCash("12345");
  assert(!bad.ok, "invalid rejected");
  await handleCustomerWhatsAppMessage(
    {
      providerMessageId: `eco-bad-${Date.now()}`,
      from: customerPhone,
      text: "12345"
    },
    io
  );
  assert(
    mock.sent.some((m) => /doesn't look like a Zimbabwe mobile/i.test(m.body)),
    "invalid phone message"
  );

  console.log("4) Mock payment pending…");
  await handleCustomerWhatsAppMessage(
    {
      providerMessageId: `eco-phone-${Date.now()}`,
      from: customerPhone,
      text: "0772123456"
    },
    io
  );
  const pendingMsg = mock.sent.filter((m) => m.to === customerPhone).pop()?.body ?? "";
  assert(/We've sent an EcoCash payment request/i.test(pendingMsg), `pending: ${pendingMsg}`);

  const order = await prisma.commerceOrder.findFirst({
    where: { merchantId: merchant.id },
    orderBy: { createdAt: "desc" },
    include: { paymentAttempts: true }
  });
  assert(order, "order created");
  assert(order.status === "CUSTOMER_CONFIRMED", `status ${order.status}`);
  assert(order.paymentStatus === "PAYMENT_PENDING", `pay status ${order.paymentStatus}`);
  assert(order.paymentMethod === "ECOCASH", `method ${order.paymentMethod}`);
  assert(order.paymentAttempts.length >= 1, "attempt row");
  const attempt = order.paymentAttempts[0]!;
  assert(attempt.status === "PENDING", `attempt ${attempt.status}`);
  assert(attempt.payerPhone === "+263772123456", "normalized payer");
  assert(attempt.providerPaymentId, "providerPaymentId");
  const mockRec = getMockCommercePaymentRecord(attempt.providerPaymentId!);
  assert(mockRec?.status === "PENDING", "mock store pending");

  // Merchant must NOT be notified yet
  assert(
    !mock.sent.some((m) => m.to === merchantPhone && /New DUTS order/i.test(m.body)),
    "merchant not notified before PAID"
  );

  // Second number while pending must not silently replace
  await handleCustomerWhatsAppMessage(
    {
      providerMessageId: `eco-replace-${Date.now()}`,
      from: customerPhone,
      text: "0772987654"
    },
    io
  );
  assert(
    mock.sent.some((m) => /already pending/i.test(m.body)),
    "block silent replace"
  );

  console.log("5) Mock success → order PAID → WhatsApp confirmation…");
  const paid1 = await applyProviderPaymentResult({
    providerPaymentId: attempt.providerPaymentId!,
    commerceOrderId: order.id,
    amountCents: order.totalCents,
    status: "PAID"
  });
  assert(paid1.applied && !paid1.duplicate, "paid applied");
  // Simulate route notify path for customer + merchant
  {
    const { notifyCustomerStatus, notifyMerchantNewOrder } = await import(
      "../src/modules/whatsapp/merchant-handler.js"
    );
    const { formatEcoCashPaid } = await import("../src/modules/whatsapp/copy.js");
    const full = await prisma.commerceOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { merchant: true, items: true, customer: true }
    });
    await notifyCustomerStatus(customerPhone, formatEcoCashPaid());
    await notifyMerchantNewOrder(full);
  }
  const paidOrder = await prisma.commerceOrder.findUniqueOrThrow({ where: { id: order.id } });
  assert(paidOrder.paymentStatus === "PAID", `paid status ${paidOrder.paymentStatus}`);
  assert(paidOrder.status === "MERCHANT_PENDING", `merchant pending ${paidOrder.status}`);
  assert(
    mock.sent.some((m) => m.to === customerPhone && /Payment received/i.test(m.body)),
    "customer paid message"
  );
  assert(
    mock.sent.some((m) => m.to === merchantPhone && /New DUTS order/i.test(m.body)),
    "merchant notified after PAID"
  );

  console.log("6) Mock failure…");
  // New order for failure path
  await handleCustomerWhatsAppMessage(
    { providerMessageId: `eco-so-${Date.now()}`, from: customerPhone, text: "start over" },
    io
  );
  await shopToPaymentChoice();
  await handleCustomerWhatsAppMessage(
    { providerMessageId: `eco-sel2-${Date.now()}`, from: customerPhone, text: "1" },
    io
  );
  await handleCustomerWhatsAppMessage(
    { providerMessageId: `eco-ph2-${Date.now()}`, from: customerPhone, text: "0772111222" },
    io
  );
  const failOrder = await prisma.commerceOrder.findFirst({
    where: { merchantId: merchant.id, paymentStatus: "PAYMENT_PENDING" },
    orderBy: { createdAt: "desc" },
    include: { paymentAttempts: { orderBy: { createdAt: "desc" } } }
  });
  assert(failOrder?.paymentAttempts[0]?.providerPaymentId, "fail order attempt");
  const failRes = await applyProviderPaymentResult({
    providerPaymentId: failOrder!.paymentAttempts[0]!.providerPaymentId!,
    commerceOrderId: failOrder!.id,
    amountCents: failOrder!.totalCents,
    status: "FAILED",
    failureReason: "declined"
  });
  assert(failRes.applied && failRes.status === "FAILED", "failure applied");
  const failOrder2 = await prisma.commerceOrder.findUniqueOrThrow({ where: { id: failOrder!.id } });
  assert(failOrder2.paymentStatus === "PAYMENT_FAILED", "PAYMENT_FAILED");

  console.log("7) Mock expiry…");
  await handleCustomerWhatsAppMessage(
    { providerMessageId: `eco-retry-exp-${Date.now()}`, from: customerPhone, text: "RETRY" },
    io
  );
  await handleCustomerWhatsAppMessage(
    { providerMessageId: `eco-ph3-${Date.now()}`, from: customerPhone, text: "0772333444" },
    io
  );
  const expOrder = await prisma.commerceOrder.findFirst({
    where: { id: failOrder!.id },
    include: { paymentAttempts: { orderBy: { createdAt: "desc" } } }
  });
  const expAttempt = expOrder!.paymentAttempts.find((a) => a.status === "PENDING");
  assert(expAttempt?.providerPaymentId, "expiry attempt");
  const expRes = await applyProviderPaymentResult({
    providerPaymentId: expAttempt!.providerPaymentId!,
    commerceOrderId: expOrder!.id,
    amountCents: expOrder!.totalCents,
    status: "EXPIRED"
  });
  assert(expRes.status === "EXPIRED", "expired");

  console.log("8) RETRY creates a new payment attempt…");
  const beforeRetry = await prisma.commercePaymentAttempt.count({
    where: { commerceOrderId: failOrder!.id }
  });
  await handleCustomerWhatsAppMessage(
    { providerMessageId: `eco-retry2-${Date.now()}`, from: customerPhone, text: "RETRY" },
    io
  );
  await handleCustomerWhatsAppMessage(
    { providerMessageId: `eco-ph4-${Date.now()}`, from: customerPhone, text: "0772555666" },
    io
  );
  const afterRetry = await prisma.commercePaymentAttempt.count({
    where: { commerceOrderId: failOrder!.id }
  });
  assert(afterRetry > beforeRetry, `retry new attempt ${beforeRetry} → ${afterRetry}`);

  console.log("9) CASH fallback still works…");
  await handleCustomerWhatsAppMessage(
    { providerMessageId: `eco-cashfb-${Date.now()}`, from: customerPhone, text: "CASH" },
    io
  );
  const cashOrder = await prisma.commerceOrder.findUniqueOrThrow({ where: { id: failOrder!.id } });
  assert(cashOrder.paymentMethod === "CASH", "cash method");
  assert(cashOrder.paymentStatus === "DUE_ON_DELIVERY", "due on delivery");
  assert(cashOrder.status === "MERCHANT_PENDING", "merchant pending after cash");
  assert(isSelectCashIntent("Cash on delivery"), "cash intent");

  console.log("10) Duplicate webhook idempotency…");
  const dup = await applyProviderPaymentResult({
    providerPaymentId: attempt.providerPaymentId!,
    commerceOrderId: order.id,
    amountCents: order.totalCents,
    status: "PAID"
  });
  assert(dup.duplicate === true && !dup.applied, "duplicate paid ignored");

  console.log("11) Wrong amount rejected…");
  // Fresh pending attempt for mismatch tests
  await handleCustomerWhatsAppMessage(
    { providerMessageId: `eco-so2-${Date.now()}`, from: customerPhone, text: "start over" },
    io
  );
  await shopToPaymentChoice();
  await handleCustomerWhatsAppMessage(
    { providerMessageId: `eco-sel3-${Date.now()}`, from: customerPhone, buttonId: "pay_ecocash" },
    io
  );
  await handleCustomerWhatsAppMessage(
    { providerMessageId: `eco-ph5-${Date.now()}`, from: customerPhone, text: "0772777888" },
    io
  );
  const mismatchOrder = await prisma.commerceOrder.findFirst({
    where: { merchantId: merchant.id, paymentStatus: "PAYMENT_PENDING" },
    orderBy: { createdAt: "desc" },
    include: { paymentAttempts: { orderBy: { createdAt: "desc" } } }
  });
  assert(mismatchOrder, "mismatch order");
  let amountRejected = false;
  try {
    await applyProviderPaymentResult({
      providerPaymentId: mismatchOrder!.paymentAttempts[0]!.providerPaymentId!,
      commerceOrderId: mismatchOrder!.id,
      amountCents: mismatchOrder!.totalCents + 1,
      status: "PAID"
    });
  } catch (e) {
    amountRejected = (e as { code?: string }).code === "PAYMENT_AMOUNT_MISMATCH";
  }
  assert(amountRejected, "wrong amount rejected");

  console.log("12) Wrong order reference rejected…");
  let orderRejected = false;
  try {
    await applyProviderPaymentResult({
      providerPaymentId: mismatchOrder!.paymentAttempts[0]!.providerPaymentId!,
      commerceOrderId: order.id,
      amountCents: mismatchOrder!.totalCents,
      status: "PAID"
    });
  } catch (e) {
    orderRejected = (e as { code?: string }).code === "PAYMENT_ORDER_MISMATCH";
  }
  assert(orderRejected, "wrong order rejected");

  console.log('13) Customer text "I paid" does not mark PAID…');
  assert(isClaimPaidIntent("I paid"), "claim paid intent");
  const beforeClaim = await prisma.commerceOrder.findUniqueOrThrow({
    where: { id: mismatchOrder!.id }
  });
  await handleCustomerWhatsAppMessage(
    { providerMessageId: `eco-claim-${Date.now()}`, from: customerPhone, text: "I paid" },
    io
  );
  const afterClaim = await prisma.commerceOrder.findUniqueOrThrow({
    where: { id: mismatchOrder!.id }
  });
  assert(afterClaim.paymentStatus === beforeClaim.paymentStatus, "claim paid ignored");
  assert(afterClaim.paymentStatus !== "PAID", "still not PAID from chat");

  console.log("14) No PIN/OTP paths exist…");
  const pin = validateZimbabweMobileForEcoCash("0772123456 PIN 1234");
  assert(!pin.ok && /PIN|OTP/i.test(pin.reason), "pin rejected");
  // Never ask customers to enter a PIN/OTP (defensive rejection copy is OK).
  const askPin = /\b(enter|type|send|provide)\s+(your\s+)?(ecocash\s+)?(pin|otp|passcode)\b/i;
  const srcRoot = resolve(here, "../src/modules/commerce/payments");
  const srcWa = resolve(here, "../src/modules/whatsapp");
  const blob =
    readFileSync(resolve(srcRoot, "payment.service.ts"), "utf8") +
    readFileSync(resolve(srcWa, "customer-handler.ts"), "utf8") +
    readFileSync(resolve(srcWa, "copy.ts"), "utf8");
  assert(!askPin.test(blob), "no pin/otp collection prompts");
  assert(
    /Never share your EcoCash PIN or OTP/i.test(
      readFileSync(resolve(srcRoot, "zw-phone.ts"), "utf8")
    ),
    "rejects pin/otp in phone field"
  );

  console.log("15) EcoCash provider stub fail-closed…");
  const stub = new EcoCashCommercePaymentProvider();
  let stubBlocked = false;
  try {
    await stub.handleWebhook({ headers: {}, rawBody: Buffer.from("{}"), body: {} });
  } catch (e) {
    stubBlocked = (e as { code?: string }).code === "ECOCASH_WEBHOOK_DISABLED";
  }
  assert(stubBlocked, "ecocash webhook fail closed");

  // Direct initiate helper sanity
  resetMockCommercePaymentsForTests();
  const direct = await initiateEcoCashPaymentForOrder({
    commerceOrderId: mismatchOrder!.id,
    payerPhoneRaw: "0772999000"
  }).catch((e: { code?: string }) => e);
  // may fail PAYMENT_ALREADY_PENDING — cancel first
  if (direct && typeof direct === "object" && "code" in direct) {
    assert(
      direct.code === "PAYMENT_ALREADY_PENDING" || direct.code === "ALREADY_PAID",
      `initiate guard ${direct.code}`
    );
  }

  console.log("EcoCash commerce payment tests passed.");
  await prisma.$disconnect();
  io.close();
  httpServer.close();
}

main().catch(async (err) => {
  console.error(err);
  try {
    const { prisma } = await import("../src/config/prisma.js");
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
