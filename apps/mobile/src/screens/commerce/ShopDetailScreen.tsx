import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ProductCard } from "../../components/ProductCard";
import { api } from "../../lib/api";
import { DUTS } from "../../lib/theme";
import type { RootStackParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";
import { useShopLocationStore } from "../../stores/shop-location.store";
import { useCommerceCartStore } from "../../stores/commerce-cart.store";

type Props = NativeStackScreenProps<RootStackParamList, "ShopDetail">;

export function ShopDetailScreen({ route, navigation }: Props) {
  const token = useSessionStore((s) => s.session!.token);
  const location = useShopLocationStore((s) => s.location);
  const addOffer = useCommerceCartStore((s) => s.addOffer);
  const [q, setQ] = useState("");

  const shopQuery = useQuery({
    queryKey: ["commerce-shop", route.params.merchantId, location?.latitude, location?.longitude, q],
    queryFn: () =>
      api.commerceShop(route.params.merchantId, location!.latitude, location!.longitude, token, q.trim() || undefined),
    enabled: Boolean(location)
  });

  if (!location) {
    return (
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-center text-muted">Set your delivery location first.</Text>
      </View>
    );
  }

  if (shopQuery.isLoading || !shopQuery.data) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={DUTS.purple} />
      </View>
    );
  }

  const { shop, products } = shopQuery.data;

  return (
    <ScrollView className="flex-1 bg-background px-5" contentContainerStyle={{ paddingBottom: 40, paddingTop: 8 }}>
      <Text className="text-2xl font-black text-ink">{shop.name}</Text>
      <Text className="mt-1 text-sm text-muted">
        {shop.distanceKm} km · {shop.locationLabel}
      </Text>
      {shop.openingHours ? <Text className="mt-1 text-sm text-muted">{shop.openingHours}</Text> : null}

      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Search this shop…"
        placeholderTextColor={DUTS.placeholder}
        className="mt-4 rounded-2xl border border-border bg-card px-4 py-3 text-base text-ink"
        accessibilityLabel="Search this shop"
      />

      <View className="mt-4 flex-row flex-wrap justify-between">
        {products.map((p) => (
          <ProductCard
            key={p.productId}
            product={p}
            pricePrefix=""
            onPress={() =>
              navigation.navigate("ProductDetail", {
                catalogProductId: p.catalogProductId ?? undefined,
                productId: p.productId
              })
            }
            onAdd={() =>
              addOffer({
                productId: p.productId,
                catalogProductId: p.catalogProductId,
                name: p.name,
                imageUrl: p.imageUrl,
                sizeLabel: p.sizeLabel,
                unitPriceCents: p.fromPriceCents,
                merchantId: shop.id,
                merchantName: shop.name
              })
            }
          />
        ))}
      </View>
      {products.length === 0 ? <Text className="mt-4 text-sm text-muted">No products available.</Text> : null}
    </ScrollView>
  );
}
