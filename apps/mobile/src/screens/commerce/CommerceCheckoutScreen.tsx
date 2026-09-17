import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { AppButton } from "../../components/AppButton";
import { api } from "../../lib/api";
import { DUTS } from "../../lib/theme";
import type { RootStackParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";
import { useShopLocationStore } from "../../stores/shop-location.store";
import { useCommerceCartStore } from "../../stores/commerce-cart.store";

type Props = NativeStackScreenProps<RootStackParamList, "CommerceCheckout">;
type PayMethod = "CASH" | "ECOCASH" | "ONEMONEY";

export function CommerceCheckoutScreen({ navigation }: Props) {
  const token = useSessionStore((s) => s.session!.token);
  const user = useSessionStore((s) => s.session!.user);
  const location = useShopLocationStore((s) => s.location);
  const lines = useCommerceCartStore((s) => s.lines);
  const merchantName = useCommerceCartStore((s) => s.merchantName);
  const clear = useCommerceCartStore((s) => s.clear);
  const [method, setMethod] = useState<PayMethod>("CASH");
  const [error, setError] = useState("");

  const checkoutMut = useMutation({
    mutationFn: async () => {
      if (!location) throw new Error("Set delivery location first.");
      if (!lines.length) throw new Error("Your cart is empty.");
      return api.commerceCheckout(
        {
          lat: location.latitude,
          lng: location.longitude,
          deliveryLabel: location.label,
          lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
          paymentMethod: method,
          customerPhone: user.phoneNumber ?? undefined
        },
        token
      );
    },
    onSuccess: (res) => {
      clear();
      navigation.replace("CommerceOrderDetail", { orderId: res.order.id });
    },
    onError: (e: Error) => setError(e.message)
  });

  return (
    <ScrollView className="flex-1 bg-background px-5" contentContainerStyle={{ paddingBottom: 40, paddingTop: 12 }}>
      <Text className="text-2xl font-black text-ink">Checkout</Text>
      <Text className="mt-2 text-base text-muted">Shop: {merchantName}</Text>
      <Text className="mt-1 text-base text-muted">Deliver to: {location?.label ?? "—"}</Text>

      <Text className="mt-6 text-lg font-extrabold text-ink">Payment</Text>
      {(["CASH", "ECOCASH", "ONEMONEY"] as const).map((m) => (
        <Pressable
          key={m}
          onPress={() => setMethod(m)}
          className="mt-2 rounded-2xl border px-4 py-3.5"
          style={{
            borderColor: method === m ? DUTS.purple : DUTS.border,
            backgroundColor: method === m ? "#F5F0FF" : DUTS.card
          }}
          accessibilityRole="radio"
          accessibilityState={{ selected: method === m }}
          accessibilityLabel={m === "CASH" ? "Cash on delivery" : m}
        >
          <Text className="font-bold text-ink">
            {m === "CASH" ? "Cash on delivery" : m === "ECOCASH" ? "EcoCash" : "OneMoney"}
          </Text>
        </Pressable>
      ))}
      <Text className="mt-3 text-xs text-muted">
        Mobile money is confirmed only after the provider reports payment. Cash is due on delivery.
      </Text>

      {error ? <Text className="mt-4 text-sm text-danger">{error}</Text> : null}

      <View className="mt-6">
        <AppButton
          label={checkoutMut.isPending ? "Placing order…" : "Place order"}
          onPress={() => checkoutMut.mutate()}
          disabled={checkoutMut.isPending || !lines.length}
          loading={checkoutMut.isPending}
        />
      </View>
    </ScrollView>
  );
}
