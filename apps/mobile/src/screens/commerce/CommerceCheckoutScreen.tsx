import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
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
type PayMethod = "CASH" | "ECOCASH";

export function CommerceCheckoutScreen({ navigation }: Props) {
  const session = useSessionStore((s) => s.session);
  const token = session?.token;
  const user = session?.user;
  const location = useShopLocationStore((s) => s.location);
  const lines = useCommerceCartStore((s) => s.lines);
  const merchantName = useCommerceCartStore((s) => s.merchantName);
  const clear = useCommerceCartStore((s) => s.clear);
  const [method, setMethod] = useState<PayMethod>("CASH");
  const [ecoCashPhone, setEcoCashPhone] = useState(user?.phoneNumber ?? "");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session) navigation.replace("GuestCheckoutChoice");
  }, [session, navigation]);

  const checkoutMut = useMutation({
    mutationFn: async () => {
      if (!token || !user) throw new Error("Sign in to check out.");
      if (!location) throw new Error("Set delivery location first.");
      if (!lines.length) throw new Error("Your cart is empty.");
      return api.commerceCheckout(
        {
          lat: location.latitude,
          lng: location.longitude,
          deliveryLabel: location.label,
          lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
          paymentMethod: method,
          customerPhone: method === "ECOCASH" ? ecoCashPhone.trim() : user.phoneNumber ?? undefined
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

  if (!session || !token || !user) {
    return null;
  }

  if (!location) {
    return (
      <ScrollView className="flex-1 bg-background px-5" contentContainerStyle={{ paddingBottom: 40, paddingTop: 12 }}>
        <Text className="text-2xl font-black text-ink">Checkout</Text>
        <Text className="mt-4 text-base text-muted">
          Choose a delivery address so we can confirm the shop and delivery fee.
        </Text>
        <View className="mt-6">
          <AppButton label="Choose delivery location" onPress={() => navigation.navigate("ShopLocation")} />
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView className="flex-1 bg-background px-5" contentContainerStyle={{ paddingBottom: 40, paddingTop: 12 }}>
      <Text className="text-2xl font-black text-ink">Checkout</Text>
      <Text className="mt-2 text-base text-muted">
        {lines.length ? `${new Set(lines.map((l) => l.merchantId)).size > 1 ? `${new Set(lines.map((l) => l.merchantId)).size} shops` : merchantName}` : "Shop"}
      </Text>
      <Text className="mt-1 text-base text-muted">Deliver to: {location?.label ?? "—"}</Text>

      <Text className="mt-6 text-lg font-extrabold text-ink">Choose payment</Text>
      {(["ECOCASH", "CASH"] as const).map((m) => (
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
          accessibilityLabel={m === "CASH" ? "Cash on delivery" : "EcoCash USD"}
        >
          <Text className="font-bold text-ink">{m === "CASH" ? "Cash on delivery" : "EcoCash USD"}</Text>
        </Pressable>
      ))}
      {method === "ECOCASH" ? (
        <View className="mt-3">
          <Text className="mb-2 text-sm font-semibold text-ink">EcoCash number</Text>
          <TextInput
            value={ecoCashPhone}
            onChangeText={setEcoCashPhone}
            keyboardType="phone-pad"
            placeholder="0771234567"
            className="rounded-2xl border border-border bg-card px-4 py-3 text-base text-ink"
            accessibilityLabel="EcoCash number"
          />
        </View>
      ) : null}
      <Text className="mt-3 text-xs text-muted">
        EcoCash is confirmed only after payment is approved on your phone. Cash is due on delivery.
      </Text>

      {error ? <Text className="mt-4 text-sm text-danger">{error}</Text> : null}

      <View className="mt-6">
        <AppButton
          label={checkoutMut.isPending ? "Placing order…" : "Place order"}
          onPress={() => checkoutMut.mutate()}
          disabled={
            checkoutMut.isPending ||
            !lines.length ||
            (method === "ECOCASH" && !ecoCashPhone.trim())
          }
          loading={checkoutMut.isPending}
        />
      </View>
    </ScrollView>
  );
}
