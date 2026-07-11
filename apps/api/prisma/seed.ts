import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { AccountStatus, LaunchPhase, PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password.js";

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
  ["moving-assistance", "Moving Assistance", "Loading, unloading, and short-term moving help.", "truck", 6000, 4200, 200, 1.35, LaunchPhase.MVP],
  ["house-cleaning", "House Cleaning", "Whole-home cleaning for apartments and houses.", "sparkles", 4500, 3200, 150, 1.15, LaunchPhase.MVP],
  ["room-cleaning", "Room Cleaning", "Single-room cleaning and organization.", "home", 2500, 2400, 125, 0.95, LaunchPhase.MVP],
  ["lawn-cutting", "Lawn Cutting", "Mowing, edging, and basic yard cleanup.", "leaf", 3500, 2800, 125, 1, LaunchPhase.MVP],
  ["short-term-labor", "Short-Term Labor", "Flexible local labor for projects and events.", "hammer", 5000, 3800, 200, 1.3, LaunchPhase.MVP],
  ["car-detailing", "Car Detailing", "Interior and exterior vehicle detailing.", "car", 5000, 3500, 175, 1.2, LaunchPhase.MVP],
  ["furniture-assembly", "Furniture Assembly", "Assemble furniture, fixtures, and flat-pack items.", "wrench", 4000, 3000, 150, 1.1, LaunchPhase.MVP],
  ["junk-removal", "Junk Removal", "Haul away unwanted items and light debris.", "trash", 5500, 3600, 200, 1.25, LaunchPhase.MVP],
  ["event-help", "Event Help", "Setup, teardown, and on-site event support.", "calendar", 4500, 3400, 175, 1.2, LaunchPhase.MVP],
  ["babysitting", "Babysitting", "Short-term childcare from vetted local workers.", "baby", 4000, 3000, 150, 1.25, LaunchPhase.PHASE_2],
  ["companionship", "Companionship", "Companionship, errands, and light support.", "heart", 3000, 2600, 125, 1.05, LaunchPhase.PHASE_2],
  ["caregiving-pickup", "Overnight Caregiving Pickup", "Late-night pickup and caregiving support.", "moon", 7000, 4500, 250, 1.6, LaunchPhase.PHASE_2],
  [
    "virtual-assistant",
    "Virtual Assistant / Personal Assistant",
    "Administrative tasks, errands, and assistant gigs.",
    "briefcase",
    3500,
    3000,
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

  const adminPassword = process.env.ADMIN_SEED_PASSWORD;
  if (!adminPassword || adminPassword.length < 12) {
    throw new Error("Set ADMIN_SEED_PASSWORD (min 12 characters) in apps/api/.env before seeding.");
  }

  const adminPasswordHash = await hashPassword(adminPassword);
  await prisma.user.upsert({
    where: { email: "admin@gigflow.local" },
    update: {
      fullName: "GIGFLOW Admin",
      roles: ["ADMIN", "CLIENT"],
      defaultRole: "ADMIN",
      accountStatus: AccountStatus.ACTIVE,
      passwordHash: adminPasswordHash,
      emailVerified: true,
      phoneVerified: true,
      profileCompleted: true,
      isVerified: true
    },
    create: {
      email: "admin@gigflow.local",
      fullName: "GIGFLOW Admin",
      roles: ["ADMIN", "CLIENT"],
      defaultRole: "ADMIN",
      accountStatus: AccountStatus.ACTIVE,
      passwordHash: adminPasswordHash,
      emailVerified: true,
      phoneVerified: true,
      profileCompleted: true,
      isVerified: true
    }
  });

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
  console.log("  admin@gigflow.local — password from ADMIN_SEED_PASSWORD in apps/api/.env");
  console.log("  client@gigflow.local / Demo123!");
  console.log("  worker@gigflow.local / Demo123! (approved worker)");
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
