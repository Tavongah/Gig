import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { useRoute } from "@react-navigation/native";
import { api } from "../../lib/api";
import { showAlert, showConfirm, showPrompt } from "../../lib/confirm";
import { formatAddress, formatCents } from "../../lib/format";
import { isSearching, nextWorkerAction } from "../../lib/gig-status";
import { ClientCancelBookingButton } from "../../components/ClientCancelBookingButton";
import { getCurrentCoordinates } from "../../lib/location";
import { gigNeedsPayment } from "../../lib/gig-payment";
import { useStripeCheckout } from "../../hooks/useStripeCheckout";
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

  const { payWithStripe, isPaying } = useStripeCheckout();

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
        showAlert(payload.title, payload.body);
      },
        "location:updated": (payload: { latitude: number; longitude: number }) => {
          setWorkerLocation({ latitude: payload.latitude, longitude: payload.longitude });
        }
      }),
      [invalidate]
    )
  );

  const statusMutation = useMutation({
    mutationFn: async ({
      status,
      requiresLocation
    }: {
      status: string;
      requiresLocation?: boolean;
    }) => {
      const needsGps =
        requiresLocation || status === "WORKER_EN_ROUTE" || status === "WAITING_CUSTOMER_CONFIRMATION";
      const location = needsGps ? await getCurrentCoordinates() : undefined;
      const result = await api.updateGigStatus(route.params.gigId, status, session.token, location);
      return { result, status, location };
    },
    onSuccess: ({ status, location }) => {
      invalidate();
      if (status === "WORKER_EN_ROUTE" && location && socket) {
        socket.emit("location:update", {
          gigId: route.params.gigId,
          latitude: location.latitude,
          longitude: location.longitude
        });
      }
    },
    onError: (error: Error) => showAlert("Update failed", error.message)
  });

  const acceptMutation = useMutation({
    mutationFn: () => api.acceptGig(route.params.gigId, session.token),
    onSuccess: () => {
      invalidate();
      navigation.replace("WorkerMatching", { gigId: route.params.gigId });
    },
    onError: (error: Error) => showAlert("Could not accept", error.message)
  });

  const workerCancelMutation = useMutation({
    mutationFn: (reason: string) => api.cancelGigByWorker(route.params.gigId, reason, session.token),
    onSuccess: (result) => {
      invalidate();
      showAlert(
        result.rematching ? "Gig cancelled" : "Gig interrupted",
        result.rematching
          ? "You cancelled this gig. The customer is being matched with another worker."
          : "This gig was sent to support for review."
      );
      navigation.reset({ index: 0, routes: [{ name: "MainTabs" }] });
    },
    onError: (error: Error) => showAlert("Could not cancel", error.message)
  });

  function confirmAccept(): void {
    if (!gig) return;
    showConfirm("Accept this gig?", "Are you sure you want to accept this gig?", () => acceptMutation.mutate(), {
      confirmLabel: "Accept"
    });
  }

  function confirmWorkerCancel(): void {
    const arrivedOrLater = gig?.status === "WORKER_ARRIVED" || gig?.status === "IN_PROGRESS";
    showConfirm(
      "Cancel this gig?",
      arrivedOrLater
        ? "Cancelling after arrival requires a clear reason. The customer will be notified."
        : "The customer will be matched with another worker. You will return to Home.",
      () => {
        showPrompt(
          "Cancellation reason",
          arrivedOrLater
            ? "Please explain why you need to cancel after arriving."
            : "Tell the customer why you need to cancel.",
          (reason) => workerCancelMutation.mutate(reason),
          { confirmLabel: "Cancel gig", placeholder: "Reason" }
        );
      },
      { confirmLabel: "Continue", destructive: true }
    );
  }

  useEffect(() => {
    if (
      activeRole === "CLIENT" &&
      gig?.status === "COMPLETED" &&
      worker &&
      !hasReview &&
      !reviewsQuery.isLoading
    ) {
      showConfirm(
        "Leave a review?",
        `Tell us how ${worker.fullName} did on this gig. Reviews are optional.`,
        () => {
          navigation.navigate("Review", { gigId: gig.id, workerName: worker.fullName });
        },
        {
          confirmLabel: "Leave a Review",
          cancelLabel: "Skip",
          onCancel: () => navigation.reset({ index: 0, routes: [{ name: "MainTabs" }] })
        }
      );
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

      <StatusTimeline status={gig.status} paymentStatus={gig.paymentStatus} />

      <DutsCard className="gap-3 p-5">
        <Text className="text-lg font-black text-ink">{formatCents(gig.totalCents)}</Text>
        <Text className="text-muted">{gig.description}</Text>
        <Text className="text-muted">{formatAddress(gig)}</Text>
        {gig.distanceLabel || gig.distanceMiles != null ? (
          <Text className="text-sm font-semibold text-brand">
            {gig.distanceLabel ?? `${gig.distanceMiles} mi away`}
          </Text>
        ) : null}
        {gig.addressHidden ? (
          <Text className="text-xs text-muted">Full street address unlocks after you accept this gig.</Text>
        ) : null}
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
        {activeRole === "CLIENT" && gigNeedsPayment(gig) ? (
          <LoadingButton
            label={isPaying ? "Opening Stripe..." : "Pay with Stripe"}
            onPress={() => payWithStripe(gig.id)}
            loading={isPaying}
          />
        ) : null}

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
          <LoadingButton
            label="Accept gig"
            onPress={confirmAccept}
            loading={acceptMutation.isPending}
          />
        ) : null}

        {activeRole === "WORKER" && workerAction ? (
          <LoadingButton
            label={workerAction.label}
            loadingLabel={
              workerAction.requiresLocation ||
              workerAction.next === "WORKER_EN_ROUTE" ||
              workerAction.next === "WAITING_CUSTOMER_CONFIRMATION"
                ? "Getting location..."
                : "Updating..."
            }
            onPress={() =>
              statusMutation.mutate({
                status: workerAction.next,
                requiresLocation: workerAction.requiresLocation
              })
            }
            loading={statusMutation.isPending}
          />
        ) : null}

        {activeRole === "CLIENT" ? <ClientCancelBookingButton gig={gig} label="Cancel Gig" /> : null}

        {activeRole === "WORKER" &&
        gig.assignedWorkerId === userId &&
        ["WORKER_SELECTED", "WORKER_ASSIGNED", "WORKER_EN_ROUTE", "WORKER_ARRIVED", "IN_PROGRESS"].includes(
          gig.status
        ) ? (
          <LoadingButton
            label="Cancel this gig"
            variant="cancel"
            onPress={confirmWorkerCancel}
            loading={workerCancelMutation.isPending}
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
