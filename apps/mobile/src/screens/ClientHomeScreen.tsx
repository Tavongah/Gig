import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { CreateGigInput } from "@gigflow/shared";
import { api } from "../lib/api";
import { Screen } from "../components/Screen";
import { useSessionStore } from "../stores/session.store";

function cents(value: number): string {
  return `$${(value / 100).toFixed(2)}`;
}

export function ClientHomeScreen() {
  const session = useSessionStore((state) => state.session);
  const [title, setTitle] = useState("Clean my apartment before guests arrive");
  const [description, setDescription] = useState("Two bedrooms, one bathroom, kitchen surfaces, floors, and light organizing.");
  const [estimatedHours, setEstimatedHours] = useState("2.5");
  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: api.listCategories });
  const firstCategory = categoriesQuery.data?.categories[0];

  const draftGig = useMemo<CreateGigInput | null>(() => {
    if (!firstCategory) {
      return null;
    }

    return {
      title,
      description,
      serviceCategoryId: firstCategory.id,
      estimatedHours: Number(estimatedHours),
      distanceMiles: 4.5,
      urgency: "SOON",
      startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      demandMultiplier: 1.1,
      size: "MEDIUM",
      photos: [],
      location: {
        latitude: 33.749,
        longitude: -84.388,
        addressLine1: "100 Peachtree St",
        city: "Atlanta",
        region: "GA",
        postalCode: "30303",
        country: "US"
      }
    };
  }, [description, estimatedHours, firstCategory, title]);

  const estimateMutation = useMutation({
    mutationFn: () => api.estimateGig(draftGig!, session!.token)
  });

  const createMutation = useMutation({
    mutationFn: () => api.createGig(draftGig!, session!.token)
  });

  return (
    <Screen>
      <View className="gap-6">
        <View className="gap-2">
          <Text className="text-sm font-bold uppercase tracking-[3px] text-brand">Client home</Text>
          <Text className="text-3xl font-black text-white">Post a gig</Text>
          <Text className="text-slate-300">Pricing, payment authorization, and worker matching are handled by the API.</Text>
        </View>

        <View className="gap-4 rounded-3xl bg-white p-5">
          <Text className="text-lg font-black text-ink">{firstCategory?.name ?? "Loading categories"}</Text>
          <TextInput className="rounded-2xl bg-slate-100 px-4 py-4" value={title} onChangeText={setTitle} />
          <TextInput className="min-h-24 rounded-2xl bg-slate-100 px-4 py-4" value={description} onChangeText={setDescription} multiline />
          <TextInput className="rounded-2xl bg-slate-100 px-4 py-4" value={estimatedHours} onChangeText={setEstimatedHours} keyboardType="decimal-pad" />

          <View className="rounded-2xl bg-slate-950 p-4">
            <Text className="text-slate-400">Estimated client price</Text>
            <Text className="text-3xl font-black text-white">
              {estimateMutation.data ? cents(estimateMutation.data.estimate.totalCents) : "Run estimate"}
            </Text>
            {estimateMutation.data ? (
              <Text className="text-slate-300">Worker payout {cents(estimateMutation.data.estimate.workerPayoutCents)}</Text>
            ) : null}
          </View>

          <Pressable disabled={!draftGig} onPress={() => estimateMutation.mutate()} className="rounded-2xl bg-slate-200 px-5 py-4">
            <Text className="text-center font-black text-ink">Calculate price</Text>
          </Pressable>
          <Pressable disabled={!draftGig} onPress={() => createMutation.mutate()} className="rounded-2xl bg-brand px-5 py-4">
            <Text className="text-center font-black text-ink">{createMutation.isPending ? "Broadcasting..." : "Post and broadcast gig"}</Text>
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}
