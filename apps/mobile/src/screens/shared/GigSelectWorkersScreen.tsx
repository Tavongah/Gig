import { Text, View } from "react-native";
import { useMemo } from "react";
import { customerJourneyHeadline, isCustomerRematching, resolveCustomerJourneyStage } from "@gigflow/shared";
import { Screen } from "../../components/Screen";
import { DutsCard } from "../../components/DutsCard";
import { WorkerInterestCard } from "../../components/WorkerInterestCard";
import { CustomerJourneyProgress } from "../../components/CustomerJourneyProgress";
import { SearchingIndicator } from "../../components/SearchingIndicator";
import { ClientCancelBookingButton } from "../../components/ClientCancelBookingButton";
import { api } from "../../lib/api";
import { useSessionStore } from "../../stores/session.store";
import type { RootStackParamList } from "../../navigation/types";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { useSocketEvents } from "../../hooks/useSocket";

type Props = NativeStackScreenProps<RootStackParamList, "GigSelectWorkers">;

export function GigSelectWorkersScreen({ navigation, route }: Props) {
  const session = useSessionStore((state) => state.session)!;
  const { gigId } = route.params;

  const gigQuery = useQuery({
    queryKey: ["gig", gigId],
    queryFn: () => api.getGig(gigId, session.token),
    refetchInterval: 5000
  });

  const interestsQuery = useQuery({
    queryKey: ["gig-interests", gigId],
    queryFn: () => api.listGigInterests(gigId, session.token),
    refetchInterval: 5000
  });

  useSocketEvents(
    useMemo(
      () => ({
        gig_rematching: (payload: { gigId?: string }) => {
          if (payload.gigId !== gigId) return;
          void gigQuery.refetch();
          void interestsQuery.refetch();
        },
        selected_worker_cancelled: (payload: { gigId?: string }) => {
          if (payload.gigId !== gigId) return;
          void gigQuery.refetch();
          void interestsQuery.refetch();
        },
        "gig:interest": (payload: { gigId?: string }) => {
          if (payload.gigId !== gigId) return;
          void interestsQuery.refetch();
        }
      }),
      [gigId, gigQuery, interestsQuery]
    )
  );

  const interests = interestsQuery.data?.interests ?? [];
  const gig = gigQuery.data?.gig;
  const rematching = isCustomerRematching(gig?.status ?? "", gig?.paymentStatus, gig?.payment?.status);
  const stage = resolveCustomerJourneyStage({
    status: gig?.status ?? "POSTED",
    paymentStatus: gig?.paymentStatus,
    interestCount: interests.length
  });

  return (
    <Screen>
      <View className="gap-4">
        <View className="gap-2">
          <Text className="text-2xl font-black text-ink">
            {rematching ? "Finding another worker" : "Choose your worker"}
          </Text>
          <Text className="text-sm text-muted">
            {rematching
              ? "Your previous worker cancelled. We’re searching for another available worker nearby."
              : customerJourneyHeadline(stage)}
          </Text>
        </View>

        {gig ? (
          <CustomerJourneyProgress
            status={gig.status}
            paymentStatus={gig.paymentStatus}
            interestCount={interests.length}
            compact
          />
        ) : null}

        {rematching && interests.length === 0 ? (
          <SearchingIndicator
            title="Finding another worker"
            message="Your previous worker cancelled. We’re searching for another available worker nearby."
          />
        ) : interests.length === 0 ? (
          <View className="gap-3">
            <SearchingIndicator />
            <DutsCard className="gap-2 p-5">
              <Text className="text-base font-bold text-ink">Matching nearby workers</Text>
              <Text className="text-sm leading-5 text-muted">
                Your request was sent to nearby verified workers. They can accept immediately or submit a custom offer.
              </Text>
            </DutsCard>
          </View>
        ) : (
          interests.map((interest) => (
            <WorkerInterestCard
              key={interest.id}
              interest={interest}
              onChoose={() => navigation.navigate("GigWorkerSummary", { gigId, workerId: interest.worker.id })}
            />
          ))
        )}

        {gig ? <ClientCancelBookingButton gig={gig} /> : null}
      </View>
    </Screen>
  );
}
