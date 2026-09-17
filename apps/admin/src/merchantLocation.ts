/** Pure helpers for admin merchant location picker (testable without DOM). */

export type MerchantLocationValue = {
  latitude: string;
  longitude: string;
  locationLabel: string;
};

export type LocationSuggestion = {
  placeId: string;
  label: string;
  formattedAddress?: string;
};

export function parseCoordinate(raw: string): number | null {
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n)) return null;
  return n;
}

export function isValidLatitude(raw: string): boolean {
  const n = parseCoordinate(raw);
  return n != null && n >= -90 && n <= 90;
}

export function isValidLongitude(raw: string): boolean {
  const n = parseCoordinate(raw);
  return n != null && n >= -180 && n <= 180;
}

export function hasValidCoordinates(value: Pick<MerchantLocationValue, "latitude" | "longitude">): boolean {
  return isValidLatitude(value.latitude) && isValidLongitude(value.longitude);
}

/** Accuracy in meters — treat >100m as low (operator should check pin). */
export function isPoorGpsAccuracy(accuracyMeters: number | null | undefined): boolean {
  if (accuracyMeters == null || !Number.isFinite(accuracyMeters)) return false;
  return accuracyMeters > 100;
}

export function formatAccuracyMessage(accuracyMeters: number | null | undefined): string {
  if (accuracyMeters == null || !Number.isFinite(accuracyMeters)) {
    return "Shop location set — confirm the pin.";
  }
  if (isPoorGpsAccuracy(accuracyMeters)) {
    return "Location accuracy is low. Check the pin before confirming.";
  }
  return `Shop location set (±${Math.round(accuracyMeters)} m) — confirm the pin.`;
}

export function geolocationErrorMessage(code: number | undefined): string {
  // 1 PERMISSION_DENIED, 2 POSITION_UNAVAILABLE, 3 TIMEOUT
  void code;
  return "Couldn't access your location. Search for the shop or choose it on the map.";
}

/** Presentation label when no formal address exists (GPS-only tuck shop). */
export function defaultShopLocationLabel(): string {
  return "Shop location";
}

export function presentationLocationLabel(label: string | null | undefined): string {
  const trimmed = String(label ?? "").trim();
  return trimmed.length >= 2 ? trimmed : defaultShopLocationLabel();
}

export function roundCoord(n: number, digits = 6): string {
  const f = 10 ** digits;
  return String(Math.round(n * f) / f);
}

export function coordsEqual(
  a: Pick<MerchantLocationValue, "latitude" | "longitude">,
  b: Pick<MerchantLocationValue, "latitude" | "longitude">,
  epsilon = 1e-7
): boolean {
  const al = parseCoordinate(a.latitude);
  const ao = parseCoordinate(a.longitude);
  const bl = parseCoordinate(b.latitude);
  const bo = parseCoordinate(b.longitude);
  if (al == null || ao == null || bl == null || bo == null) return false;
  return Math.abs(al - bl) < epsilon && Math.abs(ao - bo) < epsilon;
}
