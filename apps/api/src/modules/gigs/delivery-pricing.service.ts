import {
  calculateDeliveryPrice,
  DEFAULT_DELIVERY_BASE_FEE_CENTS,
  DEFAULT_DELIVERY_MAX_DISTANCE_KM,
  DEFAULT_DELIVERY_MINIMUM_FEE_CENTS,
  DEFAULT_DELIVERY_PRICE_PER_KM_CENTS,
  distanceKmBetween,
  type DeliveryPriceBreakdown,
  type DeliveryPricingConfig
} from "@gigflow/shared";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";

export async function getDeliveryPricingConfig(): Promise<DeliveryPricingConfig> {
  try {
    const settings = await prisma.platformSetting.findUnique({ where: { id: "default" } });
    const commission = await prisma.commissionSetting.findFirst({ orderBy: { effectiveFrom: "desc" } });

    return {
      maxDistanceKm: settings ? Number(settings.deliveryMaxDistanceKm) : DEFAULT_DELIVERY_MAX_DISTANCE_KM,
      baseFeeCents: settings?.deliveryBaseFeeCents ?? DEFAULT_DELIVERY_BASE_FEE_CENTS,
      pricePerKmCents: settings?.deliveryPricePerKmCents ?? DEFAULT_DELIVERY_PRICE_PER_KM_CENTS,
      minimumFeeCents: settings?.deliveryMinimumFeeCents ?? DEFAULT_DELIVERY_MINIMUM_FEE_CENTS,
      commissionRate: commission ? Number(commission.rate) : 0.2
    };
  } catch {
    // Fall back when PlatformSetting migration is not yet applied on a given environment.
    return {
      maxDistanceKm: DEFAULT_DELIVERY_MAX_DISTANCE_KM,
      baseFeeCents: DEFAULT_DELIVERY_BASE_FEE_CENTS,
      pricePerKmCents: DEFAULT_DELIVERY_PRICE_PER_KM_CENTS,
      minimumFeeCents: DEFAULT_DELIVERY_MINIMUM_FEE_CENTS,
      commissionRate: 0.2
    };
  }
}

export async function estimateDeliveryFee(input: {
  pickup: { latitude: number; longitude: number };
  dropoff: { latitude: number; longitude: number };
}): Promise<DeliveryPriceBreakdown> {
  const distanceKm = distanceKmBetween(input.pickup, input.dropoff);
  const config = await getDeliveryPricingConfig();
  return calculateDeliveryPrice(distanceKm, config);
}

export function assertWithinDeliveryRadius(breakdown: DeliveryPriceBreakdown): void {
  if (!breakdown.withinMaxDistance) {
    throw new AppError(
      `This delivery is ${breakdown.distanceKm.toFixed(1)} km. Maximum allowed is ${breakdown.maxDistanceKm} km.`,
      400,
      "DELIVERY_DISTANCE_EXCEEDED",
      {
        distanceKm: String(breakdown.distanceKm),
        maxDistanceKm: String(breakdown.maxDistanceKm)
      }
    );
  }
}
