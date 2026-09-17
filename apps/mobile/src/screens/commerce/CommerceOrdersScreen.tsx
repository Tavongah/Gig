import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { TabScreen } from "../../components/TabScreen";
import { api } from "../../lib/api";
import { DUTS } from "../../lib/theme";
import type { RootStackParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";

export function CommerceOrdersScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const token = useSessionStore((s) => s.session!.token);

  const ordersQuery = useQuery({
    queryKey: ["commerce-orders"],
    queryFn: () => api.commerceOrders(token),
    refetchInterval: 20_000
  });

  return (
    <TabScreen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <Text className="text-2xl font-black text-ink">Orders</Text>
        <Text className="mt-1 text-sm text-muted">Your shop orders</Text>

        {ordersQuery.isLoading ? <ActivityIndicator className="mt-8" color={DUTS.purple} /> : null}
        {(ordersQuery.data?.orders ?? []).length === 0 && !ordersQuery.isLoading ? (
          <Text className="mt-8 text-base text-muted">No shop orders yet.</Text>
        ) : null}

        {(ordersQuery.data?.orders ?? []).map((o) => (
          <Pressable
            key={o.id}
            onPress={() => navigation.navigate("CommerceOrderDetail", { orderId: o.id })}
            className="mt-3 rounded-2xl border border-border bg-card px-4 py-4"
            accessibilityRole="button"
            accessibilityLabel={`Order ${o.orderNumber}`}
          >
            <Text className="text-base font-bold text-ink">Order #{o.orderNumber}</Text>
            <Text className="mt-1 text-sm text-muted">{o.merchantName}</Text>
            <Text className="mt-1 text-sm font-semibold text-ink">{o.statusLabel}</Text>
            <Text className="mt-1 text-sm text-muted">
              ${(o.totalCents / 100).toFixed(2)} · {o.itemCount} item{o.itemCount === 1 ? "" : "s"}
            </Text>
          </Pressable>
        ))}

        <Pressable
          onPress={() => navigation.navigate("MyGigsActivity")}
          className="mt-8"
          accessibilityRole="button"
        >
          <Text className="text-sm font-semibold text-muted">Package & help activity →</Text>
        </Pressable>
      </ScrollView>
    </TabScreen>
  );
}
