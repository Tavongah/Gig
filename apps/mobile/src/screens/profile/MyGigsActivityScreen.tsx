import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { api } from "../../lib/api";
import {
  ACTIVE_CLIENT_STATUSES,
  ACTIVE_WORKER_STATUSES,
  CANCELLED_STATUSES,
  COMPLETED_STATUSES
} from "../../lib/gig-status";
import { EmptyState } from "../../components/EmptyState";
import { GigCard } from "../../components/GigCard";
import { Screen } from "../../components/Screen";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import type { RootStackParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";

type TabValue = "active" | "upcoming" | "completed" | "cancelled";
type Nav = NativeStackNavigationProp<RootStackParamList, "MyGigsActivity">;

export function MyGigsActivityScreen() {
  const navigation = useNavigation<Nav>();
  const session = useSessionStore((state) => state.session)!;
  const activeRole = useSessionStore((state) => state.activeRole);
  const perspective = activeRole === "WORKER" ? "WORKER" : "CLIENT";
  const [tab, setTab] = useState<TabValue>("active");

  const gigsQuery = useQuery({
    queryKey: ["my-gigs", perspective, "activity"],
    queryFn: () => api.myGigs(session.token, perspective)
  });

  const filtered = useMemo(() => {
    const gigs = gigsQuery.data?.gigs ?? [];
    const now = Date.now();
    if (tab === "active") {
      const active = perspective === "WORKER" ? ACTIVE_WORKER_STATUSES : ACTIVE_CLIENT_STATUSES;
      return gigs.filter(
        (gig) =>
          active.includes(gig.status as never) &&
          new Date(gig.startsAt).getTime() <= now + 60 * 60 * 1000
      );
    }
    if (tab === "upcoming") {
      return gigs.filter(
        (gig) =>
          !CANCELLED_STATUSES.includes(gig.status as never) &&
          !COMPLETED_STATUSES.includes(gig.status as never) &&
          new Date(gig.startsAt).getTime() > now + 60 * 60 * 1000
      );
    }
    if (tab === "completed") {
      return gigs.filter((gig) => COMPLETED_STATUSES.includes(gig.status as never));
    }
    return gigs.filter((gig) => CANCELLED_STATUSES.includes(gig.status as never));
  }, [gigsQuery.data?.gigs, perspective, tab]);

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 32 }}>
        <SegmentedTabs
          tabs={[
            { value: "active" as const, label: "Active" },
            { value: "upcoming" as const, label: "Upcoming" },
            { value: "completed" as const, label: "Completed" },
            { value: "cancelled" as const, label: "Cancelled" }
          ]}
          value={tab}
          onChange={setTab}
        />

        {filtered.length === 0 ? (
          <EmptyState emoji="📋" title="No gigs here" description="Your gigs for this filter will appear here." />
        ) : (
          <View className="gap-4">
            {filtered.map((gig) => (
              <GigCard
                key={gig.id}
                gig={gig}
                onPress={() => navigation.navigate("GigDetail", { gigId: gig.id })}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
