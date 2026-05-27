import { useMemo, useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { CompositeNavigationProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { api } from "../../lib/api";
import { TabScreen } from "../../components/TabScreen";
import { SectionHeader } from "../../components/SectionHeader";
import { GigCard } from "../../components/GigCard";
import { EmptyState } from "../../components/EmptyState";
import { useSocket, useSocketEvents } from "../../hooks/useSocket";
import type { RootStackParamList, WorkerTabParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";

type NavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<WorkerTabParamList, "Offers">,
  NativeStackNavigationProp<RootStackParamList>
>;

export function WorkerOffersScreen() {
  const session = useSessionStore((state) => state.session)!;
  const profile = useSessionStore((state) => state.profile);
  const navigation = useNavigation<NavigationProp>();
  const queryClient = useQueryClient();
  const socket = useSocket();
  const [isAvailable, setIsAvailable] = useState(false);

  const nearbyQuery = useQuery({
    queryKey: ["nearby-gigs"],
    queryFn: () => api.nearbyGigs(session.token),
    enabled: isAvailable,
    refetchInterval: isAvailable ? 12_000 : false
  });

  const categoryIds = profile?.workerProfile?.serviceCategories.map((category) => category.id) ?? [];

  const socketEvents = useMemo(
    () => ({
      "gig:offer": () => {
        void nearbyQuery.refetch();
      }
    }),
    [nearbyQuery]
  );

  useSocketEvents(isAvailable ? socketEvents : {});

  const acceptMutation = useMutation({
    mutationFn: (gigId: string) => api.acceptGig(gigId, session.token),
    onSuccess: ({ gig }) => {
      void queryClient.invalidateQueries({ queryKey: ["my-gigs"] });
      void nearbyQuery.refetch();
      navigation.navigate("GigDetail", { gigId: gig.id });
    },
    onError: (error: Error) => Alert.alert("Could not accept", error.message)
  });

  function toggleAvailability(): void {
    if (!socket) {
      return;
    }

    if (isAvailable) {
      socket.emit("worker:offline");
      setIsAvailable(false);
      return;
    }

    socket.emit("worker:available", {
      serviceCategoryIds: categoryIds,
      latitude: 33.749,
      longitude: -84.388
    });
    setIsAvailable(true);
    void nearbyQuery.refetch();
  }

  return (
    <TabScreen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32, gap: 16 }}>
        <SectionHeader
          eyebrow="Find work"
          title="Nearby gigs"
          subtitle={isAvailable ? "You're online and receiving live offers." : "Go available to start receiving gigs."}
        />

        <View className="rounded-3xl bg-slate-900 p-5">
          <EmptyState
            emoji={isAvailable ? "🟢" : "⚪"}
            title={isAvailable ? "You're available" : "You're offline"}
            description={
              categoryIds.length > 0
                ? `Listening across ${categoryIds.length} service categories.`
                : "Complete your worker profile to select services."
            }
            actionLabel={isAvailable ? "Go offline" : "Go available"}
            onAction={toggleAvailability}
          />
        </View>

        <View className="gap-4">
          {(nearbyQuery.data?.gigs ?? []).map((gig) => (
            <GigCard
              key={gig.id}
              gig={gig}
              subtitle={gig.client ? `Client: ${gig.client.fullName}` : undefined}
              actionLabel="Accept gig"
              actionDisabled={acceptMutation.isPending}
              onAction={() => acceptMutation.mutate(gig.id)}
              onPress={() => navigation.navigate("GigDetail", { gigId: gig.id })}
            />
          ))}
        </View>
      </ScrollView>
    </TabScreen>
  );
}
