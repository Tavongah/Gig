import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { workerPreferencesSchema, zodErrorsToFieldMap } from "@gigflow/shared";
import { api } from "../../lib/api";
import { showAlert } from "../../lib/confirm";
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
      const parsed = workerPreferencesSchema.safeParse({
        serviceCategoryIds: preferences.serviceCategoryIds,
        travelDistanceMiles: Math.round(Number(preferences.travelDistanceMiles)),
        hourlyRateCents: Math.round(Number(preferences.hourlyRate) * 100),
        minJobAmountCents: Math.round(Number(preferences.minJobAmount) * 100)
      });

      if (!parsed.success) {
        const errors = zodErrorsToFieldMap(parsed.error);
        throw new Error(Object.values(errors)[0] ?? "Check your preferences and try again.");
      }

      await api.updateWorkerPreferences(parsed.data, session.token);

      const { user } = await api.getMe(session.token);
      setProfile(user);
    },
    onSuccess: () => {
      showAlert("Saved", "Your work preferences were updated.");
      navigation.goBack();
    },
    onError: (error: Error) => showAlert("Could not save", error.message)
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
