import { ScrollView, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { api } from "../../lib/api";
import { HISTORY_STATUSES } from "../../lib/gig-status";
import { TabScreen } from "../../components/TabScreen";
import { SectionHeader } from "../../components/SectionHeader";
import { GigCard } from "../../components/GigCard";
import { EmptyState } from "../../components/EmptyState";
import type { RootStackParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";

interface HistoryScreenProps {
  perspective: "CLIENT" | "WORKER";
}

export function HistoryScreen({ perspective }: HistoryScreenProps) {
  const session = useSessionStore((state) => state.session)!;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const gigsQuery = useQuery({
    queryKey: ["my-gigs", perspective],
    queryFn: () => api.myGigs(session.token, perspective)
  });

  const historyGigs = (gigsQuery.data?.gigs ?? []).filter((gig) =>
    HISTORY_STATUSES.includes(gig.status as (typeof HISTORY_STATUSES)[number])
  );

  return (
    <TabScreen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32, gap: 16 }}>
        <SectionHeader eyebrow="History" title="Past gigs" subtitle="Completed and closed jobs." />

        {historyGigs.length === 0 ? (
          <EmptyState emoji="📋" title="No history yet" description="Your completed gigs will show up here." />
        ) : (
          <View className="gap-4">
            {historyGigs.map((gig) => (
              <GigCard
                key={gig.id}
                gig={gig}
                onPress={() => navigation.navigate("GigDetail", { gigId: gig.id })}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </TabScreen>
  );
}
