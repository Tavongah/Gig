import { MAX_WORKER_TRAVEL_MILES, onboardingSchema } from "@gigflow/shared";
import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { DUTS } from "../lib/theme";
import { Screen } from "../components/Screen";
import { HeroBanner } from "../components/HeroBanner";
import { DutsCard } from "../components/DutsCard";
import { AppButton } from "../components/AppButton";
import { ServiceCategoryPicker } from "../components/ServiceCategoryPicker";
import { useSessionStore } from "../stores/session.store";

const MAX_TRAVEL_MILES = MAX_WORKER_TRAVEL_MILES;

export function ProfileSetupScreen() {
  const session = useSessionStore((state) => state.session);
  const activeRole = useSessionStore((state) => state.activeRole);
  const setProfile = useSessionStore((state) => state.setProfile);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [bio, setBio] = useState("");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [travelDistanceMiles, setTravelDistanceMiles] = useState("10");
  const [hourlyRate, setHourlyRate] = useState("35");
  const [minJobAmount, setMinJobAmount] = useState("50");
  const [formError, setFormError] = useState<string | null>(null);

  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: api.listCategories });

  useEffect(() => {
    if (categoriesQuery.data?.mvp.length && selectedCategoryIds.length === 0) {
      setSelectedCategoryIds([categoriesQuery.data.mvp[0]!.id]);
    }
  }, [categoriesQuery.data, selectedCategoryIds.length]);

  function buildPayload() {
    return {
      role: activeRole,
      fullName: session!.user.fullName,
      phoneNumber: phoneNumber.trim(),
      ...(activeRole === "WORKER"
        ? {
            workerProfile: {
              serviceCategoryIds: selectedCategoryIds,
              bio: bio.trim(),
              hasVehicle: true,
              backgroundCheckConsent: true,
              travelDistanceMiles: Math.min(MAX_TRAVEL_MILES, Math.max(1, Number(travelDistanceMiles) || 10)),
              hourlyRateCents: Math.round((Number(hourlyRate) || 35) * 100),
              minJobAmountCents: Math.round((Number(minJobAmount) || 50) * 100)
            }
          }
        : {})
    };
  }

  const onboardingMutation = useMutation({
    mutationFn: () => {
      const payload = buildPayload();
      const validation = onboardingSchema.safeParse(payload);
      if (!validation.success) {
        const messages = validation.error.issues.map((issue) => issue.message);
        throw new Error(messages.join(". "));
      }
      return api.completeOnboarding(validation.data, session!.token);
    },
    onSuccess: ({ user }) => setProfile(user),
    onError: (error: Error) => setFormError(error.message)
  });

  function toggleCategory(categoryId: string): void {
    setSelectedCategoryIds((current) =>
      current.includes(categoryId) ? current.filter((id) => id !== categoryId) : [...current, categoryId]
    );
  }

  function handleTravelDistanceChange(value: string): void {
    setFormError(null);
    if (value === "") {
      setTravelDistanceMiles("");
      return;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    setTravelDistanceMiles(String(Math.min(MAX_TRAVEL_MILES, Math.max(1, Math.round(parsed)))));
  }

  const workerFormReady =
    activeRole !== "WORKER" ||
    (phoneNumber.trim().length >= 7 &&
      bio.trim().length >= 20 &&
      selectedCategoryIds.length > 0 &&
      Number(travelDistanceMiles) >= 1 &&
      Number(travelDistanceMiles) <= MAX_TRAVEL_MILES);

  return (
    <Screen>
      <View className="gap-6">
        <HeroBanner
          eyebrow="One more step"
          title={activeRole === "WORKER" ? "Set up your worker profile" : "Confirm your contact info"}
          subtitle={
            activeRole === "WORKER"
              ? "Choose MVP services you can do and set your availability preferences."
              : "We use your phone number for gig updates and worker coordination."
          }
        />

        <DutsCard className="gap-4 p-5">
          <Text className="text-lg font-black text-ink">Phone number</Text>
          <TextInput
            className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
            value={phoneNumber}
            onChangeText={(value) => {
              setFormError(null);
              setPhoneNumber(value);
            }}
            placeholder="e.g. 555-123-4567"
            keyboardType="phone-pad"
            placeholderTextColor={DUTS.placeholder}
          />
          <Text className="text-sm text-muted">Required for gig updates (at least 7 characters).</Text>

          {activeRole === "WORKER" ? (
            <>
              <Text className="text-lg font-black text-ink">Bio</Text>
              <TextInput
                className="min-h-24 rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
                value={bio}
                onChangeText={(value) => {
                  setFormError(null);
                  setBio(value);
                }}
                placeholder="Describe your experience, tools, and what jobs you take on."
                multiline
                placeholderTextColor={DUTS.placeholder}
              />
              <Text className={`text-sm ${bio.trim().length >= 20 ? "text-muted" : "text-orange"}`}>
                {bio.trim().length}/20 characters minimum
              </Text>

              <ServiceCategoryPicker
                mvp={categoriesQuery.data?.mvp ?? []}
                comingSoon={categoriesQuery.data?.comingSoon}
                selectedIds={selectedCategoryIds}
                onSelect={toggleCategory}
              />

              <Text className="text-lg font-black text-ink">Distance willing to travel (miles)</Text>
              <TextInput
                className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
                value={travelDistanceMiles}
                onChangeText={handleTravelDistanceChange}
                keyboardType="number-pad"
                placeholderTextColor={DUTS.placeholder}
              />
              <Text className="text-sm text-muted">Maximum {MAX_TRAVEL_MILES} miles.</Text>

              <Text className="text-lg font-black text-ink">Hourly rate ($)</Text>
              <TextInput
                className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
                value={hourlyRate}
                onChangeText={setHourlyRate}
                keyboardType="decimal-pad"
                placeholderTextColor={DUTS.placeholder}
              />

              <Text className="text-lg font-black text-ink">Minimum job amount ($)</Text>
              <TextInput
                className="rounded-2xl border border-border bg-surface px-4 py-4 text-ink"
                value={minJobAmount}
                onChangeText={setMinJobAmount}
                keyboardType="decimal-pad"
                placeholderTextColor={DUTS.placeholder}
              />
            </>
          ) : null}

          {formError ? (
            <View className="rounded-2xl border border-danger/30 bg-red-50 px-4 py-3">
              <Text className="text-sm font-semibold text-danger">{formError}</Text>
            </View>
          ) : null}

          <AppButton
            label={onboardingMutation.isPending ? "Saving..." : "Enter marketplace"}
            onPress={() => {
              setFormError(null);
              onboardingMutation.mutate();
            }}
            disabled={onboardingMutation.isPending || !workerFormReady}
            loading={onboardingMutation.isPending}
          />
        </DutsCard>
      </View>
    </Screen>
  );
}
