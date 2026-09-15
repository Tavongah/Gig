import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

  const { prisma } = await import("../src/config/prisma.js");
  const {
    createMerchant,
    updateMerchant,
    normalizeMerchantPhone,
    upsertProductForMerchant,
    setProductAvailability,
    setMerchantAcceptsOrders,
    searchProductsNear,
    buildOneStoreBasket,
    requireAuthorizedMerchant,
    findMerchantByWhatsApp
  } = await import("../src/modules/commerce/merchant.service.js");
  const {
    getMerchantReadiness,
    previewBulkCatalogImport,
    confirmBulkCatalogImport,
    testMerchantBasket,
    assertValidMerchantCoordinates
  } = await import("../src/modules/commerce/merchant-onboarding.service.js");
  const { quoteBasketTotals } = await import("../src/modules/commerce/order.service.js");
  const { AppError } = await import("../src/lib/errors.js");
  const { getMockWhatsAppProvider, resetWhatsAppProviderForTests } = await import(
    "../src/modules/whatsapp/provider.js"
  );
  const { handleMerchantWhatsAppMessage } = await import(
    "../src/modules/whatsapp/merchant-handler.js"
  );
  const { createServer } = await import("node:http");
  const { Server } = await import("socket.io");
  const { setSocketServer } = await import("../src/lib/socket.js");

  resetWhatsAppProviderForTests();
  const mock = getMockWhatsAppProvider();
  mock.clear();
  const httpServer = createServer();
  const io = new Server(httpServer);
  setSocketServer(io);

  const suffix = String(Date.now()).slice(-7);
  const lat = -17.8665;
  const lng = 30.9925;

  console.log("1) create merchant with normalized Zimbabwe WhatsApp…");
  const waLocal = `0772${suffix.slice(0, 6)}`;
  const merchant = await createMerchant({
    name: `Onboard Shop ${suffix}`,
    whatsappPhone: waLocal,
    locationLabel: "Highfield Pilot",
    latitude: lat,
    longitude: lng,
    openingHours: "Mon–Sat 08:00–18:00",
    pilotArea: "Glen Norah"
  });
  assert(
    merchant.whatsappPhone === normalizeMerchantPhone(waLocal),
    `normalized ${merchant.whatsappPhone}`
  );
  assert(merchant.whatsappPhone.startsWith("+263"), "E.164 ZW");

  console.log("2) duplicate merchant WhatsApp blocked…");
  let dupBlocked = false;
  try {
    await createMerchant({
      name: "Dup",
      whatsappPhone: waLocal,
      locationLabel: "Elsewhere",
      latitude: lat + 0.01,
      longitude: lng + 0.01
    });
  } catch (e) {
    dupBlocked = e instanceof AppError && e.code === "MERCHANT_PHONE_TAKEN";
  }
  assert(dupBlocked, "duplicate blocked");

  console.log("3) invalid lat/lng rejected…");
  let badCoords = false;
  try {
    assertValidMerchantCoordinates(0, 0);
  } catch (e) {
    badCoords = e instanceof AppError && e.code === "INVALID_COORDINATES";
  }
  assert(badCoords, "0,0 rejected");

  console.log("4–5) inactive / acceptsOrders=false excluded from matching…");
  await upsertProductForMerchant(merchant.id, {
    name: "Bread",
    priceCents: 120,
    available: true,
    searchAliases: ["bread"]
  });
  await setMerchantAcceptsOrders(merchant.id, false);
  let nearby = await searchProductsNear(lat + 0.001, lng + 0.001, "bread");
  assert(!nearby.some((m) => m.merchant.id === merchant.id), "acceptsOrders=false excluded");
  await setMerchantAcceptsOrders(merchant.id, true);
  await updateMerchant(merchant.id, { isActive: false });
  nearby = await searchProductsNear(lat + 0.001, lng + 0.001, "bread");
  assert(!nearby.some((m) => m.merchant.id === merchant.id), "inactive excluded");
  await updateMerchant(merchant.id, { isActive: true });

  console.log("6–7) available included / unavailable excluded…");
  const eggs = await upsertProductForMerchant(merchant.id, {
    name: "Eggs 6 Pack",
    priceCents: 250,
    available: true,
    searchAliases: ["eggs"]
  });
  nearby = await searchProductsNear(lat + 0.001, lng + 0.001, "eggs", { availableOnly: true });
  assert(nearby.some((m) => m.product.id === eggs.id), "available included");
  await setProductAvailability(merchant.id, eggs.id, false);
  nearby = await searchProductsNear(lat + 0.001, lng + 0.001, "eggs", { availableOnly: true });
  assert(!nearby.some((m) => m.product.id === eggs.id), "unavailable excluded");
  await setProductAvailability(merchant.id, eggs.id, true);

  console.log("8) product price edits reflected in quotes…");
  await upsertProductForMerchant(
    merchant.id,
    { name: "Bread", priceCents: 150, available: true, searchAliases: ["bread"] },
    (
      await prisma.product.findFirstOrThrow({
        where: { merchantId: merchant.id, name: "Bread" }
      })
    ).id
  );
  // Isolate matching to this merchant (other pilot shops in the same DB must not win).
  await prisma.merchant.updateMany({
    where: { acceptsOrders: true, NOT: { id: merchant.id } },
    data: { acceptsOrders: false }
  });
  const basket = await buildOneStoreBasket(lat + 0.001, lng + 0.001, [
    { query: "bread", quantity: 1 }
  ]);
  assert(basket.ok, "basket ok");
  if (basket.ok) {
    assert(basket.merchant.id === merchant.id, "basket from this merchant");
    assert(basket.lines[0]?.unitPriceCents === 150, "updated price in basket");
    const totals = await quoteBasketTotals({
      merchantLat: lat,
      merchantLng: lng,
      customerLat: lat + 0.001,
      customerLng: lng + 0.001,
      lines: basket.lines
    });
    assert(totals.subtotalCents === 150, "quote subtotal uses new price");
  }
  await prisma.merchant.updateMany({
    where: { acceptsOrders: false, NOT: { id: merchant.id } },
    data: { acceptsOrders: true }
  });

  console.log("9) bulk catalog parse valid lines…");
  const preview = previewBulkCatalogImport(
    "Mazoe Orange 2L | 3.00\nMilk 1L | 1.50\nSugar 2kg | 2.80"
  );
  assert(preview.valid.length === 3, `valid ${preview.valid.length}`);
  assert(preview.invalid.length === 0, "no invalid");

  console.log("10) malformed bulk line rejected/warned…");
  const badPreview = previewBulkCatalogImport("just a name\nBread | 1.20");
  assert(badPreview.invalid.length >= 1, "malformed flagged");
  assert(badPreview.valid.length === 1, "valid still parsed");

  console.log("11) duplicate catalog entries handled…");
  const dupPreview = previewBulkCatalogImport("Bread | 1.20\nBread | 1.30", ["Bread"]);
  assert(dupPreview.duplicates.length >= 1, "duplicate warned");

  console.log("12) readiness NOT_READY with no catalog…");
  const emptyShop = await createMerchant({
    name: `Empty ${suffix}`,
    whatsappPhone: `0773${suffix.slice(0, 6)}`,
    locationLabel: "Empty",
    latitude: lat + 0.02,
    longitude: lng + 0.02,
    openingHours: "Daily"
  });
  const notReady = await getMerchantReadiness(emptyShop.id);
  assert(notReady.status === "NOT_READY", "not ready empty");
  assert(notReady.availableProductCount === 0, "0 products");

  console.log("13) readiness READY with valid setup…");
  for (let i = 0; i < 10; i++) {
    await upsertProductForMerchant(merchant.id, {
      name: `Staple ${i}`,
      priceCents: 100 + i,
      available: true,
      searchAliases: []
    });
  }
  await confirmBulkCatalogImport(
    merchant.id,
    "Cooking Oil 2L | 4.50\nRice 2kg | 3.20"
  );
  const ready = await getMerchantReadiness(merchant.id);
  assert(ready.status === "READY", `ready got ${ready.status} count=${ready.availableProductCount}`);

  console.log("14) unauthorized merchant WhatsApp cannot ACCEPT/READY…");
  mock.clear();
  await handleMerchantWhatsAppMessage(
    {
      providerMessageId: `unauth-${Date.now()}`,
      from: `+26379${suffix}`,
      text: "ACCEPT 1"
    },
    io
  );
  assert(
    mock.sent.some((m) => /not linked|not authorized|onboard/i.test(m.body)),
    "unauthorized blocked"
  );

  console.log("15) changed authorized merchant number works…");
  const newWa = normalizeMerchantPhone(`0774${suffix.slice(0, 6)}`);
  await updateMerchant(merchant.id, { whatsappPhone: newWa });
  const authorized = await requireAuthorizedMerchant(newWa);
  assert(authorized.id === merchant.id, "new number authorized");
  assert(!(await findMerchantByWhatsApp(waLocal)), "old number released");

  console.log("16) test basket uses real matching logic…");
  const test = await testMerchantBasket({
    merchantId: merchant.id,
    customerLat: lat + 0.001,
    customerLng: lng + 0.001,
    items: [
      { query: "bread", quantity: 1 },
      { query: "xyzzy-no-sku", quantity: 1 }
    ]
  });
  assert(test.matched.some((m) => /bread/i.test(m.productName)), "matched bread");
  assert(test.missing.includes("xyzzy-no-sku"), "missing item");
  assert(test.canFulfilFullBasket === false, "cannot fulfil full");
  assert(test.eligible === true, "eligible nearby");

  console.log("Merchant onboarding pilot tests passed.");
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
