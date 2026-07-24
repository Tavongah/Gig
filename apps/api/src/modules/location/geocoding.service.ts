import type { AddressSuggestion, GeocodedAddress } from "@gigflow/shared";
import { coordinatesAreConsistent } from "@gigflow/shared";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const USER_AGENT = "DUTS/1.0 (local-dev)";

interface NominatimAddress {
  house_number?: string;
  road?: string;
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  state?: string;
  postcode?: string;
  country_code?: string;
}

interface NominatimResult {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
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
  components: Array<{ long_name: string; short_name: string; types: string[] }>
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
    throw new AppError("INVALID_ADDRESS", 422, "INVALID_ADDRESS", {
      location: "Address must include street, city, state, and postal code."
    });
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

function mapNominatimResult(result: NominatimResult): GeocodedAddress {
  const address = result.address ?? {};
  const addressLine1 = [address.house_number, address.road].filter(Boolean).join(" ").trim();
  const city = address.city ?? address.town ?? address.village ?? address.hamlet ?? "";
  const region = address.state ?? "";
  const postalCode = address.postcode ?? "";
  const country = (address.country_code ?? "us").toUpperCase();

  if (!addressLine1 || !city || !region || !postalCode) {
    throw new AppError("INVALID_ADDRESS", 422, "INVALID_ADDRESS", {
      location: "Address must include street, city, state, and postal code."
    });
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

async function geocodeWithGoogle(query: string): Promise<GeocodedAddress> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("key", env.GOOGLE_MAPS_API_KEY!);
  url.searchParams.set("components", "country:US");

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
    top.address_components
  );
}

async function geocodeWithNominatim(query: string): Promise<GeocodedAddress> {
  const url = new URL(`${NOMINATIM_BASE}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");

  const results = await fetchJson<NominatimResult[]>(url.toString(), { "User-Agent": USER_AGENT });
  if (!Array.isArray(results) || results.length === 0) {
    throw new AppError("INVALID_ADDRESS", 422, "INVALID_ADDRESS", {
      location: "Enter a valid street address with city, state, and ZIP code."
    });
  }

  return mapNominatimResult(results[0]!);
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
    top.address_components
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

  return mapNominatimResult(result);
}

export async function geocodeAddressQuery(query: string): Promise<GeocodedAddress> {
  const trimmed = query.trim();
  if (trimmed.length < 8) {
    throw new AppError("INVALID_ADDRESS", 422, "INVALID_ADDRESS", {
      location: "Enter a complete street address."
    });
  }

  return hasGoogleMapsKey() ? geocodeWithGoogle(trimmed) : geocodeWithNominatim(trimmed);
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
    data.result.address_components
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
    url.searchParams.set("types", "address");
    url.searchParams.set("components", "country:us");
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
  url.searchParams.set("countrycodes", "us");

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
}): Promise<GeocodedAddress> {
  let resolved: GeocodedAddress;

  if (input.placeId) {
    if (hasGoogleMapsKey()) {
      resolved = await geocodePlaceId(input.placeId);
    } else {
      resolved = await geocodeAddressQuery(input.formattedAddress ?? input.query ?? "");
    }
  } else if (input.query) {
    resolved = await geocodeAddressQuery(input.query);
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
    resolved = await geocodeAddressQuery(resolved.formattedAddress);
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
