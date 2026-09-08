import { Platform } from "react-native";
import type { AddressSuggestion, GeoPointInput } from "@gigflow/shared";

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export class LocationAccessError extends Error {
  code: "DENIED" | "DENIED_PERMANENT" | "GPS_DISABLED" | "TIMEOUT" | "POOR_ACCURACY" | "UNAVAILABLE";

  constructor(
    code: LocationAccessError["code"],
    message: string
  ) {
    super(message);
    this.name = "LocationAccessError";
    this.code = code;
  }
}

/** Reject GPS fixes that are too coarse for arrival confirmation (meters). */
const MAX_ACCEPTABLE_ACCURACY_M = 150;

/** Friendly copy for location failures (courier arrival + “use my location”). */
export function friendlyLocationError(error: unknown): string {
  if (error instanceof LocationAccessError) {
    switch (error.code) {
      case "DENIED_PERMANENT":
        return "Location access is turned off for DUTS. Open your phone Settings → Apps → DUTS → Permissions → Location, then try again.";
      case "DENIED":
        return "Allow location access so we can confirm arrival or fill your pickup point. Tap again and choose Allow.";
      case "GPS_DISABLED":
        return "Turn on Location / GPS in your phone settings, then try again.";
      case "TIMEOUT":
        return "We couldn’t get a GPS fix in time. Move outdoors or near a window, then try again.";
      case "POOR_ACCURACY":
        return "GPS accuracy is too low right now. Move outdoors or near a window, wait a few seconds, then try again.";
      default:
        return error.message;
    }
  }
  if (error instanceof Error) {
    if (/permission|denied|authoriz/i.test(error.message)) {
      return "Location permission is required. Allow access when prompted, or enable it in Settings.";
    }
    if (/timeout|unavailable|disabled/i.test(error.message)) {
      return "Location is unavailable. Check that GPS is on and try again.";
    }
    return error.message;
  }
  return "Location is unavailable right now. Please try again.";
}

export async function getCurrentCoordinates(): Promise<Coordinates> {
  if (Platform.OS === "web") {
    if (!navigator.geolocation) {
      throw new LocationAccessError("UNAVAILABLE", "Location is not available in this browser.");
    }

    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
        },
        (error) => {
          if (error.code === error.PERMISSION_DENIED) {
            reject(
              new LocationAccessError(
                "DENIED",
                "Location permission is required to use your current position."
              )
            );
            return;
          }
          if (error.code === error.TIMEOUT) {
            reject(new LocationAccessError("TIMEOUT", "Location request timed out."));
            return;
          }
          reject(new LocationAccessError("UNAVAILABLE", error.message || "Could not access location."));
        },
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 }
      );
    });
  }

  const Location = await import("expo-location");
  const servicesEnabled = await Location.hasServicesEnabledAsync();
  if (!servicesEnabled) {
    throw new LocationAccessError(
      "GPS_DISABLED",
      "Location services are turned off on this device."
    );
  }

  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) {
    const permanent = permission.canAskAgain === false;
    throw new LocationAccessError(
      permanent ? "DENIED_PERMANENT" : "DENIED",
      permanent
        ? "Location permission was denied. Enable it in Settings to continue."
        : "Location permission is required to use your current position."
    );
  }

  try {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High
    });
    const accuracy = position.coords.accuracy;
    if (typeof accuracy === "number" && accuracy > MAX_ACCEPTABLE_ACCURACY_M) {
      throw new LocationAccessError(
        "POOR_ACCURACY",
        `GPS accuracy is about ${Math.round(accuracy)}m. Move to a clearer spot and try again.`
      );
    }
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude
    };
  } catch (error) {
    if (error instanceof LocationAccessError) throw error;
    const message = error instanceof Error ? error.message : "Could not get GPS position.";
    if (/timeout/i.test(message)) {
      throw new LocationAccessError("TIMEOUT", message);
    }
    throw new LocationAccessError("UNAVAILABLE", message);
  }
}

export function formatLocationSummary(
  location: Pick<GeoPointInput, "formattedAddress" | "addressLine1" | "city" | "region" | "postalCode">
): string {
  if (location.formattedAddress) {
    return location.formattedAddress;
  }

  return `${location.addressLine1}, ${location.city}, ${location.region} ${location.postalCode}`;
}

export function suggestionKey(suggestion: AddressSuggestion): string {
  return `${suggestion.placeId}:${suggestion.label}`;
}
