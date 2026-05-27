import { useCallback, useMemo } from "react";
import { ScrollView, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { CompositeNavigationProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { api } from "../../lib/api";
import { ACTIVE_WORKER_STATUSES } from "../../lib/gig-status";
import { TabScreen } from "../../components/TabScreen";
import { SectionHeader } from "../../components/SectionHeader";
import { GigCard } from "../../components/GigCard";
import { EmptyState } from "../../components/EmptyState";
import { useSocketEvents } from "../../hooks/useSocket";
import type { RootStackParamList, WorkerTabParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";

type NavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<WorkerTabParamList, "Active">,
  NativeStackNavigationProp<RootStackParamList>
>;

export function WorkerActiveScreen() {
  const session = useSessionStore((state) => state.session)!;
  const navigation = useNavigation<NavigationProp>();
  const queryClient = useQueryClient();

  const gigsQuery = useQuery({
    queryKey: ["my-gigs", "WORKER"],
    queryFn: () => api.myGigs(session.token, "WORKER"),
    refetchInterval: 10_000
  });

  const activeGigs = (gigsQuery.data?.gigs ?? []).filter((gig) =>
    ACTIVE_WORKER_STATUSES.includes(gig.status as (typeof ACTIVE_WORKER_STATUSES)[number])
  );

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["my-gigs"] });
  }, [queryClient]);

  const socketEvents = useMemo(
    () => ({
      "gig:status": invalidate
    }),
    [invalidate]
  );

  useSocketEvents(socketEvents);

  return (
    <TabScreen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32, gap: 16 }}>
        <SectionHeader eyebrow="Active job" title="Current assignment" subtitle="Update status as you progress through the gig." />

        {activeGigs.length === 0 ? (
          <EmptyState
            emoji="🧰"
            title="No active jobs"
            description="Accept a nearby gig from the Offers tab to start earning."
            actionLabel="Browse offers"
            onAction={() => navigation.navigate("Offers")}
          />
        ) : (
          <View className="gap-4">
            {activeGigs.map((gig) => (
              <GigCard
                key={gig.id}
                gig={gig}
                subtitle={gig.client ? `Client: ${gig.client.fullName}` : undefined}
                onPress={() => navigation.navigate("GigDetail", { gigId: gig.id })}
                actionLabel="Manage gig"
                onAction={() => navigation.navigate("GigDetail", { gigId: gig.id })}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </TabScreen>
  );
}
