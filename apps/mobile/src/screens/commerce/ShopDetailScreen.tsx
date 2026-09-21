import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ProductCard, isProductCardPurchasable } from "../../components/ProductCard";
import { AppButton } from "../../components/AppButton";
import { api } from "../../lib/api";
import { useShopBrowse } from "../../lib/shop-browse";
import { DUTS } from "../../lib/theme";
import type { RootStackParamList } from "../../navigation/types";
import { useCommerceCartStore } from "../../stores/commerce-cart.store";

type Props = NativeStackScreenProps<RootStackParamList, "ShopDetail">;

export function ShopDetailScreen({ route, navigation }: Props) {
  const browse = useShopBrowse();
  const addOffer = useCommerceCartStore((s) => s.addOffer);
  const [q, setQ] = useState("");

  const shopQuery = useQuery({
    queryKey: ["commerce-shop", route.params.merchantId, ...browse.queryKey, q],
    queryFn: () =>
      api.commerceShop(route.params.merchantId, browse.geo!, browse.token, q.trim() || undefined),
    enabled: Boolean(browse.geo)
  });

  if (!browse.geo) {
    return (
      <View className="flex-1 items-center justify-center px-6">
        {browse.isGuest ? (
          <Text className="text-center text-muted">Loading shops near you…</Text>
        ) : (
          <>
            <Text className="text-center text-muted">Set your location to see products available near you.</Text>
            <View className="mt-4 w-full max-w-sm">
              <AppButton label="Set location" onPress={() => navigation.navigate("ShopLocation")} />
            </View>
          </>
        )}
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
        {browse.isGuest ? shop.locationLabel : `${shop.distanceKm} km · ${shop.locationLabel}`}
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
                productId: p.productId ?? undefined
              })
            }
            onAdd={
              isProductCardPurchasable(p) && p.productId && p.fromPriceCents != null
                ? () =>
                    addOffer({
                      productId: p.productId!,
                      catalogProductId: p.catalogProductId,
                      name: p.name,
                      imageUrl: p.imageUrl,
                      sizeLabel: p.sizeLabel,
                      unitPriceCents: p.fromPriceCents!,
                      merchantId: shop.id,
                      merchantName: shop.name
                    })
                : undefined
            }
          />
        ))}
      </View>
      {products.length === 0 ? <Text className="mt-4 text-sm text-muted">No products available.</Text> : null}
    </ScrollView>
  );
}
