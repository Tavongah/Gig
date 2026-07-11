import { Text, View } from "react-native";
import { customerJourneyHeadline, resolveCustomerJourneyStage } from "@gigflow/shared";
import { Screen } from "../../components/Screen";
import { DutsCard } from "../../components/DutsCard";
import { WorkerInterestCard } from "../../components/WorkerInterestCard";
import { CustomerJourneyProgress } from "../../components/CustomerJourneyProgress";
import { SearchingIndicator } from "../../components/SearchingIndicator";
import { api } from "../../lib/api";
import { useSessionStore } from "../../stores/session.store";
import type { RootStackParamList } from "../../navigation/types";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";

type Props = NativeStackScreenProps<RootStackParamList, "GigSelectWorkers">;

export function GigSelectWorkersScreen({ navigation, route }: Props) {
  const session = useSessionStore((state) => state.session)!;
  const { gigId } = route.params;

  const gigQuery = useQuery({
    queryKey: ["gig", gigId],
    queryFn: () => api.getGig(gigId, session.token)
  });

  const interestsQuery = useQuery({
    queryKey: ["gig-interests", gigId],
    queryFn: () => api.listGigInterests(gigId, session.token),
    refetchInterval: 5000
  });

  const interests = interestsQuery.data?.interests ?? [];
  const gig = gigQuery.data?.gig;
  const stage = resolveCustomerJourneyStage({
    status: gig?.status ?? "POSTED",
    paymentStatus: gig?.paymentStatus,
    interestCount: interests.length
  });

  return (
    <Screen>
      <View className="gap-4">
        <View className="gap-2">
          <Text className="text-2xl font-black text-ink">Choose your worker</Text>
          <Text className="text-sm text-muted">{customerJourneyHeadline(stage)}</Text>
        </View>

        {gig ? (
          <CustomerJourneyProgress
            status={gig.status}
            paymentStatus={gig.paymentStatus}
            interestCount={interests.length}
            compact
          />
        ) : null}

        {interests.length === 0 ? (
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
      </View>
    </Screen>
  );
}
