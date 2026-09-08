import { Linking, Platform } from "react-native";
import { showAlert } from "./confirm";

/** Open the device maps app for turn-by-turn directions (no in-app map tiles). */
export async function openExternalNavigation(
  lat?: string | number | null,
  lng?: string | number | null,
  label?: string
): Promise<void> {
  if (lat == null || lng == null || Number.isNaN(Number(lat)) || Number.isNaN(Number(lng))) {
    showAlert("Map unavailable", "Location coordinates are not available yet.");
    return;
  }

  const latitude = Number(lat);
  const longitude = Number(lng);
  const encodedLabel = encodeURIComponent(label?.trim() || "Destination");

  const url =
    Platform.OS === "ios"
      ? `http://maps.apple.com/?daddr=${latitude},${longitude}&q=${encodedLabel}`
      : `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;

  try {
    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) {
      showAlert("Maps unavailable", "This device cannot open a maps application.");
      return;
    }
    await Linking.openURL(url);
  } catch {
    showAlert("Maps unavailable", "Could not open maps. Try again in a moment.");
  }
}
