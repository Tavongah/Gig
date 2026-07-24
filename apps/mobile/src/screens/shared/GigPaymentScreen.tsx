import { useEffect, useRef, useState } from "react";
import { Linking, Platform, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { formatMoney, formatHourlyRateLabel, isTimeBasedPricing } from "@gigflow/shared";
import { api, apiUrl } from "../../lib/api";
import { showAlert } from "../../lib/confirm";
import { Screen } from "../../components/Screen";
import { DutsCard } from "../../components/DutsCard";
import { AppButton } from "../../components/AppButton";
import { CustomerJourneyProgress } from "../../components/CustomerJourneyProgress";
import { useSessionStore } from "../../stores/session.store";
import type { RootStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "GigPayment">;

const FRIENDLY_PAYMENT_ERROR =
  "We couldn’t prepare the secure payment. Please try again or contact DUTS Support.";

function LineItem({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className="text-sm text-muted">{label}</Text>
      <Text className="text-sm font-semibold text-ink">{value}</Text>
    </View>
  );
}

function toFriendlyPaymentMessage(message: string): string {
  if (/sk_(test|live)_|REPLACE_|Invalid API Key|STRIPE_/i.test(message)) {
    return FRIENDLY_PAYMENT_ERROR;
  }
  return message || FRIENDLY_PAYMENT_ERROR;
}

export function GigPaymentScreen({ navigation, route }: Props) {
  const session = useSessionStore((state) => state.session)!;
  const { gigId, workerId: routeWorkerId } = route.params;
  const openingCheckout = useRef(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const gigQuery = useQuery({
    queryKey: ["gig", gigId],
    queryFn: () => api.getGig(gigId, session.token)
  });

  const gig = gigQuery.data?.gig;
  const workerId = routeWorkerId ?? gig?.assignments?.[0]?.worker?.id;

  const summaryQuery = useQuery({
    queryKey: ["worker-selection-summary", gigId, workerId],
    queryFn: () => api.getWorkerSelectionSummary(gigId, workerId!, session.token),
    enabled: Boolean(workerId)
  });

  const configQuery = useQuery({
    queryKey: ["stripe-config"],
    queryFn: () => api.getStripeConfig()
  });

  const checkoutMutation = useMutation({
    mutationFn: () => api.createCheckoutSession(gigId, session.token),
    onSuccess: async (result) => {
      openingCheckout.current = false;
      setCheckoutError(null);
      if (result.alreadyPaid) {
        navigation.replace("GigTracking", { gigId });
        return;
      }
      if (result.checkoutUrl) {
        if (Platform.OS === "web" && typeof window !== "undefined") {
          window.location.assign(result.checkoutUrl);
          return;
        }
        const opened = await Linking.openURL(result.checkoutUrl);
        if (!opened) {
          setCheckoutError("Unable to open Stripe Checkout. Allow pop-ups, then try again.");
        }
        return;
      }
      setCheckoutError(FRIENDLY_PAYMENT_ERROR);
    },
    onError: (error: Error) => {
      openingCheckout.current = false;
      const message = toFriendlyPaymentMessage(error.message);
      setCheckoutError(message);
      showAlert("Payment failed", message);
    }
  });

  const devPublishMutation = useMutation({
    mutationFn: () => api.authorizeGigWithoutStripe(gigId, session.token),
    onSuccess: () => navigation.replace("GigTracking", { gigId })
  });

  const paymentStatusQuery = useQuery({
    queryKey: ["payment-status", gigId],
    queryFn: () => api.getPaymentStatus(gigId, session.token),
    refetchInterval: 3000
  });

  const summary = summaryQuery.data;
  const stripeReady = configQuery.data?.stripeConfigured;
  const paymentConfirmed =
    paymentStatusQuery.data?.payment.isAuthorized || paymentStatusQuery.data?.payment.isPaid;

  useEffect(() => {
    if (paymentConfirmed) {
      navigation.replace("GigTracking", { gigId });
    }
  }, [paymentConfirmed, gigId, navigation]);

  const pricing = summary?.pricing;
  const worker = summary?.worker;
  const checkoutBusy = checkoutMutation.isPending || openingCheckout.current;
  const pricingType = summary?.gig.pricingType ?? gig?.pricingType ?? "FIXED";
  const timed = isTimeBasedPricing(pricingType);
  const maxAuthorized = pricing?.maximumAuthorizedAmountCents ?? pricing?.estimatedTotalCents;
  const bufferCents = pricing?.authorizationBufferCents ?? 0;
  const hourlyRate = pricing?.hourlyRateCents;
  const billingIncrement = pricing?.billingIncrementMinutes ?? summary?.gig.billingIncrementMinutes ?? 15;

  const startCheckout = () => {
    if (checkoutBusy) return;
    openingCheckout.current = true;
    setCheckoutError(null);
    checkoutMutation.mutate();
  };

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 32 }}>
        <View className="gap-2">
          <Text className="text-2xl font-black text-ink">
            {timed ? "Confirm Payment Method" : "Confirm and Pay"}
          </Text>
          <Text className="text-sm text-muted">
            {timed
              ? "Your card will be authorized for the displayed maximum amount. Your final charge will be based on the approved work time after the gig is completed."
              : "You will be charged the displayed total to confirm your booking. The worker is paid after the gig is completed."}
          </Text>
        </View>

        {gig ? (
          <CustomerJourneyProgress status={gig.status} paymentStatus={gig.paymentStatus} compact />
        ) : null}

        <DutsCard className="gap-3 p-5">
          <Text className="text-sm font-bold uppercase tracking-wider text-brand">Booking details</Text>
          {gig ? <LineItem label="Service" value={gig.serviceCategory?.name ?? gig.title} /> : null}
          {worker ? <LineItem label="Worker" value={worker.fullName} /> : null}
          {pricing ? (
            <>
              {timed && hourlyRate != null ? (
                <LineItem label="Hourly Rate" value={formatHourlyRateLabel(hourlyRate)} />
              ) : null}
              {summary?.gig.estimatedHours ? (
                <LineItem
                  label="Estimated duration"
                  value={`${summary.gig.estimatedHours} hr${summary.gig.estimatedHours === 1 ? "" : "s"}`}
                />
              ) : null}
              <LineItem
                label="Service"
                value={formatMoney(pricing.serviceAmountCents ?? pricing.estimatedTotalCents - (pricing.taxAmountCents ?? pricing.taxCents ?? 0))}
              />
              {(pricing.taxAmountCents ?? pricing.taxCents ?? 0) > 0 ? (
                <LineItem label="Tax" value={formatMoney(pricing.taxAmountCents ?? pricing.taxCents ?? 0)} />
              ) : null}
              <LineItem
                label={timed ? "Estimated total" : "Total"}
                value={formatMoney(pricing.totalChargedCents ?? pricing.estimatedTotalCents)}
              />
              {timed ? (
                <>
                  <LineItem label="Authorization buffer" value={formatMoney(bufferCents)} />
                  <LineItem
                    label="Maximum authorization"
                    value={formatMoney(maxAuthorized ?? pricing.totalChargedCents ?? pricing.estimatedTotalCents)}
                  />
                  <LineItem label="Billing increment" value={`${billingIncrement} minutes`} />
                  <Text className="pt-1 text-xs leading-4 text-muted">
                    Overtime requires your approval before additional billable time continues.
                  </Text>
                </>
              ) : null}
            </>
          ) : gig ? (
            <>
              <LineItem label="Service" value={formatMoney(gig.pricing?.serviceAmountCents ?? gig.totalCents)} />
              {(gig.pricing?.taxAmountCents ?? gig.taxCents ?? 0) > 0 ? (
                <LineItem label="Tax" value={formatMoney(gig.pricing?.taxAmountCents ?? gig.taxCents ?? 0)} />
              ) : null}
              <LineItem
                label="Total"
                value={formatMoney(gig.pricing?.totalChargedCents ?? gig.finalTotalCents ?? gig.totalCents)}
              />
            </>
          ) : null}
        </DutsCard>

        <DutsCard className="gap-2 border border-brand/20 bg-brand/5 p-4">
          <Text className="text-sm font-bold text-ink">Important</Text>
          <Text className="text-sm leading-5 text-muted">
            {timed
              ? `Your card will be authorized for up to ${formatMoney(maxAuthorized ?? pricing?.estimatedTotalCents ?? 0)}. You will only be charged for the final approved work time and applicable fees.`
              : "Your payment is collected securely when the booking is confirmed. The worker is paid after the gig is completed."}
          </Text>
        </DutsCard>

        {!stripeReady ? (
          <DutsCard className="gap-4 p-5">
            <Text className="text-sm text-danger">
              Secure payments are temporarily unavailable. Please try again later or contact DUTS Support.
            </Text>
            {apiUrl.includes("localhost") || apiUrl.includes("127.0.0.1") ? (
              <AppButton
                label={devPublishMutation.isPending ? "Continuing..." : "Continue without payment (dev only)"}
                variant="secondary"
                onPress={() => devPublishMutation.mutate()}
                disabled={devPublishMutation.isPending}
              />
            ) : null}
          </DutsCard>
        ) : null}

        {checkoutError ? <Text className="text-center text-sm text-danger">{checkoutError}</Text> : null}

        {stripeReady ? (
          <AppButton
            label={
              checkoutBusy
                ? "Opening secure checkout..."
                : timed
                  ? "Authorize Payment Securely"
                  : "Confirm & Pay Securely"
            }
            onPress={startCheckout}
            disabled={checkoutBusy}
          />
        ) : null}

        {Platform.OS === "web" && stripeReady ? (
          <Text className="text-center text-xs text-muted">
            You’ll complete payment in Stripe Checkout, then return to track your booking.
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
