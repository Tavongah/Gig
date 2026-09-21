import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ProductCard, isProductCardPurchasable } from "../../components/ProductCard";
import { AppButton } from "../../components/AppButton";
import { api } from "../../lib/api";
import { useShopBrowse } from "../../lib/shop-browse";
import { DUTS } from "../../lib/theme";
import type { RootStackParamList } from "../../navigation/types";
import { useCommerceCartStore } from "../../stores/commerce-cart.store";

type Props = NativeStackScreenProps<RootStackParamList, "ProductSearch">;

export function ProductSearchScreen({ route, navigation }: Props) {
  const browse = useShopBrowse();
  const addOffer = useCommerceCartStore((s) => s.addOffer);
  const [q, setQ] = useState(route.params?.q ?? "");
  const category = route.params?.category;

  const query = useInfiniteQuery({
    queryKey: ["commerce-search", ...browse.queryKey, q, category],
    queryFn: ({ pageParam }) =>
      api.commerceNearbyProducts(
        {
          ...(browse.geo ?? {}),
          q: q.trim() || undefined,
          category,
          limit: 24,
          offset: pageParam
        },
        browse.token
      ),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasMore ? last.offset + last.products.length : undefined),
    enabled: browse.ready
  });

  const products = query.data?.pages.flatMap((page) => page.products) ?? [];

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
      {!browse.ready || query.isLoading ? (
        <ActivityIndicator className="mt-8" color={DUTS.purple} />
      ) : products.length === 0 ? (
        <Text className="mt-8 text-sm text-muted">No products found.</Text>
      ) : (
        <>
          <View className="mt-4 flex-row flex-wrap justify-between">
            {products.map((p) => (
              <ProductCard
                key={p.catalogProductId ?? p.productId ?? p.name}
                product={p}
                pricePrefix={p.merchantOfferCount > 1 ? "From " : ""}
                onPress={() =>
                  navigation.navigate("ProductDetail", {
                    catalogProductId: p.catalogProductId ?? undefined,
                    productId: p.productId ?? undefined
                  })
                }
                onAdd={
                  isProductCardPurchasable(p)
                    ? () => {
                        if (!p.productId) return;
                        void api
                          .commerceProductDetail(
                            {
                              ...(browse.geo ?? {}),
                              catalogProductId: p.catalogProductId ?? undefined,
                              productId: p.productId
                            },
                            browse.token
                          )
                          .then((detail) => {
                            const offer = detail.offers[0];
                            if (!offer || !detail.purchasable) return;
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
                      }
                    : undefined
                }
              />
            ))}
          </View>
          {query.hasNextPage ? (
            <View className="mt-2">
              <AppButton
                label={query.isFetchingNextPage ? "Loading…" : "Load more"}
                variant="secondary"
                onPress={() => void query.fetchNextPage()}
              />
            </View>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}
