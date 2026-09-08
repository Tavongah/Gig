import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Platform, KeyboardAvoidingView, ScrollView, Text, TextInput, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { packageCategoryLabels, type PackageCategory } from "@gigflow/shared";
import { api } from "../../lib/api";
import { friendlyDeliveryError } from "../../lib/delivery-errors";
import {
  canCancelDelivery,
  deliveryCourierStatusLabel,
  deliveryCustomerHeadline,
  deliveryCustomerStatusLabel,
  isPostPickupDelivery,
  nextCourierDeliveryAction,
  transportModeEmoji,
  transportModeLabel
} from "../../lib/delivery-status";
import { formatCents } from "../../lib/format";
import { getCurrentCoordinates, friendlyLocationError } from "../../lib/location";
import { openExternalNavigation } from "../../lib/open-maps";
import { showAlert, showConfirm } from "../../lib/confirm";
import { gigNeedsPayment } from "../../lib/gig-payment";
import { useStripeCheckout } from "../../hooks/useStripeCheckout";
import { ClientCancelBookingButton } from "../../components/ClientCancelBookingButton";
import { DutsCard } from "../../components/DutsCard";
import { LoadingButton } from "../../components/LoadingButton";
import { StatusBadge } from "../../components/StatusBadge";
import { DUTS } from "../../lib/theme";
import { useSocket, useSocketEvents } from "../../hooks/useSocket";
import type { RootStackParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";
import { isSearching } from "../../lib/gig-status";
import { openSupportCall, openSupportSms, SUPPORT_EMAIL } from "../../lib/support";

export function DeliveryJobScreen() {
  const session = useSessionStore((state) => state.session)!;
  const activeRole = useSessionStore((state) => state.activeRole);
  const route = useRoute<RouteProp<RootStackParamList, "DeliveryJob">>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const queryClient = useQueryClient();
  const [pin, setPin] = useState("");
  const [pinLocked, setPinLocked] = useState(false);

  const gigQuery = useQuery({
    queryKey: ["gig", route.params.gigId],
    queryFn: () => api.getGig(route.params.gigId, session.token),
    refetchInterval: 8_000
  });

  const gig = gigQuery.data?.gig;
  const courier = gig?.assignments?.[0]?.worker;
  const action = gig ? nextCourierDeliveryAction(gig.status) : null;
  const socket = useSocket();
  const { payWithStripe, isPaying } = useStripeCheckout();

  const invalidate = useCallback(() => {
    void gigQuery.refetch();
    void queryClient.invalidateQueries({ queryKey: ["my-gigs"] });
    void queryClient.invalidateQueries({ queryKey: ["nearby-gigs"] });
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
        notification: (payload: { title: string; body: string; type?: string }) => {
          if (payload.type === "NEW_MESSAGE") return;
          showAlert(payload.title, payload.body);
        }
      }),
      [invalidate]
    )
  );

  const acceptMutation = useMutation({
    mutationFn: () => api.acceptGig(route.params.gigId, session.token),
    onSuccess: () => {
      invalidate();
      showAlert("Interest sent", "Waiting for the customer to select you.");
    },
    onError: (error: Error) => showAlert("Could not accept", friendlyDeliveryError(error))
  });

  const actionMutation = useMutation({
    mutationFn: async () => {
      if (!action) return;
      const gigId = route.params.gigId;
      const token = session.token;

      if (action.kind === "start_pickup_travel") {
        return api.startTravelToPickup(gigId, token);
      }
      if (action.kind === "arrive_pickup") {
        const location = await getCurrentCoordinates();
        return api.arriveAtPickup(gigId, token, location);
      }
      if (action.kind === "verify_pickup") {
        if (!/^\d{4,6}$/.test(pin.trim())) throw new Error("Enter the 4-digit pickup code.");
        return api.verifyPickupPin(gigId, token, pin.trim());
      }
      if (action.kind === "start_dropoff_travel") {
        return api.startTravelToDropoff(gigId, token);
      }
      if (action.kind === "arrive_dropoff") {
        const location = await getCurrentCoordinates();
        return api.arriveAtDropoff(gigId, token, location);
      }
      if (action.kind === "verify_delivery") {
        if (!/^\d{4,6}$/.test(pin.trim())) throw new Error("Enter the 4-digit delivery code.");
        const location = await getCurrentCoordinates().catch(() => undefined);
        return api.verifyDeliveryPin(gigId, token, pin.trim(), location);
      }
    },
    onSuccess: () => {
      setPin("");
      setPinLocked(false);
      invalidate();
    },
    onError: (error: Error & { code?: string }) => {
      if (error.code === "PICKUP_PIN_LOCKED" || error.code === "DELIVERY_PIN_LOCKED") {
        setPinLocked(true);
      }
      const locationMsg = /location|gps|permission|geolocation/i.test(error.message)
        ? friendlyLocationError(error)
        : friendlyDeliveryError(error);
      showAlert("Could not continue", locationMsg);
    }
  });

  const regenMutation = useMutation({
    mutationFn: () => api.regenerateDeliveryPins(route.params.gigId, session.token),
    onSuccess: (result) => {
      navigation.navigate("DeliveryPins", {
        gigId: route.params.gigId,
        pickupPin: result.secrets.pickupPin,
        deliveryPin: result.secrets.deliveryPin,
        replay: false
      });
    },
    onError: (error: Error) => showAlert("Could not regenerate", friendlyDeliveryError(error))
  });

  function openMaps(lat?: string | number | null, lng?: string | number | null, label?: string): void {
    void openExternalNavigation(lat, lng, label);
  }

  if (!gig) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: DUTS.background }}>
        <Text className="text-ink">{gigQuery.isLoading ? "Loading delivery…" : "Delivery not found"}</Text>
      </View>
    );
  }

  const packageLabel =
    gig.packageCategory && gig.packageCategory in packageCategoryLabels
      ? packageCategoryLabels[gig.packageCategory as PackageCategory]
      : gig.packageCategory ?? "Package";

  const pickupArea = gig.locationSummary || `${gig.city}, ${gig.region}`;
  const dropoffArea =
    gig.dropoffFormattedAddress ||
    (gig.dropoffCity ? `${gig.dropoffCity}${gig.dropoffRegion ? `, ${gig.dropoffRegion}` : ""}` : "Drop-off");

  const needsPin =
    activeRole === "WORKER" &&
    (action?.kind === "verify_pickup" || action?.kind === "verify_delivery") &&
    !pinLocked;

  return (
    <KeyboardAvoidingView
      className="flex-1"
      style={{ backgroundColor: DUTS.background, flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
    >
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: DUTS.background }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 14 }}
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text className="text-xs font-bold uppercase tracking-[2px] text-brand">Delivery</Text>
          <Text className="text-2xl font-black text-ink">
            {activeRole === "CLIENT"
              ? deliveryCustomerStatusLabel(gig.status)
              : deliveryCourierStatusLabel(gig.status)}
          </Text>
          <Text className="text-sm text-muted">
            {activeRole === "CLIENT"
              ? deliveryCustomerHeadline(gig.status)
              : gig.packageDescription ?? packageLabel}
          </Text>
        </View>
        <StatusBadge status={gig.status} fulfillmentType="DELIVERY" />
      </View>

      <DutsCard className="gap-3 p-5">
        <Row label="Pickup" value={pickupArea} />
        <Row label="Drop-off" value={dropoffArea} />
        <Row label="Package" value={`${packageLabel}${gig.packageDescription ? ` · ${gig.packageDescription}` : ""}`} />
        {gig.estimatedDistanceKm != null ? (
          <Row label="Distance" value={`${Number(gig.estimatedDistanceKm).toFixed(1)} km`} />
        ) : null}
        <Row
          label={activeRole === "WORKER" ? "You earn" : "Delivery fee"}
          value={formatCents(activeRole === "WORKER" ? gig.workerPayoutCents ?? gig.totalCents : gig.totalCents)}
        />
      </DutsCard>

      {activeRole === "CLIENT" && courier ? (
        <DutsCard className="gap-2 p-5">
          <Text className="text-xs font-bold uppercase text-brand">Your courier</Text>
          <Text className="text-xl font-black text-ink">{courier.fullName}</Text>
          {courier.workerProfile?.ratingAverage != null ? (
            <Text className="text-sm text-muted">Rating {Number(courier.workerProfile.ratingAverage).toFixed(1)}</Text>
          ) : null}
          {courier.workerProfile?.transportMode ? (
            <Text className="text-sm text-muted">
              {transportModeEmoji(courier.workerProfile.transportMode)}{" "}
              {transportModeLabel(courier.workerProfile.transportMode)}
            </Text>
          ) : null}
          {courier.phoneNumber ? (
            <LoadingButton
              label="Call courier"
              variant="secondary"
              onPress={() => void Linking.openURL(`tel:${courier.phoneNumber}`)}
            />
          ) : null}
        </DutsCard>
      ) : null}

      {activeRole === "CLIENT" && isSearching(gig.status) ? (
        <DutsCard className="gap-3 border border-dashed border-slate-200 p-5">
          <Text className="text-center font-semibold text-ink">Finding a courier near your pickup…</Text>
          <Text className="text-center text-sm text-muted">Keep your pickup and delivery codes ready.</Text>
          <LoadingButton
            label="View courier matches"
            onPress={() => navigation.navigate("GigSelectWorkers", { gigId: gig.id })}
          />
          <LoadingButton
            label="View or regenerate codes"
            variant="secondary"
            loading={regenMutation.isPending}
            onPress={() => regenMutation.mutate()}
          />
        </DutsCard>
      ) : null}

      {activeRole === "WORKER" && gig.assignedWorkerId === session.user.id ? (
        <DutsCard className="gap-3 p-5">
          {gig.status === "WORKER_ASSIGNED" || gig.status === "WORKER_EN_ROUTE" || gig.status === "WORKER_ARRIVED" ? (
            <>
              {gig.pickupContactName ? <Row label="Pickup contact" value={gig.pickupContactName} /> : null}
              {gig.pickupContactPhone ? (
                <LoadingButton
                  label="Call pickup contact"
                  variant="secondary"
                  onPress={() => void Linking.openURL(`tel:${gig.pickupContactPhone}`)}
                />
              ) : null}
              {gig.pickupInstructions ? <Row label="Instructions" value={gig.pickupInstructions} /> : null}
              <LoadingButton
                label="Open pickup in maps"
                variant="secondary"
                onPress={() => openMaps(gig.latitude, gig.longitude, "Pickup")}
              />
            </>
          ) : null}

          {gig.status === "PACKAGE_COLLECTED" ||
          gig.status === "EN_ROUTE_TO_DROPOFF" ||
          gig.status === "ARRIVED_AT_DROPOFF" ? (
            <>
              {gig.dropoffContactName ? <Row label="Recipient" value={gig.dropoffContactName} /> : null}
              {gig.dropoffContactPhone ? (
                <LoadingButton
                  label="Call recipient"
                  variant="secondary"
                  onPress={() => void Linking.openURL(`tel:${gig.dropoffContactPhone}`)}
                />
              ) : null}
              {gig.dropoffInstructions ? <Row label="Instructions" value={gig.dropoffInstructions} /> : null}
              <LoadingButton
                label="Open drop-off in maps"
                variant="secondary"
                onPress={() => openMaps(gig.dropoffLatitude, gig.dropoffLongitude, "Drop-off")}
              />
            </>
          ) : null}
        </DutsCard>
      ) : null}

      {needsPin ? (
        <DutsCard className="gap-3 p-5">
          <Text className="text-sm font-bold text-ink">
            {action?.kind === "verify_pickup"
              ? "Ask the sender for the Pickup PIN"
              : "Ask the recipient for the Delivery PIN"}
          </Text>
          <TextInput
            value={pin}
            onChangeText={setPin}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="••••"
            placeholderTextColor={DUTS.placeholder}
            className="rounded-2xl border border-border bg-surface px-4 py-4 text-center text-3xl font-black tracking-[10px] text-ink"
          />
        </DutsCard>
      ) : null}

      {pinLocked ? (
        <DutsCard className="gap-2 bg-orange/10 p-5">
          <Text className="font-bold text-orange">Verification locked</Text>
          <Text className="text-sm text-ink">
            Too many incorrect attempts. Ask the customer to regenerate the delivery codes or contact
            support.
          </Text>
        </DutsCard>
      ) : null}

      <View className="gap-3">
        {activeRole === "CLIENT" && gigNeedsPayment(gig) ? (
          <LoadingButton
            label={isPaying ? "Opening Stripe…" : "Pay to confirm courier"}
            onPress={() => payWithStripe(gig.id)}
            loading={isPaying}
          />
        ) : null}

        {activeRole === "WORKER" && isSearching(gig.status) ? (
          <LoadingButton
            label="Accept delivery"
            onPress={() =>
              showConfirm("Accept this delivery?", "Express interest so the customer can select you.", () =>
                acceptMutation.mutate()
              )
            }
            loading={acceptMutation.isPending}
          />
        ) : null}

        {activeRole === "WORKER" && action && !pinLocked ? (
          <LoadingButton
            label={action.label}
            loading={actionMutation.isPending}
            loadingLabel={"requiresGps" in action && action.requiresGps ? "Getting location…" : "Updating…"}
            onPress={() => actionMutation.mutate()}
          />
        ) : null}

        <LoadingButton
          label="Messages"
          variant="secondary"
          onPress={() => navigation.navigate("Chat", { gigId: gig.id, title: gig.title })}
        />

        {activeRole === "CLIENT" && canCancelDelivery(gig.status) ? (
          <ClientCancelBookingButton gig={gig} label="Cancel delivery" />
        ) : null}

        {activeRole === "CLIENT" && isPostPickupDelivery(gig.status) ? (
          <DutsCard className="gap-3 p-4">
            <Text className="text-center text-sm text-muted">
              Need help with this delivery? Ordinary cancellation is not available after the package was
              collected.
            </Text>
            <LoadingButton
              label="Call support"
              variant="secondary"
              onPress={() => void openSupportCall()}
            />
            <LoadingButton
              label="Text support"
              variant="secondary"
              onPress={() => void openSupportSms()}
            />
            <Text className="text-center text-xs text-muted">Or email {SUPPORT_EMAIL}</Text>
          </DutsCard>
        ) : null}

        {activeRole === "CLIENT" && gig.status === "WAITING_CUSTOMER_CONFIRMATION" ? (
          <LoadingButton
            label="Confirm delivery complete"
            onPress={() => navigation.navigate("GigCompletionReview", { gigId: gig.id })}
          />
        ) : null}

        {activeRole === "CLIENT" && !isSearching(gig.status) ? (
          <LoadingButton
            label="View or regenerate codes"
            variant="secondary"
            loading={regenMutation.isPending}
            onPress={() => regenMutation.mutate()}
          />
        ) : null}

        <LoadingButton
          label="Help / Support"
          variant="secondary"
          onPress={() => void openSupportCall()}
        />
      </View>

      {activeRole === "WORKER" && gig.offer?.distanceToPickupMiles != null ? (
        <Text className="text-center text-xs text-muted">
          About {(Number(gig.offer.distanceToPickupMiles) * 1.60934).toFixed(1)} km to pickup
        </Text>
      ) : null}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="gap-0.5">
      <Text className="text-xs font-bold uppercase text-muted">{label}</Text>
      <Text className="text-base font-semibold text-ink" numberOfLines={4}>
        {value}
      </Text>
    </View>
  );
}
