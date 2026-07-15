import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Linking, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { customerJourneyHeadline, formatMoney, haversineMiles, liveTrackingWorkerStatus, resolveCustomerJourneyStage } from "@gigflow/shared";
import { api } from "../../lib/api";
import { formatAddress, formatCents } from "../../lib/format";
import { canClientCancel, isSearching, needsClientReview, showTrackingMap } from "../../lib/gig-status";
import { SearchingIndicator } from "../../components/SearchingIndicator";
import { AssignedWorkerCard } from "../../components/AssignedWorkerCard";
import { TrackingMap } from "../../components/TrackingMap";
import { StatusBadge } from "../../components/StatusBadge";
import { LoadingButton } from "../../components/LoadingButton";
import { DutsCard } from "../../components/DutsCard";
import { SuccessAnimation } from "../../components/SuccessAnimation";
import { CustomerJourneyProgress } from "../../components/CustomerJourneyProgress";
import { useSocket, useSocketEvents } from "../../hooks/useSocket";
import type { RootStackParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";
import { APP_NAME } from "../../lib/brand";
import { DUTS } from "../../lib/theme";

export function GigTrackingScreen() {
  const session = useSessionStore((state) => state.session)!;
  const route = useRoute<RouteProp<RootStackParamList, "GigTracking">>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const queryClient = useQueryClient();
  const socket = useSocket();
  const [workerLocation, setWorkerLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const gigQuery = useQuery({
    queryKey: ["gig", route.params.gigId],
    queryFn: () => api.getGig(route.params.gigId, session.token),
    refetchInterval: 8_000
  });

  const gig = gigQuery.data?.gig;
  const worker = gig?.assignments?.[0]?.worker;
  const workerProfile = worker?.workerProfile;
  const pricingType = gig?.pricingType ?? "HOURLY";
  const showTimer = pricingType === "HOURLY" || pricingType === "ESTIMATE_TIMER";

  const invalidate = useCallback(() => {
    void gigQuery.refetch();
    void queryClient.invalidateQueries({ queryKey: ["my-gigs"] });
  }, [gigQuery, queryClient]);

  useEffect(() => {
    if (!socket) return;
    socket.emit("gig:join", { gigId: route.params.gigId });
  }, [socket, route.params.gigId]);

  useSocketEvents(
    useMemo(
      () => ({
        "gig:status": invalidate,
        "gig:assigned": invalidate,
        "gig:matched": invalidate,
        "location:updated": (payload: { latitude: number; longitude: number }) => {
          setWorkerLocation({ latitude: payload.latitude, longitude: payload.longitude });
        },
        notification: (payload: { title: string; body: string }) => {
          Alert.alert(payload.title, payload.body);
        }
      }),
      [invalidate]
    )
  );

  useEffect(() => {
    if (!gig || !needsClientReview(gig.status)) return;
    navigation.replace("GigCompletionReview", { gigId: gig.id });
  }, [gig, navigation]);

  useEffect(() => {
    const startedAt = gig?.assignments?.[0]?.startedAt;
    if (!startedAt || gig?.status !== "IN_PROGRESS" || !showTimer) {
      setElapsedSeconds(0);
      return;
    }
    const start = new Date(startedAt).getTime();
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [gig?.assignments, gig?.status, showTimer]);

  const cancelMutation = useMutation({
    mutationFn: () => api.cancelGig(route.params.gigId, session.token),
    onSuccess: () => {
      invalidate();
      Alert.alert("Booking cancelled", "Your request has been cancelled.");
    },
    onError: (error: Error) => Alert.alert("Could not cancel", error.message)
  });

  const customerLat = Number(gig?.latitude ?? 33.749);
  const customerLng = Number(gig?.longitude ?? -84.388);
  const workerLat = workerLocation?.latitude ?? Number(workerProfile?.currentLatitude ?? NaN);
  const workerLng = workerLocation?.longitude ?? Number(workerProfile?.currentLongitude ?? NaN);
  const hasWorkerCoords = Number.isFinite(workerLat) && Number.isFinite(workerLng);
  const distanceMiles = hasWorkerCoords ? haversineMiles(workerLat, workerLng, customerLat, customerLng) : undefined;
  const etaMinutes =
    distanceMiles != null ? Math.max(1, Math.round(distanceMiles * 4)) : gig?.estimatedResponseMinutes;

  if (!gig) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: DUTS.background }}>
        <Text className="text-ink">{gigQuery.isLoading ? "Loading..." : "Gig not found"}</Text>
      </View>
    );
  }

  const searching = isSearching(gig.status);
  const showMap = showTrackingMap(gig.status);
  const arrived = gig.status === "WORKER_ARRIVED";
  const inProgress = gig.status === "IN_PROGRESS";
  const completed = gig.status === "COMPLETED";
  const stage = resolveCustomerJourneyStage({ status: gig.status, paymentStatus: gig.paymentStatus });
  const headline = customerJourneyHeadline(stage);

  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: DUTS.background }}
      contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 16 }}
    >
      <View className="gap-3">
        <Text className="text-2xl font-black text-ink">{headline}</Text>
        <View className="flex-row flex-wrap items-center gap-2">
          <StatusBadge status={gig.status} />
          {!searching ? (
            <View className="rounded-full bg-surface px-3 py-1">
              <Text className="text-xs font-bold text-ink">{liveTrackingWorkerStatus(gig.status)}</Text>
            </View>
          ) : null}
        </View>
        <CustomerJourneyProgress status={gig.status} paymentStatus={gig.paymentStatus} compact />
      </View>

      {arrived ? (
        <View className="rounded-4xl border border-success/30 bg-verified px-5 py-5">
          <Text className="text-center text-lg font-black text-verified-text">Your worker has arrived</Text>
        </View>
      ) : null}

      {searching ? <SearchingIndicator /> : null}

      {worker && !searching ? (
        <AssignedWorkerCard
          fullName={worker.fullName}
          phoneNumber={worker.phoneNumber}
          ratingAverage={Number(workerProfile?.ratingAverage ?? 5)}
          completedGigCount={workerProfile?.completedGigCount ?? 0}
          distanceMiles={distanceMiles}
          onMessage={() => navigation.navigate("Chat", { gigId: gig.id, title: gig.title })}
        />
      ) : null}

      {worker && !searching && etaMinutes != null ? (
        <DutsCard className="flex-row items-center justify-between p-4">
          <Text className="text-sm font-bold text-muted">ETA</Text>
          <Text className="text-2xl font-black text-brand">~{etaMinutes} min</Text>
        </DutsCard>
      ) : null}

      {showMap ? (
        <TrackingMap
          customerLat={customerLat}
          customerLng={customerLng}
          workerLat={hasWorkerCoords ? workerLat : null}
          workerLng={hasWorkerCoords ? workerLng : null}
        />
      ) : null}

      {inProgress && showTimer ? (
        <DutsCard className="gap-2 p-5">
          <Text className="text-sm font-bold uppercase text-orange">Live timer</Text>
          <Text className="text-4xl font-black text-ink">
            {hours}:{String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
          </Text>
          <Text className="text-sm text-muted">Estimated cost updates as work continues.</Text>
        </DutsCard>
      ) : inProgress && pricingType === "FIXED" ? (
        <DutsCard className="gap-1 p-5">
          <Text className="text-sm font-bold uppercase text-brand">Work in progress</Text>
          <Text className="text-sm text-muted">Fixed price — no timer running.</Text>
        </DutsCard>
      ) : null}

      <DutsCard className="gap-3 p-5">
        <Text className="text-sm font-bold uppercase tracking-wider text-teal">Booking summary</Text>
        <Text className="text-xl font-black text-ink">{gig.title}</Text>
        {gig.serviceCategory ? <Text className="text-muted">{gig.serviceCategory.name}</Text> : null}
        <Text className="text-3xl font-black text-brand">{formatCents(gig.totalCents)}</Text>
        <Text className="text-muted">{formatAddress(gig)}</Text>
        <Text className="text-muted">Scheduled: {new Date(gig.startsAt).toLocaleString()}</Text>
      </DutsCard>

      {worker?.phoneNumber ? (
        <LoadingButton
          label="Call worker"
          variant="secondary"
          onPress={() => void Linking.openURL(`tel:${worker.phoneNumber}`)}
        />
      ) : null}

      {completed ? (
        <View className="gap-3">
          <SuccessAnimation />
          <DutsCard className="gap-2 p-5">
            <Text className="text-sm text-muted">Final amount</Text>
            <Text className="text-3xl font-black text-brand">{formatMoney(gig.totalCents)}</Text>
            <Text className="text-sm text-muted">Thank you for booking with {APP_NAME}.</Text>
          </DutsCard>
          {worker ? (
            <LoadingButton
              label="Rate & review"
              onPress={() => navigation.navigate("Review", { gigId: gig.id, workerName: worker.fullName })}
            />
          ) : null}
        </View>
      ) : null}

      {canClientCancel(gig.status) ? (
        <LoadingButton
          label="Cancel booking"
          variant="cancel"
          onPress={() =>
            Alert.alert("Cancel booking?", "Cancellation may be subject to policy once a worker is assigned.", [
              { text: "Keep booking", style: "cancel" },
              { text: "Cancel booking", style: "destructive", onPress: () => cancelMutation.mutate() }
            ])
          }
          loading={cancelMutation.isPending}
        />
      ) : null}
    </ScrollView>
  );
}
