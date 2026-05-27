import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Screen } from "../components/Screen";
import { useSessionStore } from "../stores/session.store";

export function ProfileSetupScreen() {
  const session = useSessionStore((state) => state.session);
  const activeRole = useSessionStore((state) => state.activeRole);
  const setProfile = useSessionStore((state) => state.setProfile);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [bio, setBio] = useState("");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);

  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: api.listCategories });

  useEffect(() => {
    if (categoriesQuery.data?.categories.length && selectedCategoryIds.length === 0) {
      setSelectedCategoryIds([categoriesQuery.data.categories[0]!.id]);
    }
  }, [categoriesQuery.data, selectedCategoryIds.length]);

  const onboardingMutation = useMutation({
    mutationFn: () =>
      api.completeOnboarding(
        {
          role: activeRole,
          fullName: session!.user.fullName,
          phoneNumber,
          ...(activeRole === "WORKER"
            ? {
                workerProfile: {
                  serviceCategoryIds: selectedCategoryIds,
                  bio,
                  hasVehicle: true,
                  backgroundCheckConsent: true
                }
              }
            : {})
        },
        session!.token
      ),
    onSuccess: ({ user }) => setProfile(user)
  });

  function toggleCategory(categoryId: string): void {
    setSelectedCategoryIds((current) =>
      current.includes(categoryId) ? current.filter((id) => id !== categoryId) : [...current, categoryId]
    );
  }

  return (
    <Screen>
      <View className="gap-6">
        <View className="gap-2">
          <Text className="text-sm font-bold uppercase tracking-[3px] text-brand">One more step</Text>
          <Text className="text-3xl font-black text-white">
            {activeRole === "WORKER" ? "Set up your worker profile" : "Confirm your contact info"}
          </Text>
          <Text className="text-slate-300">
            {activeRole === "WORKER"
              ? "Choose the services you offer so we can match you with nearby gigs."
              : "We use your phone number for gig updates and worker coordination."}
          </Text>
        </View>

        <View className="gap-4 rounded-3xl bg-white p-5">
          <Text className="text-lg font-black text-ink">Phone number</Text>
          <TextInput className="rounded-2xl bg-slate-100 px-4 py-4 text-ink" value={phoneNumber} onChangeText={setPhoneNumber} />

          {activeRole === "WORKER" ? (
            <>
              <Text className="text-lg font-black text-ink">Bio</Text>
              <TextInput className="min-h-24 rounded-2xl bg-slate-100 px-4 py-4 text-ink" value={bio} onChangeText={setBio} multiline />

              <Text className="text-lg font-black text-ink">Services you offer</Text>
              <View className="flex-row flex-wrap gap-2">
                {(categoriesQuery.data?.categories ?? []).map((category) => {
                  const selected = selectedCategoryIds.includes(category.id);
                  return (
                    <Pressable
                      key={category.id}
                      onPress={() => toggleCategory(category.id)}
                      className={`rounded-full px-4 py-2 ${selected ? "bg-brand" : "bg-slate-200"}`}
                    >
                      <Text className={`font-bold ${selected ? "text-ink" : "text-slate-700"}`}>{category.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}

          <Pressable
            disabled={onboardingMutation.isPending || (activeRole === "WORKER" && selectedCategoryIds.length === 0)}
            onPress={() => onboardingMutation.mutate()}
            className="rounded-2xl bg-ink px-5 py-4"
          >
            <Text className="text-center font-black text-white">
              {onboardingMutation.isPending ? "Saving..." : "Enter marketplace"}
            </Text>
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}
