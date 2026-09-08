/**
 * Stage 4.5 pilot-safety tests (mock provider — no Meta credentials required).
 * Run: npm run test:commerce-pilot-safety --workspace=@gigflow/api
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
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
  const { CommercePaymentMethod, CommercePaymentStatus, GigStatus } = await import("@prisma/client");
  const { prisma } = await import("../src/config/prisma.js");
  const { setSocketServer } = await import("../src/lib/socket.js");
  const {
    assertCommercePaymentMethodAllowed,
    assertWhatsAppMockInboundAllowed,
    paymentStatusForMethod,
    resolveCommercePaymentMethod
  } = await import("../src/modules/commerce/payment-mode.js");
  const {
    createConfirmedCommerceOrder,
    expireStaleMerchantPendingOrders,
    merchantAcceptOrder,
    merchantMarkReadyForPickup
  } = await import("../src/modules/commerce/order.service.js");
  const { createMerchant, upsertProductForMerchant } = await import(
    "../src/modules/commerce/merchant.service.js"
  );
  const { MetaWhatsAppProvider, resetWhatsAppProviderForTests } = await import(
    "../src/modules/whatsapp/provider.js"
  );
  const { extractMetaMessages } = await import("../src/modules/whatsapp/meta-payload.js");
  const { SAMPLE_META_WEBHOOK } = await import("./fixtures/whatsapp-meta-payload.js");
  const { AppError } = await import("../src/lib/errors.js");


  process.env.WHATSAPP_PROVIDER = "mock";
  process.env.COMMERCE_PAYMENT_METHOD = "CASH";
  process.env.APP_ENV = "development";
  resetWhatsAppProviderForTests();

  const httpServer = createServer();
  const io = new Server(httpServer);
  setSocketServer(io);

  console.log("1) Payment mode: CASH â†’ DUE_ON_DELIVERY; TEST_BYPASS blocked in pilotâ€¦");
  assert(resolveCommercePaymentMethod("CASH") === CommercePaymentMethod.CASH, "cash method");
  assert(
    paymentStatusForMethod(CommercePaymentMethod.CASH) === CommercePaymentStatus.DUE_ON_DELIVERY,
    "cash due on delivery"
  );
  assertCommercePaymentMethodAllowed(CommercePaymentMethod.CASH);
  process.env.APP_ENV = "pilot";
  try {
    assertCommercePaymentMethodAllowed(CommercePaymentMethod.TEST_BYPASS);
    throw new Error("expected TEST_BYPASS forbidden");
  } catch (e) {
    assert(e instanceof AppError && e.code === "TEST_BYPASS_FORBIDDEN", "bypass forbidden");
  }
  process.env.APP_ENV = "development";

  console.log("2) Mock inbound blocked in pilotâ€¦");
  process.env.APP_ENV = "pilot";
  delete process.env.ALLOW_WHATSAPP_MOCK;
  try {
    assertWhatsAppMockInboundAllowed();
    throw new Error("expected mock blocked");
  } catch (e) {
    assert(e instanceof AppError && e.code === "WHATSAPP_MOCK_DISABLED", "mock disabled");
  }
  process.env.APP_ENV = "development";
  assertWhatsAppMockInboundAllowed();

  console.log("3) Meta webhook signatureâ€¦");
  const secret = "test_app_secret";
  const body = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [] }));
  const sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  const meta = new MetaWhatsAppProvider("token", "phone", secret);
  assert(meta.verifyWebhookSignature?.(body, sig) === true, "valid sig");
  assert(meta.verifyWebhookSignature?.(body, "sha256=deadbeef") === false, "bad sig");

  console.log("4) Meta location + button payload fixture parseâ€¦");
  const msgs = extractMetaMessages(SAMPLE_META_WEBHOOK);
  assert(msgs.some((m) => m.location && m.location.latitude < 0), "ZW location");
  assert(msgs.some((m) => m.buttonId === "confirm_order"), "button id");

  console.log("5) Ready-for-pickup idempotencyâ€¦");
  const suffix = String(Date.now()).slice(-7);
  const merchantPhone = `+26377${suffix}`;
  const lat = -17.8665;
  const lng = 30.9925;
  const merchant = await createMerchant({
    name: `Pilot Safety Shop ${suffix}`,
    contactName: "Owner",
    phone: merchantPhone,
    whatsappPhone: merchantPhone,
    locationLabel: "Highfield",
    latitude: lat,
    longitude: lng
  });
  const bread = await upsertProductForMerchant(merchant.id, {
    name: "Lobels Bread White",
    priceCents: 100,
    available: true,
    searchAliases: ["bread"]
  });
  const eggs = await upsertProductForMerchant(merchant.id, {
    name: "Eggs 6 Pack",
    priceCents: 250,
    available: true,
    searchAliases: ["eggs"]
  });

  const customer = await prisma.user.create({
    data: {
      email: `pilot_${suffix}@whatsapp.duts.local`,
      fullName: "Pilot Customer",
      phoneNumber: `+26378${suffix}`,
      phoneVerified: true,
      emailVerified: true,
      profileCompleted: true,
      avatarUrl: `https://api.dicebear.com/9.x/shapes/svg?seed=pilot${suffix}`,
      roles: ["CLIENT"],
      defaultRole: "CLIENT",
      accountStatus: "ACTIVE",
      country: "ZW",
      city: "Harare",
      region: "Harare"
    }
  });

  const order = await createConfirmedCommerceOrder({
    customerId: customer.id,
    merchantId: merchant.id,
    lines: [
      {
        productId: bread.id,
        productName: bread.name,
        quantity: 1,
        unitPriceCents: 100,
        lineTotalCents: 100,
        merchantId: merchant.id
      },
      {
        productId: eggs.id,
        productName: eggs.name,
        quantity: 1,
        unitPriceCents: 250,
        lineTotalCents: 250,
        merchantId: merchant.id
      }
    ],
    deliveryLabel: "Highfield",
    deliveryLatitude: lat + 0.001,
    deliveryLongitude: lng + 0.001,
    customerWhatsAppPhone: customer.phoneNumber!
  });
  assert(order.paymentMethod === "CASH", "order cash");
  assert(order.paymentStatus === "DUE_ON_DELIVERY", `status ${order.paymentStatus}`);
  assert(order.merchantRespondBy != null, "merchant timeout set");

  await merchantAcceptOrder(merchant.id, order.orderNumber);
  const first = await merchantMarkReadyForPickup(merchant.id, order.orderNumber, io);
  const second = await merchantMarkReadyForPickup(merchant.id, order.orderNumber, io);
  assert(first.order.linkedDeliveryGigId, "gig linked");
  assert(
    first.order.linkedDeliveryGigId === second.order.linkedDeliveryGigId,
    "same gig on double ready"
  );
  assert(second.delivery.idempotentReplay === true, "idempotent replay");

  const gigCount = await prisma.gig.count({
    where: { idempotencyKey: `commerce-order-${order.id}` }
  });
  assert(gigCount === 1, `expected 1 gig, got ${gigCount}`);

  console.log("6) Concurrent courier claim (updateMany race)â€¦");
  const gigId = first.order.linkedDeliveryGigId!;
  await prisma.gig.update({
    where: { id: gigId },
    data: { assignedWorkerId: null, status: GigStatus.SEARCHING_FOR_WORKER }
  });
  const w1 = await prisma.user.create({
    data: {
      email: `c1_${suffix}@duts.local`,
      fullName: "Courier One",
      phoneNumber: `+26371${suffix}`,
      phoneVerified: true,
      emailVerified: true,
      profileCompleted: true,
      avatarUrl: `https://api.dicebear.com/9.x/shapes/svg?seed=c1${suffix}`,
      roles: ["WORKER"],
      defaultRole: "WORKER",
      accountStatus: "ACTIVE",
      country: "ZW",
      city: "Harare",
      region: "Harare"
    }
  });
  const w2 = await prisma.user.create({
    data: {
      email: `c2_${suffix}@duts.local`,
      fullName: "Courier Two",
      phoneNumber: `+26372${suffix}`,
      phoneVerified: true,
      emailVerified: true,
      profileCompleted: true,
      avatarUrl: `https://api.dicebear.com/9.x/shapes/svg?seed=c2${suffix}`,
      roles: ["WORKER"],
      defaultRole: "WORKER",
      accountStatus: "ACTIVE",
      country: "ZW",
      city: "Harare",
      region: "Harare"
    }
  });
  const [r1, r2] = await Promise.all([
    prisma.gig.updateMany({
      where: {
        id: gigId,
        assignedWorkerId: null,
        status: { in: [GigStatus.POSTED, GigStatus.SEARCHING_FOR_WORKER] }
      },
      data: { assignedWorkerId: w1.id }
    }),
    prisma.gig.updateMany({
      where: {
        id: gigId,
        assignedWorkerId: null,
        status: { in: [GigStatus.POSTED, GigStatus.SEARCHING_FOR_WORKER] }
      },
      data: { assignedWorkerId: w2.id }
    })
  ]);
  assert(r1.count + r2.count === 1, `exactly one claim won, got ${r1.count}+${r2.count}`);
  const claimed = await prisma.gig.findUniqueOrThrow({ where: { id: gigId } });
  assert(claimed.assignedWorkerId === w1.id || claimed.assignedWorkerId === w2.id, "one worker");

  console.log("7) Stale price revalidationâ€¦");
  await upsertProductForMerchant(
    merchant.id,
    { name: bread.name, priceCents: 120, available: true, searchAliases: ["bread"] },
    bread.id
  );
  try {
    await createConfirmedCommerceOrder({
      customerId: customer.id,
      merchantId: merchant.id,
      lines: [
        {
          productId: bread.id,
          productName: bread.name,
          quantity: 1,
          unitPriceCents: 100,
          lineTotalCents: 100,
          merchantId: merchant.id
        }
      ],
      deliveryLabel: "Highfield",
      deliveryLatitude: lat,
      deliveryLongitude: lng
    });
    throw new Error("expected PRICE_CHANGED");
  } catch (e) {
    assert(e instanceof AppError && e.code === "PRICE_CHANGED", "price changed");
  }

  console.log("8) Unavailable product raceâ€¦");
  await upsertProductForMerchant(
    merchant.id,
    { name: eggs.name, priceCents: 250, available: false, searchAliases: ["eggs"] },
    eggs.id
  );
  try {
    await createConfirmedCommerceOrder({
      customerId: customer.id,
      merchantId: merchant.id,
      lines: [
        {
          productId: eggs.id,
          productName: eggs.name,
          quantity: 1,
          unitPriceCents: 250,
          lineTotalCents: 250,
          merchantId: merchant.id
        }
      ],
      deliveryLabel: "Highfield",
      deliveryLatitude: lat,
      deliveryLongitude: lng
    });
    throw new Error("expected PRODUCT_UNAVAILABLE");
  } catch (e) {
    assert(e instanceof AppError && e.code === "PRODUCT_UNAVAILABLE", "unavailable");
  }

  console.log("9) Merchant timeout expiryâ€¦");
  const timeoutOrder = await createConfirmedCommerceOrder({
    customerId: customer.id,
    merchantId: merchant.id,
    lines: [
      {
        productId: bread.id,
        productName: bread.name,
        quantity: 1,
        unitPriceCents: 120,
        lineTotalCents: 120,
        merchantId: merchant.id
      }
    ],
    deliveryLabel: "Highfield",
    deliveryLatitude: lat,
    deliveryLongitude: lng,
    customerWhatsAppPhone: customer.phoneNumber!
  });
  await prisma.commerceOrder.update({
    where: { id: timeoutOrder.id },
    data: { merchantRespondBy: new Date(Date.now() - 1000) }
  });
  const expired = await expireStaleMerchantPendingOrders();
  assert(expired >= 1, "expired at least one");
  const after = await prisma.commerceOrder.findUniqueOrThrow({ where: { id: timeoutOrder.id } });
  assert(after.status === "CANCELLED", "timeout cancelled");

  console.log("\nâœ… Stage 4.5 pilot-safety tests passed.");
  await prisma.$disconnect();
  io.close();
  httpServer.close();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("\nâŒ Stage 4.5 safety failed:", e);
  await prisma.$disconnect();
  process.exit(1);
});

