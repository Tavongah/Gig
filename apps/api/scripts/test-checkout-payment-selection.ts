/**
 * Regression: order review must NOT show premature cash / duplicate confirm instructions.
 * CONFIRM must open a separate payment-selection message without selecting CASH.
 *
 * Run: npm run test:checkout-payment-selection -w @gigflow/api
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
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

async function main() {
  process.env.NODE_ENV = "test";
  process.env.APP_ENV = "development";
  process.env.WHATSAPP_PROVIDER = "mock";
  process.env.COMMERCE_PAYMENT_PROVIDER = "paynow";
  process.env.PAYNOW_MODE = "local";
  process.env.WHATSAPP_DISABLE_AI = "true";

  const { prisma } = await import("../src/config/prisma.js");
  const { resetWhatsAppProviderForTests, getMockWhatsAppProvider } = await import(
    "../src/modules/whatsapp/provider.js"
  );
  const { handleCustomerWhatsAppMessage } = await import(
    "../src/modules/whatsapp/customer-handler.js"
  );
  const { setSocketServer } = await import("../src/lib/socket.js");
  const { formatOrderCartSummary, formatPaymentMethodChoice } = await import(
    "../src/modules/whatsapp/copy.js"
  );

  resetWhatsAppProviderForTests();
  const mock = getMockWhatsAppProvider();
  mock.clear();
  const httpServer = createServer();
  const io = new Server(httpServer);
  setSocketServer(io);

  const suffix = String(Date.now()).slice(-6);
  const customerPhone = `+2637711${suffix}`;
  const merchantWa = `+2637722${suffix}`;

  // Prefer Meriden test merchant if present; else create a tiny local merchant.
  let merchant = await prisma.merchant.findFirst({
    where: { name: "DUTS Meriden Test Market", isActive: true, acceptsOrders: true }
  });
  if (!merchant) {
    const { createMerchant, upsertProductForMerchant } = await import(
      "../src/modules/commerce/merchant.service.js"
    );
    merchant = await createMerchant({
      name: `Checkout Fix Shop ${suffix}`,
      whatsappPhone: merchantWa,
      locationLabel: "Meriden, CT",
      latitude: 41.5382,
      longitude: -72.807,
      openingHours: "Always open",
      pilotArea: "Meriden, CT",
      notes: "checkout payment selection regression"
    });
    await upsertProductForMerchant(merchant.id, {
      name: "Milk",
      priceCents: 150,
      currency: "usd",
      available: true,
      searchAliases: ["milk"]
    });
  }

  const milk = await prisma.product.findFirstOrThrow({
    where: {
      merchantId: merchant.id,
      archived: false,
      available: true,
      OR: [
        { normalizedName: { contains: "milk" } },
        { name: { contains: "Milk", mode: "insensitive" } }
      ]
    }
  });

  console.log("0) copy: order review has no premature cash / no duplicate confirm lines…");
  const review = formatOrderCartSummary({
    shopName: merchant.name,
    lines: [{ quantity: 1, productName: milk.name, lineTotalCents: milk.priceCents }],
    subtotalCents: milk.priceCents,
    deliveryFeeCents: 348,
    totalCents: milk.priceCents + 348,
    deliveryLabel: "Meriden, CT",
    includeConfirmChoices: true
  });
  assert(!/payment:\s*cash/i.test(review), "no premature cash");
  assert(/confirm order\?/i.test(review), "asks confirm");
  assert(/1\.\s*confirm/i.test(review), "choice 1");
  assert(/2\.\s*change/i.test(review), "choice 2");
  assert(/3\.\s*cancel/i.test(review), "choice 3");
  assert(!/confirm,\s*change,\s*or\s*cancel/i.test(review), "no uppercase command list");
  const payChoice = formatPaymentMethodChoice(milk.priceCents + 348);
  assert(/choose payment/i.test(payChoice), "payment title");
  assert(/1\.\s*ecocash/i.test(payChoice), "ecocash");
  assert(/2\.\s*onemoney/i.test(payChoice), "onemoney");
  assert(/3\.\s*cash on delivery/i.test(payChoice), "cash");

  async function send(text: string, extra?: Partial<Parameters<typeof handleCustomerWhatsAppMessage>[0]>) {
    await handleCustomerWhatsAppMessage(
      {
        providerMessageId: `chk-${Date.now()}-${Math.random()}`,
        from: customerPhone,
        text,
        ...extra
      },
      io
    );
  }

  console.log("1) customer: I want milk → order review…");
  mock.clear();
  await send("hi");
  await send("location", {
    text: undefined,
    location: { latitude: 41.5435, longitude: -72.807, name: "Meriden, CT" }
  });
  await send("I want milk");

  const reviewMsgs = mock.sent.filter((m) => m.to === customerPhone).map((m) => m.body);
  const orderReview = [...reviewMsgs].reverse().find((b) => /your order/i.test(b));
  assert(orderReview, "order review sent");
  assert(/milk/i.test(orderReview!), "milk line");
  assert(/items:/i.test(orderReview!), "items");
  assert(/delivery:/i.test(orderReview!), "delivery");
  assert(/total:/i.test(orderReview!), "total");
  assert(!/payment:\s*cash/i.test(orderReview!), "NO premature cash on delivery");
  assert(!/confirm,\s*change,\s*or\s*cancel/i.test(orderReview!), "NO duplicate CONFIRM list");

  const attemptsBefore = await prisma.commercePaymentAttempt.count({
    where: { commerceOrder: { customerWhatsAppPhone: customerPhone } }
  });
  const merchantMsgsBefore = mock.sent.filter((m) => m.to === merchant.whatsappPhone).length;

  console.log("2) CONFIRM (1) → separate payment selection; CASH not selected…");
  mock.clear();
  await send("1");
  const afterConfirm = mock.sent.filter((m) => m.to === customerPhone).map((m) => m.body);
  const paymentMsg = afterConfirm.find((b) => /choose payment/i.test(b));
  assert(paymentMsg, "payment selection message");
  assert(/1\.\s*ecocash/i.test(paymentMsg!), "ecocash option");
  assert(/2\.\s*onemoney/i.test(paymentMsg!), "onemoney option");
  assert(/3\.\s*cash/i.test(paymentMsg!), "cash option");
  assert(!/payment:\s*cash on delivery/i.test(paymentMsg!), "still no premature cash line");

  const orders = await prisma.commerceOrder.findMany({
    where: { customerWhatsAppPhone: customerPhone },
    orderBy: { createdAt: "desc" },
    take: 3
  });
  assert(orders.length === 0, "CONFIRM alone must not create order/select CASH");
  const attemptsAfter = await prisma.commercePaymentAttempt.count({
    where: { commerceOrder: { customerWhatsAppPhone: customerPhone } }
  });
  assert(attemptsAfter === attemptsBefore, "no Paynow attempt on CONFIRM");
  assert(
    mock.sent.filter((m) => m.to === merchant.whatsappPhone).length === 0,
    "no merchant notify on CONFIRM"
  );
  void merchantMsgsBefore;

  console.log("3) CHANGE returns to cart; CANCEL cancels; EcoCash asks phone…");
  // Fresh customer for CHANGE (must be on order-review, not payment)
  const phoneChange = `+2637712${suffix}`;
  async function sendAs(from: string, text: string, extra?: Partial<Parameters<typeof handleCustomerWhatsAppMessage>[0]>) {
    await handleCustomerWhatsAppMessage(
      {
        providerMessageId: `chk-${Date.now()}-${Math.random()}`,
        from,
        text,
        ...extra
      },
      io
    );
  }
  mock.clear();
  await sendAs(phoneChange, "hi");
  await sendAs(phoneChange, "location", {
    text: undefined,
    location: { latitude: 41.5435, longitude: -72.807, name: "Meriden, CT" }
  });
  await sendAs(phoneChange, "I want milk");
  mock.clear();
  await sendAs(phoneChange, "2");
  const changeMsg = mock.sent.map((m) => m.body).join("\n");
  assert(/add|remove|change/i.test(changeMsg), "change prompts cart edits");

  const phoneCancel = `+2637713${suffix}`;
  mock.clear();
  await sendAs(phoneCancel, "hi");
  await sendAs(phoneCancel, "location", {
    text: undefined,
    location: { latitude: 41.5435, longitude: -72.807, name: "Meriden, CT" }
  });
  await sendAs(phoneCancel, "I want milk");
  mock.clear();
  await sendAs(phoneCancel, "3");
  assert(
    mock.sent.some((m) => /order cancelled/i.test(m.body)),
    "cancel ack"
  );

  const phoneEco = `+2637714${suffix}`;
  mock.clear();
  await sendAs(phoneEco, "hi");
  await sendAs(phoneEco, "location", {
    text: undefined,
    location: { latitude: 41.5435, longitude: -72.807, name: "Meriden, CT" }
  });
  await sendAs(phoneEco, "I want milk");
  await sendAs(phoneEco, "1"); // confirm
  mock.clear();
  await sendAs(phoneEco, "1"); // EcoCash
  assert(
    mock.sent.some((m) => /ecocash/i.test(m.body) && /0771234567|enter the/i.test(m.body)),
    "EcoCash phone prompt"
  );

  // ── Exact production bug: typed "Confirm" / "Cancel" / "Change" must NOT become products
  console.log("4) Exact WA bug: typed Confirm → payment (not product search)…");
  const phoneWordConfirm = `+2637715${suffix}`;
  mock.clear();
  await sendAs(phoneWordConfirm, "hi");
  await sendAs(phoneWordConfirm, "location", {
    text: undefined,
    location: { latitude: 41.5435, longitude: -72.807, name: "Meriden, CT" }
  });
  await sendAs(phoneWordConfirm, "I want milk");
  const reviewBeforeConfirm = mock.sent
    .filter((m) => m.to === phoneWordConfirm)
    .map((m) => m.body)
    .reverse()
    .find((b) => /your order/i.test(b));
  assert(reviewBeforeConfirm, "order review before Confirm");
  assert(!/payment:\s*cash/i.test(reviewBeforeConfirm!), "no premature cash before Confirm");

  mock.clear();
  await sendAs(phoneWordConfirm, "Confirm");
  const afterWordConfirm = mock.sent.filter((m) => m.to === phoneWordConfirm).map((m) => m.body);
  const joinedConfirm = afterWordConfirm.join("\n");
  assert(/choose payment/i.test(joinedConfirm), "Confirm opens payment selection");
  assert(/ecocash/i.test(joinedConfirm), "has EcoCash");
  assert(/onemoney/i.test(joinedConfirm), "has OneMoney");
  assert(/cash on delivery/i.test(joinedConfirm), "has Cash on delivery");
  assert(!/not available right now:\s*confirm/i.test(joinedConfirm), "Confirm is not a product");
  assert(!/couldn'?t find one nearby shop/i.test(joinedConfirm), "no shop-missing for Confirm");
  assert(
    (await prisma.commercePaymentAttempt.count({
      where: { commerceOrder: { customerWhatsAppPhone: phoneWordConfirm } }
    })) === 0,
    "Confirm creates no Paynow attempt"
  );
  assert(
    (await prisma.commerceOrder.count({ where: { customerWhatsAppPhone: phoneWordConfirm } })) === 0,
    "Confirm alone creates no order / does not select CASH"
  );

  console.log("5) Exact WA bug: typed Cancel → cancelled (not product search)…");
  const phoneWordCancel = `+2637716${suffix}`;
  mock.clear();
  await sendAs(phoneWordCancel, "hi");
  await sendAs(phoneWordCancel, "location", {
    text: undefined,
    location: { latitude: 41.5435, longitude: -72.807, name: "Meriden, CT" }
  });
  await sendAs(phoneWordCancel, "I want milk");
  mock.clear();
  await sendAs(phoneWordCancel, "Cancel");
  const afterWordCancel = mock.sent.filter((m) => m.to === phoneWordCancel).map((m) => m.body).join("\n");
  assert(/order cancelled/i.test(afterWordCancel), "Cancel ack");
  assert(!/not available right now:\s*cancel/i.test(afterWordCancel), "Cancel is not a product");
  assert(
    (await prisma.commercePaymentAttempt.count({
      where: { commerceOrder: { customerWhatsAppPhone: phoneWordCancel } }
    })) === 0,
    "Cancel creates no Paynow attempt"
  );
  assert(
    mock.sent.filter((m) => m.to === merchant.whatsappPhone).length === 0,
    "Cancel notifies no merchant"
  );

  console.log("6) Exact WA bug: typed Change → cart edit (not payment / not product)…");
  const phoneWordChange = `+2637717${suffix}`;
  mock.clear();
  await sendAs(phoneWordChange, "hi");
  await sendAs(phoneWordChange, "location", {
    text: undefined,
    location: { latitude: 41.5435, longitude: -72.807, name: "Meriden, CT" }
  });
  await sendAs(phoneWordChange, "I want milk");
  mock.clear();
  await sendAs(phoneWordChange, "Change");
  const afterWordChange = mock.sent.filter((m) => m.to === phoneWordChange).map((m) => m.body).join("\n");
  assert(/add|remove|change/i.test(afterWordChange), "Change enters cart edit");
  assert(!/choose payment/i.test(afterWordChange), "Change does not open payment");
  assert(!/not available right now:\s*change/i.test(afterWordChange), "Change is not a product");

  console.log("OK — checkout payment-selection regression passed.");
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
