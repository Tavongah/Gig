import { z } from "zod";

/** Temporary Harare Phase 1 defaults (USD cents). Replace via PlatformSetting in production. */
export const DEFAULT_DELIVERY_MAX_DISTANCE_KM = 10;
export const DEFAULT_DELIVERY_BASE_FEE_CENTS = 200;
export const DEFAULT_DELIVERY_PRICE_PER_KM_CENTS = 50;
export const DEFAULT_DELIVERY_MINIMUM_FEE_CENTS = 200;

export const fulfillmentTypes = ["LOCAL_HELP", "DELIVERY"] as const;
export type FulfillmentType = (typeof fulfillmentTypes)[number];

export const orderSources = ["APP", "WEB", "WHATSAPP"] as const;
export type OrderSource = (typeof orderSources)[number];

export const transportModes = [
  "WALKING",
  "BICYCLE",
  "PUBLIC_TRANSPORT",
  "MOTORBIKE",
  "CAR"
] as const;
export type TransportMode = (typeof transportModes)[number];

/** Phase 1 courier modes (UI should only offer these). */
export const phase1TransportModes = ["WALKING", "BICYCLE", "PUBLIC_TRANSPORT"] as const;

export const transportModeLabels: Record<(typeof phase1TransportModes)[number], string> = {
  WALKING: "Walking",
  BICYCLE: "Bicycle",
  PUBLIC_TRANSPORT: "Public Transport / Kombi"
};

export const packageCategories = [
  "DOCUMENTS",
  "FOOD",
  "GROCERIES",
  "CLOTHING",
  "SMALL_PARCEL",
  "OTHER"
] as const;
export type PackageCategory = (typeof packageCategories)[number];

export const packageCategoryLabels: Record<PackageCategory, string> = {
  DOCUMENTS: "Documents",
  FOOD: "Food",
  GROCERIES: "Groceries",
  CLOTHING: "Clothing",
  SMALL_PARCEL: "Small Parcel",
  OTHER: "Other"
};

/**
 * Flexible delivery stop — supports typed place names, map pins, and GPS.
 * Designed so WhatsApp shared locations can fill lat/lng later.
 */
export const deliveryStopSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  formattedAddress: z.string().min(3).max(240),
  addressLine1: z.string().min(2).max(150).optional(),
  addressLine2: z.string().max(160).optional(),
  city: z.string().min(2).max(80).default("Harare"),
  region: z.string().min(2).max(80).default("Harare"),
  postalCode: z.string().max(20).optional(),
  country: z.string().length(2).default("ZW"),
  contactName: z.string().min(2).max(100),
  contactPhone: z.string().min(7).max(24),
  instructions: z.string().max(500).optional()
});

export type DeliveryStop = z.infer<typeof deliveryStopSchema>;

export const deliveryPricingConfigSchema = z.object({
  maxDistanceKm: z.number().positive().default(DEFAULT_DELIVERY_MAX_DISTANCE_KM),
  baseFeeCents: z.number().int().min(0).default(DEFAULT_DELIVERY_BASE_FEE_CENTS),
  pricePerKmCents: z.number().int().min(0).default(DEFAULT_DELIVERY_PRICE_PER_KM_CENTS),
  minimumFeeCents: z.number().int().min(0).default(DEFAULT_DELIVERY_MINIMUM_FEE_CENTS),
  commissionRate: z.number().min(0).max(0.5).default(0.2)
});

export type DeliveryPricingConfig = z.infer<typeof deliveryPricingConfigSchema>;

export type DeliveryPriceBreakdown = {
  currency: "usd";
  distanceKm: number;
  maxDistanceKm: number;
  withinMaxDistance: boolean;
  baseFeeCents: number;
  distanceFeeCents: number;
  subtotalCents: number;
  minimumFeeCents: number;
  totalCents: number;
  platformFeeCents: number;
  workerPayoutCents: number;
  pricingNote: string;
};

/** Earth distance in kilometers (haversine). */
export function distanceKmBetween(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function calculateDeliveryPrice(
  distanceKm: number,
  config: Partial<DeliveryPricingConfig> = {}
): DeliveryPriceBreakdown {
  const parsed = deliveryPricingConfigSchema.parse(config);
  const roundedKm = Math.round(distanceKm * 1000) / 1000;
  const withinMaxDistance = roundedKm <= parsed.maxDistanceKm + 1e-6;
  const distanceFeeCents = Math.round(roundedKm * parsed.pricePerKmCents);
  const rawTotal = parsed.baseFeeCents + distanceFeeCents;
  const totalCents = Math.max(rawTotal, parsed.minimumFeeCents);
  const platformFeeCents = Math.round(totalCents * parsed.commissionRate);
  const workerPayoutCents = Math.max(0, totalCents - platformFeeCents);

  return {
    currency: "usd",
    distanceKm: roundedKm,
    maxDistanceKm: parsed.maxDistanceKm,
    withinMaxDistance,
    baseFeeCents: parsed.baseFeeCents,
    distanceFeeCents,
    subtotalCents: rawTotal,
    minimumFeeCents: parsed.minimumFeeCents,
    totalCents,
    platformFeeCents,
    workerPayoutCents,
    pricingNote:
      "Temporary development pricing (USD). Final Harare rates will be configured in platform settings."
  };
}

export function generateDeliveryPin(length = 4): string {
  const max = 10 ** length;
  const n = Math.floor(Math.random() * max);
  return String(n).padStart(length, "0");
}

/** Max failed PIN submissions before temporary lock. */
export const DELIVERY_PIN_MAX_ATTEMPTS = 5;
/** Lock duration after exceeding max attempts (minutes). */
export const DELIVERY_PIN_LOCK_MINUTES = 15;

export const phase1TransportModeSet = new Set<string>(phase1TransportModes);

export function isPhase1TransportMode(mode: string | null | undefined): boolean {
  return Boolean(mode && phase1TransportModeSet.has(mode));
}

export const enableDeliveryCourierSchema = z.object({
  transportMode: z.enum(phase1TransportModes),
  enabled: z.boolean().default(true)
});

export type EnableDeliveryCourierInput = z.infer<typeof enableDeliveryCourierSchema>;

export const createDeliverySchema = z.object({
  pickup: deliveryStopSchema,
  dropoff: deliveryStopSchema,
  package: z.object({
    category: z.enum(packageCategories),
    description: z.string().min(3).max(240),
    size: z.enum(["SMALL", "MEDIUM", "LARGE"]).default("SMALL"),
    photoUrl: z.string().url().max(2048).optional(),
    notes: z.string().max(500).optional()
  }),
  prohibitedItemsAck: z.literal(true, {
    error: "You must confirm the package does not contain prohibited items."
  }),
  orderSource: z.enum(orderSources).default("APP"),
  idempotencyKey: z.string().uuid().optional()
});

export type CreateDeliveryInput = z.infer<typeof createDeliverySchema>;

export const verifyDeliveryPinSchema = z.object({
  pin: z.string().regex(/^\d{4,6}$/),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional()
});
