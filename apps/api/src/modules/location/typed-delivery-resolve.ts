import {
  classifyGeocodeCandidates,
  type GeocodeCandidate,
  type GeocodePrecision
} from "./geocode-candidates.js";
import {
  parseZimbabweDeliveryText,
  progressiveDeliveryQueries,
  recoveryKind,
  type ParsedDeliveryText
} from "./zimbabwe-delivery-text.js";

export type DeliveryResolutionLevel =
  | "EXACT"
  | "STREET"
  | "LANDMARK"
  | "AREA"
  | "AMBIGUOUS"
  | "NEED_CITY"
  | "NEED_AREA"
  | "NEED_LANDMARK"
  | "NONE";

export type TypedDeliveryResolution = {
  parsed: ParsedDeliveryText;
  queriesAttempted: string[];
  providerResultCount: number;
  queryCategory: string;
  rejectionReason?: string;
} & (
  | { kind: "exact"; pick: GeocodeCandidate; queryUsed: string; resolutionLevel: "EXACT" | "STREET" }
  | { kind: "landmark"; pick: GeocodeCandidate; queryUsed: string; resolutionLevel: "LANDMARK" }
  | { kind: "area"; pick: GeocodeCandidate; queryUsed: string; resolutionLevel: "AREA"; areaLabel: string }
  | { kind: "ambiguous"; options: GeocodeCandidate[]; resolutionLevel: "AMBIGUOUS" }
  | { kind: "need_city"; resolutionLevel: "NEED_CITY" }
  | { kind: "need_area"; resolutionLevel: "NEED_AREA" }
  | { kind: "need_landmark"; resolutionLevel: "NEED_LANDMARK"; areaLabel?: string }
  | { kind: "none"; resolutionLevel: "NONE" }
);

export type GeocodeLookup = (query: string) => Promise<GeocodeCandidate[]>;

export function queryCategoryFromParsed(parsed: ParsedDeliveryText): string {
  if (parsed.house && parsed.street && parsed.suburb && parsed.city) return "house_street_suburb_city";
  if (parsed.street && parsed.suburb && parsed.city) return "street_suburb_city";
  if (parsed.landmark && parsed.city) return "landmark_city";
  if (parsed.suburb && parsed.city) return "suburb_city";
  if (parsed.landmark) return "landmark";
  if (parsed.city) return "city";
  return "free_text";
}

export function originalDeliveryInstructions(parsed: ParsedDeliveryText): string {
  if (parsed.house && parsed.street) return `${parsed.house} ${parsed.street}`;
  if (parsed.house) return parsed.house;
  if (parsed.street) return parsed.street;
  if (parsed.landmark && parsed.suburb) return `${parsed.suburb} near ${parsed.landmark}`;
  if (parsed.landmark) return parsed.landmark;
  return parsed.normalized || parsed.original;
}

export function shortAreaLabel(pick: GeocodeCandidate, parsed: ParsedDeliveryText): string {
  if (parsed.suburb && parsed.city) return `${parsed.suburb}, ${parsed.city}`;
  const parts = String(pick.formattedAddress || pick.label)
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p && !/^zimbabwe$/i.test(p) && !/^midlands/i.test(p));
  if (parsed.city && parts.length) {
    const suburb = parts.find((p) => !p.toLowerCase().includes(parsed.city!.toLowerCase()));
    if (suburb) return `${suburb}, ${parsed.city}`;
  }
  if (parts.length >= 2) return `${parts[0]}, ${parts[1]}`;
  return parts[0] || pick.label;
}

function relevantToCustomerArea(candidate: GeocodeCandidate, parsed: ParsedDeliveryText): boolean {
  const hay = `${candidate.label} ${candidate.formattedAddress}`.toLowerCase();
  if (parsed.city && !hay.includes(parsed.city.toLowerCase())) return false;
  return true;
}

function isStrong(precision: GeocodePrecision): boolean {
  return precision === "exact" || precision === "street" || precision === "landmark";
}

export async function resolveTypedDeliveryLocationWithLookup(
  raw: string,
  lookup: GeocodeLookup,
  parsedOverride?: ParsedDeliveryText
): Promise<TypedDeliveryResolution> {
  const parsed = parsedOverride ?? parseZimbabweDeliveryText(raw);
  const queriesAttempted = progressiveDeliveryQueries(parsed);
  const queryCategory = queryCategoryFromParsed(parsed);
  const base = { parsed, queriesAttempted, queryCategory, providerResultCount: 0 };

  if (!parsed.normalized || parsed.normalized.length < 3) {
    return { ...base, kind: "none", resolutionLevel: "NONE", rejectionReason: "query_too_short" };
  }

  let providerResultCount = 0;
  let areaFallback: { pick: GeocodeCandidate; queryUsed: string } | undefined;
  let lastAmbiguous: GeocodeCandidate[] | undefined;
  let lastRejection = "no_results";

  for (const query of queriesAttempted) {
    const candidates = await lookup(query);
    providerResultCount += candidates.length;
    const relevant = candidates.filter((c) => relevantToCustomerArea(c, parsed));
    if (!candidates.length) {
      lastRejection = "provider_zero_results";
      continue;
    }
    if (!relevant.length) {
      lastRejection = "city_filter";
      continue;
    }
    const classified = classifyGeocodeCandidates(relevant);
    if (classified.kind === "coarse") {
      lastRejection = "city_or_country_too_coarse";
      continue;
    }
    if (classified.kind === "none") {
      lastRejection = "candidates_rejected";
      continue;
    }
    if (classified.kind === "ambiguous") {
      const strong = classified.options.filter((o) => isStrong(o.precision));
      if (strong.length >= 2) {
        return {
          ...base,
          providerResultCount,
          kind: "ambiguous",
          options: strong.slice(0, 3),
          resolutionLevel: "AMBIGUOUS"
        };
      }
      if (strong.length === 1) {
        const pick = strong[0]!;
        if (pick.precision === "landmark") {
          return {
            ...base,
            providerResultCount,
            kind: "landmark",
            pick,
            queryUsed: query,
            resolutionLevel: "LANDMARK"
          };
        }
        return {
          ...base,
          providerResultCount,
          kind: "exact",
          pick,
          queryUsed: query,
          resolutionLevel: pick.precision === "street" ? "STREET" : "EXACT"
        };
      }
      lastAmbiguous = classified.options;
      lastRejection = "ambiguous_area";
      continue;
    }

    const pick = classified.pick;
    if (isStrong(pick.precision)) {
      if (pick.precision === "landmark") {
        return {
          ...base,
          providerResultCount,
          kind: "landmark",
          pick,
          queryUsed: query,
          resolutionLevel: "LANDMARK"
        };
      }
      return {
        ...base,
        providerResultCount,
        kind: "exact",
        pick,
        queryUsed: query,
        resolutionLevel: pick.precision === "street" ? "STREET" : "EXACT"
      };
    }
    if (pick.precision === "area") {
      areaFallback ??= { pick, queryUsed: query };
      lastRejection = "house_or_street_missing";
      if (!parsed.landmark) break;
    }
  }

  const withCount = { ...base, providerResultCount };

  if (areaFallback) {
    return {
      ...withCount,
      kind: "area",
      pick: areaFallback.pick,
      queryUsed: areaFallback.queryUsed,
      resolutionLevel: "AREA",
      areaLabel: shortAreaLabel(areaFallback.pick, parsed),
      rejectionReason: "house_or_street_missing"
    };
  }

  if (lastAmbiguous?.length) {
    return {
      ...withCount,
      kind: "ambiguous",
      options: lastAmbiguous.slice(0, 3),
      resolutionLevel: "AMBIGUOUS"
    };
  }

  const missing = recoveryKind(parsed);
  if (missing === "need_city") {
    return { ...withCount, kind: "need_city", resolutionLevel: "NEED_CITY", rejectionReason: lastRejection };
  }
  if (missing === "need_area") {
    return { ...withCount, kind: "need_area", resolutionLevel: "NEED_AREA", rejectionReason: lastRejection };
  }
  const areaLabel = parsed.suburb && parsed.city ? `${parsed.suburb}, ${parsed.city}` : parsed.suburb;
  return {
    ...withCount,
    kind: "need_landmark",
    resolutionLevel: "NEED_LANDMARK",
    areaLabel,
    rejectionReason: lastRejection
  };
}
