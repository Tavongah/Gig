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
  process.env.WHATSAPP_PROVIDER = "mock";
  process.env.COMMERCE_PAYMENT_METHOD = "CASH";
  process.env.COMMERCE_PAYMENT_PROVIDER = "mock";
  process.env.NODE_ENV = "test";
  process.env.APP_ENV = "development";

  const { prisma } = await import("../src/config/prisma.js");
  const {
    ensureWhatsAppCommerceCustomer,
    ensureWebGuestCommerceCustomer,
    ensureAppCommerceCustomer,
    linkCommerceCustomerToVerifiedUser,
    normalizeCommercePhone
  } = await import("../src/modules/commerce/commerce-customer.service.js");
  const { createConfirmedCommerceOrder } = await import("../src/modules/commerce/order.service.js");
  const { createMerchant, upsertProductForMerchant } = await import(
    "../src/modules/commerce/merchant.service.js"
  );
  const { getMockWhatsAppProvider, resetWhatsAppProviderForTests } = await import(
    "../src/modules/whatsapp/provider.js"
  );
  const { handleCustomerWhatsAppMessage } = await import(
    "../src/modules/whatsapp/customer-handler.js"
  );
  const { setSocketServer } = await import("../src/lib/socket.js");
  const { AppError } = await import("../src/lib/errors.js");

  resetWhatsAppProviderForTests();
  const mock = getMockWhatsAppProvider();
  mock.clear();
  const httpServer = createServer();
  const io = new Server(httpServer);
  setSocketServer(io);

  const suffix = String(Date.now()).slice(-7);
  const phoneA = `+26377${suffix}`;
  const phoneB = `+26378${suffix}`;
  const lat = -17.8665;
  const lng = 30.9925;

  console.log("1) First-time WhatsApp sender creates CommerceCustomer…");
  const first = await ensureWhatsAppCommerceCustomer(phoneA, "Alice");
  assert(first.created === true, "created flag");
  assert(first.source === "WHATSAPP", "source WHATSAPP");
  assert(first.whatsappPhone === phoneA, "whatsapp phone");
  assert(first.userId === null, "no User link");

  console.log("2) Returning WhatsApp sender reuses same customer…");
  const again = await ensureWhatsAppCommerceCustomer(phoneA, "Alice");
  assert(again.created === false, "not recreated");
  assert(again.id === first.id, "same id");

  console.log("3) Two different WhatsApp numbers create separate customers…");
  const other = await ensureWhatsAppCommerceCustomer(phoneB, "Bob");
  assert(other.id !== first.id, "distinct customers");
  assert(other.whatsappPhone === phoneB, "phone B");

  console.log("4) WhatsApp flow requires no User account…");
  const merchant = await createMerchant({
    name: `Identity Shop ${suffix}`,
    contactName: "Owner",
    phone: `+26376${suffix}`,
    whatsappPhone: `+26376${suffix}`,
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
  await prisma.merchant.updateMany({
    where: { id: { not: merchant.id } },
    data: { acceptsOrders: false }
  });

  const waPhone = `+26371${suffix}`;
  const usersBefore = await prisma.user.count({
    where: { email: { endsWith: "@whatsapp.duts.local" } }
  });
  await handleCustomerWhatsAppMessage(
    {
      providerMessageId: `id-loc-${Date.now()}`,
      from: waPhone,
      location: { latitude: lat + 0.001, longitude: lng + 0.001, name: "Home" },
      profileName: "No Account"
    },
    io
  );
  await handleCustomerWhatsAppMessage(
    { providerMessageId: `id-shop-${Date.now()}`, from: waPhone, text: "1 bread" },
    io
  );
  await handleCustomerWhatsAppMessage(
    { providerMessageId: `id-confirm-${Date.now()}`, from: waPhone, buttonId: "confirm_order" },
    io
  );
  await handleCustomerWhatsAppMessage(
    { providerMessageId: `id-cash-${Date.now()}`, from: waPhone, buttonId: "pay_cash" },
    io
  );
  const usersAfter = await prisma.user.count({
    where: { email: { endsWith: "@whatsapp.duts.local" } }
  });
  assert(usersAfter === usersBefore, "no new wa_* User accounts");

  console.log("5) CommerceOrder links correctly…");
  const order = await prisma.commerceOrder.findFirst({
    where: { merchantId: merchant.id },
    orderBy: { createdAt: "desc" },
    include: { commerceCustomer: true }
  });
  assert(order?.commerceCustomerId, "commerceCustomerId set");
  assert(order?.customerId === null, "no User on order");
  assert(order?.commerceCustomer?.whatsappPhone === waPhone, "linked WA phone");
  assert(order?.commerceCustomer?.source === "WHATSAPP", "order source customer");

  console.log("6) Authenticated app user can link to CommerceCustomer…");
  const appUser = await prisma.user.create({
    data: {
      email: `app_cc_${suffix}@test.duts.local`,
      fullName: "App Shopper",
      phoneNumber: `+26379${suffix}`,
      phoneVerified: true,
      emailVerified: true,
      profileCompleted: true,
      roles: ["CLIENT"],
      defaultRole: "CLIENT",
      accountStatus: "ACTIVE"
    }
  });
  const appCc = await ensureAppCommerceCustomer(appUser.id);
  assert(appCc.userId === appUser.id, "app user linked");
  assert(appCc.source === "APP", "APP source");
  const appCc2 = await ensureAppCommerceCustomer(appUser.id);
  assert(appCc2.id === appCc.id, "reuse app commerce customer");

  console.log("7) Guest web customer can be represented…");
  const guest = await ensureWebGuestCommerceCustomer({
    phone: `+26370${suffix}`,
    displayName: "Guest Pat"
  });
  assert(guest.source === "WEB_GUEST", "web guest");
  assert(guest.userId === null, "guest has no User");
  assert(guest.primaryPhone === `+26370${suffix}`, "guest phone");
  const guestOrder = await createConfirmedCommerceOrder({
    commerceCustomerId: guest.id,
    merchantId: merchant.id,
    lines: [
      {
        productId: (await prisma.product.findFirstOrThrow({ where: { merchantId: merchant.id } })).id,
        productName: "Lobels Bread White",
        quantity: 1,
        unitPriceCents: 100,
        lineTotalCents: 100,
        merchantId: merchant.id
      }
    ],
    deliveryLabel: "Guest drop",
    deliveryLatitude: lat,
    deliveryLongitude: lng,
    orderSource: "WEB"
  });
  assert(guestOrder.commerceCustomerId === guest.id, "guest order link");
  assert(guestOrder.customerId === null, "guest order no User");

  console.log("8) No identity merge based only on name…");
  const twin = await ensureWebGuestCommerceCustomer({ displayName: "Alice" });
  assert(twin.id !== first.id, "name-only does not merge");

  console.log("9) E.164 normalization…");
  assert(normalizeCommercePhone("0772123456") === "+263772123456", "local → E.164");
  assert(normalizeCommercePhone("+263772123456") === "+263772123456", "already E.164");

  console.log("10) Verified link helper refuses unverified / mismatched…");
  let refused = false;
  try {
    await linkCommerceCustomerToVerifiedUser({
      commerceCustomerId: first.id,
      userId: appUser.id,
      verifiedPhoneE164: phoneA
    });
  } catch (e) {
    refused = e instanceof AppError;
  }
  assert(refused, "unsafe link refused");

  console.log("Commerce customer identity tests passed.");
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
