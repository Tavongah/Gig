import {
  calculatePilotDeliveryPrice,
  classifyPackage,
  resolvePilotLocationMode,
  type PilotLocationMode,
  type PilotPackageClass,
  type PilotPackageItem
} from "@gigflow/shared";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import type { BasketLine } from "./merchant.service.js";

export const PILOT_DELIVERY_INELIGIBLE_MESSAGE = "We can't deliver this order to this location yet.";

export async function classifyBasketPackageClass(lines: BasketLine[]): Promise<PilotPackageClass> {
  const ids = [...new Set(lines.map((l) => l.productId).filter(Boolean))];
  const products = ids.length
    ? await prisma.product.findMany({
        where: { id: { in: ids } },
        include: {
          catalogProduct: {
            select: { category: true, subcategory: true, sizeLabel: true, unit: true }
          }
        }
      })
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));
  const items: PilotPackageItem[] = lines.map((line) => {
    const product = byId.get(line.productId);
    const catalog = product?.catalogProduct;
    return {
      quantity: line.quantity,
      category: catalog?.category ?? product?.category,
      subcategory: catalog?.subcategory,
      sizeLabel: catalog?.sizeLabel,
      unit: catalog?.unit ?? product?.unit
    };
  });
  return classifyPackage(items);
}

/** Authoritative commerce delivery fee. Ineligible GPS routes are not capped at $2. */
export async function quotePilotCommerceDelivery(input: {
  routeDistanceKm: number;
  lines: BasketLine[];
  locationMode?: PilotLocationMode | string | null;
  deliveryPrecision?: string | null;
  typedAddress?: string | null;
  deliveryLabel?: string | null;
}) {
  const packageClass = await classifyBasketPackageClass(input.lines);
  const locationMode = resolvePilotLocationMode({
    locationMode: input.locationMode,
    deliveryPrecision: input.deliveryPrecision,
    typedAddress: input.typedAddress,
    deliveryLabel: input.deliveryLabel
  });
  const priced = calculatePilotDeliveryPrice({
    routeDistanceKm: input.routeDistanceKm,
    packageClass,
    locationMode
  });
  if (!priced.eligible || priced.deliveryFeeCents == null) {
    throw new AppError(PILOT_DELIVERY_INELIGIBLE_MESSAGE, 409, "SHOP_NOT_NEARBY");
  }
  return priced;
}
