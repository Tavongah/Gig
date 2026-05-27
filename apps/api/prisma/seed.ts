import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to seed the database.");
}

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

const categories = [
  ["lawn-cutting", "Lawn Cutting", "Mowing, edging, and basic yard cleanup.", "leaf", 3500, 2800, 125, 1],
  ["house-cleaning", "House Cleaning", "Whole-home cleaning for apartments and houses.", "sparkles", 4500, 3200, 150, 1.15],
  ["room-cleaning", "Room Cleaning", "Single-room cleaning and organization.", "home", 2500, 2400, 125, 0.95],
  ["car-detailing", "Car Detailing", "Interior and exterior vehicle detailing.", "car", 5000, 3500, 175, 1.2],
  ["moving-assistance", "Moving Assistance", "Loading, unloading, and short-term moving help.", "truck", 6000, 4200, 200, 1.35],
  ["babysitting", "Babysitting", "Short-term childcare from vetted local workers.", "baby", 4000, 3000, 150, 1.25],
  ["caregiving-pickup", "Overnight Caregiving Pickup", "Late-night pickup and caregiving support.", "moon", 7000, 4500, 250, 1.6],
  ["companionship", "Companionship", "Companionship, errands, and light support.", "heart", 3000, 2600, 125, 1.05],
  ["admin-assistant", "Admin/Assistant", "Administrative tasks, errands, and assistant gigs.", "briefcase", 3500, 3000, 150, 1.1],
  ["short-term-labor", "Short-Term Labor", "Flexible local labor for projects and events.", "hammer", 5000, 3800, 200, 1.3]
] as const;

async function main(): Promise<void> {
  for (const [slug, name, description, iconName, baseRateCents, hourlyRateCents, distanceRateCents, multiplier] of categories) {
    await prisma.serviceCategory.upsert({
      where: { slug },
      update: { name, description, iconName, baseRateCents, hourlyRateCents, distanceRateCents, multiplier },
      create: { slug, name, description, iconName, baseRateCents, hourlyRateCents, distanceRateCents, multiplier }
    });
  }

  const existingCommission = await prisma.commissionSetting.findFirst();
  if (!existingCommission) {
    await prisma.commissionSetting.create({
      data: { rate: 0.2 }
    });
  }

  await prisma.user.upsert({
    where: { email: "admin@gigflow.local" },
    update: {
      fullName: "GigFlow Admin",
      roles: ["ADMIN", "CLIENT"],
      defaultRole: "ADMIN",
      isVerified: true
    },
    create: {
      email: "admin@gigflow.local",
      fullName: "GigFlow Admin",
      roles: ["ADMIN", "CLIENT"],
      defaultRole: "ADMIN",
      isVerified: true
    }
  });

  console.log("Seeded service categories, commission rate, and admin user (admin@gigflow.local).");
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
