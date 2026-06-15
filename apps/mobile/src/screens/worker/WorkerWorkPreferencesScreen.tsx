import { useEffect, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { api } from "../../lib/api";
import { getCurrentCoordinates } from "../../lib/location";
import { Screen } from "../../components/Screen";
import { DutsCard } from "../../components/DutsCard";
import { AppButton } from "../../components/AppButton";
import {
  WorkerPreferencesForm,
  workerPreferencesFromProfile
} from "../../components/WorkerPreferencesForm";
import type { RootStackParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";

export function WorkerWorkPreferencesScreen() {
  const session = useSessionStore((state) => state.session)!;
  const profile = useSessionStore((state) => state.profile);
  const setProfile = useSessionStore((state) => state.setProfile);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [preferences, setPreferences] = useState(() => workerPreferencesFromProfile(profile));

  useEffect(() => {
    setPreferences(workerPreferencesFromProfile(profile));
  }, [profile]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (preferences.serviceCategoryIds.length === 0) {
        throw new Error("Select at least one service type.");
      }

      const storedLat = Number(profile?.workerProfile?.currentLatitude);
      const storedLng = Number(profile?.workerProfile?.currentLongitude);
      const coords =
        Number.isFinite(storedLat) && Number.isFinite(storedLng)
          ? { latitude: storedLat, longitude: storedLng }
          : await getCurrentCoordinates();

      await api.updateWorkerAvailability(
        {
          serviceCategoryIds: preferences.serviceCategoryIds,
          latitude: coords.latitude,
          longitude: coords.longitude,
          travelDistanceMiles: Number(preferences.travelDistanceMiles) || 10,
          hourlyRateCents: Math.round((Number(preferences.hourlyRate) || 35) * 100),
          minJobAmountCents: Math.round((Number(preferences.minJobAmount) || 50) * 100)
        },
        session.token
      );

      const { user } = await api.getMe(session.token);
      setProfile(user);
    },
    onSuccess: () => {
      Alert.alert("Saved", "Your work preferences were updated.");
      navigation.goBack();
    },
    onError: (error: Error) => Alert.alert("Could not save", error.message)
  });

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32, gap: 12 }}>
        <View className="gap-1 px-1">
          <Text className="text-xs font-bold uppercase tracking-[2px] text-brand">Work preferences</Text>
          <Text className="text-2xl font-black text-ink">Gig filters</Text>
          <Text className="text-sm text-muted">Update the gigs you receive while you're online.</Text>
        </View>

        <DutsCard className="gap-4 p-4">
          <WorkerPreferencesForm values={preferences} onChange={setPreferences} />
          <AppButton
            label={saveMutation.isPending ? "Saving..." : "Save preferences"}
            onPress={() => saveMutation.mutate()}
            disabled={preferences.serviceCategoryIds.length === 0 || saveMutation.isPending}
            loading={saveMutation.isPending}
          />
        </DutsCard>
      </ScrollView>
    </Screen>
  );
}
