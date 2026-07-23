import { Alert, Text, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { formatMoney, formatHourlyRateLabel, isTimeBasedPricing, DEFAULT_HOURLY_RATE_CENTS } from "@gigflow/shared";
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
  const timed = isTimeBasedPricing(gig?.pricingType ?? "FIXED");
  const assignment = gig?.assignments?.[0];

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
            {timed
              ? "Review the work summary. Approving confirms the final timed charge from your authorization."
              : "Review the summary below. Your booking payment was already collected when you confirmed the worker."}
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
          {timed && assignment?.startedAt ? (
            <LineItem label="Work started" amount={new Date(assignment.startedAt).toLocaleString()} />
          ) : null}
          {timed && (assignment?.endedAt || assignment?.completedAt) ? (
            <LineItem
              label="Work completed"
              amount={new Date(assignment.endedAt ?? assignment.completedAt!).toLocaleString()}
            />
          ) : null}
          {gig.estimatedHours ? (
            <LineItem label="Estimated duration" amount={`${gig.estimatedHours} hrs`} />
          ) : null}
          {timed && assignment?.billableMinutes != null ? (
            <LineItem
              label="Total hours worked"
              amount={`${(assignment.billableMinutes / 60).toFixed(2)} hrs (${assignment.billableMinutes} min billed)`}
            />
          ) : null}
          {timed ? (
            <LineItem label="Hourly rate" amount={formatHourlyRateLabel(DEFAULT_HOURLY_RATE_CENTS)} />
          ) : null}
          <View className="border-t border-border pt-3">
            <Text className="text-xs font-bold uppercase tracking-wider text-muted">
              {timed ? "Total amount charged" : "Total"}
            </Text>
            <Text className="text-3xl font-black text-ink">{formatMoney(gig.finalTotalCents ?? gig.totalCents)}</Text>
          </View>
        </DutsCard>

        {gig.status === "WAITING_EXTRA_TIME_APPROVAL" ? (
          <DutsCard className="gap-3 p-5">
            <Text className="text-base font-bold text-ink">Booked time reached</Text>
            <Text className="text-sm text-muted">
              The approved booking time is almost complete. Approve an additional 30 minutes, or finish the job.
            </Text>
            <AppButton label="Approve 30 minutes" variant="secondary" onPress={() => extraTimeMutation.mutate(30)} />
            <AppButton label="Approve 1 hour" variant="secondary" onPress={() => extraTimeMutation.mutate(60)} />
            <AppButton label="Finish job" variant="cancel" onPress={() => approveMutation.mutate()} />
          </DutsCard>
        ) : (
          <>
            <AppButton
              label={approveMutation.isPending ? "Confirming..." : "Approve completion"}
              onPress={() => approveMutation.mutate()}
              disabled={approveMutation.isPending}
            />
            <AppButton
              label="Report issue"
              variant="secondary"
              onPress={() =>
                Alert.alert(
                  "Report an issue",
                  timed
                    ? "Contact support to dispute this gig. The final charge will not complete until the issue is resolved."
                    : "Contact support to dispute this gig.",
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
