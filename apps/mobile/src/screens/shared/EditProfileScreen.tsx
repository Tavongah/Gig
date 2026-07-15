import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  Text,
  View
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../lib/api";
import { initials } from "../../lib/format";
import { Screen } from "../../components/Screen";
import { DutsCard } from "../../components/DutsCard";
import { FormInput } from "../../components/FormInput";
import { LoadingButton } from "../../components/LoadingButton";
import { useSessionStore } from "../../stores/session.store";
import type { RootStackParamList } from "../../navigation/types";
import { DUTS } from "../../lib/theme";

type Nav = NativeStackNavigationProp<RootStackParamList, "EditProfile">;

const MAX_AVATAR_BYTES = 900_000;

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0] ?? "", lastName: "" };
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

export function EditProfileScreen() {
  const navigation = useNavigation<Nav>();
  const session = useSessionStore((state) => state.session)!;
  const profile = useSessionStore((state) => state.profile);
  const setProfile = useSessionStore((state) => state.setProfile);

  const initial = splitName(profile?.fullName ?? session.user.fullName);
  const [firstName, setFirstName] = useState(initial.firstName);
  const [lastName, setLastName] = useState(initial.lastName);
  const [phoneNumber, setPhoneNumber] = useState(profile?.phoneNumber ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile?.avatarUrl ?? null);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const email = profile?.email ?? session.user.email;
  const emailVerified = Boolean(profile?.emailVerified ?? session.user.emailVerified);
  const displayName = `${firstName} ${lastName}`.trim();

  async function pickAvatar(): Promise<void> {
    setPicking(true);
    setError(null);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Permission needed", "Allow photo access to update your profile picture.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8
      });

      if (result.canceled || !result.assets[0]) return;

      const asset = result.assets[0];
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 512 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );

      if (!manipulated.base64) {
        throw new Error("Could not process image.");
      }

      const dataUrl = `data:image/jpeg;base64,${manipulated.base64}`;
      if (dataUrl.length > MAX_AVATAR_BYTES) {
        throw new Error("Image is too large. Try a smaller photo.");
      }

      setAvatarUrl(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update photo.");
    } finally {
      setPicking(false);
    }
  }

  async function handleSave(): Promise<void> {
    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();
    if (trimmedFirst.length < 1) {
      setError("Enter your first name.");
      return;
    }
    const fullName = `${trimmedFirst} ${trimmedLast}`.trim();
    if (fullName.length < 2) {
      setError("Enter your first and last name.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const { user } = await api.updateProfile(
        {
          fullName,
          phoneNumber: phoneNumber.trim() ? phoneNumber.trim() : null,
          avatarUrl
        },
        session.token
      );
      setProfile(user);
      Alert.alert("Saved", "Your profile was updated.", [{ text: "OK", onPress: () => navigation.goBack() }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: 16, paddingBottom: 32 }}
      >
        <DutsCard className="items-center gap-3 p-5">
          <Pressable onPress={() => void pickAvatar()} disabled={picking} className="items-center gap-2">
            <View className="h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-hero">
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} className="h-24 w-24" />
              ) : (
                <Text className="text-3xl font-black text-brand">{initials(displayName || "DU")}</Text>
              )}
              {picking ? (
                <View className="absolute inset-0 items-center justify-center bg-black/40">
                  <ActivityIndicator color="#fff" />
                </View>
              ) : null}
            </View>
            <View className="flex-row items-center gap-1">
              <Ionicons name="camera-outline" size={16} color={DUTS.purple} />
              <Text className="font-bold text-brand">{avatarUrl ? "Change photo" : "Add photo"}</Text>
            </View>
          </Pressable>
          {avatarUrl ? (
            <Pressable onPress={() => setAvatarUrl(null)}>
              <Text className="text-sm font-semibold text-muted">Remove photo</Text>
            </Pressable>
          ) : null}
        </DutsCard>

        <DutsCard className="gap-3 p-5">
          <FormInput label="First name" value={firstName} onChangeText={setFirstName} placeholder="First name" />
          <FormInput label="Last name" value={lastName} onChangeText={setLastName} placeholder="Last name" />
          <FormInput
            label="Phone"
            value={phoneNumber}
            onChangeText={setPhoneNumber}
            placeholder="+1 555 010 0000"
            keyboardType="phone-pad"
          />
          <View className="gap-1 rounded-2xl border border-border bg-surface px-4 py-4">
            <Text className="text-sm font-bold uppercase tracking-wider text-label">Email</Text>
            <Text className="text-base font-semibold text-ink">{email}</Text>
            <Text className="text-xs text-muted">
              {emailVerified ? "Verified — email cannot be edited here." : "Not verified yet — check your inbox."}
            </Text>
          </View>
          {error ? <Text className="text-sm font-semibold text-danger">{error}</Text> : null}
          <LoadingButton label="Save changes" loadingLabel="Saving..." onPress={() => void handleSave()} loading={saving} />
        </DutsCard>
      </ScrollView>
    </Screen>
  );
}
