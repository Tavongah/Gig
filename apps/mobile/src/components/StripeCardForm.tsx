import { Text, View } from "react-native";
import { AppButton } from "./AppButton";

interface StripeCardFormProps {
  publishableKey: string;
  clientSecret: string;
  amountLabel: string;
  onSuccess: () => void;
  onError: (message: string) => void;
  onUseCheckout?: () => void;
}

export function StripeCardForm({ amountLabel, onUseCheckout }: StripeCardFormProps) {
  return (
    <View className="gap-3 rounded-3xl border border-border bg-surface p-4">
      <Text className="text-sm text-muted">
        In-app card entry is available on web. On mobile, continue in Stripe Checkout.
      </Text>
      {onUseCheckout ? (
        <AppButton label={`Pay ${amountLabel} with Stripe`} onPress={onUseCheckout} />
      ) : null}
    </View>
  );
}
