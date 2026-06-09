import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, ScrollView, Text, View } from "react-native";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useNavigation, useRoute } from "@react-navigation/native";

import type { RouteProp } from "@react-navigation/native";

import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { haversineMiles } from "@gigflow/shared";

import { api } from "../../lib/api";

import { formatAddress, formatCents } from "../../lib/format";

import {

  canClientCancel,

  isSearching,

  showTrackingMap,

  statusHeadline,

  statusLabel

} from "../../lib/gig-status";

import { SearchingIndicator } from "../../components/SearchingIndicator";

import { AssignedWorkerCard } from "../../components/AssignedWorkerCard";

import { TrackingMap } from "../../components/TrackingMap";

import { StatusBadge } from "../../components/StatusBadge";

import { LoadingButton } from "../../components/LoadingButton";

import { DutsCard } from "../../components/DutsCard";

import { SuccessAnimation } from "../../components/SuccessAnimation";

import { useSocket, useSocketEvents } from "../../hooks/useSocket";

import type { RootStackParamList } from "../../navigation/types";

import { useSessionStore } from "../../stores/session.store";

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

    const startedAt = gig?.assignments?.[0]?.startedAt;

    if (!startedAt || gig?.status !== "IN_PROGRESS") {

      setElapsedSeconds(0);

      return;

    }

    const start = new Date(startedAt).getTime();

    const timer = setInterval(() => {

      setElapsedSeconds(Math.floor((Date.now() - start) / 1000));

    }, 1000);

    return () => clearInterval(timer);

  }, [gig?.assignments, gig?.status]);



  const cancelMutation = useMutation({

    mutationFn: () => api.cancelGig(route.params.gigId, session.token),

    onSuccess: () => {

      invalidate();

      Alert.alert("Gig cancelled", "Your gig has been cancelled.");

    },

    onError: (error: Error) => Alert.alert("Could not cancel", error.message)

  });



  const customerLat = Number(gig?.latitude ?? 33.749);

  const customerLng = Number(gig?.longitude ?? -84.388);

  const workerLat = workerLocation?.latitude ?? Number(workerProfile?.currentLatitude ?? NaN);

  const workerLng = workerLocation?.longitude ?? Number(workerProfile?.currentLongitude ?? NaN);

  const hasWorkerCoords = Number.isFinite(workerLat) && Number.isFinite(workerLng);

  const distanceMiles = hasWorkerCoords ? haversineMiles(workerLat, workerLng, customerLat, customerLng) : undefined;



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

  const completed = gig.status === "COMPLETED";



  return (

    <ScrollView

      className="flex-1"

      style={{ backgroundColor: DUTS.background }}

      contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 16 }}

    >

      <View className="flex-row items-start justify-between gap-3">

        <View className="flex-1 gap-2">

          <Text className="text-2xl font-black text-ink">{statusHeadline(gig.status)}</Text>

          <StatusBadge status={gig.status} />

        </View>

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



      {showMap ? (

        <TrackingMap

          customerLat={customerLat}

          customerLng={customerLng}

          workerLat={hasWorkerCoords ? workerLat : null}

          workerLng={hasWorkerCoords ? workerLng : null}

        />

      ) : null}



      <DutsCard className="gap-3 p-5">

        <Text className="text-sm font-bold uppercase tracking-wider text-teal">Gig summary</Text>

        <Text className="text-xl font-black text-ink">{gig.title}</Text>

        {gig.serviceCategory ? <Text className="text-muted">{gig.serviceCategory.name}</Text> : null}

        <Text className="text-3xl font-black text-brand">{formatCents(gig.totalCents)}</Text>

        <Text className="text-muted">{formatAddress(gig)}</Text>

        <Text className="text-muted">Requested: {new Date(gig.startsAt).toLocaleString()}</Text>

        <Text className="text-sm text-muted">Status: {statusLabel(gig.status)}</Text>

      </DutsCard>



      {gig.status === "IN_PROGRESS" && gig.assignments?.[0]?.startedAt ? (

        <DutsCard className="p-5">

          <Text className="text-sm font-bold uppercase text-orange">Elapsed time</Text>

          <Text className="text-4xl font-black text-ink">

            {Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, "0")}

          </Text>

        </DutsCard>

      ) : null}



      {completed ? (

        <View className="gap-3">

          <SuccessAnimation />

          <DutsCard className="p-5">

            <Text className="text-sm text-muted">Final amount</Text>

            <Text className="text-3xl font-black text-brand">{formatCents(gig.totalCents)}</Text>

          </DutsCard>

          {worker ? (

            <LoadingButton

              label="Leave a review"

              onPress={() => navigation.navigate("Review", { gigId: gig.id, workerName: worker.fullName })}

            />

          ) : null}

        </View>

      ) : null}



      {canClientCancel(gig.status) ? (

        <LoadingButton

          label="Cancel Gig"

          variant="cancel"

          onPress={() =>

            Alert.alert("Cancel gig?", "Are you sure you want to cancel this gig?", [

              { text: "Keep gig", style: "cancel" },

              { text: "Cancel gig", style: "destructive", onPress: () => cancelMutation.mutate() }

            ])

          }

          loading={cancelMutation.isPending}

        />

      ) : null}

    </ScrollView>

  );

}

