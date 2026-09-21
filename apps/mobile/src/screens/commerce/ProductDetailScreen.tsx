import { useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../lib/api";
import { logDutsFlow } from "../../lib/flow-log";
import { useShopBrowse } from "../../lib/shop-browse";
import { DUTS } from "../../lib/theme";
import { productCardMeta } from "../../lib/storefront-ui";
import { StoreHeader, StorePage } from "../../components/StoreHeader";
import type { RootStackParamList } from "../../navigation/types";
import { useCommerceCartStore } from "../../stores/commerce-cart.store";

type Props = NativeStackScreenProps<RootStackParamList, "ProductDetail">;

export function ProductDetailScreen({ route, navigation }: Props) {
  const browse = useShopBrowse();
  const addOffer = useCommerceCartStore((s) => s.addOffer);
  const [imgFailed, setImgFailed] = useState(false);
  const { width } = useWindowDimensions();
  const desktop = width >= 900;

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

  const product = detailQuery.data?.product;
  const offers = detailQuery.data?.offers ?? [];
  const purchasable = Boolean(detailQuery.data?.purchasable && offers.length);
  const fromPriceCents = detailQuery.data?.fromPriceCents ?? null;
  const showImage = Boolean(product?.imageUrl) && !imgFailed;
  const meta = product ? productCardMeta(product.name, product.brand, product.sizeLabel) : "";

  function addFromOffer(offer: (typeof offers)[number]) {
    if (!product) return;
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
  }

  const imageCanvas = (
    <View
      className="items-center justify-center rounded-2xl border border-border bg-card"
      style={{
        aspectRatio: 1,
        width: "100%",
        maxHeight: desktop ? 520 : undefined,
        backgroundColor: "#FFFFFF",
        padding: 24
      }}
    >
      {detailQuery.isLoading ? (
        <ActivityIndicator color={DUTS.purple} />
      ) : showImage ? (
        <Image
          source={{ uri: product!.imageUrl! }}
          style={{ width: "86%", height: "86%", maxWidth: 420, maxHeight: 420 }}
          resizeMode="contain"
          accessibilityLabel={product?.name}
          {...({ loading: "lazy" } as object)}
          onError={() => setImgFailed(true)}
        />
      ) : (
        <View className="items-center">
          <Ionicons name="image-outline" size={36} color={DUTS.placeholder} />
          <Text className="mt-2 text-sm text-muted">No photo</Text>
        </View>
      )}
    </View>
  );

  const info = product ? (
    <View className="gap-2">
      <Text className="text-2xl font-black text-ink">{product.name}</Text>
      {meta ? <Text className="text-base text-muted">{meta}</Text> : null}
      {product.category ? <Text className="text-sm text-muted">{product.category}</Text> : null}
      {purchasable && fromPriceCents != null ? (
        <Text className="mt-2 text-2xl font-black text-ink">
          {offers.length > 1 ? "From " : ""}${(fromPriceCents / 100).toFixed(2)}
        </Text>
      ) : (
        <Text className="mt-2 text-sm font-medium text-muted">Coming soon</Text>
      )}
      {product.description ? (
        <Text className="mt-3 text-base leading-6 text-label">{product.description}</Text>
      ) : null}

      {purchasable ? (
        <View className="mt-4 gap-2">
          {offers.map((offer) => (
            <View
              key={offer.productId}
              className="flex-row items-center justify-between rounded-2xl border border-border bg-card px-4 py-4"
            >
              <View className="flex-1 pr-3">
                <Text className="text-base font-bold text-ink">{offer.merchantName}</Text>
                {!browse.isGuest ? <Text className="text-sm text-muted">{offer.distanceKm} km</Text> : null}
                <Text className="mt-1 text-lg font-extrabold text-ink">${(offer.priceCents / 100).toFixed(2)}</Text>
              </View>
              <Pressable
                onPress={() => addFromOffer(offer)}
                accessibilityRole="button"
                accessibilityLabel={`Add ${product.name} from ${offer.merchantName}`}
                className="h-11 min-w-[44px] rounded-full px-4"
                style={{ backgroundColor: DUTS.purple, justifyContent: "center" }}
              >
                <Text className="font-extrabold text-white">ADD TO CART</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : (
        <Text className="mt-2 text-sm text-muted">Not available to order yet.</Text>
      )}
    </View>
  ) : detailQuery.isError ? (
    <Text className="text-base text-muted">This product is not available.</Text>
  ) : null;

  return (
    <View className="flex-1 bg-background">
      <StoreHeader compact showCategories={false} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <StorePage>
          <View className={`mt-4 ${desktop ? "flex-row gap-8" : "gap-4"}`}>
            <View style={desktop ? { width: "46%" } : undefined}>{imageCanvas}</View>
            <View style={desktop ? { width: "50%", paddingTop: 8 } : undefined}>{info}</View>
          </View>
        </StorePage>
      </ScrollView>
    </View>
  );
}
