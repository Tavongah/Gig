import { Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Screen } from "../../components/Screen";
import { DutsCard } from "../../components/DutsCard";
import { AppButton } from "../../components/AppButton";
import { useStripeCheckout } from "../../hooks/useStripeCheckout";
import type { RootStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "PaymentFailed">;

export function PaymentFailedScreen({ navigation, route }: Props) {
  const gigId = route.params?.gigId;
  const { payWithStripe, isPaying } = useStripeCheckout();

  return (
    <Screen>
      <View className="gap-5">
        <DutsCard className="gap-4 p-5">
          <Text className="text-2xl font-black text-ink">Payment not completed</Text>
          <Text className="text-sm text-muted">
            Your gig was saved, but Stripe payment was not completed. You can try again when you are ready.
          </Text>
          {gigId ? (
            <AppButton
              label={isPaying ? "Opening Stripe..." : "Pay with Stripe"}
              onPress={() => payWithStripe(gigId)}
              loading={isPaying}
              disabled={isPaying}
            />
          ) : null}
          <AppButton label="Back to home" variant="secondary" onPress={() => navigation.navigate("MainTabs")} />
        </DutsCard>
      </View>
    </Screen>
  );
}
