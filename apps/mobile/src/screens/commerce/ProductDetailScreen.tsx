import { useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { api } from "../../lib/api";
import { logDutsFlow } from "../../lib/flow-log";
import { useShopBrowse } from "../../lib/shop-browse";
import { DUTS } from "../../lib/theme";
import { AppButton } from "../../components/AppButton";
import type { RootStackParamList } from "../../navigation/types";
import { useCommerceCartStore } from "../../stores/commerce-cart.store";

type Props = NativeStackScreenProps<RootStackParamList, "ProductDetail">;

export function ProductDetailScreen({ route, navigation }: Props) {
  const browse = useShopBrowse();
  const addOffer = useCommerceCartStore((s) => s.addOffer);
  const [imgFailed, setImgFailed] = useState(false);

  const detailQuery = useQuery({
    queryKey: [
      "commerce-detail",
      ...browse.queryKey,
      route.params.catalogProductId,
      route.params.productId
    ],
    queryFn: () =>
      api.commerceProductDetail(
        {
          ...(browse.geo ?? {}),
          catalogProductId: route.params.catalogProductId,
          productId: route.params.productId
        },
        browse.token
      ),
    enabled: Boolean(route.params.catalogProductId || route.params.productId)
  });

  if (detailQuery.isLoading || !detailQuery.data) {
    return (
      <View className="flex-1 items-center justify-center">
        {detailQuery.isError ? (
          <Text className="text-center text-muted">This product is not available.</Text>
        ) : (
          <ActivityIndicator color={DUTS.purple} />
        )}
      </View>
    );
  }

  const { product, offers, purchasable, fromPriceCents } = detailQuery.data;
  const showImage = Boolean(product.imageUrl) && !imgFailed;

  return (
    <ScrollView className="flex-1 bg-background" contentContainerStyle={{ paddingBottom: 40 }}>
      <View className="aspect-square w-full items-center justify-center bg-surface">
        {showImage ? (
          <Image
            source={{ uri: product.imageUrl! }}
            className="h-full w-full"
            resizeMode="contain"
            accessibilityLabel={product.name}
            {...({ loading: "lazy" } as object)}
            onError={() => setImgFailed(true)}
          />
        ) : (
          <Text className="text-muted">No photo</Text>
        )}
      </View>
      <View className="gap-2 px-5 pt-5">
        <Text className="text-2xl font-black text-ink">{product.name}</Text>
        {product.brand ? <Text className="text-base text-muted">{product.brand}</Text> : null}
        {product.sizeLabel ? <Text className="text-base font-semibold text-ink">{product.sizeLabel}</Text> : null}
        {product.category ? <Text className="text-sm text-muted">{product.category}</Text> : null}
        {product.description ? <Text className="mt-2 text-base leading-6 text-label">{product.description}</Text> : null}

        {purchasable && offers.length > 0 ? (
          <>
            <Text className="mt-6 text-lg font-extrabold text-ink">Available nearby</Text>
            {fromPriceCents != null ? (
              <Text className="text-base font-extrabold text-ink">
                {offers.length > 1 ? "From " : ""}${(fromPriceCents / 100).toFixed(2)}
              </Text>
            ) : null}
            {offers.map((offer) => (
              <View
                key={offer.productId}
                className="mt-2 flex-row items-center justify-between rounded-2xl border border-border bg-card px-4 py-4"
              >
                <View className="flex-1 pr-3">
                  <Text className="text-base font-bold text-ink">{offer.merchantName}</Text>
                  {!browse.isGuest ? <Text className="text-sm text-muted">{offer.distanceKm} km</Text> : null}
                  <Text className="mt-1 text-base font-extrabold text-ink">
                    ${(offer.priceCents / 100).toFixed(2)}
                  </Text>
                </View>
                <Pressable
                  onPress={() => {
                    if (browse.isGuest) logDutsFlow("GUEST_ADD_TO_CART");
                    addOffer({
                      productId: offer.productId,
                      catalogProductId: product.catalogProductId,
                      name: product.name,
                      imageUrl: product.imageUrl,
                      sizeLabel: product.sizeLabel,
                      unitPriceCents: offer.priceCents,
                      merchantId: offer.merchantId,
                      merchantName: offer.merchantName
                    });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Add from ${offer.merchantName}`}
                  className="h-11 rounded-full px-4 py-2.5"
                  style={{ backgroundColor: DUTS.purple }}
                >
                  <Text className="font-bold text-white">ADD</Text>
                </Pressable>
              </View>
            ))}
          </>
        ) : (
          <View className="mt-6 gap-2">
            <Text className="text-lg font-extrabold text-muted">Price coming soon</Text>
            <Text className="text-sm text-muted">Not available to order yet.</Text>
            {!browse.isGuest && !browse.geo ? (
              <View className="mt-2">
                <AppButton label="Set location" onPress={() => navigation.navigate("ShopLocation")} />
              </View>
            ) : null}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
