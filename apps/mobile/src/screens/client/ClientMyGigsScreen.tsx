import { useCallback, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { CompositeNavigationProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { api } from "../../lib/api";
import {
  ACTIVE_CLIENT_STATUSES,
  CANCELLED_STATUSES,
  COMPLETED_STATUSES
} from "../../lib/gig-status";
import { TabScreen } from "../../components/TabScreen";
import { HeroBanner } from "../../components/HeroBanner";
import { GigCard } from "../../components/GigCard";
import { EmptyState } from "../../components/EmptyState";
import { PendingPaymentCard } from "../../components/PendingPaymentCard";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { gigNeedsPayment } from "../../lib/gig-payment";
import { useStripeCheckout } from "../../hooks/useStripeCheckout";
import { useSocketEvents } from "../../hooks/useSocket";
import type { ClientTabParamList, RootStackParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";

type TabValue = "active" | "completed" | "cancelled";

type NavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<ClientTabParamList, "MyGigs">,
  NativeStackNavigationProp<RootStackParamList>
>;

export function ClientMyGigsScreen() {
  const session = useSessionStore((state) => state.session)!;
  const navigation = useNavigation<NavigationProp>();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabValue>("active");

  const gigsQuery = useQuery({
    queryKey: ["my-gigs", "CLIENT"],
    queryFn: () => api.myGigs(session.token, "CLIENT"),
    refetchInterval: 15_000
  });

  const { payWithStripe, isPaying, payingGigId } = useStripeCheckout();

  const unpaidGigs = useMemo(
    () => (gigsQuery.data?.gigs ?? []).filter(gigNeedsPayment),
    [gigsQuery.data?.gigs]
  );

  const filteredGigs = useMemo(() => {
    const gigs = (gigsQuery.data?.gigs ?? []).filter((gig) => !gigNeedsPayment(gig));
    if (tab === "active") {
      return gigs.filter((gig) => ACTIVE_CLIENT_STATUSES.includes(gig.status as (typeof ACTIVE_CLIENT_STATUSES)[number]));
    }
    if (tab === "completed") {
      return gigs.filter((gig) => COMPLETED_STATUSES.includes(gig.status as (typeof COMPLETED_STATUSES)[number]));
    }
    return gigs.filter((gig) => CANCELLED_STATUSES.includes(gig.status as (typeof CANCELLED_STATUSES)[number]));
  }, [gigsQuery.data?.gigs, tab]);

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["my-gigs"] });
  }, [queryClient]);

  useSocketEvents(useMemo(() => ({ "gig:matched": invalidate, "gig:status": invalidate }), [invalidate]));

  const emptyCopy = {
    active: {
      emoji: "📍",
      title: "No active gigs",
      description: "Post your first gig and get help from nearby workers.",
      actionLabel: "Post a Gig",
      onAction: () => navigation.navigate("PostGig")
    },
    completed: {
      emoji: "✅",
      title: "No completed gigs yet",
      description: "Completed gigs will show up here after workers finish the job."
    },
    cancelled: {
      emoji: "🚫",
      title: "No cancelled gigs",
      description: "Cancelled gigs will appear here if you cancel an open job."
    }
  }[tab];

  return (
    <TabScreen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32, gap: 16 }}>
        <HeroBanner eyebrow="My gigs" title="Your gigs" subtitle="Track active, completed, and cancelled jobs." />

        <SegmentedTabs
          tabs={[
            { value: "active" as const, label: "Active" },
            { value: "completed" as const, label: "Completed" },
            { value: "cancelled" as const, label: "Cancelled" }
          ]}
          value={tab}
          onChange={setTab}
        />

        {unpaidGigs.length > 0 ? (
          <View className="gap-3">
            <Text className="text-sm font-bold uppercase tracking-wider text-muted">Awaiting payment</Text>
            {unpaidGigs.map((gig) => (
              <PendingPaymentCard
                key={gig.id}
                gig={gig}
                onPay={() => payWithStripe(gig.id)}
                loading={isPaying && payingGigId === gig.id}
              />
            ))}
          </View>
        ) : null}

        {filteredGigs.length === 0 && unpaidGigs.length === 0 ? (
          <EmptyState {...emptyCopy} />
        ) : filteredGigs.length > 0 ? (
          <View className="gap-4">
            {filteredGigs.map((gig) => {
              const worker = gig.assignments?.[0]?.worker;
              return (
                <GigCard
                  key={gig.id}
                  gig={gig}
                  subtitle={worker ? `Worker: ${worker.fullName}` : undefined}
                  onPress={() => navigation.navigate("GigTracking", { gigId: gig.id })}
                />
              );
            })}
          </View>
        ) : null}
      </ScrollView>
    </TabScreen>
  );
}
