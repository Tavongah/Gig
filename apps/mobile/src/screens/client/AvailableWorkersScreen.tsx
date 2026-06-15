import { Alert, ScrollView, Text, View } from "react-native";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { TabScreen } from "../../components/TabScreen";
import { SectionHeader } from "../../components/SectionHeader";
import { WorkerCard } from "../../components/WorkerCard";
import { EmptyState } from "../../components/EmptyState";
import { api } from "../../lib/api";
import { getCurrentCoordinates } from "../../lib/location";
import type { ClientTabParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";

export function AvailableWorkersScreen() {
  const session = useSessionStore((state) => state.session)!;
  const navigation = useNavigation<BottomTabNavigationProp<ClientTabParamList>>();
  const [clientCoords, setClientCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  useEffect(() => {
    void getCurrentCoordinates()
      .then((coords) => setClientCoords(coords))
      .catch(() => undefined);
  }, []);

  const workersQuery = useQuery({
    queryKey: ["available-workers", clientCoords?.latitude, clientCoords?.longitude],
    queryFn: () => api.availableWorkersNearby(clientCoords!.latitude, clientCoords!.longitude, session.token),
    enabled: Boolean(clientCoords),
    refetchInterval: 15_000
  });
  function handleRequest(workerId: string, workerName: string): void {
    Alert.alert(
      "Request worker",
      `Post a gig to reach ${workerName}. They'll see your job when it's live.`,
      [
        { text: "Post a gig", onPress: () => navigation.navigate("PostGig", { preferredWorkerId: workerId }) },
        { text: "Cancel", style: "cancel" }
      ]
    );
  }

  return (
    <TabScreen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32, gap: 16 }}>
        <SectionHeader
          eyebrow="Workers"
          title="Workers Available Now Near You"
          subtitle="Verified workers who are online and ready to help nearby."
        />

        {(workersQuery.data?.workers ?? []).length === 0 ? (
          <EmptyState
            emoji="📍"
            title="No workers online yet"
            description="Try again shortly or post a gig and we'll broadcast it to nearby workers."
            actionLabel="Post a Gig"
            onAction={() => navigation.navigate("PostGig")}
          />
        ) : (
          <View className="gap-4">
            {(workersQuery.data?.workers ?? []).map((worker) => (
              <WorkerCard
                key={worker.userId}
                worker={worker}
                onRequest={() => handleRequest(worker.userId, worker.fullName)}
              />
            ))}
          </View>
        )}

        {workersQuery.isLoading ? <Text className="text-center text-muted">Finding nearby workers...</Text> : null}
      </ScrollView>
    </TabScreen>
  );
}
