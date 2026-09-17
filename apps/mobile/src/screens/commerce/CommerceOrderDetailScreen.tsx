import { ActivityIndicator, ScrollView, Text, View } from "react-native";
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

  if (query.isLoading || !query.data) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={DUTS.purple} />
      </View>
    );
  }

  const { order } = query.data;

  return (
    <ScrollView className="flex-1 bg-background px-5" contentContainerStyle={{ paddingBottom: 40, paddingTop: 12 }}>
      <Text className="text-2xl font-black text-ink">Order #{order.orderNumber}</Text>
      <Text className="mt-2 text-lg font-bold text-ink">{order.statusLabel}</Text>
      <Text className="mt-4 text-base text-muted">Shop: {order.merchant.name}</Text>
      <Text className="mt-1 text-base text-muted">Deliver to: {order.deliveryLabel}</Text>

      <View className="mt-6 gap-2">
        {order.items.map((item, idx) => (
          <View key={`${item.name}-${idx}`} className="flex-row justify-between">
            <Text className="flex-1 text-base text-ink">
              {item.quantity}× {item.name}
            </Text>
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
        <Text className="mt-1 text-sm text-muted">Payment: {order.paymentMethod.replace(/_/g, " ")}</Text>
      </View>
    </ScrollView>
  );
}
