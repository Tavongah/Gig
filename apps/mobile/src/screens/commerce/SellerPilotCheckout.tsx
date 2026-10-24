import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { api } from "../../lib/api";
import { friendlyCheckoutError, moneyLabel } from "../../lib/checkout-flow";
import { DUTS } from "../../lib/theme";
import type { CartLine } from "../../stores/commerce-cart.store";
import { AppButton } from "../../components/AppButton";

type Location = {
  latitude: number;
  longitude: number;
  label: string;
};

export function SellerPilotCheckout(props: {
  line: CartLine;
  location: Location;
  token: string;
  contactName: string;
  contactPhone: string;
  onPlaced: () => void;
}) {
  const { line, location, token, contactName, contactPhone, onPlaced } = props;
  const [method, setMethod] = useState<"CASH" | "ECOCASH">("CASH");
  const [ecoCashPhone, setEcoCashPhone] = useState(contactPhone);
  const [error, setError] = useState("");
  const [placing, setPlacing] = useState(false);
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const [paymentLabel, setPaymentLabel] = useState<string | null>(null);

  async function place() {
    if (!line.sellerOfferId || placing) return;
    setPlacing(true);
    setError("");
    try {
      const result = await api.commercePilotPurchase(
        {
          offerId: line.sellerOfferId,
          quantity: line.quantity,
          expectedUnitPriceCents: line.unitPriceCents,
          dropoffLabel: location.label,
          dropoffLatitude: location.latitude,
          dropoffLongitude: location.longitude,
          dropoffContactName: contactName || "Customer",
          dropoffContactPhone: contactPhone || ecoCashPhone,
          paymentMethod: method,
          payerPhone: method === "ECOCASH" ? ecoCashPhone.trim() : undefined
        },
        token
      );
      setStatusLabel(result.purchase.statusLabel);
      setPaymentLabel(result.purchase.paymentLabel);
      onPlaced();
    } catch (err) {
      setError(friendlyCheckoutError(err instanceof Error ? err.message : "Could not place this order."));
    } finally {
      setPlacing(false);
    }
  }

  if (statusLabel) {
    return (
      <View className="flex-1 bg-background px-5 pt-8">
        <Text className="text-2xl font-black text-ink">YOUR DUTS ORDER</Text>
        <Text className="mt-4 text-lg font-bold text-ink">{statusLabel}</Text>
        {paymentLabel ? <Text className="mt-2 text-base text-muted">{paymentLabel}</Text> : null}
        <Text className="mt-4 text-base text-ink">
          {line.quantity}× {line.name}
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingBottom: 24, paddingTop: 12 }}>
        <Text className="text-2xl font-black text-ink">YOUR DUTS ORDER</Text>
        <View className="mt-5 rounded-2xl border border-border bg-card p-4">
          <Text className="text-sm font-semibold uppercase text-muted">Deliver to</Text>
          <Text className="mt-1 text-base font-bold text-ink">{location.label}</Text>
        </View>
        <View className="mt-4 rounded-2xl border border-border bg-card p-4">
          <Text className="text-base text-ink">
            {line.quantity}× {line.name}
          </Text>
          <Text className="mt-2 text-base font-semibold text-ink">{moneyLabel(line.unitPriceCents * line.quantity)}</Text>
          <Text className="mt-2 text-sm text-muted">Delivery is calculated with your location.</Text>
        </View>
        <Text className="mt-6 text-lg font-extrabold text-ink">Payment</Text>
        {(["ECOCASH", "CASH"] as const).map((item) => (
          <Pressable
            key={item}
            onPress={() => setMethod(item)}
            className="mt-2 rounded-2xl border px-4 py-3.5"
            accessibilityRole="radio"
            accessibilityState={{ selected: method === item }}
            accessibilityLabel={item === "CASH" ? "Cash on delivery" : "EcoCash USD"}
          >
            <Text className="font-bold text-ink">{item === "CASH" ? "Cash on delivery" : "EcoCash USD"}</Text>
          </Pressable>
        ))}
        {method === "ECOCASH" ? (
          <TextInput
            value={ecoCashPhone}
            onChangeText={setEcoCashPhone}
            keyboardType="phone-pad"
            placeholder="0771234567"
            className="mt-3 rounded-2xl border border-border bg-card px-4 py-3 text-base text-ink"
            accessibilityLabel="EcoCash number"
          />
        ) : (
          <Text className="mt-3 text-sm text-muted">Pay when your order arrives.</Text>
        )}
        {error ? <Text className="mt-4 text-sm text-danger">{error}</Text> : null}
      </ScrollView>
      <View className="border-t border-border bg-background px-5 pb-5 pt-3">
        <AppButton
          label={placing ? "Placing order…" : "PLACE ORDER"}
          onPress={() => void place()}
          disabled={placing || (method === "ECOCASH" && !ecoCashPhone.trim())}
          loading={placing}
        />
      </View>
    </View>
  );
}
