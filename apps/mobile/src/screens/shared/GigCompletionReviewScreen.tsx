import { Alert, Text, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { formatMoney } from "@gigflow/shared";
import { api } from "../../lib/api";
import { showAlert } from "../../lib/confirm";
import { Screen } from "../../components/Screen";
import { DutsCard } from "../../components/DutsCard";
import { AppButton } from "../../components/AppButton";
import { CustomerJourneyProgress } from "../../components/CustomerJourneyProgress";
import { useSessionStore } from "../../stores/session.store";
import type { RootStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "GigCompletionReview">;

function LineItem({ label, amount }: { label: string; amount: string }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="text-sm text-muted">{label}</Text>
      <Text className="text-sm font-semibold text-ink">{amount}</Text>
    </View>
  );
}

export function GigCompletionReviewScreen({ navigation, route }: Props) {
  const session = useSessionStore((state) => state.session)!;
  const { gigId } = route.params;

  const gigQuery = useQuery({
    queryKey: ["gig", gigId],
    queryFn: () => api.getGig(gigId, session.token)
  });

  const approveMutation = useMutation({
    mutationFn: () => api.approveGigCompletion(gigId, session.token),
    onSuccess: () => {
      const worker = gigQuery.data?.gig.assignments?.[0]?.worker;
      if (worker) {
        navigation.replace("Review", { gigId, workerName: worker.fullName });
        return;
      }
      navigation.replace("GigDetail", { gigId });
    },
    onError: (error: Error) => showAlert("Could not approve", error.message)
  });

  const extraTimeMutation = useMutation({
    mutationFn: (minutes: number) => api.approveExtraTime(gigId, minutes, session.token),
    onSuccess: () => {
      showAlert("Extra time approved", "Your worker can continue billing.");
      navigation.replace("GigTracking", { gigId });
    }
  });

  const gig = gigQuery.data?.gig;
  const worker = gig?.assignments?.[0]?.worker;

  if (!gig) {
    return (
      <Screen>
        <Text className="text-muted">Loading completion summary...</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <View className="gap-4">
        <View className="gap-2">
          <Text className="text-2xl font-black text-ink">Work completed</Text>
          <Text className="text-sm text-muted">
            Review the summary below. Payment is captured only when you approve completion.
          </Text>
        </View>

        <CustomerJourneyProgress status={gig.status} paymentStatus={gig.paymentStatus} compact />

        {worker ? (
          <DutsCard className="gap-1 p-5">
            <Text className="text-xs font-bold uppercase tracking-wider text-muted">Worker</Text>
            <Text className="text-lg font-black text-ink">{worker.fullName}</Text>
          </DutsCard>
        ) : null}

        <DutsCard className="gap-3 p-5">
          <Text className="text-lg font-black text-ink">{gig.title}</Text>
          {gig.estimatedHours ? (
            <LineItem label="Estimated duration" amount={`${gig.estimatedHours} hrs`} />
          ) : null}
          <View className="border-t border-border pt-3">
            <Text className="text-xs font-bold uppercase tracking-wider text-muted">Total</Text>
            <Text className="text-3xl font-black text-ink">{formatMoney(gig.totalCents)}</Text>
          </View>
        </DutsCard>

        {gig.status === "WAITING_EXTRA_TIME_APPROVAL" ? (
          <DutsCard className="gap-3 p-5">
            <Text className="text-base font-bold text-ink">Booked time reached</Text>
            <Text className="text-sm text-muted">Billing is paused. Approve extra time or finish the job.</Text>
            <AppButton label="Approve 30 minutes" variant="secondary" onPress={() => extraTimeMutation.mutate(30)} />
            <AppButton label="Approve 1 hour" variant="secondary" onPress={() => extraTimeMutation.mutate(60)} />
            <AppButton label="Finish job" variant="cancel" onPress={() => approveMutation.mutate()} />
          </DutsCard>
        ) : (
          <>
            <AppButton
              label={approveMutation.isPending ? "Capturing payment..." : "Approve completion"}
              onPress={() => approveMutation.mutate()}
              disabled={approveMutation.isPending}
            />
            <AppButton
              label="Report issue"
              variant="secondary"
              onPress={() =>
                Alert.alert(
                  "Report an issue",
                  "Contact support to dispute this gig. Your payment will not be captured until the issue is resolved.",
                  [{ text: "OK" }]
                )
              }
            />
          </>
        )}
      </View>
    </Screen>
  );
}
