/**
 * Dev-only Harare marketplace test merchants (NOT real businesses).
 * Called from seed when APP_ENV=development|test or SEED_MARKETPLACE_TEST_DATA=true.
 */
import { normalizeProductSearchName } from "@gigflow/shared";
import type { PrismaClient } from "@prisma/client";

type CatalogItem = { name: string; priceCents: number; aliases: string[]; available?: boolean };

const TEST_MERCHANTS: Array<{
  name: string;
  whatsappPhone: string;
  locationLabel: string;
  latitude: number;
  longitude: number;
  acceptsOrders: boolean;
  catalog: CatalogItem[];
}> = [
  {
    name: "[TEST] Highfield Corner Shop",
    whatsappPhone: "+263771000101",
    locationLabel: "Highfield (test)",
    latitude: -17.8665,
    longitude: 30.9925,
    acceptsOrders: true,
    catalog: [
      { name: "Lobels Bread White", priceCents: 100, aliases: ["bread", "loaf"] },
      { name: "Lobels Bread Brown", priceCents: 110, aliases: ["brown bread"] },
      { name: "Eggs 6 Pack", priceCents: 250, aliases: ["eggs"] },
      { name: "Coca-Cola 500ml", priceCents: 80, aliases: ["coke 500", "coke"] },
      { name: "Coca-Cola 2L", priceCents: 200, aliases: ["coke", "2l coke", "coca cola"] },
      { name: "Mazoe Orange 2L", priceCents: 250, aliases: ["mazoe"] },
      { name: "Milk 1L", priceCents: 180, aliases: ["milk"] },
      { name: "Sugar 2kg", priceCents: 300, aliases: ["sugar"] },
      { name: "Cooking Oil 2L", priceCents: 400, aliases: ["oil"] },
      { name: "Rice 2kg", priceCents: 350, aliases: ["rice"] },
      { name: "Soap Bar", priceCents: 70, aliases: ["soap"] },
      { name: "Bottled Water 1.5L", priceCents: 90, aliases: ["water"] },
      { name: "Pepsi 2L", priceCents: 190, aliases: ["pepsi"] },
      { name: "Flour 2kg", priceCents: 280, aliases: ["flour"] },
      { name: "Salt 1kg", priceCents: 60, aliases: ["salt"] }
    ]
  },
  {
    name: "[TEST] Mbare Market Kiosk",
    whatsappPhone: "+263771000102",
    locationLabel: "Mbare (test)",
    latitude: -17.855,
    longitude: 31.04,
    acceptsOrders: true,
    catalog: [
      { name: "Lobels Bread White", priceCents: 95, aliases: ["bread"] },
      { name: "Eggs 6 Pack", priceCents: 240, aliases: ["eggs"] },
      { name: "Coca-Cola 2L", priceCents: 195, aliases: ["coke", "coca cola"] },
      { name: "Mazoe Orange 2L", priceCents: 240, aliases: ["mazoe"] },
      { name: "Milk 1L", priceCents: 170, aliases: ["milk"] },
      { name: "Sugar 2kg", priceCents: 290, aliases: ["sugar"] },
      { name: "Tomatoes 1kg", priceCents: 150, aliases: ["tomatoes", "tomato"] },
      { name: "Onions 1kg", priceCents: 120, aliases: ["onions"] },
      { name: "Kapenta 250g", priceCents: 350, aliases: ["kapenta"] },
      { name: "Mealie Meal 2kg", priceCents: 320, aliases: ["mealie meal", "flour"] },
      { name: "Cooking Oil 2L", priceCents: 390, aliases: ["oil"] },
      { name: "Matches Box", priceCents: 40, aliases: ["matches"] },
      { name: "Candles Pack", priceCents: 100, aliases: ["candles"] },
      { name: "Soap Bar", priceCents: 65, aliases: ["soap"] },
      { name: "Water 500ml", priceCents: 50, aliases: ["water"] }
    ]
  },
  {
    name: "[TEST] Avondale Mini Mart",
    whatsappPhone: "+263771000103",
    locationLabel: "Avondale (test)",
    latitude: -17.8,
    longitude: 31.03,
    acceptsOrders: true,
    catalog: [
      { name: "Artisan Sourdough", priceCents: 350, aliases: ["bread", "sourdough"] },
      { name: "Free Range Eggs 6", priceCents: 400, aliases: ["eggs"] },
      { name: "Coca-Cola 1L", priceCents: 150, aliases: ["coke", "1l coke"] },
      { name: "Coca-Cola 2L", priceCents: 220, aliases: ["coke", "2l coke"] },
      { name: "Almond Milk 1L", priceCents: 450, aliases: ["milk", "almond milk"] },
      { name: "Organic Sugar 1kg", priceCents: 380, aliases: ["sugar"] },
      { name: "Olive Oil 500ml", priceCents: 800, aliases: ["oil", "olive oil"] },
      { name: "Basmati Rice 1kg", priceCents: 500, aliases: ["rice"] },
      { name: "Granola 500g", priceCents: 600, aliases: ["granola", "snacks"] },
      { name: "Yoghurt 500ml", priceCents: 280, aliases: ["yoghurt", "yogurt"] },
      { name: "Butter 500g", priceCents: 450, aliases: ["butter"] },
      { name: "Cheese 250g", priceCents: 550, aliases: ["cheese"] },
      { name: "Juice Tropical 1L", priceCents: 300, aliases: ["juice"] },
      { name: "Chips 150g", priceCents: 120, aliases: ["chips", "snacks"] },
      { name: "Chocolate Bar", priceCents: 100, aliases: ["chocolate"] }
    ]
  },
  {
    name: "[TEST] Closed Tuck (do not order)",
    whatsappPhone: "+263771000104",
    locationLabel: "Highfield closed (test)",
    latitude: -17.867,
    longitude: 30.993,
    acceptsOrders: false,
    catalog: [
      { name: "Lobels Bread White", priceCents: 90, aliases: ["bread"] },
      { name: "Coca-Cola 2L", priceCents: 180, aliases: ["coke"] }
    ]
  },
  {
    name: "[TEST] Far Outside Radius Shop",
    whatsappPhone: "+263771000105",
    locationLabel: "Chitungwiza (test far)",
    latitude: -18.01,
    longitude: 31.08,
    acceptsOrders: true,
    catalog: [
      { name: "Unique Far Bread", priceCents: 100, aliases: ["far bread", "bread"] },
      { name: "Unique Far Eggs", priceCents: 200, aliases: ["far eggs", "eggs"] },
      { name: "Unique Far Coke", priceCents: 200, aliases: ["far coke", "coke"] }
    ]
  }
];

export async function seedMarketplaceTestData(prisma: PrismaClient): Promise<void> {
  const allow =
    process.env.SEED_MARKETPLACE_TEST_DATA === "true" ||
    ["development", "test", "dev"].includes((process.env.APP_ENV ?? process.env.NODE_ENV ?? "").toLowerCase());
  if (!allow) {
    console.log("Skipping [TEST] marketplace merchants (set SEED_MARKETPLACE_TEST_DATA=true to force).");
    return;
  }

  for (const shop of TEST_MERCHANTS) {
    const merchant = await prisma.merchant.upsert({
      where: { whatsappPhone: shop.whatsappPhone },
      update: {
        name: shop.name,
        locationLabel: shop.locationLabel,
        latitude: shop.latitude,
        longitude: shop.longitude,
        isActive: true,
        acceptsOrders: shop.acceptsOrders
      },
      create: {
        name: shop.name,
        contactName: "Test Operator",
        phone: shop.whatsappPhone,
        whatsappPhone: shop.whatsappPhone,
        locationLabel: shop.locationLabel,
        latitude: shop.latitude,
        longitude: shop.longitude,
        category: "TUCK_SHOP",
        isActive: true,
        acceptsOrders: shop.acceptsOrders
      }
    });

    for (const item of shop.catalog) {
      const normalizedName = normalizeProductSearchName(item.name);
      const existing = await prisma.product.findFirst({
        where: { merchantId: merchant.id, normalizedName }
      });
      if (existing) {
        await prisma.product.update({
          where: { id: existing.id },
          data: {
            priceCents: item.priceCents,
            available: item.available !== false,
            archived: false,
            searchAliases: item.aliases
          }
        });
      } else {
        await prisma.product.create({
          data: {
            merchantId: merchant.id,
            name: item.name,
            normalizedName,
            priceCents: item.priceCents,
            available: item.available !== false,
            searchAliases: item.aliases,
            category: "GROCERY"
          }
        });
      }
    }
  }

  console.log(
    `Seeded ${TEST_MERCHANTS.length} [TEST] Harare marketplace merchants (dev only — not real businesses).`
  );
}
