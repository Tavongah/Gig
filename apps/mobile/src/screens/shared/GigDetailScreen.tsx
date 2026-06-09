import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { useRoute } from "@react-navigation/native";
import { api } from "../../lib/api";
import { formatAddress, formatCents } from "../../lib/format";
import { canClientCancel, isSearching, nextWorkerAction } from "../../lib/gig-status";
import { StatusTimeline } from "../../components/StatusTimeline";
import { StatusBadge } from "../../components/StatusBadge";
import { LoadingButton } from "../../components/LoadingButton";
import { DutsCard } from "../../components/DutsCard";
import { VerifiedBadge } from "../../components/VerifiedBadge";
import { DUTS } from "../../lib/theme";
import { useSocket, useSocketEvents } from "../../hooks/useSocket";
import type { RootStackParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";

export function GigDetailScreen() {
  const session = useSessionStore((state) => state.session)!;
  const userId = session.user.id;
  const activeRole = useSessionStore((state) => state.activeRole);
  const route = useRoute<RouteProp<RootStackParamList, "GigDetail">>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const queryClient = useQueryClient();
  const [workerLocation, setWorkerLocation] = useState<{ latitude: number; longitude: number } | null>(null);

  const gigQuery = useQuery({
    queryKey: ["gig", route.params.gigId],
    queryFn: () => api.getGig(route.params.gigId, session.token),
    refetchInterval: 10_000
  });

  const reviewsQuery = useQuery({
    queryKey: ["gig-reviews", route.params.gigId],
    queryFn: () => api.getGigReviews(route.params.gigId, session.token),
    enabled: gigQuery.data?.gig.status === "COMPLETED"
  });

  const gig = gigQuery.data?.gig;
  const worker = gig?.assignments?.[0]?.worker;
  const workerAction = gig ? nextWorkerAction(gig.status) : null;
  const hasReview = (reviewsQuery.data?.reviews ?? []).some((review) => review.reviewer?.id === userId);

  const socket = useSocket();

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
      "gig:matched": invalidate,
      "gig:assigned": invalidate,
      "gig:status": invalidate,
      notification: (payload: { title: string; body: string }) => {
        Alert.alert(payload.title, payload.body);
      },
        "location:updated": (payload: { latitude: number; longitude: number }) => {
          setWorkerLocation({ latitude: payload.latitude, longitude: payload.longitude });
        }
      }),
      [invalidate]
    )
  );

  const statusMutation = useMutation({
    mutationFn: (status: string) => api.updateGigStatus(route.params.gigId, status, session.token),
    onSuccess: (_data, status) => {
      invalidate();
      if (status === "WORKER_EN_ROUTE" && socket) {
        socket.emit("location:update", {
          gigId: route.params.gigId,
          latitude: 33.751,
          longitude: -84.39
        });
      }
    },
    onError: (error: Error) => Alert.alert("Update failed", error.message)
  });

  const cancelMutation = useMutation({
    mutationFn: () => api.cancelGig(route.params.gigId, session.token),
    onSuccess: () => {
      invalidate();
      Alert.alert("Gig cancelled", "This gig has been cancelled.");
    },
    onError: (error: Error) => Alert.alert("Could not cancel", error.message)
  });

  function confirmAccept(): void {
    if (!gig) return;
    Alert.alert("Accept this gig?", "Are you sure you want to accept this gig?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Accept",
        onPress: () => {
          api
            .acceptGig(gig.id, session.token)
            .then(() => invalidate())
            .catch((error: Error) => Alert.alert("Could not accept", error.message));
        }
      }
    ]);
  }

  function confirmCancel(): void {
    Alert.alert("Cancel gig?", "Are you sure you want to cancel this gig?", [
      { text: "Keep gig", style: "cancel" },
      { text: "Cancel gig", style: "destructive", onPress: () => cancelMutation.mutate() }
    ]);
  }

  useEffect(() => {
    if (
      activeRole === "CLIENT" &&
      gig?.status === "COMPLETED" &&
      worker &&
      !hasReview &&
      !reviewsQuery.isLoading
    ) {
      Alert.alert("Leave a review?", `Tell us how ${worker.fullName} did on this gig.`, [
        { text: "Later", style: "cancel" },
        {
          text: "Review",
          onPress: () => navigation.navigate("Review", { gigId: gig.id, workerName: worker.fullName })
        }
      ]);
    }
  }, [activeRole, gig?.id, gig?.status, hasReview, navigation, reviewsQuery.isLoading, worker]);

  if (!gig) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: DUTS.background }}>
        <Text className="text-ink">{gigQuery.isLoading ? "Loading gig..." : "Gig not found"}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: DUTS.background }}
      contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 16 }}
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-2">
          <Text className="text-sm font-bold uppercase tracking-[3px] text-brand">{gig.serviceCategory?.name ?? "Gig"}</Text>
          <Text className="text-3xl font-black text-ink">{gig.title}</Text>
        </View>
        <StatusBadge status={gig.status} />
      </View>

      <StatusTimeline status={gig.status} />

      <DutsCard className="gap-3 p-5">
        <Text className="text-lg font-black text-ink">{formatCents(gig.totalCents)}</Text>
        <Text className="text-muted">{gig.description}</Text>
        <Text className="text-muted">{formatAddress(gig)}</Text>
        <Text className="text-sm text-muted">Scheduled: {new Date(gig.startsAt).toLocaleString()}</Text>
        <Text className="text-sm font-semibold text-orange">Urgency: {gig.urgency}</Text>
        <View className="rounded-2xl bg-teal/10 px-3 py-2">
          <Text className="text-xs font-semibold text-teal">Payment status</Text>
          <Text className="text-sm text-ink">{gig.payment?.status ?? "Payment pending setup"}</Text>
        </View>
      </DutsCard>

      {worker ? (
        <DutsCard className="gap-2 p-5">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-bold uppercase tracking-wider text-brand">Assigned worker</Text>
            <VerifiedBadge />
          </View>
          <Text className="text-2xl font-black text-ink">{worker.fullName}</Text>
          {worker.phoneNumber ? (
            <Pressable onPress={() => void Linking.openURL(`tel:${worker.phoneNumber}`)}>
              <Text className="font-semibold text-brand">{worker.phoneNumber}</Text>
            </Pressable>
          ) : null}
        </DutsCard>
      ) : activeRole === "CLIENT" ? (
        <DutsCard className="border border-dashed border-slate-200 p-5">
          <Text className="text-center text-muted">Broadcasting to nearby workers...</Text>
        </DutsCard>
      ) : null}

      {workerLocation ? (
        <DutsCard className="bg-teal/10 p-5">
          <Text className="font-bold text-teal">Worker location updated</Text>
          <Text className="text-muted">
            {workerLocation.latitude.toFixed(4)}, {workerLocation.longitude.toFixed(4)}
          </Text>
        </DutsCard>
      ) : null}

      <View className="gap-3">
        <LoadingButton
          label={`Message ${activeRole === "CLIENT" ? "worker" : "client"}`}
          variant="secondary"
          onPress={() => navigation.navigate("Chat", { gigId: gig.id, title: gig.title })}
        />

        {activeRole === "CLIENT" && !isSearching(gig.status) ? (
          <LoadingButton
            label="Live tracking"
            onPress={() => navigation.navigate("GigTracking", { gigId: gig.id })}
          />
        ) : null}

        {activeRole === "CLIENT" && isSearching(gig.status) ? (
          <LoadingButton
            label="Track search"
            onPress={() => navigation.navigate("GigTracking", { gigId: gig.id })}
          />
        ) : null}

        {activeRole === "WORKER" && isSearching(gig.status) ? (
          <LoadingButton label="Accept gig" onPress={confirmAccept} />
        ) : null}

        {activeRole === "WORKER" && workerAction ? (
          <LoadingButton
            label={workerAction.label}
            onPress={() => statusMutation.mutate(workerAction.next)}
            loading={statusMutation.isPending}
          />
        ) : null}

        {activeRole === "CLIENT" && canClientCancel(gig.status) ? (
          <LoadingButton
            label="Cancel Gig"
            variant="cancel"
            onPress={confirmCancel}
            loading={cancelMutation.isPending}
          />
        ) : null}

        {activeRole === "CLIENT" && gig.status === "COMPLETED" && worker && !hasReview ? (
          <LoadingButton
            label="Leave a review"
            onPress={() => navigation.navigate("Review", { gigId: gig.id, workerName: worker.fullName })}
          />
        ) : null}
      </View>
    </ScrollView>
  );
}
