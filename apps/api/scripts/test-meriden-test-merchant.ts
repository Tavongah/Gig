/**
 * Meriden CT mock shop seed + intl merchant WhatsApp tests.
 * Run: npm run test:meriden-test-merchant -w @gigflow/api
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { distanceKmBetween } from "@gigflow/shared";

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

  const suffix = String(Date.now()).slice(-6);
  // Synthetic US test number — not a real business line
  const usLocal = `203555${suffix.slice(0, 4)}`.slice(0, 10);
  process.env.SEED_MERIDEN_TEST_MERCHANT_WHATSAPP = `+1${usLocal}`;

  const {
    MERIDEN_TEST_CATALOG,
    MERIDEN_TEST_CUSTOMER_LAT,
    MERIDEN_TEST_CUSTOMER_LNG,
    MERIDEN_TEST_MERCHANT_LAT,
    MERIDEN_TEST_MERCHANT_LNG,
    MERIDEN_TEST_MERCHANT_NAME,
    seedMeridenTestMerchant
  } = await import("./seed-meriden-test-merchant.js");
  const {
    normalizeMerchantPhone,
    findNearbyMerchants,
    findMerchantByWhatsApp,
    requireAuthorizedMerchant,
    createMerchant,
    searchProductsNear
  } = await import("../src/modules/commerce/merchant.service.js");
  const { getMerchantReadiness } = await import(
    "../src/modules/commerce/merchant-onboarding.service.js"
  );
  const { prisma } = await import("../src/config/prisma.js");
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

  console.log("1) +1 US merchant WhatsApp normalizes…");
  const normalizedUs = normalizeMerchantPhone(`+1 ${usLocal.slice(0, 3)}-${usLocal.slice(3, 6)}-${usLocal.slice(6)}`);
  assert(normalizedUs === `+1${usLocal}`, `got ${normalizedUs}`);
  assert(normalizeMerchantPhone(usLocal) === `+1${usLocal}`, "10-digit NANP");
  assert(
    normalizeMerchantPhone(`whatsapp:+1${usLocal}`) === `+1${usLocal}`,
    "whatsapp: prefix"
  );

  console.log("2) seed succeeds + READY…");
  const first = await seedMeridenTestMerchant();
  assert(first.merchantId, "merchant id");
  assert(first.readinessStatus === "READY", `readiness ${first.readinessStatus}`);
  assert(first.catalogCount === MERIDEN_TEST_CATALOG.length, `catalog ${first.catalogCount}`);

  const readiness = await getMerchantReadiness(first.merchantId);
  assert(readiness.checks.whatsapp === "PASS", "whatsapp check");
  assert(readiness.checks.location === "PASS", "location check");
  assert(readiness.checks.openingHours === "PASS", "hours check");
  assert(readiness.checks.active === "PASS", "active check");
  assert(readiness.checks.acceptsOrders === "PASS", "accepts check");
  assert(readiness.checks.catalog === "PASS", "catalog check");
  assert(readiness.status === "READY", "overall READY");

  console.log("3) duplicate-safe re-seed…");
  const second = await seedMeridenTestMerchant();
  assert(second.merchantId === first.merchantId, "same merchant id");
  assert(second.catalogCount === MERIDEN_TEST_CATALOG.length, "catalog stable");
  const named = await prisma.merchant.count({
    where: {
      name: MERIDEN_TEST_MERCHANT_NAME,
      notes: { contains: "MERIDEN E2E TESTING" }
    }
  });
  assert(named === 1, `exactly one Meriden test merchant, got ${named}`);
  const products = await prisma.product.count({
    where: { merchantId: first.merchantId, archived: false, available: true }
  });
  assert(products === MERIDEN_TEST_CATALOG.length, `products ${products}`);

  console.log("4) nearby Meriden customer discovers shop…");
  const nearKm = distanceKmBetween(
    { latitude: MERIDEN_TEST_CUSTOMER_LAT, longitude: MERIDEN_TEST_CUSTOMER_LNG },
    { latitude: MERIDEN_TEST_MERCHANT_LAT, longitude: MERIDEN_TEST_MERCHANT_LNG }
  );
  assert(nearKm >= 0.4 && nearKm <= 1.2, `near distance ${nearKm.toFixed(3)} km`);
  const nearby = await findNearbyMerchants(MERIDEN_TEST_CUSTOMER_LAT, MERIDEN_TEST_CUSTOMER_LNG);
  assert(
    nearby.some((r) => r.merchant.id === first.merchantId),
    "nearby find"
  );

  console.log("5) distant customer does not match…");
  const distant = await findNearbyMerchants(40.7128, -74.006); // NYC
  assert(
    !distant.some((r) => r.merchant.id === first.merchantId),
    "NYC outside radius"
  );

  console.log("6) product phrases resolve via existing matching…");
  for (const q of ["bread", "coke", "chips", "toilet paper", "cooking oil", "orange juice"]) {
    const hits = await searchProductsNear(MERIDEN_TEST_CUSTOMER_LAT, MERIDEN_TEST_CUSTOMER_LNG, q);
    assert(
      hits.some((h) => h.merchant.id === first.merchantId && h.score > 0),
      `match ${q}`
    );
  }

  console.log("7) authorized +1 merchant WhatsApp…");
  const authorized = await requireAuthorizedMerchant(normalizedUs);
  assert(authorized.id === first.merchantId, "authorized");
  assert(await findMerchantByWhatsApp(normalizedUs), "find by wa");

  console.log("8) unauthorized number cannot ACCEPT/REJECT/READY…");
  mock.clear();
  await handleMerchantWhatsAppMessage(
    {
      providerMessageId: `meriden-unauth-${Date.now()}`,
      from: "+12035559999",
      text: "ACCEPT 1"
    },
    io
  );
  assert(
    mock.sent.some((m) => /not linked|not authorized|onboard/i.test(m.body)),
    "unauthorized blocked"
  );

  console.log("9) existing +263 merchant behavior unchanged…");
  const zwLocal = `0771${suffix}`;
  const zw = await createMerchant({
    name: `ZW Regression ${suffix}`,
    whatsappPhone: zwLocal,
    locationLabel: "Harare Pilot",
    latitude: -17.8665,
    longitude: 30.9925,
    openingHours: "Mon–Sat 08:00–18:00",
    pilotArea: "Glen Norah",
    notes: "ZW regression for Meriden seed tests"
  });
  assert(zw.whatsappPhone === normalizeMerchantPhone(zwLocal), "zw normalize");
  assert(zw.whatsappPhone.startsWith("+263"), "zw e164");
  const zwAuth = await requireAuthorizedMerchant(zwLocal);
  assert(zwAuth.id === zw.id, "zw authorized via local form");

  // cleanup Meriden test merchant products/merchant? Keep for local e2e convenience —
  // only delete the ephemeral ZW regression merchant.
  await prisma.product.deleteMany({ where: { merchantId: zw.id } });
  await prisma.merchant.delete({ where: { id: zw.id } });

  console.log("OK — Meriden test merchant suite passed.");
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
