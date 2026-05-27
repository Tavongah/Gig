import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import type { CreateGigInput } from "@gigflow/shared";
import { api } from "../../lib/api";
import { formatCents } from "../../lib/format";
import { TabScreen } from "../../components/TabScreen";
import { SectionHeader } from "../../components/SectionHeader";
import type { RootStackParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";

const URGENCIES = ["STANDARD", "SOON", "URGENT"] as const;

export function ClientPostScreen() {
  const session = useSessionStore((state) => state.session)!;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [estimatedHours, setEstimatedHours] = useState("2");
  const [urgency, setUrgency] = useState<(typeof URGENCIES)[number]>("SOON");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: api.listCategories });

  const categoryId = selectedCategoryId ?? categoriesQuery.data?.categories[0]?.id ?? null;

  const draftGig = useMemo<CreateGigInput | null>(() => {
    if (!categoryId || !title.trim() || !description.trim()) {
      return null;
    }

    return {
      title: title.trim(),
      description: description.trim(),
      serviceCategoryId: categoryId,
      estimatedHours: Number(estimatedHours) || 1,
      distanceMiles: 4.5,
      urgency,
      startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      demandMultiplier: urgency === "URGENT" ? 1.3 : urgency === "SOON" ? 1.1 : 1,
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
  }, [categoryId, description, estimatedHours, title, urgency]);

  const estimateMutation = useMutation({
    mutationFn: () => api.estimateGig(draftGig!, session.token)
  });

  const createMutation = useMutation({
    mutationFn: () => api.createGig(draftGig!, session.token),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["my-gigs"] });
      Alert.alert("Gig posted", "We're matching you with nearby workers.", [
        { text: "Track gig", onPress: () => navigation.navigate("GigDetail", { gigId: result.gig.id }) }
      ]);
    },
    onError: (error: Error) => Alert.alert("Could not post gig", error.message)
  });

  return (
    <TabScreen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
        <SectionHeader
          eyebrow="Post a gig"
          title="What do you need done?"
          subtitle="Get an instant price estimate and broadcast to verified workers nearby."
        />

        <View className="gap-4 rounded-3xl bg-white p-5">
          <Text className="text-sm font-bold uppercase tracking-wider text-slate-500">Service type</Text>
          <View className="flex-row flex-wrap gap-2">
            {(categoriesQuery.data?.categories ?? []).map((category) => {
              const selected = categoryId === category.id;
              return (
                <Pressable
                  key={category.id}
                  onPress={() => setSelectedCategoryId(category.id)}
                  className={`rounded-full px-4 py-2 ${selected ? "bg-brand" : "bg-slate-100"}`}
                >
                  <Text className={`font-bold ${selected ? "text-ink" : "text-slate-700"}`}>{category.name}</Text>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            className="rounded-2xl bg-slate-100 px-4 py-4 text-ink"
            value={title}
            onChangeText={setTitle}
            placeholder="Gig title"
            placeholderTextColor="#94a3b8"
          />
          <TextInput
            className="min-h-24 rounded-2xl bg-slate-100 px-4 py-4 text-ink"
            value={description}
            onChangeText={setDescription}
            placeholder="Describe the job..."
            placeholderTextColor="#94a3b8"
            multiline
          />
          <TextInput
            className="rounded-2xl bg-slate-100 px-4 py-4 text-ink"
            value={estimatedHours}
            onChangeText={setEstimatedHours}
            placeholder="Estimated hours"
            placeholderTextColor="#94a3b8"
            keyboardType="decimal-pad"
          />

          <Text className="text-sm font-bold uppercase tracking-wider text-slate-500">Urgency</Text>
          <View className="flex-row gap-2">
            {URGENCIES.map((value) => (
              <Pressable
                key={value}
                onPress={() => setUrgency(value)}
                className={`flex-1 rounded-2xl px-3 py-3 ${urgency === value ? "bg-ink" : "bg-slate-100"}`}
              >
                <Text className={`text-center text-xs font-black ${urgency === value ? "text-white" : "text-slate-700"}`}>
                  {value}
                </Text>
              </Pressable>
            ))}
          </View>

          <View className="rounded-2xl bg-slate-950 p-4">
            <Text className="text-slate-400">Estimated price</Text>
            <Text className="text-3xl font-black text-white">
              {estimateMutation.data ? formatCents(estimateMutation.data.estimate.totalCents) : "Tap calculate"}
            </Text>
            {estimateMutation.data ? (
              <Text className="text-slate-300">Worker receives {formatCents(estimateMutation.data.estimate.workerPayoutCents)}</Text>
            ) : null}
          </View>

          <Pressable
            disabled={!draftGig || estimateMutation.isPending}
            onPress={() => estimateMutation.mutate()}
            className="rounded-2xl bg-slate-200 px-5 py-4"
          >
            <Text className="text-center font-black text-ink">{estimateMutation.isPending ? "Calculating..." : "Calculate price"}</Text>
          </Pressable>
          <Pressable
            disabled={!draftGig || createMutation.isPending}
            onPress={() => createMutation.mutate()}
            className="rounded-2xl bg-brand px-5 py-4"
          >
            <Text className="text-center font-black text-ink">
              {createMutation.isPending ? "Posting..." : "Post & find workers"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </TabScreen>
  );
}
