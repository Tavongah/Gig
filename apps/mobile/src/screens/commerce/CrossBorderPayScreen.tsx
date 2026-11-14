import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { api } from "../../lib/api";
import type { RootStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "CrossBorderPay">;

function money(cents: number): string {
  return `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function CrossBorderPayScreen({ route }: Props) {
  const quote = useQuery({
    queryKey: ["cross-border-pay", route.params.token],
    queryFn: () => api.crossBorderPayment(route.params.token)
  });
  const [phone, setPhone] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = quote.data as {
    reference?: string;
    currency?: string;
    totalCents?: number;
    payable?: boolean;
    quoteStatus?: string;
    lines?: Array<{ productName: string; quantity: number; size?: string | null; color?: string | null; lineTotalCents: number }>;
    charges?: Record<string, number | boolean | string | null>;
    methods?: { ecocash?: boolean; card?: boolean };
    paymentsEnabled?: boolean;
    paymentNotice?: string | null;
    cardUnavailableReason?: string;
    terms?: string;
  } | undefined;

  async function pay() {
    setError(null);
    if (!accepted) {
      setError("Accept the quotation before payment.");
      return;
    }
    try {
      await api.payCrossBorderEcoCash(route.params.token, phone);
      setMessage("EcoCash request sent. DUTS will purchase the items only after the payment provider confirms this amount.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment was not started.");
    }
  }

  if (quote.isLoading) return <Text className="p-5 text-ink">Loading quotation</Text>;
  if (quote.error || !data) return <Text className="p-5 text-ink">This payment link is not valid.</Text>;

  return (
    <ScrollView className="flex-1 bg-background" contentContainerStyle={{ padding: 20 }}>
      <Text className="text-xl font-extrabold text-ink">DUTS</Text>
      <Text className="mt-2 text-base font-bold text-ink">Quotation {data.reference}</Text>
      <Text className="mt-1 text-sm text-muted">Status {data.quoteStatus}. {data.paymentsEnabled === false ? "Payment is not yet available." : data.payable ? "Payment is open." : "This link cannot start a payment."}</Text>
      {(data.lines ?? []).map((line, index) => (
        <Text key={index} className="mt-3 text-sm text-ink">
          {line.quantity} x {line.productName}{line.size ? `, size ${line.size}` : ""}{line.color ? `, colour ${line.color}` : ""} · {money(line.lineTotalCents)}
        </Text>
      ))}
      <Text className="mt-4 text-lg font-extrabold text-ink">Total {money(data.totalCents ?? 0)} {data.currency}</Text>
      {data.charges?.customsIsEstimate ? <Text className="mt-2 text-sm text-muted">Customs on this quotation is an estimate, not a guaranteed all-inclusive price.</Text> : null}
      <Text className="mt-3 text-xs text-muted">{data.terms}</Text>
      {data.paymentsEnabled === false ? null : (
      <Pressable onPress={() => setAccepted((value) => !value)} className="mt-4">
        <Text className="text-sm text-ink">{accepted ? "✓ " : "○ "}I accept this quotation</Text>
      </Pressable>
      )}
      {data.paymentsEnabled !== false && data.methods?.ecocash ? (
        <View className="mt-4">
          <Text className="text-sm font-bold text-ink">EcoCash</Text>
          <TextInput value={phone} onChangeText={setPhone} placeholder="EcoCash number" className="mt-2 rounded-xl border border-border px-3 py-3" />
          <Pressable onPress={() => void pay()} className="mt-3 rounded-full bg-ink px-4 py-3">
            <Text className="text-center font-bold text-white">Pay with EcoCash</Text>
          </Pressable>
        </View>
      ) : null}
      {data.paymentsEnabled === false ? <Text className="mt-4 text-sm text-ink">Payment is not yet available.</Text> : null}
      {data.paymentsEnabled !== false && data.cardUnavailableReason ? <Text className="mt-4 text-sm text-muted">{data.cardUnavailableReason}</Text> : null}
      {message ? <Text className="mt-3 text-sm text-ink">{message}</Text> : null}
      {error ? <Text className="mt-3 text-sm text-red-700">{error}</Text> : null}
    </ScrollView>
  );
}
