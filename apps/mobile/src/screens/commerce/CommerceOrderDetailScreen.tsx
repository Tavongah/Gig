import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { api } from "../../lib/api";
import { DUTS } from "../../lib/theme";
import type { RootStackParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";

type Props = NativeStackScreenProps<RootStackParamList, "CommerceOrderDetail">;

export function CommerceOrderDetailScreen({ route }: Props) {
  const token = useSessionStore((s) => s.session!.token);
  const query = useQuery({
    queryKey: ["commerce-order", route.params.orderId],
    queryFn: () => api.commerceOrder(route.params.orderId, token),
    refetchInterval: 15_000
  });
  const [payerPhone, setPayerPhone] = useState("");
  const [busy, setBusy] = useState(false);

  if (query.isLoading || !query.data) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={DUTS.purple} />
      </View>
    );
  }

  const payload = query.data;
  const { order } = payload;
  if (!order) {
    const quote = payload.priceProposed || payload.customerApproved;
    return (
      <View className="flex-1 bg-background px-5 pt-8">
        <Text className="text-2xl font-black text-ink">YOUR DUTS REQUEST</Text>
        <Text className="mt-3 text-base text-muted">
          {payload.message ?? "This request isn't ready for payment. We'll confirm the total first."}
        </Text>
        {quote && payload.lines?.length ? (
          <View className="mt-6 gap-2">
            {payload.lines.map((line) => (
              <Text key={`${line.name}-${line.quantity}`} className="text-base text-ink">
                {line.name} × {line.quantity} — ${((line.lineTotalCents ?? 0) / 100).toFixed(2)}
              </Text>
            ))}
            <Text className="text-base text-ink">Delivery — ${((payload.deliveryFeeCents ?? 0) / 100).toFixed(2)}</Text>
            <Text className="text-lg font-black text-ink">Total — ${((payload.totalCents ?? 0) / 100).toFixed(2)}</Text>
          </View>
        ) : null}
        {payload.priceProposed && payload.approvalId && payload.quoteVersion ? (
          <Pressable
            className="mt-6 rounded-2xl bg-brand px-4 py-3"
            disabled={busy}
            onPress={async () => {
              setBusy(true);
              try {
                await api.approveCommerceQuote(
                  route.params.orderId,
                  { approvalId: payload.approvalId!, quoteVersion: payload.quoteVersion! },
                  token
                );
                await query.refetch();
              } finally {
                setBusy(false);
              }
            }}
          >
            <Text className="text-center text-base font-bold text-white">Confirm this total</Text>
          </Pressable>
        ) : null}
        {payload.customerApproved && payload.approvalId && payload.quoteVersion ? (
          <View className="mt-6 gap-3">
            <Pressable
              className="rounded-2xl bg-brand px-4 py-3"
              disabled={busy}
              onPress={async () => {
                setBusy(true);
                try {
                  await api.handoffCommerceQuote(
                    route.params.orderId,
                    { approvalId: payload.approvalId!, quoteVersion: payload.quoteVersion!, paymentMethod: "CASH" },
                    token
                  );
                  await query.refetch();
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Text className="text-center text-base font-bold text-white">Cash on delivery</Text>
            </Pressable>
            <TextInput
              value={payerPhone}
              onChangeText={setPayerPhone}
              placeholder="EcoCash number"
              className="rounded-2xl border border-border bg-surface px-4 py-3 text-base text-ink"
            />
            <Pressable
              className="rounded-2xl border border-border px-4 py-3"
              disabled={busy}
              onPress={async () => {
                setBusy(true);
                try {
                  await api.handoffCommerceQuote(
                    route.params.orderId,
                    {
                      approvalId: payload.approvalId!,
                      quoteVersion: payload.quoteVersion!,
                      paymentMethod: "ECOCASH",
                      payerPhone
                    },
                    token
                  );
                  await query.refetch();
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Text className="text-center text-base font-bold text-ink">Pay with EcoCash</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-background px-5" contentContainerStyle={{ paddingBottom: 40, paddingTop: 12 }}>
      <Text className="text-2xl font-black text-ink">YOUR DUTS ORDER</Text>
      <Text className="mt-2 text-lg font-bold text-ink">{order.statusLabel}</Text>
      <Text className="mt-2 text-base text-muted">DUTS is arranging your delivery.</Text>
      <Text className="mt-4 text-lg font-black text-ink">Order #{order.orderNumber}</Text>
      <Text className="mt-1 text-base font-bold text-ink">{order.statusLabel}</Text>
      {order.fulfillmentHint ? (
        <Text className="mt-2 text-base text-muted">{order.fulfillmentHint}</Text>
      ) : null}
      <Text className="mt-4 text-base text-muted">Shop: {order.merchant.name}</Text>
      <Text className="mt-1 text-base text-muted">Deliver to: {order.deliveryLabel}</Text>

      <View className="mt-6 gap-2">
        {order.items.map((item, idx) => (
          <View key={`${item.name}-${idx}`} className="flex-row justify-between">
            <View className="flex-1 pr-3">
              <Text className="text-base text-ink">
                {item.quantity}× {item.name}
              </Text>
              {item.flavorLine ? <Text className="text-xs text-muted">{item.flavorLine}</Text> : null}
            </View>
            <Text className="text-base font-semibold text-ink">
              ${(item.lineTotalCents / 100).toFixed(2)}
            </Text>
          </View>
        ))}
      </View>

      <View className="mt-6 gap-1 rounded-2xl border border-border bg-surface p-4">
        <Text className="text-sm text-muted">Items: ${(order.subtotalCents / 100).toFixed(2)}</Text>
        <Text className="text-sm text-muted">Delivery: ${(order.deliveryFeeCents / 100).toFixed(2)}</Text>
        <Text className="mt-2 text-lg font-black text-ink">Total: ${(order.totalCents / 100).toFixed(2)}</Text>
        <Text className="mt-1 text-sm text-muted">
          Payment: {order.paymentMethod === "CASH" ? "Cash on delivery" : order.paymentMethod === "ECOCASH" ? "EcoCash USD" : order.paymentMethod.replace(/_/g, " ")}
        </Text>
      </View>

      {order.paymentStatus === "PAYMENT_PENDING" ? (
        <View className="mt-5 rounded-2xl border border-border bg-card p-4">
          <Text className="text-base font-bold text-ink">EcoCash payment request sent.</Text>
          <Text className="mt-2 text-sm text-muted">Approve the payment on your phone.</Text>
          <Text className="mt-2 text-sm text-muted">Waiting for confirmation...</Text>
        </View>
      ) : null}
      {order.paymentStatus === "PAYMENT_FAILED" || order.paymentStatus === "FAILED" ? (
        <View className="mt-5 rounded-2xl border border-border bg-card p-4">
          <Text className="text-base font-bold text-ink">Payment was not completed.</Text>
          <Text className="mt-2 text-sm text-muted">Try EcoCash again from checkout, or choose cash on delivery on a new order.</Text>
        </View>
      ) : null}
      {order.paymentStatus === "DUE_ON_DELIVERY" ? (
        <Text className="mt-5 text-sm text-muted">Pay cash when your order arrives.</Text>
      ) : null}
    </ScrollView>
  );
}
