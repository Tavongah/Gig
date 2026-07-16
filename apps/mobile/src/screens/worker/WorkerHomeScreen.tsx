import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { CompositeNavigationProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { api } from "../../lib/api";
import { formatCents } from "../../lib/format";
import { showAlert, showConfirm } from "../../lib/confirm";
import { TabScreen } from "../../components/TabScreen";
import { DutsCard } from "../../components/DutsCard";
import { AppButton } from "../../components/AppButton";
import { EmptyState } from "../../components/EmptyState";
import { AcceptGigAnimation } from "../../components/AcceptGigAnimation";
import { NearbyGigCard } from "../../components/NearbyGigCard";
import { BrandLogo } from "../../components/BrandLogo";
import { useWorkerOnline } from "../../hooks/useWorkerOnline";
import { useSocketEvents } from "../../hooks/useSocket";
import { useWorkerFlowRecovery } from "../../hooks/useGigFlowRecovery";
import type { RootStackParamList, WorkerTabParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";

type NavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<WorkerTabParamList, "Home">,
  NativeStackNavigationProp<RootStackParamList>
>;

export function WorkerHomeScreen() {
  const session = useSessionStore((state) => state.session)!;
  const profile = useSessionStore((state) => state.profile);
  const navigation = useNavigation<NavigationProp>();
  const queryClient = useQueryClient();

  const { isOnline, isGoingOnline, preferencesReady, goOnline, goOffline } = useWorkerOnline();
  const { matchingOffers, activeGig } = useWorkerFlowRecovery();

  const [declinedOfferIds, setDeclinedOfferIds] = useState<string[]>([]);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [showAcceptAnimation, setShowAcceptAnimation] = useState(false);
  const [acceptedGigId, setAcceptedGigId] = useState<string | null>(null);

  const invalidateEarnings = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["worker-earnings"] });
  }, [queryClient]);

  const earningsQuery = useQuery({
    queryKey: ["worker-earnings"],
    queryFn: () => api.getWorkerEarnings(session.token)
  });

  useSocketEvents(useMemo(() => ({ "worker:earnings_updated": invalidateEarnings }), [invalidateEarnings]));

  const nearbyQuery = useQuery({
    queryKey: ["nearby-gigs"],
    queryFn: () => api.nearbyGigs(session.token),
    enabled: isOnline,
    refetchInterval: isOnline ? 10_000 : false
  });

  useSocketEvents(
    useMemo(
      () => ({
        "gig:offer": () => {
          if (isOnline) {
            void nearbyQuery.refetch();
          }
        },
        worker_not_selected: () => {
          void queryClient.invalidateQueries({ queryKey: ["worker-matching-list"] });
        },
        worker_selected: () => {
          void queryClient.invalidateQueries({ queryKey: ["worker-matching-list"] });
          void queryClient.invalidateQueries({ queryKey: ["my-gigs"] });
        },
        notification: (payload: { title: string; body: string }) => {
          if (isOnline) {
            showAlert(payload.title, payload.body);
          }
        }
      }),
      [isOnline, nearbyQuery, queryClient]
    )
  );

  const acceptMutation = useMutation({
    mutationFn: (gigId: string) => api.acceptGig(gigId, session.token),
    onSuccess: (_result, gigId) => {
      void queryClient.invalidateQueries({ queryKey: ["my-gigs"] });
      void queryClient.invalidateQueries({ queryKey: ["worker-matching-list"] });
      void nearbyQuery.refetch();
      setAcceptedGigId(gigId);
      setShowAcceptAnimation(true);
    },
    onError: (error: Error) => showAlert("Could not accept", error.message),
    onSettled: () => setAcceptingId(null)
  });

  const offers = (nearbyQuery.data?.gigs ?? []).filter((gig) => !declinedOfferIds.includes(gig.id));
  const previewGigs = offers.slice(0, 3);
  const earnings = earningsQuery.data?.earnings;

  const checklist = [
    { label: "Bio added", done: Boolean(profile?.workerProfile?.bio?.length) },
    { label: "Services selected", done: (profile?.workerProfile?.serviceCategories.length ?? 0) > 0 },
    { label: "Rates configured", done: Boolean(profile?.workerProfile?.hourlyRateCents) },
    { label: "Profile photo", done: false }
  ];

  function confirmAccept(gigId: string, title: string): void {
    showConfirm("Accept this offer?", `Accept "${title}"?`, () => {
      setAcceptingId(gigId);
      acceptMutation.mutate(gigId);
    }, { confirmLabel: "Accept" });
  }

  function declineOffer(gigId: string): void {
    setDeclinedOfferIds((current) => (current.includes(gigId) ? current : [...current, gigId]));
  }

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

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 36, gap: 16 }}>
        <View className="gap-2 px-1">
          <BrandLogo size={48} />
          <Text className="text-2xl font-black text-ink">Hey {profile?.fullName?.split(" ")[0] ?? "there"} 👋</Text>
        </View>

        {activeGig ? (
          <DutsCard className="gap-3 border border-brand/20 p-4">
            <Text className="text-xs font-bold uppercase tracking-wider text-brand">Active Gig</Text>
            <Text className="text-lg font-black text-ink">{activeGig.serviceCategory?.name ?? activeGig.title}</Text>
            <Text className="text-sm text-muted">Continue your assigned job.</Text>
            <AppButton
              label="Continue Active Gig"
              onPress={() => navigation.navigate("GigDetail", { gigId: activeGig.id })}
            />
          </DutsCard>
        ) : null}

        {matchingOffers.length > 0 ? (
          <View className="gap-3">
            <Text className="px-1 text-sm font-bold uppercase tracking-wider text-muted">Matching</Text>
            {matchingOffers.map((offer) => (
              <DutsCard key={offer.id} className="gap-3 p-4">
                <Text className="text-base font-black text-ink">{offer.gig.serviceCategory.name}</Text>
                <Text className="text-sm text-muted">
                  {offer.gig.city}, {offer.gig.region} · Waiting for customer
                </Text>
                <AppButton
                  label="Open Matching"
                  variant="secondary"
                  onPress={() => navigation.navigate("WorkerMatching", { gigId: offer.gig.id })}
                />
              </DutsCard>
            ))}
          </View>
        ) : null}

        <DutsCard className="overflow-hidden p-0">
          <View className={`gap-1 px-5 py-4 ${isOnline ? "bg-success/10" : "bg-surface"}`}>
            <View className="flex-row items-center gap-2">
              <View className={`h-3 w-3 rounded-full ${isOnline ? "bg-success" : "bg-disabled"}`} />
              <Text className="text-lg font-black text-ink">{isOnline ? "You're online" : "You're offline"}</Text>
            </View>
            <Text className="text-sm text-muted">
              {isOnline ? "Listening for nearby offers matching your preferences." : "Tap Go Online when you're ready to work."}
            </Text>
          </View>

          <View className="gap-3 p-4">
            {isOnline ? (
              <AppButton label="Go Offline" onPress={() => void goOffline()} variant="secondary" size="lg" />
            ) : (
              <AppButton
                label={isGoingOnline ? "Going online..." : "Go Online"}
                onPress={() => void goOnline()}
                variant="primary"
                size="lg"
                disabled={isGoingOnline}
                loading={isGoingOnline}
              />
            )}

            {!preferencesReady ? (
              <Pressable onPress={() => navigation.navigate("WorkerWorkPreferences")}>
                <Text className="text-center text-sm font-semibold text-brand">Set up work preferences →</Text>
              </Pressable>
            ) : null}
          </View>
        </DutsCard>

        {isOnline ? (
          <View className="gap-3">
            <View className="flex-row items-center justify-between px-1">
              <Text className="text-sm font-bold uppercase tracking-wider text-muted">Incoming offers</Text>
              {offers.length > 3 ? (
                <Pressable onPress={() => navigation.navigate("NearbyGigs")}>
                  <Text className="text-sm font-bold text-brand">See all</Text>
                </Pressable>
              ) : null}
            </View>

            {offers.length === 0 ? (
              <EmptyState
                emoji="📡"
                title="Waiting for offers"
                description="You're online. We'll notify you when a matching gig is nearby."
              />
            ) : (
              previewGigs.map((gig) => (
                <NearbyGigCard
                  key={gig.id}
                  gig={gig}
                  onView={() => navigation.navigate("GigDetail", { gigId: gig.id })}
                  onAccept={() => confirmAccept(gig.id, gig.title)}
                  onDecline={() => declineOffer(gig.id)}
                  acceptDisabled={acceptMutation.isPending && acceptingId === gig.id}
                />
              ))
            )}
          </View>
        ) : null}

        <Pressable onPress={() => navigation.navigate("NearbyGigs")}>
          <DutsCard className="flex-row items-center justify-between p-5">
            <View className="gap-1">
              <Text className="text-sm font-bold uppercase tracking-wider text-muted">My gigs</Text>
              <Text className="text-base font-semibold text-ink">View available, active, and completed gigs</Text>
            </View>
            <Text className="text-lg font-black text-brand">→</Text>
          </DutsCard>
        </Pressable>

        <DutsCard className="gap-4 p-5">
          <Text className="text-sm font-bold uppercase tracking-wider text-brand">Earnings summary</Text>
          <View className="flex-row gap-3">
            <View className="flex-1 rounded-2xl border border-border bg-surface p-3">
              <Text className="text-xs text-muted">Available</Text>
              <Text className="text-lg font-black text-success">{formatCents(earnings?.availableBalanceCents ?? 0)}</Text>
            </View>
            <View className="flex-1 rounded-2xl border border-border bg-surface p-3">
              <Text className="text-xs text-muted">Pending</Text>
              <Text className="text-lg font-black text-orange">{formatCents(earnings?.pendingEarningsCents ?? 0)}</Text>
            </View>
            <View className="flex-1 rounded-2xl border border-border bg-surface p-3">
              <Text className="text-xs text-muted">Completed</Text>
              <Text className="text-lg font-black text-ink">{earnings?.completedGigCount ?? 0}</Text>
            </View>
          </View>
          <Pressable onPress={() => navigation.navigate("Earnings")}>
            <Text className="font-bold text-brand">View earnings →</Text>
          </Pressable>
        </DutsCard>

        <DutsCard className="gap-3 p-5">
          <Text className="text-sm font-bold uppercase tracking-wider text-teal">Profile checklist</Text>
          {checklist.map((item) => (
            <View key={item.label} className="flex-row items-center gap-3">
              <View className={`h-6 w-6 items-center justify-center rounded-full ${item.done ? "bg-success" : "bg-disabled"}`}>
                <Text className={`text-xs font-black ${item.done ? "text-white" : "text-disabled-text"}`}>
                  {item.done ? "✓" : ""}
                </Text>
              </View>
              <Text className={`text-sm ${item.done ? "font-semibold text-ink" : "text-muted"}`}>{item.label}</Text>
            </View>
          ))}
        </DutsCard>
      </ScrollView>
    </TabScreen>
  );
}
