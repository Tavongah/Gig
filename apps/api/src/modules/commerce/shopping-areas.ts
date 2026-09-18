import { distanceKmBetween } from "@gigflow/shared";
import { prisma } from "../../config/prisma.js";

/** Coarse city centroids used to cluster merchants when no service-area table exists. */
export const DUTS_CITY_SEEDS = [
  { id: "harare", name: "Harare", lat: -17.8292, lng: 31.0522 },
  { id: "bulawayo", name: "Bulawayo", lat: -20.1569, lng: 28.5809 },
  { id: "gweru", name: "Gweru", lat: -19.455, lng: 29.812 }
] as const;

/** Merchants within this distance of a seed city inherit that shopping area. */
export const SHOPPING_AREA_MATCH_KM = 40;

export type ShoppingArea = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  shopCount: number;
};

export type AreaMerchant = {
  id: string;
  locationLabel: string;
  pilotArea: string | null;
  latitude: unknown;
  longitude: unknown;
};

export function slugAreaId(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "other";
}

export function titleFromAreaId(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Map a merchant to a coarse shopping area. Not a delivery address. */
export function shoppingAreaForMerchant(merchant: AreaMerchant): ShoppingArea {
  const text = `${merchant.pilotArea ?? ""} ${merchant.locationLabel}`.toLowerCase();
  for (const seed of DUTS_CITY_SEEDS) {
    if (text.includes(seed.name.toLowerCase())) {
      return { id: seed.id, name: seed.name, lat: seed.lat, lng: seed.lng, shopCount: 1 };
    }
  }

  const lat = Number(merchant.latitude);
  const lng = Number(merchant.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    let best: (typeof DUTS_CITY_SEEDS)[number] | null = null;
    let bestKm = Infinity;
    for (const seed of DUTS_CITY_SEEDS) {
      const km = distanceKmBetween(
        { latitude: lat, longitude: lng },
        { latitude: seed.lat, longitude: seed.lng }
      );
      if (km < bestKm) {
        bestKm = km;
        best = seed;
      }
    }
    if (best && bestKm <= SHOPPING_AREA_MATCH_KM) {
      return { id: best.id, name: best.name, lat: best.lat, lng: best.lng, shopCount: 1 };
    }
  }

  const raw = (merchant.pilotArea || merchant.locationLabel || "Other").split(",")[0]!.trim();
  const id = slugAreaId(raw);
  return {
    id,
    name: titleFromAreaId(id),
    lat: Number.isFinite(lat) ? lat : DUTS_CITY_SEEDS[0].lat,
    lng: Number.isFinite(lng) ? lng : DUTS_CITY_SEEDS[0].lng,
    shopCount: 1
  };
}

export async function listShoppingAreas(): Promise<{ areas: ShoppingArea[] }> {
  const merchants = await prisma.merchant.findMany({
    where: { isActive: true, acceptsOrders: true },
    select: { id: true, locationLabel: true, pilotArea: true, latitude: true, longitude: true }
  });

  const buckets = new Map<string, ShoppingArea>();
  for (const merchant of merchants) {
    const area = shoppingAreaForMerchant(merchant);
    const cur = buckets.get(area.id);
    if (!cur) {
      buckets.set(area.id, { ...area, shopCount: 1 });
    } else {
      cur.shopCount += 1;
    }
  }

  const areas = [...buckets.values()].sort((a, b) => b.shopCount - a.shopCount || a.name.localeCompare(b.name));
  if (areas.length) return { areas };

  return {
    areas: DUTS_CITY_SEEDS.map((seed) => ({
      id: seed.id,
      name: seed.name,
      lat: seed.lat,
      lng: seed.lng,
      shopCount: 0
    }))
  };
}

export async function findMerchantsInShoppingArea(areaId: string) {
  const wanted = areaId.trim().toLowerCase();
  const merchants = await prisma.merchant.findMany({
    where: { isActive: true, acceptsOrders: true }
  });
  return merchants
    .map((merchant) => {
      const area = shoppingAreaForMerchant(merchant);
      const distanceKm = distanceKmBetween(
        { latitude: Number(merchant.latitude), longitude: Number(merchant.longitude) },
        { latitude: area.lat, longitude: area.lng }
      );
      return { merchant, area, distanceKm };
    })
    .filter((row) => row.area.id === wanted)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .map(({ merchant, distanceKm }) => ({ merchant, distanceKm }));
}
