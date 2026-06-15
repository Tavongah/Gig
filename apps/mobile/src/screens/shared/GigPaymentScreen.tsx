import { useEffect } from "react";
import { Linking, Platform, Text, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { api } from "../../lib/api";
import { formatCents } from "../../lib/format";
import { Screen } from "../../components/Screen";
import { DutsCard } from "../../components/DutsCard";
import { AppButton } from "../../components/AppButton";
import { useSessionStore } from "../../stores/session.store";
import type { RootStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "GigPayment">;

export function GigPaymentScreen({ navigation, route }: Props) {
  const session = useSessionStore((state) => state.session)!;
  const { gigId } = route.params;

  const gigQuery = useQuery({
    queryKey: ["gig", gigId],
    queryFn: () => api.getGig(gigId, session.token)
  });

  const configQuery = useQuery({
    queryKey: ["stripe-config"],
    queryFn: () => api.getStripeConfig()
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
    }
  });

  const devPublishMutation = useMutation({
    mutationFn: () => api.publishGigWithoutPayment(gigId, session.token),
    onSuccess: () => navigation.replace("GigTracking", { gigId })
  });

  const paymentStatusQuery = useQuery({
    queryKey: ["payment-status", gigId],
    queryFn: () => api.getPaymentStatus(gigId, session.token),
    refetchInterval: 5000
  });

  useEffect(() => {
    if (paymentStatusQuery.data?.payment.isAuthorized || paymentStatusQuery.data?.payment.isPaid) {
      navigation.replace("GigTracking", { gigId });
    }
  }, [paymentStatusQuery.data?.payment.isAuthorized, paymentStatusQuery.data?.payment.isPaid, gigId, navigation]);

  const gig = gigQuery.data?.gig;
  const stripeReady = configQuery.data?.stripeConfigured;

  return (
    <Screen>
      <View className="gap-5">
        <DutsCard className="gap-4 p-5">
          <Text className="text-2xl font-black text-ink">Confirm & pay</Text>
          <Text className="text-sm text-muted">
            Your payment is authorized in Stripe before a worker starts. The platform fee uses tiered commission rates.
          </Text>
          {gig ? (
            <View className="rounded-2xl bg-surface p-4">
              <Text className="font-black text-ink">{gig.title}</Text>
              <Text className="mt-2 text-2xl font-black text-brand">{formatCents(gig.totalCents)}</Text>
              <Text className="text-xs text-muted">Worker receives {formatCents(gig.workerPayoutCents)} after completion</Text>
            </View>
          ) : null}
          {!stripeReady ? (
            <>
              <Text className="text-sm text-danger">
                Stripe is not configured on the server. Add STRIPE_SECRET_KEY to enable live payments.
              </Text>
              <AppButton
                label={devPublishMutation.isPending ? "Publishing..." : "Continue without payment (dev)"}
                variant="secondary"
                onPress={() => devPublishMutation.mutate()}
                disabled={devPublishMutation.isPending}
              />
            </>
          ) : null}
          {stripeReady ? (
            <AppButton
              label={checkoutMutation.isPending ? "Opening checkout..." : "Pay with Stripe"}
              onPress={() => checkoutMutation.mutate()}
              disabled={checkoutMutation.isPending}
            />
          ) : null}
          {checkoutMutation.error ? (
            <Text className="text-sm text-danger">{checkoutMutation.error.message}</Text>
          ) : null}
          <Text className="text-center text-xs text-muted">
            Status: {paymentStatusQuery.data?.payment.lifecycleStatus ?? "payment_pending"}
          </Text>
          {Platform.OS === "web" ? (
            <Text className="text-center text-xs text-muted">
              After paying in Stripe, return here — we will detect your payment automatically.
            </Text>
          ) : null}
        </DutsCard>
      </View>
    </Screen>
  );
}
