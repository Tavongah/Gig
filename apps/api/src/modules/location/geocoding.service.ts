import type { AddressSuggestion, GeocodedAddress } from "@gigflow/shared";
import { coordinatesAreConsistent } from "@gigflow/shared";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { logDutsFlow } from "../../lib/flow-log.js";
import {
  type GeocodeCandidate,
  type GeocodePrecision
} from "./geocode-candidates.js";
import { resolveTypedDeliveryLocationWithLookup } from "./typed-delivery-resolve.js";

export type { GeocodeCandidate, GeocodeClassification, GeocodePrecision } from "./geocode-candidates.js";
export { classifyGeocodeCandidates } from "./geocode-candidates.js";
export type { TypedDeliveryResolution } from "./typed-delivery-resolve.js";
export {
  originalDeliveryInstructions,
  queryCategoryFromParsed,
  shortAreaLabel
} from "./typed-delivery-resolve.js";

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const USER_AGENT = "DUTS/1.0 (local-dev)";

interface NominatimAddress {
  house_number?: string;
  road?: string;
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  suburb?: string;
  neighbourhood?: string;
  neighborhood?: string;
  state?: string;
  county?: string;
  postcode?: string;
  country?: string;
  country_code?: string;
}

interface NominatimResult {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  class?: string;
  type?: string;
  addresstype?: string;
  address?: NominatimAddress;
}

interface GoogleGeocodeResult {
  results: Array<{
    formatted_address: string;
    geometry: { location: { lat: number; lng: number } };
    address_components: Array<{
      long_name: string;
      short_name: string;
      types: string[];
    }>;
    place_id: string;
    types?: string[];
  }>;
  status: string;
}

interface GoogleAutocompleteResult {
  predictions: Array<{
    description: string;
    place_id: string;
  }>;
  status: string;
}

interface GooglePlaceDetailsResult {
  result?: {
    formatted_address: string;
    geometry: { location: { lat: number; lng: number } };
    address_components: Array<{
      long_name: string;
      short_name: string;
      types: string[];
    }>;
  };
  status: string;
}

function pickComponent(
  components: Array<{ long_name: string; short_name: string; types: string[] }>,
  type: string,
  useShort = false
): string {
  const match = components.find((component) => component.types.includes(type));
  if (!match) return "";
  return useShort ? match.short_name : match.long_name;
}

function buildAddressLine1(components: Array<{ long_name: string; short_name: string; types: string[] }>): string {
  const streetNumber = pickComponent(components, "street_number");
  const route = pickComponent(components, "route");
  const combined = [streetNumber, route].filter(Boolean).join(" ").trim();
  if (combined) return combined;
  return pickComponent(components, "premise") || pickComponent(components, "subpremise") || pickComponent(components, "route");
}

function mapGoogleComponents(
  formattedAddress: string,
  latitude: number,
  longitude: number,
  components: Array<{ long_name: string; short_name: string; types: string[] }>,
  options?: { allowIncomplete?: boolean }
): GeocodedAddress {
  const city =
    pickComponent(components, "locality") ||
    pickComponent(components, "postal_town") ||
    pickComponent(components, "sublocality") ||
    pickComponent(components, "administrative_area_level_2");

  const region = pickComponent(components, "administrative_area_level_1", true);
  const postalCode = pickComponent(components, "postal_code");
  const country = pickComponent(components, "country", true) || "US";
  const addressLine1 = buildAddressLine1(components);

  if (!addressLine1 || !city || !region || !postalCode) {
    if (!options?.allowIncomplete) {
      throw new AppError("INVALID_ADDRESS", 422, "INVALID_ADDRESS", {
        location: "Address must include street, city, state, and postal code."
      });
    }
    // Merchant / place flows: GPS + label matter more than a full postal address (e.g. Zimbabwe tuck shops).
    return {
      addressLine1: addressLine1 || formattedAddress || "Shop",
      city: city || "Unknown",
      region: region || "Unknown",
      postalCode: postalCode || "0000",
      country: country.length === 2 ? country : "ZW",
      formattedAddress: formattedAddress || "Shop location",
      latitude,
      longitude
    };
  }

  return {
    addressLine1,
    city,
    region,
    postalCode,
    country: country.length === 2 ? country : "US",
    formattedAddress,
    latitude,
    longitude
  };
}

function mapNominatimResult(result: NominatimResult, options?: { allowIncomplete?: boolean }): GeocodedAddress {
  const address = result.address ?? {};
  const addressLine1 = [address.house_number, address.road].filter(Boolean).join(" ").trim();
  const city = address.city ?? address.town ?? address.village ?? address.hamlet ?? address.suburb ?? "";
  const region = address.state ?? address.county ?? "";
  const postalCode = address.postcode ?? "";
  const country = (address.country_code ?? "us").toUpperCase();

  if (!addressLine1 || !city || !region || !postalCode) {
    if (!options?.allowIncomplete) {
      throw new AppError("INVALID_ADDRESS", 422, "INVALID_ADDRESS", {
        location: "Address must include street, city, state, and postal code."
      });
    }
    return {
      addressLine1: addressLine1 || result.display_name || "Shop",
      city: city || "Unknown",
      region: region || "Unknown",
      postalCode: postalCode || "0000",
      country: country.length === 2 ? country : "ZW",
      formattedAddress: result.display_name || "Shop location",
      latitude: Number(result.lat),
      longitude: Number(result.lon)
    };
  }

  return {
    addressLine1,
    city,
    region,
    postalCode,
    country: country.length === 2 ? country : "US",
    formattedAddress: result.display_name,
    latitude: Number(result.lat),
    longitude: Number(result.lon)
  };
}

async function fetchJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new AppError("GEOCODING_FAILED", 502, "GEOCODING_FAILED", {
      location: "Could not validate the address right now. Try again shortly."
    });
  }

  return response.json() as Promise<T>;
}

function hasGoogleMapsKey(): boolean {
  return Boolean(env.GOOGLE_MAPS_API_KEY?.trim());
}

async function geocodeWithGoogle(query: string, options?: { allowIncomplete?: boolean }): Promise<GeocodedAddress> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("key", env.GOOGLE_MAPS_API_KEY!);
  // Zimbabwe tuck shops + Meriden US pilot.
  url.searchParams.set("components", "country:ZW|country:US");

  const data = await fetchJson<GoogleGeocodeResult>(url.toString());
  if (data.status !== "OK" || data.results.length === 0) {
    throw new AppError("INVALID_ADDRESS", 422, "INVALID_ADDRESS", {
      location: "Enter a valid street address with city, state, and ZIP code."
    });
  }

  const top = data.results[0]!;
  return mapGoogleComponents(
    top.formatted_address,
    top.geometry.location.lat,
    top.geometry.location.lng,
    top.address_components,
    options
  );
}

async function geocodeWithNominatim(query: string, options?: { allowIncomplete?: boolean }): Promise<GeocodedAddress> {
  const url = new URL(`${NOMINATIM_BASE}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "zw,us");

  const results = await fetchJson<NominatimResult[]>(url.toString(), { "User-Agent": USER_AGENT });
  if (!Array.isArray(results) || results.length === 0) {
    throw new AppError("INVALID_ADDRESS", 422, "INVALID_ADDRESS", {
      location: "Enter a valid street address with city, state, and ZIP code."
    });
  }

  return mapNominatimResult(results[0]!, options);
}

async function reverseGeocodeWithGoogle(latitude: number, longitude: number): Promise<GeocodedAddress> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("latlng", `${latitude},${longitude}`);
  url.searchParams.set("key", env.GOOGLE_MAPS_API_KEY!);

  const data = await fetchJson<GoogleGeocodeResult>(url.toString());
  if (data.status !== "OK" || data.results.length === 0) {
    throw new AppError("INVALID_ADDRESS", 422, "INVALID_ADDRESS", {
      location: "Could not resolve this location to a valid address."
    });
  }

  const top = data.results[0]!;
  return mapGoogleComponents(
    top.formatted_address,
    top.geometry.location.lat,
    top.geometry.location.lng,
    top.address_components,
    { allowIncomplete: true }
  );
}

async function reverseGeocodeWithNominatim(latitude: number, longitude: number): Promise<GeocodedAddress> {
  const url = new URL(`${NOMINATIM_BASE}/reverse`);
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");

  const result = await fetchJson<NominatimResult>(url.toString(), { "User-Agent": USER_AGENT });
  if (!result?.lat || !result.lon) {
    throw new AppError("INVALID_ADDRESS", 422, "INVALID_ADDRESS", {
      location: "Could not resolve this location to a valid address."
    });
  }

  return mapNominatimResult(result, { allowIncomplete: true });
}

function looksLikeUnitedStatesQuery(query: string): boolean {
  return /\b(united states|\busa\b|, us\b|meriden|, ct\b)\b/i.test(query);
}

function looksLikeZimbabweQuery(query: string): boolean {
  return /\b(zimbabwe|harare|gweru|bulawayo|mutare|masvingo|kwekwe|chitungwiza|epworth|senga)\b/i.test(query);
}

function biasLocalQuery(query: string): string {
  if (looksLikeUnitedStatesQuery(query) || looksLikeZimbabweQuery(query)) {
    return query;
  }
  return `${query}, Zimbabwe`;
}

function nominatimCountryCodes(query: string): string {
  if (looksLikeUnitedStatesQuery(query)) return "us";
  return "zw";
}

function googleCountryComponents(query: string): string {
  if (looksLikeUnitedStatesQuery(query)) return "country:US";
  return "country:ZW";
}

function nominatimPrecision(result: NominatimResult): GeocodePrecision {
  const address = result.address ?? {};
  const kind = String(result.addresstype || result.type || "").toLowerCase();
  const cls = String(result.class || "").toLowerCase();
  if (address.house_number) return "exact";
  if (cls === "amenity" || cls === "shop" || cls === "tourism" || cls === "leisure") return "landmark";
  if (["gate", "university", "college", "mall", "retail", "supermarket", "marketplace"].includes(kind)) return "landmark";
  if (cls === "building" || kind === "building" || kind === "house" || kind === "residential") return "street";
  if (address.road || kind === "road" || kind === "street") return "street";
  if (
    address.suburb ||
    address.neighbourhood ||
    address.neighborhood ||
    ["suburb", "neighbourhood", "neighborhood", "quarter", "hamlet", "village"].includes(kind)
  ) {
    return "area";
  }
  if (["city", "town", "municipality", "county", "state", "country"].includes(kind)) {
    return kind === "country" || kind === "state" ? "coarse" : "city";
  }
  if (address.city || address.town) return "city";
  return "coarse";
}

function googlePrecision(types: string[] | undefined): GeocodePrecision {
  const t = types ?? [];
  if (t.includes("street_address") || t.includes("premise") || t.includes("subpremise")) return "exact";
  if (t.includes("route") || t.includes("intersection")) return "street";
  if (t.includes("point_of_interest") || t.includes("establishment") || t.includes("plus_code")) return "landmark";
  if (
    t.includes("neighborhood") ||
    t.includes("sublocality") ||
    t.includes("sublocality_level_1") ||
    t.includes("sublocality_level_2")
  ) {
    return "area";
  }
  if (t.includes("locality") || t.includes("postal_town") || t.includes("administrative_area_level_2")) return "city";
  if (t.includes("country") || t.includes("administrative_area_level_1")) return "coarse";
  return "coarse";
}

function isCoarseGoogleTypes(types: string[] | undefined): boolean {
  const t = types ?? [];
  if (
    t.includes("street_address") ||
    t.includes("premise") ||
    t.includes("subpremise") ||
    t.includes("route") ||
    t.includes("intersection") ||
    t.includes("neighborhood") ||
    t.includes("sublocality") ||
    t.includes("sublocality_level_1") ||
    t.includes("point_of_interest") ||
    t.includes("establishment") ||
    t.includes("plus_code")
  ) {
    return false;
  }
  return t.includes("country") || t.includes("administrative_area_level_1") || t.includes("administrative_area_level_2");
}

function isCoarseNominatim(result: NominatimResult): boolean {
  const precision = nominatimPrecision(result);
  return precision === "city" || precision === "coarse";
}

function candidateLabel(formattedAddress: string, query: string): string {
  const formatted = formattedAddress.trim();
  if (formatted && formatted.length <= 96) return formatted;
  const typed = query.trim();
  return typed.length <= 96 ? typed : `${typed.slice(0, 93)}…`;
}

async function geocodeCandidatesWithGoogle(query: string): Promise<GeocodeCandidate[]> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", biasLocalQuery(query));
  url.searchParams.set("key", env.GOOGLE_MAPS_API_KEY!);
  url.searchParams.set("components", googleCountryComponents(query));

  const data = await fetchJson<GoogleGeocodeResult>(url.toString());
  if (data.status === "ZERO_RESULTS" || !data.results.length) return [];
  if (data.status !== "OK") return [];
  return data.results.slice(0, 5).map((top) => {
    const precision = googlePrecision(top.types);
    return {
      label: candidateLabel(top.formatted_address, query),
      formattedAddress: top.formatted_address,
      latitude: top.geometry.location.lat,
      longitude: top.geometry.location.lng,
      placeId: top.place_id,
      coarse: isCoarseGoogleTypes(top.types) || precision === "city" || precision === "coarse",
      precision
    };
  });
}

async function geocodeCandidatesWithNominatim(query: string): Promise<GeocodeCandidate[]> {
  const url = new URL(`${NOMINATIM_BASE}/search`);
  url.searchParams.set("q", biasLocalQuery(query));
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "5");
  url.searchParams.set("countrycodes", nominatimCountryCodes(query));

  const response = await fetch(url.toString(), { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) {
    logDutsFlow("GEOCODE_TYPED_ADDRESS", {
      queryCategory: "provider_http",
      providerResultCount: 0,
      resolutionLevel: "NONE",
      candidateRejectionReason: `http_${response.status}`
    });
    return [];
  }
  const results = (await response.json()) as NominatimResult[];
  if (!Array.isArray(results) || results.length === 0) return [];
  return results.slice(0, 5).map((result) => {
    const precision = nominatimPrecision(result);
    return {
      label: candidateLabel(result.display_name, query),
      formattedAddress: result.display_name,
      latitude: Number(result.lat),
      longitude: Number(result.lon),
      placeId: String(result.place_id),
      coarse: isCoarseNominatim(result),
      precision
    };
  });
}

export async function geocodeAddressCandidates(query: string): Promise<GeocodeCandidate[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];
  try {
    return hasGoogleMapsKey()
      ? await geocodeCandidatesWithGoogle(trimmed)
      : await geocodeCandidatesWithNominatim(trimmed);
  } catch {
    return [];
  }
}

export async function resolveTypedDeliveryLocation(
  raw: string,
  options?: { parsed?: import("./zimbabwe-delivery-text.js").ParsedDeliveryText }
) {
  let lastAt = 0;
  const resolution = await resolveTypedDeliveryLocationWithLookup(raw, async (query) => {
    const wait = 1100 - (Date.now() - lastAt);
    if (lastAt && wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastAt = Date.now();
    const candidates = await geocodeAddressCandidates(query);
    logDutsFlow("GEOCODE_TYPED_ADDRESS", {
      queryCategory: "provider_lookup",
      providerResultCount: candidates.length,
      resolutionLevel: candidates[0]?.precision?.toUpperCase() ?? "NONE",
      candidateRejectionReason: candidates.length ? null : "provider_zero_results"
    });
    return candidates;
  }, options?.parsed);
  logDutsFlow("GEOCODE_TYPED_ADDRESS", {
    queryCategory: resolution.queryCategory,
    providerResultCount: resolution.providerResultCount,
    resolutionLevel: resolution.resolutionLevel,
    candidateRejectionReason: resolution.rejectionReason ?? null
  });
  return resolution;
}

export function candidateToGeocodedAddress(pick: GeocodeCandidate): GeocodedAddress {
  const parts = pick.formattedAddress.split(",").map((p) => p.trim()).filter(Boolean);
  return {
    addressLine1: pick.label || parts[0] || "Delivery location",
    city: parts[1] || parts[0] || "Unknown",
    region: parts[2] || "Unknown",
    postalCode: "0000",
    country: "ZW",
    formattedAddress: pick.formattedAddress,
    latitude: pick.latitude,
    longitude: pick.longitude
  };
}

export async function geocodeAddressQuery(
  query: string,
  options?: { allowIncomplete?: boolean }
): Promise<GeocodedAddress> {
  const trimmed = query.trim();
  const minLen = options?.allowIncomplete ? 3 : 8;
  if (trimmed.length < minLen) {
    throw new AppError("INVALID_ADDRESS", 422, "INVALID_ADDRESS", {
      location: "Enter a complete street address."
    });
  }

  return hasGoogleMapsKey()
    ? geocodeWithGoogle(trimmed, options)
    : geocodeWithNominatim(trimmed, options);
}

export async function reverseGeocodeCoordinates(latitude: number, longitude: number): Promise<GeocodedAddress> {
  return hasGoogleMapsKey()
    ? reverseGeocodeWithGoogle(latitude, longitude)
    : reverseGeocodeWithNominatim(latitude, longitude);
}

export async function geocodePlaceId(placeId: string): Promise<GeocodedAddress> {
  if (!hasGoogleMapsKey()) {
    throw new AppError("GEOCODING_NOT_CONFIGURED", 503, "GEOCODING_NOT_CONFIGURED", {
      location: "Place lookup requires Google Maps configuration."
    });
  }

  const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  url.searchParams.set("place_id", placeId);
  url.searchParams.set("fields", "formatted_address,geometry,address_component");
  url.searchParams.set("key", env.GOOGLE_MAPS_API_KEY!);

  const data = await fetchJson<GooglePlaceDetailsResult>(url.toString());
  if (data.status !== "OK" || !data.result) {
    throw new AppError("INVALID_ADDRESS", 422, "INVALID_ADDRESS", {
      location: "Selected address could not be verified."
    });
  }

  return mapGoogleComponents(
    data.result.formatted_address,
    data.result.geometry.location.lat,
    data.result.geometry.location.lng,
    data.result.address_components,
    { allowIncomplete: true }
  );
}

export async function searchAddressSuggestions(query: string): Promise<AddressSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) {
    return [];
  }

  if (hasGoogleMapsKey()) {
    const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
    url.searchParams.set("input", trimmed);
    // Zimbabwe + US merchants (tuck shops + Meriden pilot).
    url.searchParams.set("components", "country:zw|country:us");
    url.searchParams.set("key", env.GOOGLE_MAPS_API_KEY!);

    const data = await fetchJson<GoogleAutocompleteResult>(url.toString());
    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      return [];
    }

    return (data.predictions ?? []).slice(0, 5).map((prediction) => ({
      placeId: prediction.place_id,
      label: prediction.description,
      formattedAddress: prediction.description
    }));
  }

  const url = new URL(`${NOMINATIM_BASE}/search`);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "5");
  url.searchParams.set("countrycodes", "zw,us");

  const results = await fetchJson<NominatimResult[]>(url.toString(), { "User-Agent": USER_AGENT });
  return (results ?? []).map((result) => ({
    placeId: String(result.place_id),
    label: result.display_name,
    formattedAddress: result.display_name
  }));
}

export async function resolveGeocodedLocation(input: {
  query?: string;
  placeId?: string;
  latitude?: number;
  longitude?: number;
  formattedAddress?: string;
  addressLine1?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  allowIncomplete?: boolean;
}): Promise<GeocodedAddress> {
  let resolved: GeocodedAddress;
  const incomplete = { allowIncomplete: Boolean(input.allowIncomplete) };

  if (input.placeId) {
    if (hasGoogleMapsKey()) {
      resolved = await geocodePlaceId(input.placeId);
    } else {
      resolved = await geocodeAddressQuery(input.formattedAddress ?? input.query ?? "", incomplete);
    }
  } else if (input.query) {
    if (incomplete.allowIncomplete) {
      const typed = await resolveTypedDeliveryLocation(input.query);
      if (typed.kind === "exact" || typed.kind === "landmark" || typed.kind === "area") {
        resolved = candidateToGeocodedAddress(typed.pick);
      } else {
        throw new AppError("INVALID_ADDRESS", 422, "INVALID_ADDRESS", {
          location:
            typed.kind === "need_city"
              ? "Which city should we deliver to?"
              : typed.kind === "need_area"
                ? "Which area or suburb should we deliver to?"
                : "I found the area, but not the exact address. Add a nearby landmark."
        });
      }
    } else {
      resolved = await geocodeAddressQuery(input.query, incomplete);
    }
  } else if (input.latitude !== undefined && input.longitude !== undefined) {
    resolved = await reverseGeocodeCoordinates(input.latitude, input.longitude);
  } else if (
    input.addressLine1 &&
    input.city &&
    input.region &&
    input.postalCode &&
    input.latitude !== undefined &&
    input.longitude !== undefined
  ) {
    resolved = {
      addressLine1: input.addressLine1,
      city: input.city,
      region: input.region,
      postalCode: input.postalCode,
      country: input.country ?? "US",
      formattedAddress: input.formattedAddress ?? `${input.addressLine1}, ${input.city}, ${input.region} ${input.postalCode}`,
      latitude: input.latitude,
      longitude: input.longitude
    };
    resolved = await geocodeAddressQuery(resolved.formattedAddress, incomplete);
  } else {
    throw new AppError("INVALID_ADDRESS", 422, "INVALID_ADDRESS", {
      location: "A valid address is required."
    });
  }

  if (
    input.latitude !== undefined &&
    input.longitude !== undefined &&
    !coordinatesAreConsistent(input.latitude, input.longitude, resolved.latitude, resolved.longitude)
  ) {
    throw new AppError("INVALID_ADDRESS", 422, "INVALID_ADDRESS", {
      location: "Address coordinates could not be verified."
    });
  }

  return resolved;
}
