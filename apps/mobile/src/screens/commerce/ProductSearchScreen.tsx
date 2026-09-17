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

type Props = NativeStackScreenProps<RootStackParamList, "ProductSearch">;

export function ProductSearchScreen({ route, navigation }: Props) {
  const token = useSessionStore((s) => s.session!.token);
  const location = useShopLocationStore((s) => s.location);
  const addOffer = useCommerceCartStore((s) => s.addOffer);
  const [q, setQ] = useState(route.params?.q ?? "");
  const category = route.params?.category;

  const query = useQuery({
    queryKey: ["commerce-search", location?.latitude, location?.longitude, q, category],
    queryFn: () =>
      api.commerceNearbyProducts(
        {
          lat: location!.latitude,
          lng: location!.longitude,
          q: q.trim() || undefined,
          category,
          limit: 40
        },
        token
      ),
    enabled: Boolean(location)
  });

  if (!location) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <Text className="text-center text-base text-muted">Set your delivery location on Home first.</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-background px-5" contentContainerStyle={{ paddingBottom: 40, paddingTop: 8 }}>
      <Text className="text-xl font-black text-ink">{category ?? "Search"}</Text>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Search products…"
        placeholderTextColor={DUTS.placeholder}
        className="mt-3 rounded-2xl border border-border bg-card px-4 py-3 text-base text-ink"
        accessibilityLabel="Search products"
      />
      {query.isLoading ? (
        <ActivityIndicator className="mt-8" color={DUTS.purple} />
      ) : (query.data?.products ?? []).length === 0 ? (
        <Text className="mt-8 text-sm text-muted">No products found near you.</Text>
      ) : (
        <View className="mt-4 flex-row flex-wrap justify-between">
          {query.data!.products.map((p) => (
            <ProductCard
              key={p.catalogProductId ?? p.productId}
              product={p}
              pricePrefix={p.offerCount > 1 ? "From " : ""}
              onPress={() =>
                navigation.navigate("ProductDetail", {
                  catalogProductId: p.catalogProductId ?? undefined,
                  productId: p.productId
                })
              }
              onAdd={() => {
                void api
                  .commerceProductDetail(
                    {
                      lat: location.latitude,
                      lng: location.longitude,
                      catalogProductId: p.catalogProductId ?? undefined,
                      productId: p.productId
                    },
                    token
                  )
                  .then((detail) => {
                    const offer = detail.offers[0];
                    if (!offer) return;
                    addOffer({
                      productId: offer.productId,
                      catalogProductId: detail.product.catalogProductId,
                      name: detail.product.name,
                      imageUrl: detail.product.imageUrl,
                      sizeLabel: detail.product.sizeLabel,
                      unitPriceCents: offer.priceCents,
                      merchantId: offer.merchantId,
                      merchantName: offer.merchantName
                    });
                  });
              }}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}
