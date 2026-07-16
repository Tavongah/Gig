import { useEffect, useState } from "react";
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

const POLL_MS = 2000;
const MAX_WAIT_MS = 45_000;

export function PaymentSuccessScreen({ navigation, route }: Props) {
  const session = useSessionStore((state) => state.session)!;
  const gigId = route.params?.gigId ?? "";
  const [startedAt] = useState(() => Date.now());
  const [timedOut, setTimedOut] = useState(false);

  const paymentStatusQuery = useQuery({
    queryKey: ["payment-status", gigId],
    queryFn: () => api.getPaymentStatus(gigId, session.token),
    enabled: Boolean(gigId) && !timedOut,
    refetchInterval: (query) => {
      const paid = query.state.data?.payment.isPaid || query.state.data?.payment.isAuthorized;
      return paid ? false : POLL_MS;
    },
    retry: 2
  });

  const confirmed =
    Boolean(paymentStatusQuery.data?.payment.isPaid) || Boolean(paymentStatusQuery.data?.payment.isAuthorized);

  useEffect(() => {
    if (!gigId || confirmed) return;
    const timer = setInterval(() => {
      if (Date.now() - startedAt >= MAX_WAIT_MS) {
        setTimedOut(true);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [gigId, confirmed, startedAt]);

  useEffect(() => {
    if (confirmed && gigId) {
      const timer = setTimeout(() => navigation.replace("GigTracking", { gigId }), 1200);
      return () => clearTimeout(timer);
    }
  }, [confirmed, gigId, navigation]);

  let title = "Confirming your payment…";
  let body = "Please wait while we verify your payment with Stripe. Do not close this screen yet.";

  if (confirmed) {
    title = "Booking confirmed";
    body = "Your payment was received. We’re opening live tracking for your booking.";
  } else if (timedOut || paymentStatusQuery.isError) {
    title = "Payment still confirming";
    body =
      "Your payment is still being confirmed. You can safely close this screen and check My Gigs.";
  }

  return (
    <Screen>
      <View className="gap-5">
        <DutsCard className="gap-4 p-5">
          <Text className="text-2xl font-black text-ink">{title}</Text>
          <Text className="text-sm text-muted">{body}</Text>
          {gigId ? (
            <AppButton
              label={confirmed ? "Go to live tracking" : "Check My Gigs"}
              onPress={() =>
                confirmed ? navigation.replace("GigTracking", { gigId }) : navigation.navigate("MainTabs")
              }
            />
          ) : (
            <AppButton label="Go to My Gigs" onPress={() => navigation.navigate("MainTabs")} />
          )}
        </DutsCard>
      </View>
    </Screen>
  );
}
