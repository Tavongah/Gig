import { useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { DutsCard } from "../../components/DutsCard";
import { EmptyState } from "../../components/EmptyState";
import { Screen } from "../../components/Screen";
import { api } from "../../lib/api";
import { formatCents } from "../../lib/format";
import { statusLabel } from "../../lib/gig-status";
import type { RootStackParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";
import { DUTS } from "../../lib/theme";

type Nav = NativeStackNavigationProp<RootStackParamList, "PaymentHistory">;

function paymentLabel(status?: string): string {
  if (!status) return "Pending";
  const normalized = status.toUpperCase();
  if (normalized.includes("AUTHORIZED") || normalized.includes("CAPTURED") || normalized.includes("SUCCEEDED")) {
    return "Paid";
  }
  if (normalized.includes("FAILED")) return "Failed";
  if (normalized.includes("PENDING")) return "Pending";
  if (normalized.includes("CANCEL")) return "Cancelled";
  return statusLabel(status);
}

export function PaymentHistoryScreen() {
  const navigation = useNavigation<Nav>();
  const session = useSessionStore((state) => state.session)!;
  const activeRole = useSessionStore((state) => state.activeRole);

  const gigsQuery = useQuery({
    queryKey: ["my-gigs", activeRole === "WORKER" ? "WORKER" : "CLIENT", "payments"],
    queryFn: () => api.myGigs(session.token, activeRole === "WORKER" ? "WORKER" : "CLIENT")
  });

  const earningsQuery = useQuery({
    queryKey: ["worker-earnings"],
    queryFn: () => api.getWorkerEarnings(session.token),
    enabled: activeRole === "WORKER"
  });

  const rows = useMemo(() => {
    if (activeRole === "WORKER") {
      return (earningsQuery.data?.earnings.transactions ?? []).map((tx) => ({
        id: tx.id,
        date: tx.createdAt,
        gig: tx.gigTitle ?? "Payout",
        amountCents: tx.amountCents,
        status: tx.status,
        gigId: tx.gigId
      }));
    }

    return (gigsQuery.data?.gigs ?? [])
      .filter((gig) => gig.payment || gig.paymentStatus || gig.totalCents > 0)
      .map((gig) => ({
        id: gig.id,
        date: gig.createdAt,
        gig: gig.title,
        amountCents: gig.payment?.amountCents ?? gig.totalCents,
        status: gig.payment?.status ?? gig.paymentStatus ?? gig.status,
        gigId: gig.id
      }));
  }, [activeRole, earningsQuery.data?.earnings.transactions, gigsQuery.data?.gigs]);

  const loading = gigsQuery.isLoading || (activeRole === "WORKER" && earningsQuery.isLoading);

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 32 }}>
        {loading ? (
          <ActivityIndicator color={DUTS.purple} />
        ) : rows.length === 0 ? (
          <EmptyState emoji="🧾" title="No payments yet" description="Payment history for your gigs will show up here." />
        ) : (
          rows.map((row) => (
            <Pressable
              key={row.id}
              onPress={() => {
                if (row.gigId) navigation.navigate("GigDetail", { gigId: row.gigId });
              }}
            >
              <DutsCard className="gap-1 p-5">
                <View className="flex-row items-start justify-between gap-3">
                  <View className="flex-1 gap-1">
                    <Text className="text-base font-black text-ink">{row.gig}</Text>
                    <Text className="text-sm text-muted">{new Date(row.date).toLocaleDateString()}</Text>
                    <Text className="text-xs font-bold uppercase tracking-wider text-brand">
                      {paymentLabel(row.status)}
                    </Text>
                  </View>
                  <Text className="text-base font-black text-ink">{formatCents(row.amountCents)}</Text>
                </View>
              </DutsCard>
            </Pressable>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
