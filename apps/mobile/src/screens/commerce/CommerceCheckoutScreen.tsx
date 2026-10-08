import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { AppButton } from "../../components/AppButton";
import { api } from "../../lib/api";
import { friendlyCheckoutError, moneyLabel } from "../../lib/checkout-flow";
import { DUTS } from "../../lib/theme";
import type { RootStackParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";
import { useShopLocationStore } from "../../stores/shop-location.store";
import { cartLineKey, useCommerceCartStore } from "../../stores/commerce-cart.store";
import { toCheckoutLine } from "../../lib/storefront-cart";
import { formatFlavorCustomerLine } from "@gigflow/shared";

type Props = NativeStackScreenProps<RootStackParamList, "CommerceCheckout">;
type PayMethod = "CASH" | "ECOCASH";

export function CommerceCheckoutScreen({ navigation }: Props) {
  const session = useSessionStore((s) => s.session);
  const token = session?.token;
  const user = session?.user;
  const location = useShopLocationStore((s) => s.location);
  const lines = useCommerceCartStore((s) => s.lines);
  const clear = useCommerceCartStore((s) => s.clear);
  const [method, setMethod] = useState<PayMethod>("CASH");
  const [ecoCashPhone, setEcoCashPhone] = useState(user?.phoneNumber ?? "");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session) navigation.replace("GuestCheckoutChoice");
  }, [session, navigation]);

  useEffect(() => {
    if (session && !location && lines.length) {
      navigation.replace("ShopLocation", { next: "checkout" });
    }
  }, [session, location, lines.length, navigation]);

  const prepQuery = useQuery({
    queryKey: [
      "checkout-prep",
      location?.latitude,
      location?.longitude,
      location?.label,
      location?.locationMode,
      lines.map((l) => `${cartLineKey(l)}:${l.quantity}`).join(",")
    ],
    queryFn: () =>
      api.commerceCheckoutPrepare(
        {
          lat: location!.latitude,
          lng: location!.longitude,
          deliveryLabel: location!.label,
          locationMode: location!.locationMode,
          lines: lines.map(toCheckoutLine)
        },
        token
      ),
    enabled: Boolean(session && token && location && lines.length)
  });

  useEffect(() => {
    if (prepQuery.error) setError(friendlyCheckoutError((prepQuery.error as Error).message));
    else setError("");
  }, [prepQuery.error]);

  const checkoutMut = useMutation({
    mutationFn: async () => {
      if (!token || !user) throw new Error("Sign in to check out.");
      if (!location) throw new Error("Tell us where to deliver.");
      if (!lines.length) throw new Error("Your cart is empty.");
      return api.commerceCheckout(
        {
          lat: location.latitude,
          lng: location.longitude,
          deliveryLabel: location.label,
          locationMode: location.locationMode,
          lines: lines.map(toCheckoutLine),
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
    onError: (e: Error) => setError(friendlyCheckoutError(e.message))
  });

  if (!session || !token || !user) {
    return null;
  }

  if (!location) {
    return null;
  }

  const quote = prepQuery.data;
  const placing = checkoutMut.isPending;
  const ready = Boolean(quote) && !prepQuery.isFetching && !placing;
  const placeLabel = quote
    ? placing
      ? "Placing order…"
      : `PLACE ORDER • ${moneyLabel(quote.totalCents)}`
    : "PLACE ORDER";

  return (
    <View className="flex-1 bg-background">
      <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingBottom: 24, paddingTop: 12 }}>
        <Text className="text-2xl font-black text-ink">YOUR DUTS ORDER</Text>
        {quote ? (
          <Text className="mt-1 text-sm font-semibold text-muted">
            {quote.lines.reduce((n, l) => n + l.quantity, 0)} items
            {(quote.shopCount ?? 1) > 1 ? ` • ${quote.shopCount} shops` : ""}
          </Text>
        ) : null}
        {prepQuery.isFetching && !quote ? (
          <Text className="mt-4 text-base text-muted">Getting your order ready…</Text>
        ) : null}

        <View className="mt-5 rounded-2xl border border-border bg-card p-4">
          <Text className="text-sm font-semibold uppercase text-muted">Deliver to</Text>
          <Text className="mt-1 text-base font-bold text-ink">{location.label}</Text>
          <Pressable
            onPress={() => navigation.navigate("ShopLocation")}
            className="mt-2 self-start"
            accessibilityRole="button"
            accessibilityLabel="Change delivery location"
          >
            <Text className="text-sm font-bold" style={{ color: DUTS.purple }}>
              Change
            </Text>
          </Pressable>
        </View>

        <View className="mt-4 rounded-2xl border border-border bg-card p-4">
          <Text className="text-sm font-semibold uppercase text-muted">Items</Text>
          {quote
            ? quote.lines.map((line, idx) => (
                <View key={`${line.productId}-${line.flavorOptionId ?? "ANY"}-${idx}`} className="mt-3 flex-row justify-between">
                  <View className="flex-1 pr-3">
                    <Text className="text-base text-ink">
                      {line.quantity}× {line.productName}
                    </Text>
                    {formatFlavorCustomerLine(line.flavorPreference, line.flavorName) ? (
                      <Text className="text-xs text-muted">
                        {formatFlavorCustomerLine(line.flavorPreference, line.flavorName)}
                      </Text>
                    ) : null}
                  </View>
                  <Text className="text-base font-semibold text-ink">{moneyLabel(line.lineTotalCents)}</Text>
                </View>
              ))
            : lines.map((line) => (
                <View key={cartLineKey(line)} className="mt-3 flex-row justify-between">
                  <View className="flex-1 pr-3">
                    <Text className="text-base text-ink">
                      {line.quantity}× {line.name}
                    </Text>
                    {formatFlavorCustomerLine(line.flavorPreference, line.flavorName) ? (
                      <Text className="text-xs text-muted">
                        {formatFlavorCustomerLine(line.flavorPreference, line.flavorName)}
                      </Text>
                    ) : null}
                  </View>
                  <Text className="text-base font-semibold text-ink">
                    {moneyLabel(line.unitPriceCents * line.quantity)}
                  </Text>
                </View>
              ))}
        </View>

        {quote ? (
          <View className="mt-4 gap-1 rounded-2xl border border-border bg-surface p-4">
            <Text className="text-sm text-muted">Items          {moneyLabel(quote.subtotalCents)}</Text>
            <Text className="text-sm text-muted">Delivery       {moneyLabel(quote.deliveryFeeCents)}</Text>
            {quote.serviceFeeCents > 0 ? (
              <Text className="text-sm text-muted">Service        {moneyLabel(quote.serviceFeeCents)}</Text>
            ) : null}
            <Text className="mt-2 text-lg font-black text-ink">Total          {moneyLabel(quote.totalCents)}</Text>
          </View>
        ) : null}

        <Text className="mt-6 text-lg font-extrabold text-ink">Payment</Text>
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
            <Text className="mt-2 text-sm text-muted">Check your phone to approve payment.</Text>
          </View>
        ) : (
          <Text className="mt-3 text-sm text-muted">Pay when your order arrives.</Text>
        )}

        {error ? <Text className="mt-4 text-sm text-danger">{error}</Text> : null}
      </ScrollView>
      <View className="border-t border-border bg-background px-5 pb-5 pt-3">
        <AppButton
          label={placeLabel}
          onPress={() => {
            if (!ready || placing) return;
            checkoutMut.mutate();
          }}
          disabled={!ready || !lines.length || (method === "ECOCASH" && !ecoCashPhone.trim())}
          loading={placing}
        />
      </View>
    </View>
  );
}
