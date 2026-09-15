/**
 * Non-production pilot merchant seed.
 * Phone/coords come from env — never hardcode real production numbers.
 *
 * SEED_PILOT_MERCHANT_WHATSAPP=+2637…
 * SEED_PILOT_MERCHANT_LAT=-17.86
 * SEED_PILOT_MERCHANT_LNG=30.99
 * SEED_PILOT_MERCHANT_AREA=Glen Norah
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });
loadEnv({ path: resolve(here, "../.env") });

async function main() {
  const appEnv = (process.env.APP_ENV ?? process.env.NODE_ENV ?? "development").toLowerCase();
  if (appEnv === "production" || appEnv === "pilot") {
    throw new Error("Pilot merchant seed is blocked in production/pilot. Use admin UI.");
  }

  const whatsapp = process.env.SEED_PILOT_MERCHANT_WHATSAPP?.trim();
  const lat = Number(process.env.SEED_PILOT_MERCHANT_LAT);
  const lng = Number(process.env.SEED_PILOT_MERCHANT_LNG);
  if (!whatsapp || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error(
      "Set SEED_PILOT_MERCHANT_WHATSAPP, SEED_PILOT_MERCHANT_LAT, SEED_PILOT_MERCHANT_LNG"
    );
  }

  const { createMerchant, upsertProductForMerchant, findMerchantByWhatsApp } = await import(
    "../src/modules/commerce/merchant.service.js"
  );
  const { getMerchantReadiness } = await import(
    "../src/modules/commerce/merchant-onboarding.service.js"
  );
  const { prisma } = await import("../src/config/prisma.js");

  let merchant = await findMerchantByWhatsApp(whatsapp);
  if (!merchant) {
    merchant = await createMerchant({
      name: process.env.SEED_PILOT_MERCHANT_NAME?.trim() || "DUTS Pilot Tuck",
      contactName: "Pilot Manager",
      whatsappPhone: whatsapp,
      locationLabel: process.env.SEED_PILOT_MERCHANT_ADDRESS?.trim() || "Pilot test location",
      latitude: lat,
      longitude: lng,
      openingHours: "Mon–Sat 07:00–19:00",
      pilotArea: process.env.SEED_PILOT_MERCHANT_AREA?.trim() || "Pilot",
      notes: "Seeded for non-production E2E only",
      acceptsOrders: true,
      isActive: true
    });
    console.log("Created merchant", merchant.id);
  } else {
    console.log("Reusing merchant", merchant.id);
  }

  const catalog = [
    { name: "Bread", priceCents: 120, searchAliases: ["loaf", "lobels"] },
    { name: "Eggs 6 Pack", priceCents: 250, searchAliases: ["eggs"] },
    { name: "Mazoe Orange 2L", priceCents: 300, searchAliases: ["mazoe", "mazoe orange"] },
    { name: "Milk 1L", priceCents: 150, searchAliases: ["milk"] },
    { name: "Sugar 2kg", priceCents: 280, searchAliases: ["sugar"] },
    { name: "Cooking Oil 2L", priceCents: 450, searchAliases: ["oil", "cooking oil"] }
  ];

  for (const item of catalog) {
    await upsertProductForMerchant(merchant.id, {
      ...item,
      currency: "usd",
      available: true
    });
  }

  // Pad toward readiness threshold for local demos (still tiny catalog).
  for (let i = 1; i <= 6; i++) {
    await upsertProductForMerchant(merchant.id, {
      name: `Pilot Staple ${i}`,
      priceCents: 100 + i * 10,
      currency: "usd",
      available: true,
      searchAliases: []
    });
  }

  const readiness = await getMerchantReadiness(merchant.id);
  console.log(readiness.summary);
  await prisma.$disconnect();
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
