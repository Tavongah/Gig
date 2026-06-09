import { ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { formatCents } from "../../lib/format";
import { TabScreen } from "../../components/TabScreen";
import { HeroBanner } from "../../components/HeroBanner";
import { DutsCard } from "../../components/DutsCard";
import { EmptyState } from "../../components/EmptyState";
import { useSessionStore } from "../../stores/session.store";

export function WorkerEarningsScreen() {
  const session = useSessionStore((state) => state.session)!;

  const earningsQuery = useQuery({
    queryKey: ["worker-earnings"],
    queryFn: () => api.getWorkerEarnings(session.token)
  });

  const earnings = earningsQuery.data?.earnings;

  return (
    <TabScreen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32, gap: 16 }}>
        <HeroBanner
          eyebrow="Earnings"
          title="Your earnings"
          subtitle="Track completed payouts and pending work."
        />

        <DutsCard className="gap-4 p-5">
          <View className="gap-1">
            <Text className="text-sm text-muted">Total earnings</Text>
            <Text className="text-3xl font-black text-ink">{formatCents(earnings?.totalEarningsCents ?? 0)}</Text>
          </View>
          <View className="flex-row gap-3">
            <View className="flex-1 rounded-2xl bg-surface p-3">
              <Text className="text-xs text-muted">Pending</Text>
              <Text className="text-lg font-black text-ink">{formatCents(earnings?.pendingEarningsCents ?? 0)}</Text>
            </View>
            <View className="flex-1 rounded-2xl bg-surface p-3">
              <Text className="text-xs text-muted">Platform fees</Text>
              <Text className="text-lg font-black text-ink">{formatCents(earnings?.platformFeesCents ?? 0)}</Text>
            </View>
          </View>
          <View className="rounded-2xl bg-surface px-4 py-3">
            <Text className="text-sm font-semibold text-muted">Payout status</Text>
            <Text className="text-base text-ink">{earnings?.payoutStatus ?? "Payouts coming soon"}</Text>
          </View>
        </DutsCard>

        <Text className="text-sm font-bold uppercase tracking-wider text-muted">Recent payouts</Text>
        {(earnings?.recentPayouts ?? []).length === 0 ? (
          <EmptyState
            emoji="💰"
            title="No payouts yet"
            description="Complete gigs to start building your earnings history."
          />
        ) : (
          <View className="gap-3">
            {(earnings?.recentPayouts ?? []).map((payout) => (
              <View key={payout.gigId} className="rounded-3xl bg-card p-4">
                <Text className="font-black text-ink">{payout.title}</Text>
                <Text className="text-brand">{formatCents(payout.workerPayoutCents)}</Text>
                <Text className="text-xs text-muted">{new Date(payout.completedAt).toLocaleDateString()}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </TabScreen>
  );
}
