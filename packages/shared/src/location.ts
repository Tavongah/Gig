export type GigSize = "SMALL" | "MEDIUM" | "LARGE" | "ENTERPRISE";
export type GigUrgency = "STANDARD" | "SOON" | "URGENT";

export const DEFAULT_MATCHING_RADIUS_MILES = 10;
export const MAX_COORDINATE_DRIFT_MILES = 1;

export const GIG_SEARCHING_STATUSES = ["POSTED", "SEARCHING_FOR_WORKER"] as const;

export interface GeocodedAddress {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
}

export interface AddressSuggestion {
  placeId: string;
  label: string;
  formattedAddress: string;
}

export function haversineMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function estimateResponseMinutes(distanceMiles: number): number {
  return Math.max(5, Math.round(distanceMiles * 4 + 8));
}

export function formatDistanceMiles(distanceMiles: number): string {
  const rounded = Math.round(distanceMiles * 10) / 10;
  return `${rounded} mile${rounded === 1 ? "" : "s"} away`;
}

export function getGigMatchingRadiusMiles(urgency: GigUrgency, size: GigSize = "MEDIUM"): number {
  const urgencyRadius: Record<GigUrgency, number> = {
    STANDARD: 10,
    SOON: 12,
    URGENT: 15
  };

  const sizeRadius: Record<GigSize, number> = {
    SMALL: 10,
    MEDIUM: 15,
    LARGE: 25,
    ENTERPRISE: 25
  };

  return Math.max(urgencyRadius[urgency], sizeRadius[size]);
}

export function getEffectiveMatchingRadiusMiles(
  gigRadiusMiles: number,
  workerTravelRadiusMiles: number
): number {
  return Math.min(gigRadiusMiles, workerTravelRadiusMiles);
}

export function isWithinMatchingRadius(
  workerLat: number,
  workerLng: number,
  gigLat: number,
  gigLng: number,
  gigRadiusMiles: number,
  workerTravelRadiusMiles: number
): boolean {
  const distanceMiles = haversineMiles(workerLat, workerLng, gigLat, gigLng);
  const allowedRadius = getEffectiveMatchingRadiusMiles(gigRadiusMiles, workerTravelRadiusMiles);
  return distanceMiles <= allowedRadius;
}

export function coordinatesAreConsistent(
  submittedLat: number,
  submittedLng: number,
  geocodedLat: number,
  geocodedLng: number,
  maxDriftMiles = MAX_COORDINATE_DRIFT_MILES
): boolean {
  return haversineMiles(submittedLat, submittedLng, geocodedLat, geocodedLng) <= maxDriftMiles;
}

export interface RankedWorkerCandidate {
  userId: string;
  distanceMiles: number;
  ratingAverage: number;
  completedGigCount: number;
}

export function compareWorkersForMatching(left: RankedWorkerCandidate, right: RankedWorkerCandidate): number {
  if (left.distanceMiles !== right.distanceMiles) {
    return left.distanceMiles - right.distanceMiles;
  }

  if (right.ratingAverage !== left.ratingAverage) {
    return right.ratingAverage - left.ratingAverage;
  }

  return right.completedGigCount - left.completedGigCount;
}
