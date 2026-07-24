import { useEffect, useRef } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { formatMoney } from "@gigflow/shared";
import { api } from "../../lib/api";
import { showAlert } from "../../lib/confirm";
import { Screen } from "../../components/Screen";
import { DutsCard } from "../../components/DutsCard";
import { AppButton } from "../../components/AppButton";
import { SearchingIndicator } from "../../components/SearchingIndicator";
import { useSessionStore } from "../../stores/session.store";
import { useSocket } from "../../hooks/useSocket";
import type { RootStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "WorkerMatching">;

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-start justify-between gap-3">
      <Text className="text-sm text-muted">{label}</Text>
      <Text className="max-w-[60%] text-right text-sm font-semibold text-ink">{value}</Text>
    </View>
  );
}

export function WorkerMatchingScreen({ navigation, route }: Props) {
  const session = useSessionStore((state) => state.session)!;
  const { gigId } = route.params;
  const leaving = useRef(false);

  const interestQuery = useQuery({
    queryKey: ["worker-matching", gigId],
    queryFn: () => api.getWorkerMatchingInterest(gigId, session.token),
    refetchInterval: 4000
  });

  const withdrawMutation = useMutation({
    mutationFn: () => api.withdrawGigInterest(gigId, session.token),
    onSuccess: () => {
      leaving.current = true;
      navigation.reset({ index: 0, routes: [{ name: "MainTabs" }] });
    },
    onError: (error: Error) => showAlert("Could not withdraw", error.message)
  });

  const interest = interestQuery.data?.interest;
  const gig = interestQuery.data?.gig;
  const socket = useSocket();

  useEffect(() => {
    if (!socket) return;

    const goHomeWithMessage = (message: string) => {
      if (leaving.current) return;
      leaving.current = true;
      showAlert("Matching update", message);
      navigation.reset({ index: 0, routes: [{ name: "MainTabs" }] });
    };

    const onNotSelected = (payload: { gigId?: string; message?: string }) => {
      if (payload.gigId !== gigId) return;
      goHomeWithMessage(payload.message ?? "Another worker was selected for this gig.");
    };

    const onSelected = (payload: { gigId?: string; paymentSecured?: boolean }) => {
      if (payload.gigId !== gigId || leaving.current) return;
      if (payload.paymentSecured) {
        leaving.current = true;
        navigation.replace("GigDetail", { gigId });
        return;
      }
      void interestQuery.refetch();
    };

    const onCancelled = (payload: { gigId?: string }) => {
      if (payload.gigId !== gigId) return;
      goHomeWithMessage("This request is no longer available.");
    };

    const onStatus = (payload: { gigId?: string; status?: string }) => {
      if (payload.gigId !== gigId) return;
      if (payload.status === "CANCELLED" || payload.status === "EXPIRED") {
        goHomeWithMessage(
          payload.status === "CANCELLED"
            ? "This request is no longer available."
            : "This matching request has expired."
        );
      }
      if (payload.status === "WORKER_ASSIGNED") {
        leaving.current = true;
        navigation.replace("GigDetail", { gigId });
      }
    };

    socket.on("worker_not_selected", onNotSelected);
    socket.on("worker_selected", onSelected);
    socket.on("selected_worker_cancelled", onCancelled);
    socket.on("gig:status", onStatus);
    socket.emit("gig:join", { gigId });

    return () => {
      socket.off("worker_not_selected", onNotSelected);
      socket.off("worker_selected", onSelected);
      socket.off("selected_worker_cancelled", onCancelled);
      socket.off("gig:status", onStatus);
    };
  }, [gigId, interestQuery, navigation, socket]);

  useEffect(() => {
    if (!interest || leaving.current) return;

    if (interest.status === "REJECTED" || interest.status === "WITHDRAWN") {
      leaving.current = true;
      showAlert(
        "Matching update",
        interest.status === "WITHDRAWN"
          ? "You withdrew from this request."
          : "Another worker was selected for this gig."
      );
      navigation.reset({ index: 0, routes: [{ name: "MainTabs" }] });
      return;
    }

    if (
      interest.status === "SELECTED" &&
      (gig?.status === "WORKER_ASSIGNED" ||
        gig?.status === "WORKER_EN_ROUTE" ||
        gig?.status === "WORKER_ARRIVED" ||
        gig?.status === "IN_PROGRESS")
    ) {
      leaving.current = true;
      navigation.replace("GigDetail", { gigId });
    }
  }, [gig?.status, gigId, interest, navigation]);

  if (interestQuery.isLoading && !interestQuery.data) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center gap-3">
          <ActivityIndicator />
          <Text className="text-sm text-muted">Opening matching…</Text>
        </View>
      </Screen>
    );
  }

  if (interestQuery.isError || !gig || !interest) {
    return (
      <Screen>
        <DutsCard className="gap-4 p-5">
          <Text className="text-lg font-black text-ink">Offer unavailable</Text>
          <Text className="text-sm text-muted">This matching request is no longer available.</Text>
          <AppButton label="Back to Home" onPress={() => navigation.reset({ index: 0, routes: [{ name: "MainTabs" }] })} />
        </DutsCard>
      </Screen>
    );
  }

  const startsLabel = new Date(gig.startsAt).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 32 }}>
        <View className="gap-2">
          <Text className="text-2xl font-black text-ink">Matching</Text>
          <Text className="text-sm text-muted">Waiting for the customer to choose a worker.</Text>
          <Text className="text-xs text-muted">
            You can keep this screen open. We’ll update you when the customer responds.
          </Text>
        </View>

        <SearchingIndicator
          title="Matching"
          message="Waiting for the customer to choose a worker."
        />

        <DutsCard className="gap-3 p-5">
          <Text className="text-sm font-bold uppercase tracking-wider text-brand">Your offer</Text>
          <Line label="Service" value={gig.serviceCategory.name} />
          <Line label="Area" value={`${gig.city}, ${gig.region}`} />
          <Line label="Scheduled" value={startsLabel} />
          <Line label="Estimated duration" value={`${gig.estimatedHours} hr`} />
          <Line label="Your earnings" value={formatMoney(gig.earnings?.netEarningsCents ?? gig.workerPayoutCents ?? 0)} />
          <Line label="Status" value="Waiting for customer" />
        </DutsCard>

        {interest.status === "SELECTED" && gig.status === "WORKER_SELECTED" ? (
          <DutsCard className="gap-2 border border-brand/20 bg-brand/5 p-4">
            <Text className="text-sm font-bold text-ink">You have been selected for this gig.</Text>
            <Text className="text-sm text-muted">Waiting for the customer to complete payment.</Text>
          </DutsCard>
        ) : null}

        <AppButton
          label={withdrawMutation.isPending ? "Withdrawing…" : "Withdraw offer"}
          variant="secondary"
          onPress={() => withdrawMutation.mutate()}
          disabled={withdrawMutation.isPending || interest.status !== "INTERESTED"}
        />
      </ScrollView>
    </Screen>
  );
}
