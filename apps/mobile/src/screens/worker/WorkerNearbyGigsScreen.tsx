import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { CompositeNavigationProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { api } from "../../lib/api";
import { showAlert, showConfirm } from "../../lib/confirm";
import { ACTIVE_WORKER_STATUSES, COMPLETED_STATUSES } from "../../lib/gig-status";
import { TabScreen } from "../../components/TabScreen";
import { HeroBanner } from "../../components/HeroBanner";
import { AcceptGigAnimation } from "../../components/AcceptGigAnimation";
import { NearbyGigCard } from "../../components/NearbyGigCard";
import { GigCard } from "../../components/GigCard";
import { EmptyState } from "../../components/EmptyState";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { useSocketEvents } from "../../hooks/useSocket";
import type { RootStackParamList, WorkerTabParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";

type TabValue = "available" | "matching" | "accepted" | "completed";

type NavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<WorkerTabParamList, "NearbyGigs">,
  NativeStackNavigationProp<RootStackParamList>
>;

export function WorkerNearbyGigsScreen() {
  const session = useSessionStore((state) => state.session)!;
  const navigation = useNavigation<NavigationProp>();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabValue>("available");
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [showAcceptAnimation, setShowAcceptAnimation] = useState(false);
  const [acceptedGigId, setAcceptedGigId] = useState<string | null>(null);

  const nearbyQuery = useQuery({
    queryKey: ["nearby-gigs"],
    queryFn: () => api.nearbyGigs(session.token),
    refetchInterval: 10_000
  });

  const matchingQuery = useQuery({
    queryKey: ["worker-matching-list"],
    queryFn: () => api.listWorkerMatchingInterests(session.token),
    refetchInterval: 10_000
  });

  const myGigsQuery = useQuery({
    queryKey: ["my-gigs", "WORKER"],
    queryFn: () => api.myGigs(session.token, "WORKER"),
    refetchInterval: 10_000
  });

  useSocketEvents(
    useMemo(
      () => ({
        "gig:offer": () => {
          void nearbyQuery.refetch();
        },
        notification: (payload: { title: string; body: string }) => {
          showAlert(payload.title, payload.body);
        }
      }),
      [nearbyQuery]
    )
  );

  const acceptMutation = useMutation({
    mutationFn: (gigId: string) => api.acceptGig(gigId, session.token),
    onSuccess: (_result, gigId) => {
      void queryClient.invalidateQueries({ queryKey: ["my-gigs"] });
      void nearbyQuery.refetch();
      setAcceptedGigId(gigId);
      setShowAcceptAnimation(true);
    },
    onError: (error: Error) => showAlert("Could not accept", error.message),
    onSettled: () => setAcceptingId(null)
  });

  const availableGigs = nearbyQuery.data?.gigs ?? [];
  const myGigs = myGigsQuery.data?.gigs ?? [];
  const matchingOffers = (matchingQuery.data?.interests ?? []).filter(
    (row) =>
      row.status === "INTERESTED" ||
      (row.status === "SELECTED" && row.gig.status === "WORKER_SELECTED")
  );
  const acceptedGigs = myGigs.filter((gig) =>
    ACTIVE_WORKER_STATUSES.includes(gig.status as (typeof ACTIVE_WORKER_STATUSES)[number])
  );
  const completedGigs = myGigs.filter((gig) =>
    COMPLETED_STATUSES.includes(gig.status as (typeof COMPLETED_STATUSES)[number])
  );

  function confirmAccept(gigId: string, title: string): void {
    showConfirm("Accept this gig?", `Are you sure you want to accept "${title}"?`, () => {
      setAcceptingId(gigId);
      acceptMutation.mutate(gigId);
    }, { confirmLabel: "Accept" });
  }

  const emptyCopy = {
    available: {
      emoji: "📡",
      title: "No available gigs",
      description: "Go online from home to receive new gigs matching your services."
    },
    matching: {
      emoji: "⏳",
      title: "No matching offers",
      description: "Accept a nearby gig to wait for the customer to choose a worker."
    },
    accepted: {
      emoji: "🧰",
      title: "No active gig",
      description: "Once a customer selects you and payment is secured, the gig appears here."
    },
    completed: {
      emoji: "✅",
      title: "No completed gigs",
      description: "Completed gigs will appear here after you finish jobs."
    }
  }[tab];

  return (
    <TabScreen>
      <AcceptGigAnimation
        visible={showAcceptAnimation}
        onDone={() => {
          setShowAcceptAnimation(false);
          if (acceptedGigId) {
            navigation.replace("WorkerMatching", { gigId: acceptedGigId });
            setAcceptedGigId(null);
          }
        }}
      />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32, gap: 16 }}>
        <HeroBanner
          eyebrow="Nearby gigs"
          title="Your gigs"
          subtitle="Available gigs stay visible even while you have an active job."
        />

        <SegmentedTabs
          tabs={[
            { value: "available" as const, label: "Available" },
            { value: "matching" as const, label: "Matching" },
            { value: "accepted" as const, label: "Active" },
            { value: "completed" as const, label: "Completed" }
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === "available" ? (
          availableGigs.length === 0 ? (
            <EmptyState {...emptyCopy} />
          ) : (
            <View className="gap-4">
              {availableGigs.map((gig) => (
                <NearbyGigCard
                  key={gig.id}
                  gig={gig}
                  onView={() => navigation.navigate("GigDetail", { gigId: gig.id })}
                  onAccept={() => confirmAccept(gig.id, gig.title)}
                  acceptDisabled={acceptMutation.isPending && acceptingId === gig.id}
                />
              ))}
            </View>
          )
        ) : null}

        {tab === "matching" ? (
          matchingOffers.length === 0 ? (
            <EmptyState {...emptyCopy} />
          ) : (
            <View className="gap-4">
              {matchingOffers.map((offer) => (
                <GigCard
                  key={offer.id}
                  gig={{
                    id: offer.gig.id,
                    title: offer.gig.title,
                    description: "",
                    status: offer.gig.status,
                    urgency: "STANDARD",
                    totalCents: offer.offeredWorkerPayoutCents,
                    workerPayoutCents: offer.offeredWorkerPayoutCents,
                    addressLine1: "",
                    city: offer.gig.city,
                    region: offer.gig.region,
                    latitude: 0,
                    longitude: 0,
                    startsAt: offer.gig.startsAt,
                    createdAt: offer.gig.startsAt,
                    serviceCategory: offer.gig.serviceCategory
                  }}
                  showWorkerEarnings
                  subtitle={`${offer.gig.city}, ${offer.gig.region} · Waiting for customer`}
                  actionLabel="Open Matching"
                  onAction={() => navigation.navigate("WorkerMatching", { gigId: offer.gig.id })}
                  onPress={() => navigation.navigate("WorkerMatching", { gigId: offer.gig.id })}
                />
              ))}
            </View>
          )
        ) : null}

        {tab === "accepted" ? (
          acceptedGigs.length === 0 ? (
            <EmptyState {...emptyCopy} />
          ) : (
            <View className="gap-4">
              {acceptedGigs.map((gig) => (
                <GigCard
                  key={gig.id}
                  gig={gig}
                  showWorkerEarnings
                  subtitle={gig.client ? `Client: ${gig.client.fullName}` : undefined}
                  actionLabel="Manage gig"
                  onAction={() => navigation.navigate("GigDetail", { gigId: gig.id })}
                  onPress={() => navigation.navigate("GigDetail", { gigId: gig.id })}
                />
              ))}
            </View>
          )
        ) : null}

        {tab === "completed" ? (
          completedGigs.length === 0 ? (
            <EmptyState {...emptyCopy} />
          ) : (
            <View className="gap-4">
              {completedGigs.map((gig) => (
                <GigCard
                  key={gig.id}
                  gig={gig}
                  showWorkerEarnings
                  onPress={() => navigation.navigate("GigDetail", { gigId: gig.id })}
                />
              ))}
            </View>
          )
        ) : null}
      </ScrollView>
    </TabScreen>
  );
}
