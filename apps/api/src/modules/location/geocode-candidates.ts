import { haversineMeters } from "@gigflow/shared";

export type GeocodePrecision = "exact" | "street" | "landmark" | "area" | "city" | "coarse";

export type GeocodeCandidate = {
  label: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
  placeId?: string;
  coarse: boolean;
  precision: GeocodePrecision;
};

export type GeocodeClassification =
  | { kind: "none" }
  | { kind: "coarse" }
  | { kind: "single"; pick: GeocodeCandidate }
  | { kind: "ambiguous"; options: GeocodeCandidate[] };

const LOCATION_AMBIGUITY_METERS = 400;

function precisionOf(candidate: GeocodeCandidate): GeocodePrecision {
  return candidate.precision ?? (candidate.coarse ? "coarse" : "area");
}

function isStrongPrecision(precision: GeocodePrecision): boolean {
  return precision === "exact" || precision === "street" || precision === "landmark";
}

function dedupeCandidates(candidates: GeocodeCandidate[]): GeocodeCandidate[] {
  const seen = new Set<string>();
  const out: GeocodeCandidate[] = [];
  for (const c of candidates) {
    const key = `${c.latitude.toFixed(4)},${c.longitude.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

export function classifyGeocodeCandidates(candidates: GeocodeCandidate[]): GeocodeClassification {
  const unique = dedupeCandidates(candidates).map((c) => ({
    ...c,
    precision: precisionOf(c),
    coarse: c.coarse || precisionOf(c) === "city" || precisionOf(c) === "coarse"
  }));
  if (!unique.length) return { kind: "none" };
  const strong = unique.filter((c) => isStrongPrecision(c.precision));
  const area = unique.filter((c) => c.precision === "area");
  if (!strong.length && !area.length) return { kind: "coarse" };
  const pool = strong.length ? strong : area;
  if (pool.length === 1) return { kind: "single", pick: pool[0]! };
  const origin = pool[0]!;
  const spread = pool.some(
    (c) => haversineMeters(origin.latitude, origin.longitude, c.latitude, c.longitude) > LOCATION_AMBIGUITY_METERS
  );
  if (!spread) return { kind: "single", pick: origin };
  return { kind: "ambiguous", options: pool.slice(0, 3) };
}
