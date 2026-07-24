import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  Text,
  View
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";

const MAX_DATA_URL_CHARS = 350_000;

type Props = {
  label: string;
  hint?: string;
  aspect?: [number, number];
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  error?: string;
};

async function pickAndCompress(aspect: [number, number]): Promise<string> {
  const choice = await new Promise<"camera" | "gallery" | null>((resolve) => {
    Alert.alert("Add photo", "Choose a source", [
      { text: "Camera", onPress: () => resolve("camera") },
      { text: "Gallery", onPress: () => resolve("gallery") },
      { text: "Cancel", style: "cancel", onPress: () => resolve(null) }
    ]);
  });
  if (!choice) throw new Error("CANCELLED");

  if (choice === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      throw new Error("Camera permission is required.");
    }
  } else {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      throw new Error("Photo library permission is required.");
    }
  }

  const result =
    choice === "camera"
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"],
          allowsEditing: true,
          aspect,
          quality: 0.7
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsEditing: true,
          aspect,
          quality: 0.7
        });

  if (result.canceled || !result.assets[0]) {
    throw new Error("CANCELLED");
  }

  const manipulated = await ImageManipulator.manipulateAsync(
    result.assets[0].uri,
    [{ resize: { width: aspect[0] === aspect[1] ? 384 : 1280 } }],
    { compress: 0.55, format: ImageManipulator.SaveFormat.JPEG, base64: true }
  );

  if (!manipulated.base64) {
    throw new Error("Could not process image.");
  }

  const dataUrl = `data:image/jpeg;base64,${manipulated.base64}`;
  if (dataUrl.length > MAX_DATA_URL_CHARS) {
    throw new Error("Image is too large. Try a smaller photo.");
  }
  return dataUrl;
}

export function IdentityImageField({ label, hint, aspect = [1, 1], value, onChange, error }: Props) {
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handlePick(): Promise<void> {
    setBusy(true);
    setLocalError(null);
    try {
      const dataUrl = await pickAndCompress(aspect);
      onChange(dataUrl);
    } catch (err) {
      if (err instanceof Error && err.message === "CANCELLED") return;
      setLocalError(err instanceof Error ? err.message : "Could not update photo.");
    } finally {
      setBusy(false);
    }
  }

  const message = error || localError;

  return (
    <View className="gap-2">
      <Text className="text-sm font-bold text-ink">{label}</Text>
      {hint ? <Text className="text-xs text-muted">{hint}</Text> : null}
      {value ? (
        <Image source={{ uri: value }} className="h-40 w-full rounded-2xl bg-surface" resizeMode="cover" />
      ) : (
        <View className="h-40 items-center justify-center rounded-2xl border border-dashed border-border bg-surface">
          <Text className="text-sm text-muted">No image selected</Text>
        </View>
      )}
      <View className="flex-row gap-2">
        <Pressable
          onPress={handlePick}
          disabled={busy}
          className="min-h-[44px] flex-1 items-center justify-center rounded-2xl bg-brand px-3"
        >
          {busy ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="font-bold text-white">{value ? "Replace photo" : "Upload photo"}</Text>
          )}
        </Pressable>
        {value ? (
          <Pressable
            onPress={() => onChange(null)}
            className="min-h-[44px] items-center justify-center rounded-2xl border border-border px-4"
          >
            <Text className="font-bold text-danger">Remove</Text>
          </Pressable>
        ) : null}
      </View>
      {message ? <Text className="text-xs text-danger">{message}</Text> : null}
    </View>
  );
}
