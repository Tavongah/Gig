import { Linking, Platform } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { api } from "../lib/api";
import { showAlert } from "../lib/confirm";
import type { RootStackParamList } from "../navigation/types";
import { useSessionStore } from "../stores/session.store";

export function useStripeCheckout() {
  const session = useSessionStore((state) => state.session)!;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const configQuery = useQuery({
    queryKey: ["stripe-config"],
    queryFn: () => api.getStripeConfig()
  });

  const checkoutMutation = useMutation({
    mutationFn: (gigId: string) => api.createCheckoutSession(gigId, session.token),
    onSuccess: async (result, gigId) => {
      if (result.alreadyPaid) {
        navigation.navigate("GigTracking", { gigId });
        return;
      }
      if (result.checkoutUrl) {
        await Linking.openURL(result.checkoutUrl);
        return;
      }
      showAlert("Stripe checkout", "Could not open Stripe checkout. Try again.");
    },
    onError: (error: Error) => showAlert("Payment failed", error.message)
  });

  function payWithStripe(gigId: string): void {
    if (!configQuery.data?.stripeConfigured) {
      navigation.navigate("GigPayment", { gigId });
      return;
    }
    if (Platform.OS === "web") {
      navigation.navigate("GigPayment", { gigId });
      return;
    }
    checkoutMutation.mutate(gigId);
  }

  return {
    stripeConfigured: configQuery.data?.stripeConfigured ?? false,
    isPaying: checkoutMutation.isPending,
    payingGigId: checkoutMutation.variables ?? null,
    payWithStripe
  };
}
