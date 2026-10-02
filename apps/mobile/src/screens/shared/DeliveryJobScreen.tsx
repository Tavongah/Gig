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
  isDeliveryCompleteUi,
  isDropoffPhase,
  isPickupPhase,
  isPostPickupDelivery,
  nextCourierDeliveryAction,
  transportModeEmoji,
  transportModeLabel
} from "../../lib/delivery-status";
import { formatCents } from "../../lib/format";
import { getCurrentCoordinates, friendlyLocationError } from "../../lib/location";
import { openExternalNavigation } from "../../lib/open-maps";
import { gigNeedsPayment } from "../../lib/gig-payment";
import { useStripeCheckout } from "../../hooks/useStripeCheckout";
import { ClientCancelBookingButton } from "../../components/ClientCancelBookingButton";
import { DutsCard } from "../../components/DutsCard";
import { DutsInlineBanner } from "../../components/DutsInlineBanner";
import { LoadingButton } from "../../components/LoadingButton";
import { StatusBadge } from "../../components/StatusBadge";
import { DUTS } from "../../lib/theme";
import { useSocket, useSocketEvents } from "../../hooks/useSocket";
import type { RootStackParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";
import { isSearching } from "../../lib/gig-status";
import { openSupportCall, openSupportSms, SUPPORT_EMAIL } from "../../lib/support";
import { shouldSilenceWorkerNotification } from "../../lib/commerce-notifications";

export function DeliveryJobScreen() {
  const session = useSessionStore((state) => state.session)!;
  const activeRole = useSessionStore((state) => state.activeRole);
  const route = useRoute<RouteProp<RootStackParamList, "DeliveryJob">>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const queryClient = useQueryClient();
  const [pin, setPin] = useState("");
  const [pinLocked, setPinLocked] = useState(false);
  const [releasePanel, setReleasePanel] = useState<"none" | "reasons" | "confirm">("none");
  const [problemPanel, setProblemPanel] = useState(false);
  const [releaseReason, setReleaseReason] = useState<
    "TRANSPORT" | "PERSONAL_EMERGENCY" | "SHOP_PROBLEM" | "CUSTOMER_PROBLEM" | "ROUTE_PROBLEM" | "OTHER"
  >("TRANSPORT");
  const [problemReason, setProblemReason] = useState<
    "SHOP_CLOSED" | "SHOP_CANNOT_FULFILL" | "ITEM_UNAVAILABLE" | "CANNOT_FIND_SHOP" | "CUSTOMER_UNREACHABLE" | "OTHER"
  >("SHOP_CLOSED");
  const [inlineError, setInlineError] = useState<{
    title: string;
    body: string;
    kind: "generic" | "location" | "too_far" | "uncertain";
  } | null>(null);
  const [inlineNotice, setInlineNotice] = useState<string | null>(null);

  const gigQuery = useQuery({
    queryKey: ["gig", route.params.gigId],
    queryFn: () => api.getGig(route.params.gigId, session.token),
    refetchInterval: 8_000
  });

  const gig = gigQuery.data?.gig;
  const courier = gig?.assignments?.[0]?.worker;
  const action = gig ? nextCourierDeliveryAction(gig.status) : null;
  const commercePickup = gig?.commercePickup;
  const assistedConfirmNeeded = Boolean(
    activeRole === "WORKER" &&
      gig?.assignedWorkerId === session.user.id &&
      commercePickup?.confirmationRequired &&
      gig?.status === "WORKER_ARRIVED"
  );
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
          if (shouldSilenceWorkerNotification(payload)) {
            invalidate();
            return;
          }
          invalidate();
        }
      }),
      [invalidate]
    )
  );

  const acceptMutation = useMutation({
    mutationFn: () => api.acceptGig(route.params.gigId, session.token),
    onSuccess: () => {
      setInlineError(null);
      setInlineNotice("Delivery accepted");
      invalidate();
    },
    onError: (error: Error) =>
      setInlineError({ title: "We couldn't continue", body: friendlyDeliveryError(error), kind: "generic" })
  });

  const actionMutation = useMutation({
    mutationFn: async () => {
      if (!action || !gig) return;
      const gigId = route.params.gigId;
      const token = session.token;

      if (action.kind === "arrive_pickup") {
        if (action.ensurePickupTravel || gig.status === "WORKER_ASSIGNED") {
          await api.startTravelToPickup(gigId, token);
        }
        const location = await getCurrentCoordinates();
        return api.arriveAtPickup(gigId, token, location);
      }
      if (action.kind === "verify_pickup") {
        if (!/^\d{4,6}$/.test(pin.trim())) throw new Error("Enter the pickup code from the shop.");
        return api.verifyPickupPin(gigId, token, pin.trim());
      }
      if (action.kind === "arrive_dropoff") {
        if (action.ensureDropoffTravel || gig.status === "PACKAGE_COLLECTED") {
          await api.startTravelToDropoff(gigId, token);
        }
        const location = await getCurrentCoordinates();
        return api.arriveAtDropoff(gigId, token, location);
      }
      if (action.kind === "verify_delivery") {
        if (!/^\d{4,6}$/.test(pin.trim())) throw new Error("Enter the delivery code from the customer.");
        const location = await getCurrentCoordinates().catch(() => undefined);
        return api.verifyDeliveryPin(gigId, token, pin.trim(), location);
      }
    },
    onSuccess: () => {
      setPin("");
      setPinLocked(false);
      setInlineError(null);
      invalidate();
    },
    onError: async (error: Error & { code?: string }) => {
      if (error.code === "PICKUP_PIN_LOCKED" || error.code === "DELIVERY_PIN_LOCKED") {
        setPinLocked(true);
      }
      if (
        error.code === "INVALID_STATUS_TRANSITION" ||
        /INVALID_STATUS_TRANSITION/i.test(error.message)
      ) {
        setInlineError(null);
        await invalidate();
        return;
      }
      const code = error.code ?? "";
      const locationFail = /location|gps|permission|geolocation/i.test(error.message) || code.startsWith("GPS_");
      if (code === "GPS_TOO_FAR") {
        setInlineError({
          title: "You're still too far from the pickup location.",
          body: "Move closer and try again.",
          kind: "too_far"
        });
        return;
      }
      if (code === "GPS_ARRIVAL_UNCERTAIN") {
        setInlineError({
          title: "We couldn't confirm your location.",
          body: "If you are at the shop, you can confirm you're there.",
          kind: "uncertain"
        });
        return;
      }
      if (locationFail) {
        setInlineError({
          title: "We couldn't confirm your location.",
          body: friendlyLocationError(error),
          kind: "location"
        });
        return;
      }
      setInlineError({
        title: "We couldn't continue",
        body: friendlyDeliveryError(error),
        kind: "generic"
      });
    }
  });

  const ensureTravelMutation = useMutation({
    mutationFn: async (phase: "pickup" | "dropoff") => {
      const gigId = route.params.gigId;
      const token = session.token;
      if (phase === "pickup") {
        if (gig?.status !== "WORKER_ASSIGNED") return null;
        return api.startTravelToPickup(gigId, token);
      }
      if (gig?.status !== "PACKAGE_COLLECTED") return null;
      return api.startTravelToDropoff(gigId, token);
    },
    onSuccess: () => invalidate(),
    onError: (error: Error) => {
      setInlineError({ title: "We couldn't continue", body: friendlyDeliveryError(error), kind: "generic" });
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
    onError: (error: Error) =>
      setInlineError({ title: "We couldn't continue", body: friendlyDeliveryError(error), kind: "generic" })
  });

  const assistedPickupMutation = useMutation({
    mutationFn: (outcome: "AVAILABLE" | "PROBLEM") =>
      api.confirmAssistedPickup(route.params.gigId, session.token, outcome),
    onSuccess: (_data, outcome) => {
      invalidate();
      if (outcome === "PROBLEM") {
        setInlineNotice("DUTS is checking this order. Do not collect it.");
      }
    },
    onError: (error: Error) =>
      setInlineError({ title: "We couldn't continue", body: friendlyDeliveryError(error), kind: "generic" })
  });

  const releaseMutation = useMutation({
    mutationFn: () =>
      api.releaseDelivery(route.params.gigId, { reason: releaseReason }, session.token),
    onSuccess: (result) => {
      setReleasePanel("none");
      invalidate();
      if (result.needsAttention) {
        setInlineNotice("You already collected this order. DUTS needs to help complete the delivery.");
        return;
      }
      setInlineNotice("DUTS will find another courier. The customer order stays confirmed.");
      navigation.reset({ index: 0, routes: [{ name: "MainTabs" }] });
    },
    onError: (error: Error) => {
      setInlineError({
        title: "We couldn't update this delivery.",
        body: friendlyDeliveryError(error) || "Please try again.",
        kind: "generic"
      });
    }
  });

  const problemMutation = useMutation({
    mutationFn: () =>
      api.reportDeliveryProblem(route.params.gigId, { reason: problemReason }, session.token),
    onSuccess: () => {
      setProblemPanel(false);
      invalidate();
      setInlineNotice("DUTS is checking this delivery.");
    },
    onError: (error: Error) =>
      setInlineError({ title: "We couldn't continue", body: friendlyDeliveryError(error), kind: "generic" })
  });

  function openMaps(lat?: string | number | null, lng?: string | number | null, label?: string): void {
    void openExternalNavigation(lat, lng, label).catch(() => {
      setInlineError({ title: "We couldn't continue", body: "Couldn't open maps. Please try again.", kind: "generic" });
    });
  }

  async function openPickupDirections(): Promise<void> {
    if (!gig) return;
    if (gig.status === "WORKER_ASSIGNED" && !ensureTravelMutation.isPending) {
      try {
        await ensureTravelMutation.mutateAsync("pickup");
      } catch {
        /* inline error in onError */
      }
    }
    const label = gig.locationSummary || `${gig.city}, ${gig.region}`;
    openMaps(gig.latitude, gig.longitude, label);
  }

  async function openDropoffDirections(): Promise<void> {
    if (!gig) return;
    if (gig.status === "PACKAGE_COLLECTED" && !ensureTravelMutation.isPending) {
      try {
        await ensureTravelMutation.mutateAsync("dropoff");
      } catch {
        /* inline error in onError */
      }
    }
    const label =
      gig.dropoffFormattedAddress ||
      (gig.dropoffCity ? `${gig.dropoffCity}${gig.dropoffRegion ? `, ${gig.dropoffRegion}` : ""}` : "Drop-off");
    openMaps(gig.dropoffLatitude, gig.dropoffLongitude, label);
  }

  async function confirmNearbyArrival(): Promise<void> {
    if (!gig || !action) return;
    setInlineError(null);
    try {
      const location = await getCurrentCoordinates();
      if (action.kind === "arrive_pickup") {
        if (action.ensurePickupTravel || gig.status === "WORKER_ASSIGNED") {
          await api.startTravelToPickup(route.params.gigId, session.token);
        }
        await api.arriveAtPickup(route.params.gigId, session.token, { ...location, confirmNearby: true });
      } else if (action.kind === "arrive_dropoff") {
        if (action.ensureDropoffTravel || gig.status === "PACKAGE_COLLECTED") {
          await api.startTravelToDropoff(route.params.gigId, session.token);
        }
        await api.arriveAtDropoff(route.params.gigId, session.token, { ...location, confirmNearby: true });
      }
      invalidate();
    } catch (error) {
      const code = (error as Error & { code?: string }).code ?? "";
      if (code === "GPS_TOO_FAR") {
        setInlineError({
          title: "You're still too far from the pickup location.",
          body: "Move closer and try again.",
          kind: "too_far"
        });
        return;
      }
      setInlineError({
        title: "We couldn't confirm your location.",
        body: friendlyLocationError(error),
        kind: "location"
      });
    }
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
    !pinLocked &&
    !(action?.kind === "verify_pickup" && assistedConfirmNeeded);

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

      {inlineError ? (
        <DutsInlineBanner
          title={inlineError.title}
          body={inlineError.body}
          tone="error"
          actions={[
            {
              label: "Try again",
              onPress: () => {
                setInlineError(null);
                if (action) actionMutation.mutate();
              },
              variant: "primary",
              loading: actionMutation.isPending
            },
            ...(inlineError.kind === "uncertain"
              ? [
                  {
                    label: isDropoffPhase(gig.status) ? "I'm at the customer" : "I'm at the shop",
                    onPress: () => void confirmNearbyArrival()
                  }
                ]
              : []),
            ...(inlineError.kind === "location" || inlineError.kind === "uncertain" || inlineError.kind === "too_far"
              ? [
                  {
                    label: "Get directions",
                    onPress: () =>
                      void (isDropoffPhase(gig.status) ? openDropoffDirections() : openPickupDirections())
                  }
                ]
              : [])
          ]}
        />
      ) : null}

      {inlineNotice ? <DutsInlineBanner title={inlineNotice} tone="success" /> : null}

      <DutsCard className="gap-3 p-5">
        <Row label="Pickup" value={pickupArea} />
        <Row label="Drop-off" value={dropoffArea} />
        <Row label="Package" value={`${packageLabel}${gig.packageDescription ? ` · ${gig.packageDescription}` : ""}`} />
        {gig.estimatedDistanceKm != null ? (
          <Row label="Distance" value={`${Number(gig.estimatedDistanceKm).toFixed(1)} km`} />
        ) : null}
        {activeRole === "WORKER" && commercePickup?.paymentLabel ? (
          <>
            <Row label="Payment" value={commercePickup.paymentLabel} />
            {commercePickup.paid ? (
              <Text className="text-sm font-semibold text-ink">Do not collect cash.</Text>
            ) : (
              <Text className="text-sm font-semibold text-ink">
                Collect {formatCents(commercePickup.collectCents ?? gig.totalCents)}
              </Text>
            )}
          </>
        ) : null}
        {activeRole === "CLIENT" ? (
          <Row label="Delivery fee" value={formatCents(gig.totalCents)} />
        ) : null}
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

      {activeRole === "CLIENT" && isSearching(gig.status) && !commercePickup ? (
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
          {isPickupPhase(gig.status) ? (
            <>
              <Text className="text-xs font-bold uppercase text-brand">Pickup</Text>
              {commercePickup?.headline ? (
                <Text className="text-sm font-extrabold text-ink">{commercePickup.headline}</Text>
              ) : null}
              {commercePickup?.currentLabel ? (
                <Text className="text-base font-black text-ink">{commercePickup.currentLabel}</Text>
              ) : null}
              {commercePickup?.stops?.length ? (
                <>
                  {commercePickup.stops.map((s) => (
                    <Text key={`${s.sequence}-${s.shopName}`} className="text-sm text-ink">
                      {s.status === "COLLECTED" ? "✓" : s.current ? "→" : "○"} {s.shopName}
                    </Text>
                  ))}
                  <Text className="text-sm text-ink">○ Customer</Text>
                </>
              ) : (
                <Text className="text-xl font-black text-ink">{pickupArea}</Text>
              )}
              {gig.pickupContactName ? <Row label="Shop contact" value={gig.pickupContactName} /> : null}
              {gig.pickupInstructions ? <Row label="Notes" value={gig.pickupInstructions} /> : null}
          {commercePickup?.pickupCount && commercePickup.pickupCount > 1 ? (
            <Text className="text-sm font-semibold text-ink">
              {commercePickup.currentLabel ?? `Pickup ${(commercePickup.pickupIndex ?? 1)} of ${commercePickup.pickupCount}`}
            </Text>
          ) : null}
          {gig.status === "WORKER_ASSIGNED" || gig.status === "WORKER_EN_ROUTE" ? (
                <LoadingButton
                  label={commercePickup && (commercePickup.pickupCount ?? 1) > 1 ? "Directions to next pickup" : "Directions to shop"}
                  variant="secondary"
                  loading={ensureTravelMutation.isPending}
                  onPress={() => void openPickupDirections()}
                />
              ) : null}
            </>
          ) : null}

          {isDropoffPhase(gig.status) ? (
            <>
              <Text className="text-xs font-bold uppercase text-brand">Drop-off</Text>
              {commercePickup?.stops?.length ? (
                <>
                  {commercePickup.stops.map((s) => (
                    <Text key={`done-${s.sequence}-${s.shopName}`} className="text-sm text-ink">
                      ✓ {s.shopName}
                    </Text>
                  ))}
                  <Text className="text-base font-black text-ink">→ Customer</Text>
                </>
              ) : null}
              <Text className="text-xl font-black text-ink">{dropoffArea}</Text>
              {gig.dropoffContactName ? <Row label="Customer" value={gig.dropoffContactName} /> : null}
              {gig.dropoffInstructions ? <Row label="Notes" value={gig.dropoffInstructions} /> : null}
              {gig.status === "PACKAGE_COLLECTED" || gig.status === "EN_ROUTE_TO_DROPOFF" ? (
                <LoadingButton
                  label="Directions to customer"
                  variant="secondary"
                  loading={ensureTravelMutation.isPending}
                  onPress={() => void openDropoffDirections()}
                />
              ) : null}
            </>
          ) : null}

          {isDeliveryCompleteUi(gig.status) ? (
            <>
              <Text className="text-xl font-black text-ink">✓ Delivery complete</Text>
              {commercePickup ? null : (
                <Row
                  label="Earnings"
                  value={formatCents(gig.workerPayoutCents ?? gig.totalCents)}
                />
              )}
              <LoadingButton
                label="Done"
                onPress={() => navigation.reset({ index: 0, routes: [{ name: "MainTabs" }] })}
              />
            </>
          ) : null}
        </DutsCard>
      ) : null}

      {activeRole === "WORKER" && gig.assignedWorkerId === session.user.id && commercePickup ? (
        <DutsCard className="gap-3 p-5">
          <Text className="text-xs font-bold uppercase text-brand">Pickup from</Text>
          <Text className="text-xl font-black text-ink">{commercePickup.shopName}</Text>
          <Text className="text-xs font-bold uppercase text-brand">Shopping list</Text>
          {commercePickup.items.map((item) => (
            <Text key={`${item.name}-${item.quantity}`} className="text-base text-ink">
              {item.quantity}× {item.name}
            </Text>
          ))}
          {commercePickup.warning ? (
            <Text className="text-sm font-semibold text-ink">{commercePickup.warning}</Text>
          ) : null}
          {commercePickup.problemReported ? (
            <Text className="text-sm font-semibold text-ink">
              Problem reported. DUTS is checking this order. Do not collect it.
            </Text>
          ) : null}
          {assistedConfirmNeeded ? (
            <>
              <Text className="text-base font-bold text-ink">Items available as ordered?</Text>
              <LoadingButton
                label="Items confirmed — continue"
                loading={assistedPickupMutation.isPending}
                onPress={() => assistedPickupMutation.mutate("AVAILABLE")}
              />
              <LoadingButton
                label="Report a problem"
                variant="secondary"
                loading={assistedPickupMutation.isPending}
                onPress={() => assistedPickupMutation.mutate("PROBLEM")}
              />
            </>
          ) : null}
        </DutsCard>
      ) : null}

      {needsPin ? (
        <DutsCard className="gap-3 p-5">
          <Text className="text-sm font-bold text-ink">
            {action?.kind === "verify_pickup"
              ? "Enter pickup code"
              : "Enter delivery code"}
          </Text>
          <Text className="text-sm text-muted">
            {action?.kind === "verify_pickup"
              ? "Ask the shop for the code."
              : "Ask the customer for the code."}
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
          <Text className="font-bold text-orange">Code locked</Text>
          <Text className="text-sm text-ink">
            Too many incorrect attempts. Ask the customer to regenerate codes or contact support.
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
            onPress={() => acceptMutation.mutate()}
            loading={acceptMutation.isPending}
            loadingLabel="Accepting…"
          />
        ) : null}

        {activeRole === "WORKER" &&
        gig.assignedWorkerId === session.user.id &&
        action &&
        !pinLocked &&
        !isDeliveryCompleteUi(gig.status) &&
        !(action.kind === "verify_pickup" && assistedConfirmNeeded) ? (
          <LoadingButton
            label={action.label}
            loading={actionMutation.isPending}
            loadingLabel={"requiresGps" in action && action.requiresGps ? "Confirming location…" : "Updating…"}
            onPress={() => {
              setInlineError(null);
              actionMutation.mutate();
            }}
          />
        ) : null}

        {activeRole === "WORKER" &&
        gig.assignedWorkerId === session.user.id &&
        !isDeliveryCompleteUi(gig.status) &&
        !isSearching(gig.status) ? (
          <View className="mt-4 gap-3">
            <LoadingButton
              label="Report a problem"
              variant="secondary"
              onPress={() => setProblemPanel(true)}
            />
            <LoadingButton
              label="Can't complete delivery"
              variant="secondary"
              onPress={() => setReleasePanel("reasons")}
            />
          </View>
        ) : null}

        {activeRole === "WORKER" && problemPanel ? (
          <DutsCard className="gap-3 p-5">
            <Text className="text-lg font-black text-ink">Report a problem</Text>
            {(
              [
                ["SHOP_CLOSED", "Shop closed"],
                ["SHOP_CANNOT_FULFILL", "Shop cannot fulfill order"],
                ["ITEM_UNAVAILABLE", "Item unavailable"],
                ["CANNOT_FIND_SHOP", "Cannot find shop"],
                ["CUSTOMER_UNREACHABLE", "Customer unreachable"],
                ["OTHER", "Other"]
              ] as const
            ).map(([id, label]) => (
              <LoadingButton
                key={id}
                label={`${problemReason === id ? "● " : "○ "}${label}`}
                variant={problemReason === id ? "primary" : "secondary"}
                onPress={() => setProblemReason(id)}
              />
            ))}
            <LoadingButton
              label="Submit"
              loading={problemMutation.isPending}
              onPress={() => problemMutation.mutate()}
            />
            <LoadingButton label="Go back" variant="secondary" onPress={() => setProblemPanel(false)} />
          </DutsCard>
        ) : null}

        {activeRole === "WORKER" && releasePanel !== "none" ? (
          <DutsCard className="gap-3 p-5">
            {releasePanel === "reasons" ? (
              <>
                <Text className="text-lg font-black text-ink">Can't complete this delivery?</Text>
                {(
                  [
                    ["TRANSPORT", "Transport problem"],
                    ["PERSONAL_EMERGENCY", "Personal emergency"],
                    ["SHOP_PROBLEM", "Shop problem"],
                    ["CUSTOMER_PROBLEM", "Customer problem"],
                    ["ROUTE_PROBLEM", "Too far / route problem"],
                    ["OTHER", "Other"]
                  ] as const
                ).map(([id, label]) => (
                  <LoadingButton
                    key={id}
                    label={`${releaseReason === id ? "● " : "○ "}${label}`}
                    variant={releaseReason === id ? "primary" : "secondary"}
                    onPress={() => setReleaseReason(id)}
                  />
                ))}
                <LoadingButton label="Continue" onPress={() => setReleasePanel("confirm")} />
                <LoadingButton label="Go back" variant="secondary" onPress={() => setReleasePanel("none")} />
              </>
            ) : isPostPickupDelivery(gig.status) ? (
              <>
                <Text className="text-lg font-black text-ink">You already collected this order.</Text>
                <Text className="text-sm text-ink">DUTS needs to help complete the delivery.</Text>
                <LoadingButton
                  label="Report and get help"
                  loading={releaseMutation.isPending}
                  onPress={() => releaseMutation.mutate()}
                />
                <LoadingButton label="Go back" variant="secondary" onPress={() => setReleasePanel("none")} />
              </>
            ) : (
              <>
                <Text className="text-lg font-black text-ink">Release this delivery?</Text>
                <Text className="text-sm text-ink">DUTS will find another courier. The customer order stays confirmed.</Text>
                <LoadingButton
                  label="Release delivery"
                  loading={releaseMutation.isPending}
                  onPress={() => releaseMutation.mutate()}
                />
                <LoadingButton label="Keep delivery" variant="secondary" onPress={() => setReleasePanel("none")} />
              </>
            )}
          </DutsCard>
        ) : null}

        {activeRole === "CLIENT" ? (
          <LoadingButton
            label="Messages"
            variant="secondary"
            onPress={() => navigation.navigate("Chat", { gigId: gig.id, title: gig.title })}
          />
        ) : null}

        {activeRole === "CLIENT" && canCancelDelivery(gig.status) ? (
          <ClientCancelBookingButton gig={gig} label="Cancel delivery" />
        ) : null}

        {activeRole === "CLIENT" && isPostPickupDelivery(gig.status) ? (
          <DutsCard className="gap-3 p-4">
            <Text className="text-center text-sm text-muted">
              Need help with this delivery? Ordinary cancellation is not available after pickup.
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
