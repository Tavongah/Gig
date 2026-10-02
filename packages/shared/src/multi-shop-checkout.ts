/**
 * DUTS 3-shop checkout V1 — feature flags, route eligibility, pickup ordering.
 *
 * Architecture (implementation lives in API):
 * - Parent CommerceCheckout = one customer payment, one delivery fee, one combined delivery
 * - Child CommerceOrder = one merchant fulfillment (existing merchant WhatsApp / ACCEPT / READY)
 * - Combined Gig = one courier, sequential pickups, one customer dropoff
 *
 * Historical CommerceOrders are unchanged (checkoutId null). Order #2 is not migrated.
 *
 * V1 delivery fee: ONE fee from calculatePilotDeliveryPrice(combinedRouteKm, packageClass).
 * combinedRouteKm = shortest haversine permutation of pickups then the customer.
 * Not fee × shop count. No hidden surcharge.
 *
 * Safe TESTING defaults below are not production-tuned walking limits.
 * Keep MULTI_SHOP_CHECKOUT_ENABLED=false until controlled E2E.
 */

import { distanceKmBetween } from "./delivery.js";

export const MULTI_SHOP_TESTING_DEFAULTS = {
  /** Hard cap. Server-enforced. */
  maxShops: 3,
  /**
   * Max pickup-only path (A→B→C, excluding customer). ~walking/bicycle testing.
   * Not a Zimbabwe production SLA.
   */
  maxPickupRouteKm: 8,
  /** Extra km vs nearest shop → customer. */
  maxExtraRouteKm: 5,
  /** Combined route vs nearest direct (e.g. 2.5 = 250%). */
  maxExtraRouteRatio: 2.5
} as const;

export function parseMultiShopCheckoutEnabled(value?: string | boolean | null): boolean {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

function parsePositiveNumber(value: string | undefined, fallback: number, min: number, max: number): number {
  if (!value || !Number.isFinite(Number(value))) return fallback;
  const n = Number(value);
  if (n < min || n > max) return fallback;
  return n;
}

export function parseMaxShopsPerCheckout(value?: string | null): number {
  const n = parsePositiveNumber(value ?? undefined, MULTI_SHOP_TESTING_DEFAULTS.maxShops, 1, 3);
  return Math.min(3, Math.max(1, Math.floor(n)));
}

export function parseMultiShopMaxPickupRouteKm(value?: string | null): number {
  return parsePositiveNumber(value ?? undefined, MULTI_SHOP_TESTING_DEFAULTS.maxPickupRouteKm, 0.5, 50);
}

export function parseMultiShopMaxExtraRouteKm(value?: string | null): number {
  return parsePositiveNumber(value ?? undefined, MULTI_SHOP_TESTING_DEFAULTS.maxExtraRouteKm, 0.1, 50);
}

export function parseMultiShopMaxExtraRouteRatio(value?: string | null): number {
  return parsePositiveNumber(value ?? undefined, MULTI_SHOP_TESTING_DEFAULTS.maxExtraRouteRatio, 1, 10);
}

export type GeoPoint = { latitude: number; longitude: number };

export type PickupCandidate = {
  id: string;
  latitude: number;
  longitude: number;
};

export type CombinedRouteLimits = {
  maxPickupRouteKm: number;
  maxExtraRouteKm: number;
  maxExtraRouteRatio: number;
  maxDeliveryKm: number;
};

export type CombinedRouteResult = {
  eligible: boolean;
  reason: "ok" | "pickup_route" | "extra_km" | "extra_ratio" | "delivery_max" | "empty";
  orderedIds: string[];
  routeKm: number;
  pickupOnlyKm: number;
  nearestDirectKm: number;
  extraKm: number;
  extraRatio: number;
};

export function permute<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permute(rest)) out.push([items[i]!, ...p]);
  }
  return out;
}

export function pathDistanceKm(points: GeoPoint[]): number {
  let km = 0;
  for (let i = 0; i < points.length - 1; i++) {
    km += distanceKmBetween(points[i]!, points[i + 1]!);
  }
  return km;
}

/** Shortest pickup permutation then customer. 1 shop = 1 path; 2 = 2; 3 = 6. */
export function chooseShortestPickupRoute(input: {
  pickups: PickupCandidate[];
  customer: GeoPoint;
}): { orderedIds: string[]; routeKm: number; pickupOnlyKm: number; nearestDirectKm: number } {
  const { pickups, customer } = input;
  if (pickups.length === 0) {
    return { orderedIds: [], routeKm: 0, pickupOnlyKm: 0, nearestDirectKm: 0 };
  }

  const nearestDirectKm = Math.min(
    ...pickups.map((p) => distanceKmBetween({ latitude: p.latitude, longitude: p.longitude }, customer))
  );

  let best: { orderedIds: string[]; routeKm: number; pickupOnlyKm: number } | null = null;
  for (const order of permute(pickups)) {
    const pickupPts = order.map((p) => ({ latitude: p.latitude, longitude: p.longitude }));
    const pickupOnlyKm = pathDistanceKm(pickupPts);
    const routeKm = pathDistanceKm([...pickupPts, customer]);
    if (!best || routeKm < best.routeKm - 1e-9) {
      best = { orderedIds: order.map((p) => p.id), routeKm, pickupOnlyKm };
    }
  }

  return {
    orderedIds: best?.orderedIds ?? pickups.map((p) => p.id),
    routeKm: best?.routeKm ?? 0,
    pickupOnlyKm: best?.pickupOnlyKm ?? 0,
    nearestDirectKm
  };
}

export function evaluateCombinedRoute(input: {
  pickups: PickupCandidate[];
  customer: GeoPoint;
  limits: CombinedRouteLimits;
}): CombinedRouteResult {
  if (input.pickups.length === 0) {
    return {
      eligible: false,
      reason: "empty",
      orderedIds: [],
      routeKm: 0,
      pickupOnlyKm: 0,
      nearestDirectKm: 0,
      extraKm: 0,
      extraRatio: 0
    };
  }

  const chosen = chooseShortestPickupRoute(input);
  const extraKm = Math.max(0, chosen.routeKm - chosen.nearestDirectKm);
  const extraRatio =
    chosen.nearestDirectKm > 0.05 ? chosen.routeKm / chosen.nearestDirectKm : extraKm > 0 ? 99 : 1;

  let reason: CombinedRouteResult["reason"] = "ok";
  if (chosen.pickupOnlyKm > input.limits.maxPickupRouteKm + 1e-6) reason = "pickup_route";
  else if (extraKm > input.limits.maxExtraRouteKm + 1e-6) reason = "extra_km";
  else if (extraRatio > input.limits.maxExtraRouteRatio + 1e-6) reason = "extra_ratio";
  else if (chosen.routeKm > input.limits.maxDeliveryKm + 1e-6) reason = "delivery_max";

  return {
    eligible: reason === "ok",
    reason,
    orderedIds: chosen.orderedIds,
    routeKm: Math.round(chosen.routeKm * 1000) / 1000,
    pickupOnlyKm: Math.round(chosen.pickupOnlyKm * 1000) / 1000,
    nearestDirectKm: Math.round(chosen.nearestDirectKm * 1000) / 1000,
    extraKm: Math.round(extraKm * 1000) / 1000,
    extraRatio: Math.round(extraRatio * 1000) / 1000
  };
}

export const FULFILLMENT_LABELS = ["A", "B", "C"] as const;
export type FulfillmentLabel = (typeof FULFILLMENT_LABELS)[number];

export function fulfillmentLabelAt(index: number): FulfillmentLabel {
  return FULFILLMENT_LABELS[Math.max(0, Math.min(2, index))] ?? "A";
}

/** Merchant-facing #1082-A from parent checkout number + A/B/C. */
export function merchantFulfillmentRef(checkoutNumber: number, label: string): string {
  return `${checkoutNumber}-${label}`;
}

export function parseMerchantFulfillmentRef(
  raw: string
): { checkoutNumber: number; label: FulfillmentLabel } | null {
  const m = String(raw).trim().match(/^(\d+)\s*[-–]\s*([A-Ca-c])$/);
  if (!m) return null;
  const label = m[2]!.toUpperCase() as FulfillmentLabel;
  if (!FULFILLMENT_LABELS.includes(label)) return null;
  return { checkoutNumber: Number(m[1]), label };
}

export type MultiShopAllocation = {
  merchants: Array<{
    merchantId: string;
    commerceOrderId: string;
    fulfillmentLabel: string;
    itemsSubtotalCents: number;
  }>;
  deliveryFeeCents: number;
  serviceFeeCents: number;
  itemsSubtotalCents: number;
  totalCents: number;
};
