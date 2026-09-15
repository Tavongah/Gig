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

  const {
    arriveAtPickup,
    startTravelToPickup,
    verifyDeliveryPinAndComplete,
    verifyPickupPin,
    arriveAtDropoff,
    startTravelToDropoff,
    regenerateDeliveryPins,
    setDeliveryCourierEligibility
  } = await import("../src/modules/gigs/delivery.service.js");
  const { approveGigCompletion, expressWorkerInterest } = await import(
    "../src/modules/gigs/gig-workflow.service.js"
  );
  const { prisma } = await import("../src/config/prisma.js");
  const {
    buildOneStoreBasket,
    createMerchant,
    findMerchantByWhatsApp,
    requireAuthorizedMerchant,
    searchProductsNear,
    upsertProductForMerchant
  } = await import("../src/modules/commerce/merchant.service.js");
  const { extractShoppingItems, isTrackIntent } = await import(
    "../src/modules/whatsapp/shopping-intent.js"
  );
  const { getMockWhatsAppProvider, resetWhatsAppProviderForTests } = await import(
    "../src/modules/whatsapp/provider.js"
  );
  const { handleCustomerWhatsAppMessage } = await import(
    "../src/modules/whatsapp/customer-handler.js"
  );
  const { handleMerchantWhatsAppMessage } = await import(
    "../src/modules/whatsapp/merchant-handler.js"
  );

resetWhatsAppProviderForTests();
  const mock = getMockWhatsAppProvider();
  mock.clear();

  const httpServer = createServer();
  const io = new Server(httpServer);
  const { setSocketServer } = await import("../src/lib/socket.js");
  setSocketServer(io);

  console.log("1) Deterministic shopping intentâ€¦");
  const items = extractShoppingItems("I need 2 breads, eggs and a 2L Coke");
  assert(items.length >= 3, `expected >=3 items, got ${JSON.stringify(items)}`);
  assert(isTrackIntent("Where is my order?"), "track intent");

  console.log("2) Merchant + catalogâ€¦");
  const merchantPhone = `+26377${String(Date.now()).slice(-7)}`;
  const customerPhone = `+26378${String(Date.now()).slice(-7)}`;
  // Highfield-ish coords near seed shop; create own merchant colocated
  const lat = -17.8665;
  const lng = 30.9925;

  const merchant = await createMerchant({
    name: "Stage4 Test Tuck",
    contactName: "Owner",
    phone: merchantPhone,
    whatsappPhone: merchantPhone,
    locationLabel: "Highfield Test",
    latitude: lat,
    longitude: lng,
    category: "TUCK_SHOP"
  });

  await upsertProductForMerchant(merchant.id, {
    name: "Lobels Bread White",
    priceCents: 100,
    available: true,
    searchAliases: ["bread", "loaf"]
  });
  await upsertProductForMerchant(merchant.id, {
    name: "Eggs 6 Pack",
    priceCents: 250,
    available: true,
    searchAliases: ["eggs"]
  });
  await upsertProductForMerchant(merchant.id, {
    name: "Coca-Cola 2L",
    priceCents: 200,
    available: true,
    searchAliases: ["coke", "coca-cola"]
  });

  const auth = await requireAuthorizedMerchant(merchantPhone);
  assert(auth.id === merchant.id, "merchant auth");

  const unauthorized = await findMerchantByWhatsApp("+263799999999");
  assert(!unauthorized, "unknown merchant phone");

  console.log("3) Product search + one-store basket…");
  // Isolate this merchant so price snapshots are deterministic.
  await prisma.merchant.updateMany({
    where: { id: { not: merchant.id } },
    data: { acceptsOrders: false }
  });
  await prisma.merchant.update({
    where: { id: merchant.id },
    data: { acceptsOrders: true, isActive: true }
  });

  const matches = await searchProductsNear(lat, lng, "coke");
  assert(matches.some((m) => m.product.name.includes("Coca-Cola")), "coke match");
  assert(matches.every((m) => m.product.available), "unavailable excluded");

  const basket = await buildOneStoreBasket(lat, lng, [
    { query: "bread", quantity: 2 },
    { query: "eggs", quantity: 1 },
    { query: "coke", quantity: 1 }
  ]);
  assert(basket.ok, `basket should fulfill: ${JSON.stringify(basket)}`);
  assert(basket.ok && basket.lines.length === 3, "3 lines");
  const subtotal = basket.ok ? basket.lines.reduce((s, l) => s + l.lineTotalCents, 0) : 0;
  assert(subtotal === 2 * 100 + 250 + 200, `subtotal snapshot ${subtotal}`);

  console.log("4) Customer WhatsApp flow…");
  await handleCustomerWhatsAppMessage(
    {
      providerMessageId: `cust-loc-${Date.now()}`,
      from: customerPhone,
      location: { latitude: lat + 0.002, longitude: lng + 0.002, name: "Highfield" },
      profileName: "Test Customer"
    },
    io
  );
  await handleCustomerWhatsAppMessage(
    {
      providerMessageId: `cust-shop-${Date.now()}`,
      from: customerPhone,
      text: "I need 2 breads, eggs and a 2L Coke"
    },
    io
  );

  const quoteMsg = mock.sent.filter((m) => m.to.includes(customerPhone.replace("+", "")) || m.to === customerPhone);
  // mock stores `to` as provided phone
  const customerOut = mock.sent.filter((m) => m.to === customerPhone);
  assert(
    customerOut.some(
      (m) =>
        /has your items|Confirm order|Total:/i.test(m.body) ||
        (m.buttons?.some((b) => /confirm/i.test(b.id)) ?? false)
    ),
    `expected quote, got ${JSON.stringify(customerOut.slice(-2))}`
  );

  // Duplicate webhook must not double-confirm
  const dupId = `cust-confirm-${Date.now()}`;
  await handleCustomerWhatsAppMessage(
    { providerMessageId: dupId, from: customerPhone, buttonId: "confirm_order" },
    io
  );
  const dup = await handleCustomerWhatsAppMessage(
    { providerMessageId: dupId, from: customerPhone, buttonId: "confirm_order" },
    io
  );
  assert(dup.duplicate === true, "duplicate confirm blocked");

  const payChoice = mock.sent
    .filter((m) => m.to === customerPhone)
    .slice(-4)
    .map((m) => m.body)
    .join("\n");
  assert(/EcoCash|Cash on delivery|Choose payment|How would you like to pay/i.test(payChoice), `payment choice: ${payChoice}`);

  // Keep Stage 4 COD path: select cash on delivery after confirm
  await handleCustomerWhatsAppMessage(
    { providerMessageId: `cust-cash-${Date.now()}`, from: customerPhone, buttonId: "pay_cash" },
    io
  );

  const order = await prisma.commerceOrder.findFirst({
    where: { merchantId: merchant.id },
    orderBy: { createdAt: "desc" },
    include: { items: true }
  });
  assert(order, "commerce order created");
  assert(order.status === "MERCHANT_PENDING", `status ${order.status}`);
  assert(order.paymentMethod === "CASH", `paymentMethod ${order.paymentMethod}`);
  assert(order.paymentStatus === "DUE_ON_DELIVERY", `paymentStatus ${order.paymentStatus}`);
  assert(order.items.every((i) => i.unitPriceCents > 0 && i.lineTotalCents === i.unitPriceCents * i.quantity), "price snapshots");

  console.log("5) Merchant WhatsApp accept + readyâ€¦");
  const merchantOutBefore = mock.sent.length;
  assert(
    mock.sent.some((m) => m.to === merchantPhone && /New DUTS order/i.test(m.body)),
    "merchant notified"
  );

  await handleMerchantWhatsAppMessage(
    {
      providerMessageId: `merch-accept-${Date.now()}`,
      from: merchantPhone,
      text: `Accept ${order.orderNumber}`
    },
    io
  );
  await handleMerchantWhatsAppMessage(
    {
      providerMessageId: `merch-ready-${Date.now()}`,
      from: merchantPhone,
      text: `Order ${order.orderNumber} is ready`
    },
    io
  );

  const refreshed = await prisma.commerceOrder.findUniqueOrThrow({
    where: { id: order.id },
    include: { linkedDeliveryGig: true }
  });
  assert(refreshed.linkedDeliveryGigId, "linked delivery gig");
  assert(
    refreshed.status === "READY_FOR_PICKUP" || refreshed.status === "COURIER_ASSIGNED",
    `ready status ${refreshed.status}`
  );
  assert(refreshed.linkedDeliveryGig?.fulfillmentType === "DELIVERY", "DELIVERY gig");
  assert(refreshed.linkedDeliveryGig?.orderSource === "WHATSAPP", "WHATSAPP source");

  console.log("6) Courier interest â†’ auto-assign (marketplace)â€¦");
  const worker = await prisma.user.findFirst({
    where: { email: "worker@gigflow.local" },
    include: { workerProfile: true }
  });
  assert(worker?.workerProfile, "seed worker required â€” run prisma seed");

  await prisma.user.update({
    where: { id: worker.id },
    data: {
      avatarUrl: worker.avatarUrl || "https://api.dicebear.com/9.x/shapes/svg?seed=courier",
      emailVerified: true,
      profileCompleted: true,
      accountStatus: "APPROVED"
    }
  });
  await prisma.workerProfile.update({
    where: { userId: worker.id },
    data: {
      currentLatitude: lat,
      currentLongitude: lng,
      deliveryEligible: true,
      transportMode: "BICYCLE",
      availabilityStatus: "AVAILABLE"
    }
  });
  await setDeliveryCourierEligibility(worker.id, { transportMode: "BICYCLE", enabled: true });

  await expressWorkerInterest(refreshed.linkedDeliveryGigId!, worker.id, io);

  const afterAssign = await prisma.commerceOrder.findUniqueOrThrow({
    where: { id: order.id },
    include: { linkedDeliveryGig: true }
  });
  assert(afterAssign.linkedDeliveryGig?.assignedWorkerId === worker.id, "courier assigned");
  assert(
    afterAssign.status === "COURIER_ASSIGNED" ||
      afterAssign.linkedDeliveryGig?.status === "WORKER_ASSIGNED",
    "courier assigned status"
  );

  console.log("7) Courier PIN lifecycle on linked deliveryâ€¦");
  const gigId = afterAssign.linkedDeliveryGigId!;
  const gig = await prisma.gig.findUniqueOrThrow({ where: { id: gigId } });
  const secrets = await regenerateDeliveryPins(gigId, gig.clientId);

  await startTravelToPickup(gigId, worker.id, io);
  await arriveAtPickup(gigId, worker.id, { latitude: lat, longitude: lng }, io);
  await verifyPickupPin(gigId, worker.id, secrets.secrets.pickupPin, io);
  await startTravelToDropoff(gigId, worker.id, io);
  await arriveAtDropoff(
    gigId,
    worker.id,
    { latitude: lat + 0.002, longitude: lng + 0.002 },
    io
  );
  await verifyDeliveryPinAndComplete(
    gigId,
    worker.id,
    secrets.secrets.deliveryPin,
    io,
    { latitude: lat + 0.002, longitude: lng + 0.002 }
  );
  await approveGigCompletion(gigId, gig.clientId, io);

  const done = await prisma.commerceOrder.findUniqueOrThrow({ where: { id: order.id } });
  assert(done.status === "DELIVERED", `commerce delivered, got ${done.status}`);

  console.log("8) AI unavailable fallback still extractsâ€¦");
  const fallback = extractShoppingItems("Can I get milk and sugar?");
  assert(fallback.length >= 2, "fallback extract");

  console.log("9) Unauthorized merchant mutation blockedâ€¦");
  const blocked = await handleMerchantWhatsAppMessage(
    {
      providerMessageId: `bad-${Date.now()}`,
      from: "+263770000099",
      text: "Add Fake Item for $1.00"
    },
    io
  );
  assert(blocked.unauthorized === true, "unauthorized merchant");

  void merchantOutBefore;
  console.log("\nâœ… Stage 4 commerce WhatsApp E2E passed.");
  await prisma.$disconnect();
  io.close();
  httpServer.close();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("\nâŒ Stage 4 E2E failed:", error);
  await prisma.$disconnect();
  process.exit(1);
});

