import { useEffect } from "react";
import { Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { api } from "../../lib/api";
import { Screen } from "../../components/Screen";
import { DutsCard } from "../../components/DutsCard";
import { AppButton } from "../../components/AppButton";
import { useSessionStore } from "../../stores/session.store";
import type { RootStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "PaymentSuccess">;

export function PaymentSuccessScreen({ navigation, route }: Props) {
  const session = useSessionStore((state) => state.session)!;
  const gigId = route.params?.gigId ?? "";

  const paymentStatusQuery = useQuery({
    queryKey: ["payment-status", gigId],
    queryFn: () => api.getPaymentStatus(gigId, session.token),
    enabled: Boolean(gigId),
    refetchInterval: 2000
  });

  useEffect(() => {
    if ((paymentStatusQuery.data?.payment.isAuthorized || paymentStatusQuery.data?.payment.isPaid) && gigId) {
      const timer = setTimeout(() => navigation.replace("GigTracking", { gigId }), 1200);
      return () => clearTimeout(timer);
    }
  }, [paymentStatusQuery.data?.payment.isAuthorized, paymentStatusQuery.data?.payment.isPaid, gigId, navigation]);

  return (
    <Screen>
      <View className="gap-5">
        <DutsCard className="gap-4 p-5">
          <Text className="text-2xl font-black text-ink">Payment received</Text>
          <Text className="text-sm text-muted">
            Stripe confirmed your payment. We are activating your gig and matching workers.
          </Text>
          <Text className="text-sm text-brand">
            {paymentStatusQuery.data?.payment.lifecycleStatus ?? "Confirming payment..."}
          </Text>
          {gigId ? (
            <AppButton label="Go to live tracking" onPress={() => navigation.replace("GigTracking", { gigId })} />
          ) : null}
        </DutsCard>
      </View>
    </Screen>
  );
}
