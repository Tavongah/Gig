/**
 * DUTS commerce pilot delivery pricing V1.
 *
 * GPS / shared-location: distance band + package class → $0.50–$2.00 matrix.
 * Typed MSU/Gweru pilot address: package class only → $1.00 / $1.30 / $1.70.
 *
 * Does NOT apply to legacy gig/P2P calculateDeliveryPrice.
 * Does NOT split courier payout from the customer fee.
 */

export const PILOT_PACKAGE_CLASSES = ["SMALL", "MEDIUM", "LARGE"] as const;
export type PilotPackageClass = (typeof PILOT_PACKAGE_CLASSES)[number];

export const PILOT_DISTANCE_BANDS = ["0_TO_1_KM", "1_TO_2_KM", "2_TO_3_KM"] as const;
export type PilotDistanceBand = (typeof PILOT_DISTANCE_BANDS)[number];

/** Allowed customer-facing delivery fees (USD cents). */
export const PILOT_DELIVERY_FEE_CENTS = {
  SMALL_0_1_KM: 50,
  MEDIUM_0_1_KM: 70,
  LARGE_0_1_KM: 100,
  SMALL_1_2_KM: 70,
  MEDIUM_1_2_KM: 100,
  LARGE_1_2_KM: 130,
  SMALL_2_3_KM: 100,
  MEDIUM_2_3_KM: 150,
  LARGE_2_3_KM: 200
} as const;

export const MIN_DELIVERY_FEE_CENTS = 50;
export const MAX_PILOT_DELIVERY_FEE_CENTS = 200;
export const PILOT_DELIVERY_MAX_KM = 3;

export const PILOT_LOCATION_MODES = ["GPS", "TYPED_PILOT"] as const;
export type PilotLocationMode = (typeof PILOT_LOCATION_MODES)[number];

/** Authoritative typed-address pilot zone. Do not duplicate these cents in WhatsApp/mobile. */
export const PILOT_TYPED_ADDRESS_ZONE = "MSU_GWERU" as const;

export const PILOT_TYPED_ADDRESS_FEE_CENTS: Record<PilotPackageClass, number> = {
  SMALL: 100,
  MEDIUM: 130,
  LARGE: 170
};

/** Senga / MSU Gweru centroid used when a typed address is recognized without exact geocoding. */
export const MSU_GWERU_TYPED_PILOT_CENTROID = {
  latitude: -19.4970683,
  longitude: 29.838108
} as const;

export const PILOT_DELIVERY_MATRIX_CENTS: Record<
  PilotDistanceBand,
  Record<PilotPackageClass, number>
> = {
  "0_TO_1_KM": {
    SMALL: PILOT_DELIVERY_FEE_CENTS.SMALL_0_1_KM,
    MEDIUM: PILOT_DELIVERY_FEE_CENTS.MEDIUM_0_1_KM,
    LARGE: PILOT_DELIVERY_FEE_CENTS.LARGE_0_1_KM
  },
  "1_TO_2_KM": {
    SMALL: PILOT_DELIVERY_FEE_CENTS.SMALL_1_2_KM,
    MEDIUM: PILOT_DELIVERY_FEE_CENTS.MEDIUM_1_2_KM,
    LARGE: PILOT_DELIVERY_FEE_CENTS.LARGE_1_2_KM
  },
  "2_TO_3_KM": {
    SMALL: PILOT_DELIVERY_FEE_CENTS.SMALL_2_3_KM,
    MEDIUM: PILOT_DELIVERY_FEE_CENTS.MEDIUM_2_3_KM,
    LARGE: PILOT_DELIVERY_FEE_CENTS.LARGE_2_3_KM
  }
};

export type PilotPackageItem = {
  quantity: number;
  category?: string | null;
  subcategory?: string | null;
  sizeLabel?: string | null;
  unit?: string | null;
};

export type PilotDeliveryPriceResult =
  | {
      eligible: true;
      currency: "USD";
      deliveryFeeCents: number;
      distanceBand: PilotDistanceBand | null;
      packageClass: PilotPackageClass;
      distanceKm: number;
      locationMode: PilotLocationMode;
    }
  | {
      eligible: false;
      currency: "USD";
      deliveryFeeCents: null;
      distanceBand: null;
      packageClass: PilotPackageClass;
      distanceKm: number;
      locationMode: PilotLocationMode;
    };

function foldAddressText(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[，、]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Recognized typed address inside the configured MSU/Gweru pilot zone. */
export function isMsuGweruTypedPilotAddress(text: string | null | undefined): boolean {
  const hay = foldAddressText(text);
  if (!hay) return false;
  const hasGweru = /\bgweru\b/.test(hay);
  const hasMsu = /\bmsu\b/.test(hay) || /\bmidlands state\b/.test(hay);
  const hasSenga = /\bsenga\b/.test(hay);
  const hasNehosho = /\bnehosho\b/.test(hay);
  return (hasGweru || hasMsu) && (hasSenga || hasNehosho || hasMsu);
}

export function resolvePilotLocationMode(input: {
  locationMode?: string | null;
  deliveryPrecision?: string | null;
  typedAddress?: string | null;
  deliveryLabel?: string | null;
}): PilotLocationMode {
  const explicit = String(input.locationMode ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (explicit === "GPS") return "GPS";
  if (explicit === "TYPED_PILOT") return "TYPED_PILOT";
  if (String(input.deliveryPrecision ?? "").trim().toUpperCase() === "GPS") return "GPS";
  const text = String(input.typedAddress || input.deliveryLabel || "").trim();
  if (isMsuGweruTypedPilotAddress(text)) return "TYPED_PILOT";
  return "GPS";
}

/** Integer millimetres so 1.0000 vs 1.0001 never falls between bands. */
export function distanceKmToMillimetres(km: number): number {
  if (!Number.isFinite(km) || km < 0) return -1;
  return Math.round(km * 1_000_000);
}

export function distanceBandForKm(km: number): PilotDistanceBand | null {
  const mm = distanceKmToMillimetres(km);
  if (mm < 0) return null;
  if (mm <= 1_000_000) return "0_TO_1_KM";
  if (mm <= 2_000_000) return "1_TO_2_KM";
  if (mm <= 3_000_000) return "2_TO_3_KM";
  return null;
}

function parsePhysical(item: PilotPackageItem): { ml: number; grams: number } {
  const blob = `${item.sizeLabel ?? ""} ${item.unit ?? ""}`.toLowerCase().replace(/,/g, " ");
  let ml = 0;
  let grams = 0;
  const mlMatch = blob.match(/(\d+(?:\.\d+)?)\s*ml\b/);
  const lMatch = blob.match(/(\d+(?:\.\d+)?)\s*(?:l|ltr|litre|liter)s?\b/);
  const kgMatch = blob.match(/(\d+(?:\.\d+)?)\s*kg\b/);
  const gMatch = blob.match(/(\d+(?:\.\d+)?)\s*g(?:ram)?s?\b/);
  if (mlMatch) ml = Number(mlMatch[1]);
  else if (lMatch) ml = Number(lMatch[1]) * 1000;
  if (kgMatch) grams = Number(kgMatch[1]) * 1000;
  else if (gMatch) grams = Number(gMatch[1]);
  return {
    ml: Number.isFinite(ml) ? ml : 0,
    grams: Number.isFinite(grams) ? grams : 0
  };
}

function hasStructuredMeta(item: PilotPackageItem): boolean {
  return Boolean(
    (item.category && item.category.trim()) ||
      (item.subcategory && item.subcategory.trim()) ||
      (item.sizeLabel && item.sizeLabel.trim()) ||
      (item.unit && item.unit.trim())
  );
}

function bulkyCategory(category?: string | null, subcategory?: string | null): boolean {
  const hay = `${category ?? ""} ${subcategory ?? ""}`.toLowerCase();
  return /\b(household|cleaning|rice|flour|oil|water|bulk)\b/.test(hay);
}

/**
 * Deterministic V1 classifier. Unknown / incomplete metadata → MEDIUM.
 * SMALL only when metadata supports a genuinely light basket.
 */
export function classifyPackage(items: PilotPackageItem[]): PilotPackageClass {
  if (!items.length) return "MEDIUM";

  const totalQty = items.reduce((sum, item) => sum + Math.max(1, Math.floor(item.quantity || 1)), 0);
  const skuCount = items.length;
  let known = 0;
  let totalMl = 0;
  let totalGrams = 0;
  let bulkyHits = 0;

  for (const item of items) {
    const qty = Math.max(1, Math.floor(item.quantity || 1));
    if (hasStructuredMeta(item)) known += 1;
    const physical = parsePhysical(item);
    totalMl += physical.ml * qty;
    totalGrams += physical.grams * qty;
    if (physical.ml >= 2000) bulkyHits += qty;
    if (physical.grams >= 2000) bulkyHits += qty;
    if (bulkyCategory(item.category, item.subcategory)) bulkyHits += qty;
  }

  if (totalQty >= 8 || skuCount >= 6 || totalMl >= 4000 || totalGrams >= 5000 || bulkyHits >= 3) {
    return "LARGE";
  }

  const coverage = known / skuCount;
  if (
    coverage >= 0.5 &&
    totalQty <= 3 &&
    skuCount <= 3 &&
    bulkyHits === 0 &&
    totalMl <= 1500 &&
    totalGrams <= 1500
  ) {
    return "SMALL";
  }

  return "MEDIUM";
}

export function calculatePilotDeliveryPrice(input: {
  routeDistanceKm: number;
  packageClass: PilotPackageClass;
  locationMode?: PilotLocationMode | string | null;
}): PilotDeliveryPriceResult {
  const packageClass = PILOT_PACKAGE_CLASSES.includes(input.packageClass as PilotPackageClass)
    ? (input.packageClass as PilotPackageClass)
    : "MEDIUM";
  const locationMode: PilotLocationMode = input.locationMode === "TYPED_PILOT" ? "TYPED_PILOT" : "GPS";
  const distanceKm = Number.isFinite(input.routeDistanceKm) ? input.routeDistanceKm : Number.NaN;
  if (locationMode === "TYPED_PILOT") {
    return {
      eligible: true,
      currency: "USD",
      deliveryFeeCents: PILOT_TYPED_ADDRESS_FEE_CENTS[packageClass],
      distanceBand: null,
      packageClass,
      distanceKm: Number.isFinite(distanceKm) ? distanceKm : 0,
      locationMode
    };
  }
  const distanceBand = distanceBandForKm(distanceKm);
  if (!distanceBand) {
    return {
      eligible: false,
      currency: "USD",
      deliveryFeeCents: null,
      distanceBand: null,
      packageClass,
      distanceKm: Number.isFinite(distanceKm) ? distanceKm : -1,
      locationMode
    };
  }
  const deliveryFeeCents = PILOT_DELIVERY_MATRIX_CENTS[distanceBand][packageClass];
  return {
    eligible: true,
    currency: "USD",
    deliveryFeeCents,
    distanceBand,
    packageClass,
    distanceKm,
    locationMode
  };
}
