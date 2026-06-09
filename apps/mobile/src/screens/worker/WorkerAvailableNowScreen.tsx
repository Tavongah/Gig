import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { DUTS } from "../../lib/theme";
import { TabScreen } from "../../components/TabScreen";
import { HeroBanner } from "../../components/HeroBanner";
import { DutsCard } from "../../components/DutsCard";
import { AppButton } from "../../components/AppButton";
import { ServiceCategoryPicker } from "../../components/ServiceCategoryPicker";
import { useSocket } from "../../hooks/useSocket";
import { useSessionStore } from "../../stores/session.store";

const DEFAULT_LAT = 33.749;
const DEFAULT_LNG = -84.388;

export function WorkerAvailableNowScreen() {
  const session = useSessionStore((state) => state.session)!;
  const profile = useSessionStore((state) => state.profile);
  const socket = useSocket();
  const [isAvailable, setIsAvailable] = useState(profile?.workerProfile?.availabilityStatus === "AVAILABLE");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>(
    profile?.workerProfile?.serviceCategories.map((category) => category.id) ?? []
  );
  const [travelDistanceMiles, setTravelDistanceMiles] = useState(
    String(profile?.workerProfile?.travelDistanceMiles ?? 10)
  );
  const [hourlyRate, setHourlyRate] = useState(
    profile?.workerProfile?.hourlyRateCents ? String(profile.workerProfile.hourlyRateCents / 100) : "35"
  );
  const [minJobAmount, setMinJobAmount] = useState(
    profile?.workerProfile?.minJobAmountCents ? String(profile.workerProfile.minJobAmountCents / 100) : "50"
  );

  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: api.listCategories });

  const availabilityMutation = useMutation({
    mutationFn: () =>
      api.updateWorkerAvailability(
        {
          serviceCategoryIds: selectedCategoryIds,
          latitude: DEFAULT_LAT,
          longitude: DEFAULT_LNG,
          travelDistanceMiles: Number(travelDistanceMiles) || 10,
          hourlyRateCents: Math.round((Number(hourlyRate) || 35) * 100),
          minJobAmountCents: Math.round((Number(minJobAmount) || 50) * 100)
        },
        session.token
      )
  });

  function toggleCategory(categoryId: string): void {
    setSelectedCategoryIds((current) =>
      current.includes(categoryId) ? current.filter((id) => id !== categoryId) : [...current, categoryId]
    );
  }

  async function toggleAvailability(): Promise<void> {
    if (isAvailable) {
      await api.setWorkerOffline(session.token);
      socket?.emit("worker:offline");
      setIsAvailable(false);
      return;
    }

    if (selectedCategoryIds.length === 0) {
      Alert.alert("Select services", "Choose at least one MVP service before going available.");
      return;
    }

    await availabilityMutation.mutateAsync();
    socket?.emit("worker:available", {
      serviceCategoryIds: selectedCategoryIds,
      latitude: DEFAULT_LAT,
      longitude: DEFAULT_LNG
    });
    setIsAvailable(true);
  }

  return (
    <TabScreen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32, gap: 16 }}>
        <HeroBanner
          eyebrow="Available now"
          title="Go online for nearby gigs"
          subtitle={isAvailable ? "You're visible to customers nearby." : "Turn on Available Now to receive offers."}
        />

        <DutsCard className="gap-4 p-5">
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-lg font-black text-ink">Available Now</Text>
              <Text className="text-sm text-muted">{isAvailable ? "Online" : "Offline"}</Text>
            </View>
            {isAvailable ? (
              <Pressable onPress={() => void toggleAvailability()} className="rounded-full border border-danger bg-card px-5 py-3">
                <Text className="font-black text-danger">Go offline</Text>
              </Pressable>
            ) : (
              <AppButton label="Go online" onPress={() => void toggleAvailability()} variant="primary" size="md" />
            )}
          </View>

          <View className="rounded-2xl border border-border bg-surface px-4 py-3">
            <Text className="text-sm text-muted">
              Your profile is visible to customers nearby while Available Now is turned on.
            </Text>
          </View>

          <ServiceCategoryPicker
            mvp={categoriesQuery.data?.mvp ?? []}
            selectedIds={selectedCategoryIds}
            onSelect={toggleCategory}
            disabled={isAvailable}
          />

          <Text className="text-sm font-bold uppercase tracking-wider text-label">Distance willing to travel (mi)</Text>
          <TextInput
            className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
            value={travelDistanceMiles}
            onChangeText={setTravelDistanceMiles}
            keyboardType="decimal-pad"
            editable={!isAvailable}
            placeholderTextColor={DUTS.placeholder}
          />

          <Text className="text-sm font-bold uppercase tracking-wider text-label">Hourly rate ($)</Text>
          <TextInput
            className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
            value={hourlyRate}
            onChangeText={setHourlyRate}
            keyboardType="decimal-pad"
            editable={!isAvailable}
            placeholderTextColor={DUTS.placeholder}
          />

          <Text className="text-sm font-bold uppercase tracking-wider text-label">Minimum job amount ($)</Text>
          <TextInput
            className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
            value={minJobAmount}
            onChangeText={setMinJobAmount}
            keyboardType="decimal-pad"
            editable={!isAvailable}
            placeholderTextColor={DUTS.placeholder}
          />
        </DutsCard>
      </ScrollView>
    </TabScreen>
  );
}
