import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { AccountStatus, LaunchPhase, PrismaClient, UserRole } from "@prisma/client";
import { hashPassword } from "../src/lib/password.js";

const here = fileURLToPath(new URL(".", import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });
loadEnv({ path: resolve(here, "../.env") });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to seed the database.");
}

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

type CategorySeed = [
  slug: string,
  name: string,
  description: string,
  iconName: string,
  baseRateCents: number,
  hourlyRateCents: number,
  distanceRateCents: number,
  multiplier: number,
  launchPhase: LaunchPhase
];

const categories: CategorySeed[] = [
  ["moving-assistance", "Moving Assistance", "Loading, unloading, and short-term moving help.", "truck", 6000, 2500, 200, 1.35, LaunchPhase.MVP],
  ["house-cleaning", "House Cleaning", "Whole-home cleaning for apartments and houses.", "sparkles", 4500, 2500, 150, 1.15, LaunchPhase.MVP],
  ["room-cleaning", "Room Cleaning", "Single-room cleaning and organization.", "home", 2500, 2500, 125, 0.95, LaunchPhase.MVP],
  ["lawn-cutting", "Lawn Cutting", "Mowing, edging, and basic yard cleanup.", "leaf", 3500, 2500, 125, 1, LaunchPhase.MVP],
  ["short-term-labor", "Short-Term Labor", "Flexible local labor for projects and events.", "hammer", 5000, 2500, 200, 1.3, LaunchPhase.MVP],
  ["car-detailing", "Car Detailing", "Interior and exterior vehicle detailing.", "car", 5000, 2500, 175, 1.2, LaunchPhase.MVP],
  ["furniture-assembly", "Furniture Assembly", "Assemble furniture, fixtures, and flat-pack items.", "wrench", 4000, 2500, 150, 1.1, LaunchPhase.MVP],
  ["junk-removal", "Junk Removal", "Haul away unwanted items and light debris.", "trash", 5500, 2500, 200, 1.25, LaunchPhase.MVP],
  ["event-help", "Event Help", "Setup, teardown, and on-site event support.", "calendar", 4500, 2500, 175, 1.2, LaunchPhase.MVP],
  [
    "parcel-delivery",
    "Parcel Delivery",
    "Hyperlocal parcel delivery (DUTS Delivery).",
    "package",
    200,
    0,
    50,
    1,
    LaunchPhase.MVP
  ],
  ["babysitting", "Babysitting", "Short-term childcare from vetted local workers.", "baby", 4000, 2500, 150, 1.25, LaunchPhase.PHASE_2],
  ["companionship", "Companionship", "Companionship, errands, and light support.", "heart", 3000, 2500, 125, 1.05, LaunchPhase.PHASE_2],
  ["caregiving-pickup", "Overnight Caregiving Pickup", "Late-night pickup and caregiving support.", "moon", 7000, 2500, 250, 1.6, LaunchPhase.PHASE_2],
  [
    "virtual-assistant",
    "Virtual Assistant / Personal Assistant",
    "Administrative tasks, errands, and assistant gigs.",
    "briefcase",
    3500,
    2500,
    150,
    1.1,
    LaunchPhase.PHASE_2
  ]
];

async function main(): Promise<void> {
  for (const [slug, name, description, iconName, baseRateCents, hourlyRateCents, distanceRateCents, multiplier, launchPhase] of categories) {
    await prisma.serviceCategory.upsert({
      where: { slug },
      update: {
        name,
        description,
        iconName,
        baseRateCents,
        hourlyRateCents,
        distanceRateCents,
        multiplier,
        launchPhase,
        isActive: true
      },
      create: {
        slug,
        name,
        description,
        iconName,
        baseRateCents,
        hourlyRateCents,
        distanceRateCents,
        multiplier,
        launchPhase,
        isActive: true
      }
    });
  }

  await prisma.serviceCategory.updateMany({
    where: { slug: "admin-assistant" },
    data: { isActive: false }
  });

  const existingCommission = await prisma.commissionSetting.findFirst();
  if (!existingCommission) {
    await prisma.commissionSetting.create({
      data: { rate: 0.2 }
    });
  }

  await prisma.platformSetting.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      cancellationFeePercent: 0.15,
      cancellationGraceMinutes: 5,
      deliveryMaxDistanceKm: 10,
      deliveryBaseFeeCents: 200,
      deliveryPricePerKmCents: 50,
      deliveryMinimumFeeCents: 200
    }
  });

  const adminPassword = process.env.ADMIN_SEED_PASSWORD;
  if (!adminPassword || adminPassword.length < 12) {
    throw new Error("Set ADMIN_SEED_PASSWORD (min 12 characters) in apps/api/.env before seeding.");
  }

  const adminPasswordHash = await hashPassword(adminPassword);
  const adminEmail = "info@duts.tech";
  const legacyAdminEmail = "admin@gigflow.local";
  const adminData = {
    fullName: "DUTS Admin",
    roles: [UserRole.ADMIN, UserRole.CLIENT],
    defaultRole: UserRole.ADMIN,
    accountStatus: AccountStatus.ACTIVE,
    passwordHash: adminPasswordHash,
    emailVerified: true,
    phoneVerified: true,
    profileCompleted: true,
    isVerified: true
  };

  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  const legacyAdmin = await prisma.user.findUnique({ where: { email: legacyAdminEmail } });

  if (legacyAdmin && !existingAdmin) {
    await prisma.user.update({
      where: { id: legacyAdmin.id },
      data: { email: adminEmail, ...adminData }
    });
  } else {
    await prisma.user.upsert({
      where: { email: adminEmail },
      update: adminData,
      create: { email: adminEmail, ...adminData }
    });
    if (legacyAdmin && legacyAdmin.id !== existingAdmin?.id) {
      await prisma.user.update({
        where: { id: legacyAdmin.id },
        data: {
          roles: legacyAdmin.roles.filter((role) => role !== UserRole.ADMIN)
        }
      });
    }
  }

  const demoPasswordHash = await hashPassword("Demo123!");
  const lawnCategory = await prisma.serviceCategory.findUnique({ where: { slug: "lawn-cutting" } });
  const cleaningCategory = await prisma.serviceCategory.findUnique({ where: { slug: "house-cleaning" } });
  const categoryIds = [lawnCategory?.id, cleaningCategory?.id].filter((id): id is string => Boolean(id));

  await prisma.user.upsert({
    where: { email: "client@gigflow.local" },
    update: {
      fullName: "Demo Client",
      roles: ["CLIENT"],
      defaultRole: "CLIENT",
      accountStatus: AccountStatus.ACTIVE,
      passwordHash: demoPasswordHash,
      phoneNumber: "+15550100001",
      emailVerified: true,
      phoneVerified: true,
      profileCompleted: true,
      isVerified: true,
      formattedAddress: "100 Market St, San Francisco, CA",
      city: "San Francisco",
      region: "CA",
      postalCode: "94105",
      country: "US",
      latitude: 37.7937,
      longitude: -122.3965
    },
    create: {
      email: "client@gigflow.local",
      fullName: "Demo Client",
      roles: ["CLIENT"],
      defaultRole: "CLIENT",
      accountStatus: AccountStatus.ACTIVE,
      passwordHash: demoPasswordHash,
      phoneNumber: "+15550100001",
      emailVerified: true,
      phoneVerified: true,
      profileCompleted: true,
      isVerified: true,
      formattedAddress: "100 Market St, San Francisco, CA",
      city: "San Francisco",
      region: "CA",
      postalCode: "94105",
      country: "US",
      latitude: 37.7937,
      longitude: -122.3965
    }
  });

  const demoWorker = await prisma.user.upsert({
    where: { email: "worker@gigflow.local" },
    update: {
      fullName: "Demo Worker",
      roles: ["WORKER", "CLIENT"],
      defaultRole: "WORKER",
      accountStatus: AccountStatus.APPROVED,
      passwordHash: demoPasswordHash,
      phoneNumber: "+15550100002",
      emailVerified: true,
      phoneVerified: true,
      profileCompleted: true,
      isVerified: true,
      formattedAddress: "200 Mission St, San Francisco, CA",
      city: "San Francisco",
      region: "CA",
      postalCode: "94105",
      country: "US",
      latitude: 37.7912,
      longitude: -122.392
    },
    create: {
      email: "worker@gigflow.local",
      fullName: "Demo Worker",
      roles: ["WORKER", "CLIENT"],
      defaultRole: "WORKER",
      accountStatus: AccountStatus.APPROVED,
      passwordHash: demoPasswordHash,
      phoneNumber: "+15550100002",
      emailVerified: true,
      phoneVerified: true,
      profileCompleted: true,
      isVerified: true,
      formattedAddress: "200 Mission St, San Francisco, CA",
      city: "San Francisco",
      region: "CA",
      postalCode: "94105",
      country: "US",
      latitude: 37.7912,
      longitude: -122.392
    }
  });

  if (categoryIds.length > 0) {
    await prisma.workerProfile.upsert({
      where: { userId: demoWorker.id },
      update: {
        bio: "Demo worker for launch smoke tests. Reliable local help for cleaning and yard work.",
        city: "San Francisco",
        serviceArea: "SF Bay Area",
        hasVehicle: true,
        backgroundCheckConsent: true,
        platformRulesAgreed: true,
        reviewedAt: new Date(),
        serviceCategories: { set: categoryIds.map((id) => ({ id })) },
        currentLatitude: 37.7912,
        currentLongitude: -122.392
      },
      create: {
        userId: demoWorker.id,
        bio: "Demo worker for launch smoke tests. Reliable local help for cleaning and yard work.",
        city: "San Francisco",
        serviceArea: "SF Bay Area",
        hasVehicle: true,
        backgroundCheckConsent: true,
        platformRulesAgreed: true,
        reviewedAt: new Date(),
        serviceCategories: { connect: categoryIds.map((id) => ({ id })) },
        currentLatitude: 37.7912,
        currentLongitude: -122.392
      }
    });
  }

  console.log("Seeded MVP categories, commission, admin, and demo client/worker accounts.");
  console.log("  info@duts.tech — password from ADMIN_SEED_PASSWORD in apps/api/.env");
  console.log("  client@gigflow.local / Demo123!");
  console.log("  worker@gigflow.local / Demo123! (approved worker)");

  // Stage 4 demo tuck shop (WhatsApp merchant number)
  const merchant = await prisma.merchant.upsert({
    where: { whatsappPhone: "+263771000001" },
    update: {
      name: "ABC Tuck Shop",
      isActive: true,
      acceptsOrders: true,
      locationLabel: "Highfield, Harare",
      latitude: -17.8665,
      longitude: 30.9925
    },
    create: {
      name: "ABC Tuck Shop",
      contactName: "Tendai",
      phone: "+263771000001",
      whatsappPhone: "+263771000001",
      locationLabel: "Highfield, Harare",
      latitude: -17.8665,
      longitude: 30.9925,
      category: "TUCK_SHOP",
      isActive: true,
      acceptsOrders: true
    }
  });

  const catalog: Array<{ name: string; priceCents: number; aliases: string[] }> = [
    { name: "Lobels Bread White", priceCents: 100, aliases: ["bread", "loaf", "lobels"] },
    { name: "Eggs 6 Pack", priceCents: 250, aliases: ["eggs", "egg"] },
    { name: "Coca-Cola 2L", priceCents: 200, aliases: ["coke", "coca cola", "coca-cola"] },
    { name: "Mazoe Orange Crush 2L", priceCents: 250, aliases: ["mazoe", "mazoe orange"] },
    { name: "Milk 1L", priceCents: 180, aliases: ["milk"] },
    { name: "Cooking Oil 2L", priceCents: 400, aliases: ["oil", "cooking oil"] },
    { name: "Sugar 2kg", priceCents: 300, aliases: ["sugar"] }
  ];

  for (const item of catalog) {
    const normalizedName = item.name.toLowerCase();
    const existing = await prisma.product.findFirst({
      where: { merchantId: merchant.id, normalizedName }
    });
    if (existing) {
      await prisma.product.update({
        where: { id: existing.id },
        data: {
          priceCents: item.priceCents,
          available: true,
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
          available: true,
          searchAliases: item.aliases,
          category: "GROCERY"
        }
      });
    }
  }

  console.log("Seeded Stage 4 demo merchant ABC Tuck Shop @ +263771000001 with sample catalog.");

  const { seedMarketplaceTestData } = await import("./seed-marketplace-test.js");
  await seedMarketplaceTestData(prisma);
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
