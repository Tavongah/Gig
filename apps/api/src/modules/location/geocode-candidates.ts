import { haversineMeters } from "@gigflow/shared";

export type GeocodeCandidate = {
  label: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
  placeId?: string;
  coarse: boolean;
};

export type GeocodeClassification =
  | { kind: "none" }
  | { kind: "coarse" }
  | { kind: "single"; pick: GeocodeCandidate }
  | { kind: "ambiguous"; options: GeocodeCandidate[] };

const LOCATION_AMBIGUITY_METERS = 400;

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
  const unique = dedupeCandidates(candidates);
  if (!unique.length) return { kind: "none" };
  const precise = unique.filter((c) => !c.coarse);
  const pool = precise.length ? precise : unique;
  if (!precise.length) return { kind: "coarse" };
  if (pool.length === 1) return { kind: "single", pick: pool[0]! };
  const origin = pool[0]!;
  const spread = pool.some(
    (c) => haversineMeters(origin.latitude, origin.longitude, c.latitude, c.longitude) > LOCATION_AMBIGUITY_METERS
  );
  if (!spread) return { kind: "single", pick: origin };
  return { kind: "ambiguous", options: pool.slice(0, 3) };
}
