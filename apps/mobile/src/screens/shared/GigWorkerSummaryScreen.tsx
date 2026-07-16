import { ScrollView, Text, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { customerJourneyHeadline, formatMoney, resolveCustomerJourneyStage } from "@gigflow/shared";
import { api } from "../../lib/api";
import { initials } from "../../lib/format";
import { Screen } from "../../components/Screen";
import { DutsCard } from "../../components/DutsCard";
import { AppButton } from "../../components/AppButton";
import { VerifiedBadge } from "../../components/VerifiedBadge";
import { CustomerJourneyProgress } from "../../components/CustomerJourneyProgress";
import { useSessionStore } from "../../stores/session.store";
import type { RootStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "GigWorkerSummary">;

function LineItem({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className="text-sm text-muted">{label}</Text>
      <Text className="text-sm font-semibold text-ink">{value}</Text>
    </View>
  );
}

export function GigWorkerSummaryScreen({ navigation, route }: Props) {
  const session = useSessionStore((state) => state.session)!;
  const { gigId, workerId } = route.params;

  const summaryQuery = useQuery({
    queryKey: ["worker-selection-summary", gigId, workerId],
    queryFn: () => api.getWorkerSelectionSummary(gigId, workerId, session.token)
  });

  const interestsQuery = useQuery({
    queryKey: ["gig-interests", gigId],
    queryFn: () => api.listGigInterests(gigId, session.token)
  });

  const selectMutation = useMutation({
    mutationFn: () => api.selectWorker(gigId, workerId, session.token),
    onSuccess: () => {
      navigation.replace("GigPayment", { gigId, workerId });
    }
  });

  const summary = summaryQuery.data;
  const interest = interestsQuery.data?.interests.find((item) => item.worker.id === workerId);
  const worker = summary?.worker;
  const gig = summary?.gig;

  if (!summary || !worker || !gig) {
    return (
      <Screen>
        <Text className="text-muted">{summaryQuery.isLoading ? "Loading worker profile..." : "Worker not found"}</Text>
      </Screen>
    );
  }

  const stage = resolveCustomerJourneyStage({ status: gig.status, paymentStatus: gig.paymentStatus });
  const etaMinutes = interest?.estimatedArrivalMinutes;

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 32 }}>
        <View className="gap-2">
          <Text className="text-2xl font-black text-ink">Review your worker</Text>
          <Text className="text-sm text-muted">{customerJourneyHeadline(stage)}</Text>
        </View>

        <CustomerJourneyProgress status={gig.status} paymentStatus={gig.paymentStatus} compact />

        <DutsCard className="gap-4 p-5">
          <View className="flex-row items-center gap-4">
            <View className="h-20 w-20 items-center justify-center rounded-full bg-hero">
              <Text className="text-2xl font-black text-brand">{initials(worker.fullName)}</Text>
            </View>
            <View className="flex-1 gap-1">
              <View className="flex-row items-center justify-between gap-2">
                <Text className="text-xl font-black text-ink">{worker.fullName}</Text>
                <VerifiedBadge />
              </View>
              <Text className="text-sm font-semibold text-orange">
                ★ {worker.ratingAverage.toFixed(1)} · {worker.completedGigCount} gigs completed
              </Text>
              {interest?.distanceMiles != null ? (
                <Text className="text-sm text-muted">
                  {interest.distanceMiles} mi away
                  {etaMinutes != null ? ` · ~${etaMinutes} min ETA` : ""}
                </Text>
              ) : null}
            </View>
          </View>

          {interest?.message ? (
            <View className="rounded-2xl bg-surface px-4 py-3">
              <Text className="text-xs font-bold uppercase tracking-wider text-muted">Message from worker</Text>
              <Text className="mt-1 text-sm leading-5 text-ink">{interest.message}</Text>
            </View>
          ) : null}
        </DutsCard>

        <DutsCard className="gap-3 p-5">
          <Text className="text-sm font-bold uppercase tracking-wider text-brand">Booking summary</Text>
          <LineItem label="Service" value={gig.serviceCategoryName} />
          <LineItem label="Estimated duration" value={`${gig.estimatedHours} hr${gig.estimatedHours === 1 ? "" : "s"}`} />
          <View className="mt-1 border-t border-border pt-3">
            <LineItem label="Estimated total" value={formatMoney(summary.pricing.estimatedTotalCents)} />
          </View>
          <Text className="text-xs leading-5 text-muted">
            Your payment is collected when you confirm the booking. The worker is paid after the gig is completed.
          </Text>
        </DutsCard>

        <AppButton
          label={selectMutation.isPending ? "Securing selection..." : "Choose Worker"}
          onPress={() => selectMutation.mutate()}
          disabled={selectMutation.isPending}
        />
        <AppButton
          label="Message Worker"
          variant="secondary"
          onPress={() => navigation.navigate("Chat", { gigId, title: gig.title })}
        />
        <AppButton label="Back to workers" variant="secondary" onPress={() => navigation.goBack()} />
      </ScrollView>
    </Screen>
  );
}
