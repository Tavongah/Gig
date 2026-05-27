import { useCallback, useMemo } from "react";
import { ScrollView, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { CompositeNavigationProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { api } from "../../lib/api";
import { ACTIVE_CLIENT_STATUSES } from "../../lib/gig-status";
import { TabScreen } from "../../components/TabScreen";
import { SectionHeader } from "../../components/SectionHeader";
import { GigCard } from "../../components/GigCard";
import { EmptyState } from "../../components/EmptyState";
import { useSocketEvents } from "../../hooks/useSocket";
import type { ClientTabParamList, RootStackParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";

type NavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<ClientTabParamList, "Active">,
  NativeStackNavigationProp<RootStackParamList>
>;

export function ClientActiveScreen() {
  const session = useSessionStore((state) => state.session)!;
  const navigation = useNavigation<NavigationProp>();
  const queryClient = useQueryClient();

  const gigsQuery = useQuery({
    queryKey: ["my-gigs", "CLIENT"],
    queryFn: () => api.myGigs(session.token, "CLIENT"),
    refetchInterval: 15_000
  });

  const activeGigs = (gigsQuery.data?.gigs ?? []).filter((gig) =>
    ACTIVE_CLIENT_STATUSES.includes(gig.status as (typeof ACTIVE_CLIENT_STATUSES)[number])
  );

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["my-gigs"] });
  }, [queryClient]);

  const socketEvents = useMemo(
    () => ({
      "gig:matched": invalidate,
      "gig:status": invalidate
    }),
    [invalidate]
  );

  useSocketEvents(socketEvents);

  return (
    <TabScreen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32, gap: 16 }}>
        <SectionHeader
          eyebrow="Active"
          title="Track your gigs"
          subtitle="See live updates as workers accept and head your way."
        />

        {activeGigs.length === 0 ? (
          <EmptyState
            emoji="📍"
            title="No active gigs"
            description="Post a gig from the Home tab and track your worker here in real time."
            actionLabel="Post a gig"
            onAction={() => navigation.navigate("Home")}
          />
        ) : (
          <View className="gap-4">
            {activeGigs.map((gig) => {
              const worker = gig.assignments?.[0]?.worker;
              return (
                <GigCard
                  key={gig.id}
                  gig={gig}
                  subtitle={worker ? `Worker: ${worker.fullName}` : "Waiting for a worker to accept..."}
                  onPress={() => navigation.navigate("GigDetail", { gigId: gig.id })}
                  actionLabel="View live tracking"
                  onAction={() => navigation.navigate("GigDetail", { gigId: gig.id })}
                />
              );
            })}
          </View>
        )}
      </ScrollView>
    </TabScreen>
  );
}
