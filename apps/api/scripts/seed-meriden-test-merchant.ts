/**
 * Meriden, CT mock convenience shop for controlled E2E testing.
 * TEST DATA ONLY — not a real business.
 *
 * Required:
 *   SEED_MERIDEN_TEST_MERCHANT_WHATSAPP=+1…   (your real test WhatsApp; never commit)
 *
 * Optional overrides:
 *   SEED_MERIDEN_TEST_MERCHANT_LAT=41.5382
 *   SEED_MERIDEN_TEST_MERCHANT_LNG=-72.8070
 *
 * Blocked in APP_ENV=production|pilot (use admin onboarding UI there).
 *
 * Run: npm run seed:meriden-test-merchant -w @gigflow/api
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeProductSearchName } from "@gigflow/shared";

const here = fileURLToPath(new URL(".", import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });
loadEnv({ path: resolve(here, "../.env") });

export const MERIDEN_TEST_MERCHANT_NAME = "DUTS Meriden Test Market";
export const MERIDEN_TEST_MERCHANT_NOTES =
  "TEST MERCHANT — NOT A REAL BUSINESS — MERIDEN E2E TESTING";
export const MERIDEN_TEST_MERCHANT_LAT = 41.5382;
export const MERIDEN_TEST_MERCHANT_LNG = -72.8070;
/** ~0.6 km north of shop — safe synthetic customer point (not a real address). */
export const MERIDEN_TEST_CUSTOMER_LAT = 41.5435;
export const MERIDEN_TEST_CUSTOMER_LNG = -72.8070;

export const MERIDEN_TEST_CATALOG: Array<{
  name: string;
  priceCents: number;
  searchAliases: string[];
}> = [
  { name: "Bread", priceCents: 200, searchAliases: ["loaf", "breads", "bred"] },
  { name: "Eggs 12 Pack", priceCents: 350, searchAliases: ["eggs", "egg", "dozen eggs"] },
  { name: "Milk 1 Gallon", priceCents: 400, searchAliases: ["milk", "gallon milk"] },
  {
    name: "Coca-Cola 2L",
    priceCents: 300,
    searchAliases: ["coke", "coca cola", "cola", "coka"]
  },
  { name: "Pepsi 2L", priceCents: 300, searchAliases: ["pepsi"] },
  {
    name: "Orange Juice",
    priceCents: 350,
    searchAliases: ["oj", "orange juice", "juice"]
  },
  {
    name: "Bottled Water",
    priceCents: 100,
    searchAliases: ["water", "bottle water"]
  },
  { name: "Rice 2 lb", priceCents: 300, searchAliases: ["rice"] },
  { name: "Sugar 2 lb", priceCents: 250, searchAliases: ["sugar"] },
  {
    name: "Cooking Oil",
    priceCents: 450,
    searchAliases: ["oil", "cooking oil", "cookin oil"]
  },
  {
    name: "Potato Chips",
    priceCents: 200,
    searchAliases: ["chips", "crisps", "potato chips"]
  },
  { name: "Cookies", priceCents: 200, searchAliases: ["cookie", "biscuits"] },
  { name: "Bananas", priceCents: 200, searchAliases: ["banana"] },
  { name: "Apples", priceCents: 300, searchAliases: ["apple"] },
  {
    name: "Chicken Breast",
    priceCents: 600,
    searchAliases: ["chicken", "chicken breast"]
  },
  {
    name: "Ground Beef",
    priceCents: 600,
    searchAliases: ["beef", "mince", "ground beef"]
  },
  { name: "Pasta", priceCents: 200, searchAliases: ["spaghetti", "noodles"] },
  {
    name: "Tomato Sauce",
    priceCents: 200,
    searchAliases: ["sauce", "pasta sauce"]
  },
  {
    name: "Toilet Paper 4 Pack",
    priceCents: 400,
    searchAliases: ["toilet paper", "tp", "tissue"]
  },
  { name: "Dish Soap", priceCents: 300, searchAliases: ["soap", "dishwashing soap"] }
];

function describeDbTarget(url: string | undefined): string {
  if (!url) return "(DATABASE_URL not set)";
  try {
    const u = new URL(url);
    const db = u.pathname.replace(/^\//, "") || "(unknown-db)";
    const port = u.port || "5432";
    return `${u.hostname}:${port}/${db}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

export async function seedMeridenTestMerchant(opts?: {
  whatsappPhone?: string;
  latitude?: number;
  longitude?: number;
}): Promise<{
  merchantId: string;
  whatsappPhone: string;
  catalogCount: number;
  readinessStatus: string;
  created: boolean;
  nearbyCustomer: { lat: number; lng: number };
}> {
  const appEnv = (process.env.APP_ENV ?? process.env.NODE_ENV ?? "development").toLowerCase();
  if (appEnv === "production" || appEnv === "pilot") {
    throw new Error(
      "Meriden test merchant seed is blocked in production/pilot. Use the admin merchant onboarding UI."
    );
  }

  const whatsappRaw =
    opts?.whatsappPhone?.trim() || process.env.SEED_MERIDEN_TEST_MERCHANT_WHATSAPP?.trim();
  if (!whatsappRaw) {
    throw new Error(
      "Set SEED_MERIDEN_TEST_MERCHANT_WHATSAPP to your test merchant WhatsApp (E.164, e.g. +1…)."
    );
  }

  const lat = Number(
    opts?.latitude ?? process.env.SEED_MERIDEN_TEST_MERCHANT_LAT ?? MERIDEN_TEST_MERCHANT_LAT
  );
  const lng = Number(
    opts?.longitude ?? process.env.SEED_MERIDEN_TEST_MERCHANT_LNG ?? MERIDEN_TEST_MERCHANT_LNG
  );
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("Invalid Meriden test merchant coordinates.");
  }

  const {
    createMerchant,
    updateMerchant,
    findMerchantByWhatsApp,
    normalizeMerchantPhone,
    upsertProductForMerchant,
    archiveProduct,
    listMerchantProducts,
    findNearbyMerchants
  } = await import("../src/modules/commerce/merchant.service.js");
  const { getMerchantReadiness } = await import(
    "../src/modules/commerce/merchant-onboarding.service.js"
  );
  const { prisma } = await import("../src/config/prisma.js");

  const whatsappPhone = normalizeMerchantPhone(whatsappRaw);

  console.log("—— Meriden test merchant seed ——");
  console.log(`APP_ENV: ${appEnv}`);
  console.log(`Database: ${describeDbTarget(process.env.DATABASE_URL)}`);
  console.log(`Merchant: ${MERIDEN_TEST_MERCHANT_NAME}`);
  console.log(`WhatsApp (normalized): ${whatsappPhone}`);
  console.log(`Coords: ${lat}, ${lng}`);

  let merchant = await findMerchantByWhatsApp(whatsappPhone);
  let created = false;

  if (!merchant) {
    merchant = await prisma.merchant.findFirst({
      where: {
        name: MERIDEN_TEST_MERCHANT_NAME,
        notes: { contains: "MERIDEN E2E TESTING" }
      }
    });
  }

  if (!merchant) {
    merchant = await createMerchant({
      name: MERIDEN_TEST_MERCHANT_NAME,
      contactName: "DUTS Test Merchant",
      whatsappPhone,
      locationLabel: "Meriden, Connecticut",
      latitude: lat,
      longitude: lng,
      openingHours: "Always open (test hours 00:00–23:59)",
      pilotArea: "Meriden, CT",
      notes: MERIDEN_TEST_MERCHANT_NOTES,
      acceptsOrders: true,
      isActive: true
    });
    created = true;
    console.log(`Created merchant ${merchant.id}`);
  } else {
    merchant = await updateMerchant(merchant.id, {
      name: MERIDEN_TEST_MERCHANT_NAME,
      contactName: "DUTS Test Merchant",
      whatsappPhone,
      phone: whatsappPhone,
      locationLabel: "Meriden, Connecticut",
      latitude: lat,
      longitude: lng,
      openingHours: "Always open (test hours 00:00–23:59)",
      pilotArea: "Meriden, CT",
      notes: MERIDEN_TEST_MERCHANT_NOTES,
      acceptsOrders: true,
      isActive: true
    });
    console.log(`Updated merchant ${merchant.id}`);
  }

  const keepNormalized = new Set(
    MERIDEN_TEST_CATALOG.map((p) => normalizeProductSearchName(p.name))
  );

  for (const item of MERIDEN_TEST_CATALOG) {
    const normalizedName = normalizeProductSearchName(item.name);
    const matches = await prisma.product.findMany({
      where: { merchantId: merchant.id, normalizedName, archived: false },
      orderBy: { createdAt: "asc" }
    });
    const primary = matches[0];
    for (const extra of matches.slice(1)) {
      await archiveProduct(merchant.id, extra.id);
    }
    await upsertProductForMerchant(
      merchant.id,
      {
        name: item.name,
        priceCents: item.priceCents,
        currency: "usd",
        available: true,
        searchAliases: item.searchAliases
      },
      primary?.id
    );
  }

  const existing = await listMerchantProducts(merchant.id, true);
  for (const product of existing) {
    if (!keepNormalized.has(product.normalizedName)) {
      await archiveProduct(merchant.id, product.id);
    }
  }

  const catalog = await listMerchantProducts(merchant.id, false);
  const readiness = await getMerchantReadiness(merchant.id);
  const nearby = await findNearbyMerchants(MERIDEN_TEST_CUSTOMER_LAT, MERIDEN_TEST_CUSTOMER_LNG);
  const foundNearby = nearby.some((row) => row.merchant.id === merchant.id);

  console.log(`Catalog available: ${catalog.length}`);
  console.log(readiness.summary);
  console.log(
    `Nearby discovery @ ${MERIDEN_TEST_CUSTOMER_LAT},${MERIDEN_TEST_CUSTOMER_LNG}: ${
      foundNearby ? "PASS" : "FAIL"
    }`
  );
  console.log(
    `Safe customer test point (not a real address): ${MERIDEN_TEST_CUSTOMER_LAT}, ${MERIDEN_TEST_CUSTOMER_LNG}`
  );

  return {
    merchantId: merchant.id,
    whatsappPhone: merchant.whatsappPhone,
    catalogCount: catalog.length,
    readinessStatus: readiness.status,
    created,
    nearbyCustomer: {
      lat: MERIDEN_TEST_CUSTOMER_LAT,
      lng: MERIDEN_TEST_CUSTOMER_LNG
    }
  };
}

async function main() {
  const result = await seedMeridenTestMerchant();
  console.log(
    JSON.stringify(
      {
        ok: true,
        merchantId: result.merchantId,
        catalogCount: result.catalogCount,
        readiness: result.readinessStatus,
        created: result.created,
        nearbyCustomer: result.nearbyCustomer
      },
      null,
      2
    )
  );
  const { prisma } = await import("../src/config/prisma.js");
  await prisma.$disconnect();
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].includes("seed-meriden-test-merchant") ||
    process.argv[1].endsWith("seed-meriden-test-merchant.ts") ||
    process.argv[1].endsWith("seed-meriden-test-merchant.js"));

if (isDirectRun) {
  main().catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    try {
      const { prisma } = await import("../src/config/prisma.js");
      await prisma.$disconnect();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
}
