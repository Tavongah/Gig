import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  View
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../lib/api";
import { showAlert } from "../../lib/confirm";
import { initials } from "../../lib/format";
import { pickProfilePhoto } from "../../lib/pick-profile-photo";
import { Screen } from "../../components/Screen";
import { DutsCard } from "../../components/DutsCard";
import { FormInput } from "../../components/FormInput";
import { LoadingButton } from "../../components/LoadingButton";
import { useSessionStore } from "../../stores/session.store";
import type { RootStackParamList } from "../../navigation/types";
import { DUTS } from "../../lib/theme";

type Nav = NativeStackNavigationProp<RootStackParamList, "EditProfile">;

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
  const setSession = useSessionStore((state) => state.setSession);

  const initial = splitName(profile?.fullName ?? session.user.fullName);
  const [firstName, setFirstName] = useState(initial.firstName);
  const [lastName, setLastName] = useState(initial.lastName);
  const [phoneNumber, setPhoneNumber] = useState(profile?.phoneNumber ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile?.avatarUrl ?? null);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const email = profile?.email ?? session.user.email;
  const emailVerified = Boolean(profile?.emailVerified ?? session.user.emailVerified);
  const displayName = `${firstName} ${lastName}`.trim();
  const photoRequired = !avatarUrl;

  async function pickAndUploadAvatar(): Promise<void> {
    setUploadingPhoto(true);
    setError(null);
    setUploadProgress("Opening camera / gallery…");
    const previousUrl = profile?.avatarUrl ?? session.user.avatarUrl ?? null;
    try {
      const photo = await pickProfilePhoto();
      if (!photo) {
        setUploadProgress(null);
        return;
      }

      setAvatarUrl(photo.dataUrl);
      setUploadProgress("Uploading photo…");
      const avatarResult = await api.uploadProfilePhoto(
        { dataUrl: photo.dataUrl, base64: photo.base64 },
        session.token
      );
      const nextUrl = avatarResult.user.avatarUrl ?? null;
      if (!nextUrl) {
        throw new Error("Upload succeeded but no photo URL was returned. Try again.");
      }
      setAvatarUrl(nextUrl);
      setProfile({ ...(profile ?? session.user), ...avatarResult.user });
      setSession({ ...session, user: { ...session.user, ...avatarResult.user } });
      setUploadProgress(null);
      showAlert("Photo saved", "Your profile picture was uploaded. You can go online now.");
    } catch (err) {
      setUploadProgress(null);
      setAvatarUrl(previousUrl);
      const message = err instanceof Error ? err.message : "Could not upload photo.";
      setError(message);
      showAlert("Upload failed", message);
    } finally {
      setUploadingPhoto(false);
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
    if (!avatarUrl) {
      setError("Profile photo is required. Upload a photo before saving.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const { user } = await api.updateProfile(
        {
          fullName,
          phoneNumber: phoneNumber.trim() ? phoneNumber.trim() : null
        },
        session.token
      );
      const merged = { ...(profile ?? session.user), ...user, avatarUrl };
      setProfile(merged);
      setSession({ ...session, user: { ...session.user, ...merged } });
      showAlert("Saved", "Your profile was updated.");
      navigation.goBack();
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
          <Text className="text-center text-sm font-semibold text-ink">
            Profile photo is required{photoRequired ? " — add one to continue" : ""}
          </Text>
          <Pressable
            onPress={() => void pickAndUploadAvatar()}
            disabled={uploadingPhoto || saving}
            className="items-center gap-2"
          >
            <View className="h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-hero">
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} className="h-24 w-24" />
              ) : (
                <Text className="text-3xl font-black text-brand">{initials(displayName || "DU")}</Text>
              )}
              {uploadingPhoto ? (
                <View className="absolute inset-0 items-center justify-center bg-black/40">
                  <ActivityIndicator color="#fff" />
                </View>
              ) : null}
            </View>
            <View className="flex-row items-center gap-1">
              <Ionicons name="camera-outline" size={16} color={DUTS.purple} />
              <Text className="font-bold text-brand">
                {uploadingPhoto ? "Uploading…" : avatarUrl ? "Replace photo" : "Add photo"}
              </Text>
            </View>
          </Pressable>
          {uploadProgress ? <Text className="text-xs text-muted">{uploadProgress}</Text> : null}
          <Text className="text-center text-xs text-muted">
            Use camera or gallery. Photos are compressed automatically before upload.
          </Text>
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
          <LoadingButton
            label="Save changes"
            loadingLabel="Saving..."
            onPress={() => void handleSave()}
            loading={saving}
            disabled={uploadingPhoto || !avatarUrl}
          />
        </DutsCard>
      </ScrollView>
    </Screen>
  );
}
