import { Alert, Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";

/** Keep under API avatar limits (400k chars / ~350k bytes). */
export const MAX_PROFILE_PHOTO_DATA_URL_CHARS = 380_000;

async function chooseSource(): Promise<"camera" | "gallery" | null> {
  if (Platform.OS === "web") {
    return "gallery";
  }
  return new Promise((resolve) => {
    Alert.alert("Profile photo", "Choose a source", [
      { text: "Camera", onPress: () => resolve("camera") },
      { text: "Gallery", onPress: () => resolve("gallery") },
      { text: "Cancel", style: "cancel", onPress: () => resolve(null) }
    ]);
  });
}

async function compressToLimit(uri: string): Promise<string> {
  const attempts: Array<{ width: number; compress: number }> = [
    { width: 512, compress: 0.55 },
    { width: 384, compress: 0.45 },
    { width: 256, compress: 0.35 },
    { width: 192, compress: 0.3 }
  ];

  let lastError: Error | null = null;
  for (const attempt of attempts) {
    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: attempt.width } }],
        { compress: attempt.compress, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      if (!manipulated.base64) {
        throw new Error("Could not process image.");
      }
      const dataUrl = `data:image/jpeg;base64,${manipulated.base64}`;
      if (dataUrl.length <= MAX_PROFILE_PHOTO_DATA_URL_CHARS) {
        return dataUrl;
      }
      lastError = new Error("Image is too large. Try a smaller photo.");
    } catch (err) {
      lastError = err instanceof Error ? err : new Error("Could not process image.");
    }
  }
  throw lastError ?? new Error("Image is too large. Try a smaller photo.");
}

/**
 * Camera or gallery → crop → compress → JPEG data URL ready for POST /auth/me/avatar.
 */
export async function pickProfilePhotoDataUrl(): Promise<string | null> {
  const source = await chooseSource();
  if (!source) return null;

  if (source === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      throw new Error("Camera permission is required to take a profile photo.");
    }
  } else {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      throw new Error("Photo library permission is required to upload a profile photo.");
    }
  }

  const result =
    source === "camera"
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.7
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.7
        });

  if (result.canceled || !result.assets[0]?.uri) {
    return null;
  }

  return compressToLimit(result.assets[0].uri);
}
