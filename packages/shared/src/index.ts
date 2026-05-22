import { z } from "zod";

export const userRoles = ["CLIENT", "WORKER", "ADMIN"] as const;
export const gigStatuses = [
  "DRAFT",
  "OPEN",
  "MATCHED",
  "EN_ROUTE",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "DISPUTED"
] as const;

export const defaultCommissionRate = 0.2;

export type UserRole = (typeof userRoles)[number];
export type GigStatus = (typeof gigStatuses)[number];

export const geoPointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  addressLine1: z.string().min(3).max(160),
  addressLine2: z.string().max(160).optional(),
  city: z.string().min(2).max(80),
  region: z.string().min(2).max(80),
  postalCode: z.string().min(3).max(20),
  country: z.string().length(2).default("US")
});

export const onboardingSchema = z.object({
  role: z.enum(userRoles),
  fullName: z.string().min(2).max(100),
  phoneNumber: z.string().min(7).max(24),
  workerProfile: z
    .object({
      serviceCategoryIds: z.array(z.string().uuid()).min(1),
      bio: z.string().min(20).max(500),
      hasVehicle: z.boolean(),
      backgroundCheckConsent: z.boolean()
    })
    .optional()
});

export const gigEstimateSchema = z.object({
  serviceCategoryId: z.string().uuid(),
  location: geoPointSchema,
  estimatedHours: z.number().positive().max(24),
  distanceMiles: z.number().nonnegative().max(250),
  urgency: z.enum(["STANDARD", "SOON", "URGENT"]),
  startsAt: z.string().datetime(),
  demandMultiplier: z.number().min(1).max(3).default(1)
});

export const createGigSchema = gigEstimateSchema.extend({
  title: z.string().min(8).max(120),
  description: z.string().min(20).max(2000),
  size: z.enum(["SMALL", "MEDIUM", "LARGE", "ENTERPRISE"]).default("SMALL"),
  photos: z.array(z.string().url()).max(10).default([])
});

export type GeoPointInput = z.infer<typeof geoPointSchema>;
export type OnboardingInput = z.infer<typeof onboardingSchema>;
export type GigEstimateInput = z.infer<typeof gigEstimateSchema>;
export type CreateGigInput = z.infer<typeof createGigSchema>;

export interface PriceBreakdown {
  baseRateCents: number;
  hourlyRateCents: number;
  laborCents: number;
  distanceFeeCents: number;
  serviceMultiplier: number;
  peakMultiplier: number;
  urgencyMultiplier: number;
  demandMultiplier: number;
  totalCents: number;
  platformFeeCents: number;
  workerPayoutCents: number;
  commissionRate: number;
}

export function calculatePriceEstimate(
  input: GigEstimateInput,
  category: {
    baseRateCents: number;
    hourlyRateCents: number;
    distanceRateCents: number;
    multiplier: number;
  },
  commissionRate = defaultCommissionRate
): PriceBreakdown {
  const startsAt = new Date(input.startsAt);
  const hour = startsAt.getHours();
  const isPeak = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 21);
  const peakMultiplier = isPeak ? 1.2 : 1;
  const urgencyMultiplier = input.urgency === "URGENT" ? 1.5 : input.urgency === "SOON" ? 1.2 : 1;
  const laborCents = Math.round(category.hourlyRateCents * input.estimatedHours);
  const distanceFeeCents = Math.round(category.distanceRateCents * input.distanceMiles);
  const subtotal = category.baseRateCents + laborCents + distanceFeeCents;
  const totalCents = Math.round(
    subtotal * category.multiplier * peakMultiplier * urgencyMultiplier * input.demandMultiplier
  );
  const platformFeeCents = Math.round(totalCents * commissionRate);

  return {
    baseRateCents: category.baseRateCents,
    hourlyRateCents: category.hourlyRateCents,
    laborCents,
    distanceFeeCents,
    serviceMultiplier: category.multiplier,
    peakMultiplier,
    urgencyMultiplier,
    demandMultiplier: input.demandMultiplier,
    totalCents,
    platformFeeCents,
    workerPayoutCents: totalCents - platformFeeCents,
    commissionRate
  };
}
