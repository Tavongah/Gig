import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Linking, ScrollView, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { customerJourneyHeadline, formatMoney, haversineMiles, isCustomerRematching, liveTrackingWorkerStatus, resolveCustomerJourneyStage } from "@gigflow/shared";
import { api } from "../../lib/api";
import { formatAddress, formatCents } from "../../lib/format";
import { clientCancelMayIncurFee, isSearching, needsClientReview, showTrackingMap } from "../../lib/gig-status";
import { SearchingIndicator } from "../../components/SearchingIndicator";
import { AssignedWorkerCard } from "../../components/AssignedWorkerCard";
import { TrackingMap } from "../../components/TrackingMap";
import { StatusBadge } from "../../components/StatusBadge";
import { LoadingButton } from "../../components/LoadingButton";
import { DutsCard } from "../../components/DutsCard";
import { SuccessAnimation } from "../../components/SuccessAnimation";
import { CustomerJourneyProgress } from "../../components/CustomerJourneyProgress";
import { ClientCancelBookingButton } from "../../components/ClientCancelBookingButton";
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
        gig_rematching: (payload: { gigId?: string }) => {
          invalidate();
          if (payload.gigId === route.params.gigId) {
            navigation.replace("GigSelectWorkers", { gigId: route.params.gigId });
          }
        },
        selected_worker_cancelled: (payload: { gigId?: string; rematching?: boolean }) => {
          invalidate();
          if (payload.gigId === route.params.gigId && payload.rematching !== false) {
            Alert.alert(
              "Finding another worker",
              "Your previous worker cancelled. We’re searching for another available worker nearby."
            );
            navigation.replace("GigSelectWorkers", { gigId: route.params.gigId });
          }
        },
        "location:updated": (payload: { latitude: number; longitude: number }) => {
          setWorkerLocation({ latitude: payload.latitude, longitude: payload.longitude });
        },
        notification: (payload: { title: string; body: string }) => {
          Alert.alert(payload.title, payload.body);
        }
      }),
      [invalidate, navigation, route.params.gigId]
    )
  );

  useEffect(() => {
    if (!gig || gig.status !== "CANCELLED") return;
    navigation.reset({ index: 0, routes: [{ name: "MainTabs" }] });
  }, [gig?.status, navigation]);

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
        <Text className="text-ink">{gigQuery.isLoading ? "Opening tracking…" : "Gig not found"}</Text>
      </View>
    );
  }

  const searching = isSearching(gig.status);
  const rematching = isCustomerRematching(gig.status, gig.paymentStatus, gig.payment?.status);
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

      {gig.status === "WORKER_EN_ROUTE" && gig.cancellationGraceEndsAt ? (
        <DutsCard className="gap-1 p-4">
          <Text className="text-sm font-black text-ink">
            {clientCancelMayIncurFee(gig) ? "Free cancellation ended" : "Free cancellation window"}
          </Text>
          <Text className="text-sm text-muted">
            {clientCancelMayIncurFee(gig)
              ? "Cancelling now will charge a cancellation fee that goes to your worker."
              : `Cancel free until ${new Date(gig.cancellationGraceEndsAt).toLocaleTimeString()}.`}
          </Text>
        </DutsCard>
      ) : null}

      {arrived ? (
        <View className="rounded-4xl border border-success/30 bg-verified px-5 py-5">
          <Text className="text-center text-lg font-black text-verified-text">Your worker has arrived</Text>
        </View>
      ) : null}

      {searching ? (
        <View className="gap-3">
          <SearchingIndicator
            title={rematching ? "Finding another worker" : "Matching workers near you..."}
            message={
              rematching
                ? "Your previous worker cancelled. We’re searching for another available worker nearby."
                : "Your request was sent to nearby verified workers who can accept or submit offers."
            }
          />
          <LoadingButton
            label="View worker offers"
            onPress={() => navigation.navigate("GigSelectWorkers", { gigId: gig.id })}
          />
        </View>
      ) : null}

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

      <ClientCancelBookingButton gig={gig} />
    </ScrollView>
  );
}
