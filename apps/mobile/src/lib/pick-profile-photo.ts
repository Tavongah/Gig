import { Alert, Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";

/** Keep under API data-URL fallback limits. */
export const MAX_PROFILE_PHOTO_DATA_URL_CHARS = 900_000;

export type PickedProfilePhoto = {
  uri: string;
  dataUrl: string;
  base64: string;
  byteLength: number;
};

function permissionOk(
  permission: ImagePicker.MediaLibraryPermissionResponse | ImagePicker.CameraPermissionResponse
): boolean {
  return permission.granted || permission.status === ImagePicker.PermissionStatus.GRANTED;
}

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

function base64ToByteLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

async function compressToLimit(uri: string): Promise<PickedProfilePhoto> {
  const attempts: Array<{ width: number; compress: number }> = [
    { width: 512, compress: 0.55 },
    { width: 384, compress: 0.45 },
    { width: 256, compress: 0.35 },
    { width: 192, compress: 0.3 },
    { width: 128, compress: 0.25 }
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
        return {
          uri: manipulated.uri,
          dataUrl,
          base64: manipulated.base64,
          byteLength: base64ToByteLength(manipulated.base64)
        };
      }
      lastError = new Error("Image is too large. Try a smaller photo.");
    } catch (err) {
      lastError = err instanceof Error ? err : new Error("Could not process image.");
    }
  }
  throw lastError ?? new Error("Image is too large. Try a smaller photo.");
}

/**
 * Camera or gallery → compress → JPEG bytes ready for signed PUT or data-URL fallback.
 */
export async function pickProfilePhoto(): Promise<PickedProfilePhoto | null> {
  const source = await chooseSource();
  if (!source) return null;

  if (source === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permissionOk(permission)) {
      throw new Error("Camera permission is required. Enable it in Settings, then try again.");
    }
  } else {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionOk(permission)) {
      throw new Error("Photo library permission is required. Enable it in Settings, then try again.");
    }
  }

  const allowsEditing = Platform.OS === "ios";

  const result =
    source === "camera"
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"],
          allowsEditing,
          aspect: [1, 1],
          quality: 0.6,
          exif: false,
          base64: true
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsEditing,
          aspect: [1, 1],
          quality: 0.6,
          exif: false,
          base64: true
        });

  if (result.canceled || !result.assets[0]?.uri) {
    return null;
  }

  const asset = result.assets[0];
  if (asset.base64) {
    const dataUrl = `data:image/jpeg;base64,${asset.base64}`;
    if (dataUrl.length <= MAX_PROFILE_PHOTO_DATA_URL_CHARS) {
      return {
        uri: asset.uri,
        dataUrl,
        base64: asset.base64,
        byteLength: base64ToByteLength(asset.base64)
      };
    }
  }

  return compressToLimit(asset.uri);
}

/** @deprecated Prefer pickProfilePhoto() */
export async function pickProfilePhotoDataUrl(): Promise<string | null> {
  const photo = await pickProfilePhoto();
  return photo?.dataUrl ?? null;
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const normalized = base64.replace(/[^A-Za-z0-9+/=]/g, "");
  const atobFn = (globalThis as { atob?: (value: string) => string }).atob;
  if (typeof atobFn === "function") {
    const binary = atobFn(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  const BufferCtor = (globalThis as { Buffer?: { from: (v: string, enc: string) => Uint8Array } }).Buffer;
  if (BufferCtor) {
    return Uint8Array.from(BufferCtor.from(normalized, "base64"));
  }

  throw new Error("Could not decode photo data on this device.");
}
