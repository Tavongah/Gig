import { useEffect } from "react";
import { Linking, Platform, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { formatMoney } from "@gigflow/shared";
import { api, apiUrl } from "../../lib/api";
import { showAlert } from "../../lib/confirm";
import { Screen } from "../../components/Screen";
import { DutsCard } from "../../components/DutsCard";
import { AppButton } from "../../components/AppButton";
import { StripeCardForm } from "../../components/StripeCardForm";
import { CustomerJourneyProgress } from "../../components/CustomerJourneyProgress";
import { useSessionStore } from "../../stores/session.store";
import type { RootStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "GigPayment">;

function LineItem({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className="text-sm text-muted">{label}</Text>
      <Text className="text-sm font-semibold text-ink">{value}</Text>
    </View>
  );
}

export function GigPaymentScreen({ navigation, route }: Props) {
  const session = useSessionStore((state) => state.session)!;
  const { gigId, workerId: routeWorkerId } = route.params;

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

  const paymentIntentQuery = useQuery({
    queryKey: ["payment-intent", gigId],
    queryFn: () => api.createPaymentIntent(gigId, session.token),
    enabled: Boolean(configQuery.data?.stripeConfigured)
  });

  const checkoutMutation = useMutation({
    mutationFn: () => api.createCheckoutSession(gigId, session.token),
    onSuccess: async (result) => {
      if (result.alreadyPaid) {
        navigation.replace("GigTracking", { gigId });
        return;
      }
      if (result.checkoutUrl) {
        await Linking.openURL(result.checkoutUrl);
      }
    },
    onError: (error: Error) => showAlert("Payment failed", error.message)
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
  const publishableKey = configQuery.data?.publishableKey;
  const clientSecret = paymentIntentQuery.data?.clientSecret;
  const paymentAuthorized =
    paymentStatusQuery.data?.payment.isAuthorized || paymentStatusQuery.data?.payment.isPaid;

  useEffect(() => {
    if (paymentAuthorized || paymentIntentQuery.data?.alreadyPaid) {
      navigation.replace("GigTracking", { gigId });
    }
  }, [paymentAuthorized, paymentIntentQuery.data?.alreadyPaid, gigId, navigation]);

  const pricing = summary?.pricing;
  const worker = summary?.worker;

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 32 }}>
        <View className="gap-2">
          <Text className="text-2xl font-black text-ink">Confirm your booking</Text>
          <Text className="text-sm text-muted">Secure your worker with a card authorization — not a charge.</Text>
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
              {summary?.gig.estimatedHours ? (
                <LineItem
                  label="Estimated duration"
                  value={`${summary.gig.estimatedHours} hr${summary.gig.estimatedHours === 1 ? "" : "s"}`}
                />
              ) : null}
              <View className="border-t border-border pt-3">
                <LineItem label="Estimated total" value={formatMoney(pricing.estimatedTotalCents)} />
              </View>
            </>
          ) : gig ? (
            <LineItem label="Estimated total" value={formatMoney(gig.totalCents)} />
          ) : null}
        </DutsCard>

        <DutsCard className="gap-2 border border-brand/20 bg-brand/5 p-4">
          <Text className="text-sm font-bold text-ink">Important</Text>
          <Text className="text-sm leading-5 text-muted">
            Your payment will only be captured after your gig is successfully completed.
          </Text>
        </DutsCard>

        {!stripeReady ? (
          <DutsCard className="gap-4 p-5">
            <Text className="text-sm text-danger">
              Stripe is not configured on the server. Add STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY to enable card
              payments.
            </Text>
            {apiUrl.includes("localhost") || apiUrl.includes("127.0.0.1") ? (
              <AppButton
                label={devPublishMutation.isPending ? "Authorizing..." : "Continue without payment (dev only)"}
                variant="secondary"
                onPress={() => devPublishMutation.mutate()}
                disabled={devPublishMutation.isPending}
              />
            ) : (
              <Text className="text-xs text-muted">
                Payment bypass is disabled for hosted environments. Configure Stripe before launch.
              </Text>
            )}
          </DutsCard>
        ) : null}

        {stripeReady && publishableKey && clientSecret && gig && (pricing || gig.totalCents) ? (
          <DutsCard className="gap-4 p-5">
            <StripeCardForm
              publishableKey={publishableKey}
              clientSecret={clientSecret}
              amountLabel={formatMoney(pricing?.estimatedTotalCents ?? gig.totalCents)}
              onSuccess={() => navigation.replace("GigTracking", { gigId })}
              onError={(message) => showAlert("Payment failed", message)}
              onUseCheckout={() => checkoutMutation.mutate()}
            />
          </DutsCard>
        ) : null}

        {stripeReady && paymentIntentQuery.isLoading ? (
          <Text className="text-center text-sm text-muted">Preparing secure checkout...</Text>
        ) : null}

        {paymentIntentQuery.error ? (
          <Text className="text-center text-sm text-danger">{paymentIntentQuery.error.message}</Text>
        ) : null}

        {stripeReady && Platform.OS !== "web" ? (
          <AppButton
            label={checkoutMutation.isPending ? "Opening Stripe..." : "Confirm & Secure Payment in Stripe"}
            variant="secondary"
            onPress={() => checkoutMutation.mutate()}
            disabled={checkoutMutation.isPending}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}
