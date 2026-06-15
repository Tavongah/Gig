import { Platform } from "react-native";
import type { AddressSuggestion, GeoPointInput } from "@gigflow/shared";

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export async function getCurrentCoordinates(): Promise<Coordinates> {
  if (Platform.OS === "web") {
    if (!navigator.geolocation) {
      throw new Error("Location is not available in this browser.");
    }

    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
        },
        (error) => reject(new Error(error.message || "Could not access your current location.")),
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 }
      );
    });
  }

  const Location = await import("expo-location");
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) {
    throw new Error("Location permission is required to use your current position.");
  }

  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced
  });

  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude
  };
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
