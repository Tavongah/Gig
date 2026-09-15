/**
 * Regression: merchant READY must use merchant.whatsappPhone when phone is empty.
 * Raw Zod/validation errors must never reach WhatsApp.
 *
 * Run: npm run test:merchant-ready-delivery -w @gigflow/api
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
  const { setSocketServer } = await import("../src/lib/socket.js");
  const { createMerchant, upsertProductForMerchant } = await import(
    "../src/modules/commerce/merchant.service.js"
  );
  const {
    createConfirmedCommerceOrder,
    merchantAcceptOrder,
    merchantMarkReadyForPickup,
    resolveMerchantPickupContactPhone,
    resolveCustomerDropoffContactPhone
  } = await import("../src/modules/commerce/order.service.js");
  const { handleMerchantWhatsAppMessage } = await import(
    "../src/modules/whatsapp/merchant-handler.js"
  );
  const { formatMerchantReadyDeliveryFailed } = await import("../src/modules/whatsapp/copy.js");
  const { AppError } = await import("../src/lib/errors.js");
  const { CommercePaymentMethod } = await import("@prisma/client");

  resetWhatsAppProviderForTests();
  const mock = getMockWhatsAppProvider();
  mock.clear();
  const httpServer = createServer();
  const io = new Server(httpServer);
  setSocketServer(io);

  const suffix = String(Date.now()).slice(-6);

  console.log("0) unit: pickup phone prefers phone, falls back to whatsapp…");
  assert(
    resolveMerchantPickupContactPhone({ phone: "+263771234567", whatsappPhone: "+263779999999" }) ===
      "+263771234567",
    "prefers merchant.phone"
  );
  assert(
    resolveMerchantPickupContactPhone({ phone: "", whatsappPhone: "+263771234567" }) ===
      "+263771234567",
    "+263 whatsapp fallback"
  );
  assert(
    resolveMerchantPickupContactPhone({ phone: null, whatsappPhone: "+12025550123" }) ===
      "+12025550123",
    "+1 whatsapp fallback"
  );
  try {
    resolveMerchantPickupContactPhone({ phone: "", whatsappPhone: "" });
    throw new Error("expected invalid");
  } catch (e) {
    assert(e instanceof AppError && e.code === "DELIVERY_CONTACT_INVALID", "invalid pickup");
  }

  const customerWa = `+2637733${suffix}`;
  assert(
    resolveCustomerDropoffContactPhone({
      customerWhatsAppPhone: customerWa,
      commerceWhatsappPhone: null,
      linkedUserPhone: "+19999999999"
    }) === customerWa,
    "dropoff uses customer WA"
  );
  assert(
    resolveCustomerDropoffContactPhone({
      customerWhatsAppPhone: customerWa,
      commerceWhatsappPhone: null,
      linkedUserPhone: null
    }) !== "+263771234567",
    "dropoff is not merchant phone"
  );

  const failedCopy = formatMerchantReadyDeliveryFailed();
  assert(/couldn't start delivery/i.test(failedCopy), "failed copy");
  assert(!/contactPhone|zod|prisma|\[\{/i.test(failedCopy), "no internal terms in failed copy");

  console.log("1) merchant phone empty + whatsapp +263 → READY creates delivery…");
  const merchantWa = `+2637722${suffix}`;
  const merchant = await createMerchant({
    name: `Ready Fix Shop ${suffix}`,
    whatsappPhone: merchantWa,
    phone: "",
    locationLabel: "Highfield",
    latitude: -17.864,
    longitude: 30.992,
    openingHours: "Always open",
    pilotArea: "Harare",
    notes: "ready delivery contact regression"
  });
  // Force empty phone (createMerchant may copy whatsapp into phone).
  await prisma.merchant.update({
    where: { id: merchant.id },
    data: { phone: "" }
  });
  await upsertProductForMerchant(merchant.id, {
    name: "Milk",
    priceCents: 150,
    currency: "usd",
    available: true,
    searchAliases: ["milk"]
  });
  const milk = await prisma.product.findFirstOrThrow({
    where: { merchantId: merchant.id, name: "Milk" }
  });

  const { ensureWhatsAppCommerceCustomer } = await import(
    "../src/modules/commerce/commerce-customer.service.js"
  );
  const commerceCustomer = await ensureWhatsAppCommerceCustomer(customerWa, "Ready Tester");

  const order = await createConfirmedCommerceOrder({
    commerceCustomerId: commerceCustomer.id,
    merchantId: merchant.id,
    lines: [
      {
        productId: milk.id,
        productName: milk.name,
        quantity: 1,
        unitPriceCents: milk.priceCents,
        lineTotalCents: milk.priceCents,
        merchantId: merchant.id
      }
    ],
    deliveryLabel: "Highfield Road",
    deliveryLatitude: -17.865,
    deliveryLongitude: 30.993,
    customerWhatsAppPhone: customerWa,
    paymentMethod: CommercePaymentMethod.CASH
  });

  await merchantAcceptOrder(merchant.id, order.orderNumber);
  const { order: readyOrder, delivery } = await merchantMarkReadyForPickup(
    merchant.id,
    order.orderNumber,
    io
  );
  assert(readyOrder.status === "READY_FOR_PICKUP", `status ${readyOrder.status}`);
  assert(readyOrder.linkedDeliveryGigId, "linked delivery gig");
  assert(delivery?.delivery, "delivery payload");

  const gig = await prisma.gig.findUniqueOrThrow({
    where: { id: readyOrder.linkedDeliveryGigId! }
  });
  assert(gig.pickupContactPhone === merchantWa, `pickup phone ${gig.pickupContactPhone}`);
  assert(gig.pickupContactPhone !== customerWa, "pickup is not customer");
  assert(gig.dropoffContactPhone === customerWa, `dropoff ${gig.dropoffContactPhone}`);
  assert(gig.dropoffContactPhone !== merchantWa, "dropoff is not merchant");
  assert(!gig.pickupContactPhone || gig.pickupContactPhone.length >= 7, "pickup len");

  console.log("2) duplicate READY does not create second gig…");
  const again = await merchantMarkReadyForPickup(merchant.id, order.orderNumber, io);
  assert(again.order.linkedDeliveryGigId === readyOrder.linkedDeliveryGigId, "same gig");
  assert(again.delivery?.idempotentReplay === true, "idempotent replay");

  console.log("3) +1 merchant whatsapp also works…");
  const usWa = `+1202555${suffix.slice(-4)}`;
  const usMerchant = await createMerchant({
    name: `Ready US Shop ${suffix}`,
    whatsappPhone: usWa,
    phone: "",
    locationLabel: "Meriden, CT",
    latitude: 41.5382,
    longitude: -72.807,
    openingHours: "Always open",
    pilotArea: "Meriden, CT",
    notes: "us ready regression"
  });
  await prisma.merchant.update({ where: { id: usMerchant.id }, data: { phone: "" } });
  await upsertProductForMerchant(usMerchant.id, {
    name: "Milk",
    priceCents: 150,
    currency: "usd",
    available: true,
    searchAliases: ["milk"]
  });
  const usMilk = await prisma.product.findFirstOrThrow({
    where: { merchantId: usMerchant.id, name: "Milk" }
  });
  const usCustomerWa = `+1202666${suffix.slice(-4)}`;
  const usCustomer = await ensureWhatsAppCommerceCustomer(usCustomerWa, "US Tester");
  const usOrder = await createConfirmedCommerceOrder({
    commerceCustomerId: usCustomer.id,
    merchantId: usMerchant.id,
    lines: [
      {
        productId: usMilk.id,
        productName: usMilk.name,
        quantity: 1,
        unitPriceCents: usMilk.priceCents,
        lineTotalCents: usMilk.priceCents,
        merchantId: usMerchant.id
      }
    ],
    deliveryLabel: "Meriden, CT",
    deliveryLatitude: 41.5435,
    deliveryLongitude: -72.807,
    customerWhatsAppPhone: usCustomerWa,
    paymentMethod: CommercePaymentMethod.CASH
  });
  await merchantAcceptOrder(usMerchant.id, usOrder.orderNumber);
  const { order: usReady } = await merchantMarkReadyForPickup(usMerchant.id, usOrder.orderNumber, io);
  const usGig = await prisma.gig.findUniqueOrThrow({ where: { id: usReady.linkedDeliveryGigId! } });
  assert(usGig.pickupContactPhone === usWa, `us pickup ${usGig.pickupContactPhone}`);

  console.log("4) WhatsApp READY error path never leaks Zod JSON…");
  const badMerchantWa = `+2637744${suffix}`;
  const badMerchant = await createMerchant({
    name: `Bad Phone Shop ${suffix}`,
    whatsappPhone: badMerchantWa,
    phone: "x",
    locationLabel: "Highfield",
    latitude: -17.864,
    longitude: 30.992,
    openingHours: "Always open",
    pilotArea: "Harare",
    notes: "error ux"
  });
  // Corrupt both phones to force DELIVERY_CONTACT_INVALID after accept.
  await prisma.merchant.update({
    where: { id: badMerchant.id },
    data: { phone: "1", whatsappPhone: badMerchantWa }
  });
  await upsertProductForMerchant(badMerchant.id, {
    name: "Bread",
    priceCents: 100,
    currency: "usd",
    available: true,
    searchAliases: ["bread"]
  });
  const bread = await prisma.product.findFirstOrThrow({
    where: { merchantId: badMerchant.id, name: "Bread" }
  });
  const badCustomer = await ensureWhatsAppCommerceCustomer(`+2637755${suffix}`, "Bad Path");
  const badOrder = await createConfirmedCommerceOrder({
    commerceCustomerId: badCustomer.id,
    merchantId: badMerchant.id,
    lines: [
      {
        productId: bread.id,
        productName: bread.name,
        quantity: 1,
        unitPriceCents: bread.priceCents,
        lineTotalCents: bread.priceCents,
        merchantId: badMerchant.id
      }
    ],
    deliveryLabel: "Highfield",
    deliveryLatitude: -17.86,
    deliveryLongitude: 30.99,
    customerWhatsAppPhone: `+2637755${suffix}`,
    paymentMethod: CommercePaymentMethod.CASH
  });
  await merchantAcceptOrder(badMerchant.id, badOrder.orderNumber);
  // Keep merchant WA valid for routing; clear customer contacts so dropoff validation fails.
  await prisma.commerceOrder.update({
    where: { id: badOrder.id },
    data: { customerWhatsAppPhone: "" }
  });
  await prisma.commerceCustomer.update({
    where: { id: badCustomer.id },
    data: { whatsappPhone: `bad${suffix}`, primaryPhone: "1" }
  });

  mock.clear();
  await handleMerchantWhatsAppMessage(
    {
      providerMessageId: `ready-err-${Date.now()}`,
      from: badMerchantWa,
      text: "READY"
    },
    io
  );
  const merchantMsgs = mock.sent.filter((m) => m.to === badMerchantWa).map((m) => m.body);
  const last = merchantMsgs[merchantMsgs.length - 1] ?? "";
  assert(/couldn't start delivery|try READY again|something went wrong/i.test(last), `safe copy: ${last}`);
  assert(!/contactPhone/i.test(last), "no contactPhone leak");
  assert(!/too_small|zod|origin|inclusive/i.test(last), "no zod leak");
  assert(!last.trimStart().startsWith("["), "no JSON array");

  // Order remains MERCHANT_ACCEPTED (retryable) — no linked gig
  const still = await prisma.commerceOrder.findUniqueOrThrow({ where: { id: badOrder.id } });
  assert(still.status === "MERCHANT_ACCEPTED", `retryable state ${still.status}`);
  assert(!still.linkedDeliveryGigId, "no gig on failure");

  console.log("OK — merchant READY delivery contact regression passed.");
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
