import { useMemo } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { DutsCard } from "../../components/DutsCard";
import { EmptyState } from "../../components/EmptyState";
import { Screen } from "../../components/Screen";
import { api } from "../../lib/api";
import { APP_NAME } from "../../lib/brand";
import { formatCents } from "../../lib/format";
import { COMPLETED_STATUSES } from "../../lib/gig-status";
import { DUTS } from "../../lib/theme";
import { useSessionStore } from "../../stores/session.store";

export function ReceiptsScreen() {
  const session = useSessionStore((state) => state.session)!;
  const activeRole = useSessionStore((state) => state.activeRole);
  const perspective = activeRole === "WORKER" ? "WORKER" : "CLIENT";

  const gigsQuery = useQuery({
    queryKey: ["my-gigs", perspective, "receipts"],
    queryFn: () => api.myGigs(session.token, perspective)
  });

  const receipts = useMemo(
    () =>
      (gigsQuery.data?.gigs ?? []).filter(
        (gig) =>
          COMPLETED_STATUSES.includes(gig.status as never) ||
          String(gig.paymentStatus ?? "").toUpperCase().includes("CAPTURED") ||
          String(gig.paymentStatus ?? "").toUpperCase().includes("AUTHORIZED")
      ),
    [gigsQuery.data?.gigs]
  );

  async function shareReceipt(gig: (typeof receipts)[number]): Promise<void> {
    const body = [
      `${APP_NAME} Receipt`,
      `Gig: ${gig.title}`,
      `Date: ${new Date(gig.createdAt).toLocaleString()}`,
      `Amount: ${formatCents(gig.payment?.amountCents ?? gig.totalCents)}`,
      `Status: ${gig.payment?.status ?? gig.paymentStatus ?? gig.status}`,
      `Reference: ${gig.id}`
    ].join("\n");

    try {
      await Share.share({ message: body, title: `${APP_NAME} Receipt` });
    } catch {
      Alert.alert("Unable to share", "Copy the receipt details from the screen instead.");
    }
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 32 }}>
        {gigsQuery.isLoading ? (
          <ActivityIndicator color={DUTS.purple} />
        ) : receipts.length === 0 ? (
          <EmptyState
            emoji="📄"
            title="No receipts yet"
            description="Downloadable receipts appear after paid or completed gigs."
          />
        ) : (
          receipts.map((gig) => (
            <DutsCard key={gig.id} className="gap-3 p-5">
              <View className="flex-row items-start justify-between gap-3">
                <View className="flex-1 gap-1">
                  <Text className="text-base font-black text-ink">{gig.title}</Text>
                  <Text className="text-sm text-muted">{new Date(gig.createdAt).toLocaleDateString()}</Text>
                  <Text className="text-base font-bold text-brand">
                    {formatCents(gig.payment?.amountCents ?? gig.totalCents)}
                  </Text>
                </View>
                <Ionicons name="document-text-outline" size={22} color={DUTS.purple} />
              </View>
              <Pressable
                onPress={() => void shareReceipt(gig)}
                className="min-h-[48px] flex-row items-center justify-center gap-2 rounded-full border border-brand px-4"
              >
                <Ionicons name="download-outline" size={18} color={DUTS.purple} />
                <Text className="font-bold text-brand">Download / Share receipt</Text>
              </Pressable>
            </DutsCard>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
