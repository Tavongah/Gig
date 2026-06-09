import { Pressable, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { api } from "../../lib/api";
import { formatCents } from "../../lib/format";
import { TabScreen } from "../../components/TabScreen";
import { HeroBanner } from "../../components/HeroBanner";
import { DutsCard } from "../../components/DutsCard";
import { GigCard } from "../../components/GigCard";
import { EmptyState } from "../../components/EmptyState";
import type { WorkerTabParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";

export function WorkerHomeScreen() {
  const session = useSessionStore((state) => state.session)!;
  const profile = useSessionStore((state) => state.profile);
  const navigation = useNavigation<BottomTabNavigationProp<WorkerTabParamList>>();

  const isOnline = profile?.workerProfile?.availabilityStatus === "AVAILABLE";

  const earningsQuery = useQuery({
    queryKey: ["worker-earnings"],
    queryFn: () => api.getWorkerEarnings(session.token)
  });

  const nearbyQuery = useQuery({
    queryKey: ["nearby-gigs"],
    queryFn: () => api.nearbyGigs(session.token),
    refetchInterval: 15_000
  });

  const previewGigs = (nearbyQuery.data?.gigs ?? []).slice(0, 3);
  const earnings = earningsQuery.data?.earnings;

  const checklist = [
    { label: "Bio added", done: Boolean(profile?.workerProfile?.bio?.length) },
    { label: "Services selected", done: (profile?.workerProfile?.serviceCategories.length ?? 0) > 0 },
    { label: "Rates configured", done: Boolean(profile?.workerProfile?.hourlyRateCents) },
    { label: "Profile photo", done: false }
  ];

  return (
    <TabScreen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 36, gap: 20 }}>
        <HeroBanner
          eyebrow="Worker dashboard"
          title={`Hey ${profile?.fullName?.split(" ")[0] ?? "there"} 👋`}
          subtitle="Go available, pick up nearby gigs, and track your earnings in real time."
        />

        <Pressable onPress={() => navigation.navigate("AvailableNow")}>
          <DutsCard className="flex-row items-center justify-between p-5">
            <View>
              <Text className="text-lg font-black text-ink">Available Now</Text>
              <Text className="text-sm text-muted">{isOnline ? "You're online and receiving gigs" : "Go online to earn"}</Text>
            </View>
            <View className={`rounded-full px-5 py-2 ${isOnline ? "bg-success" : "bg-disabled"}`}>
              <Text className={`font-black ${isOnline ? "text-white" : "text-disabled-text"}`}>{isOnline ? "ON" : "OFF"}</Text>
            </View>
          </DutsCard>
        </Pressable>

        <DutsCard className="gap-4 p-5">
          <Text className="text-sm font-bold uppercase tracking-wider text-brand">Earnings summary</Text>
          <View className="flex-row gap-3">
            <View className="flex-1 rounded-2xl border border-border bg-surface p-3">
              <Text className="text-xs text-muted">Total</Text>
              <Text className="text-lg font-black text-ink">{formatCents(earnings?.totalEarningsCents ?? 0)}</Text>
            </View>
            <View className="flex-1 rounded-2xl border border-border bg-surface p-3">
              <Text className="text-xs text-muted">Pending</Text>
              <Text className="text-lg font-black text-orange">{formatCents(earnings?.pendingEarningsCents ?? 0)}</Text>
            </View>
            <View className="flex-1 rounded-2xl border border-border bg-surface p-3">
              <Text className="text-xs text-muted">Completed</Text>
              <Text className="text-lg font-black text-success">{earnings?.completedGigCount ?? 0}</Text>
            </View>
          </View>
          <Pressable onPress={() => navigation.navigate("Earnings")}>
            <Text className="font-bold text-brand">View earnings →</Text>
          </Pressable>
        </DutsCard>

        <View className="gap-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-bold uppercase tracking-wider text-muted">Nearby gigs</Text>
            <Pressable onPress={() => navigation.navigate("NearbyGigs")}>
              <Text className="text-sm font-bold text-brand">See all</Text>
            </Pressable>
          </View>
          {previewGigs.length === 0 ? (
            <EmptyState
              emoji="📡"
              title="No gigs nearby"
              description="Turn on Available Now to start receiving matching gigs."
              actionLabel="Go Available"
              onAction={() => navigation.navigate("AvailableNow")}
            />
          ) : (
            previewGigs.map((gig) => (
              <GigCard key={gig.id} gig={gig} onPress={() => navigation.navigate("NearbyGigs")} />
            ))
          )}
        </View>

        <DutsCard className="gap-3 p-5">
          <Text className="text-sm font-bold uppercase tracking-wider text-teal">Profile checklist</Text>
          {checklist.map((item) => (
            <View key={item.label} className="flex-row items-center gap-3">
              <View className={`h-6 w-6 items-center justify-center rounded-full ${item.done ? "bg-success" : "bg-disabled"}`}>
                <Text className={`text-xs font-black ${item.done ? "text-white" : "text-disabled-text"}`}>
                  {item.done ? "✓" : ""}
                </Text>
              </View>
              <Text className={`text-sm ${item.done ? "font-semibold text-ink" : "text-muted"}`}>{item.label}</Text>
            </View>
          ))}
        </DutsCard>
      </ScrollView>
    </TabScreen>
  );
}
