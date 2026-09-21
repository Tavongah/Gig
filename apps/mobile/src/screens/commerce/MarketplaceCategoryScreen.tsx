import { Pressable, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { StoreHeader, StorePage } from "../../components/StoreHeader";
import { ProductGrid } from "../../components/ProductGrid";
import type { ProductCardData } from "../../components/ProductCard";
import { api } from "../../lib/api";
import { useShopBrowse } from "../../lib/shop-browse";
import { DUTS } from "../../lib/theme";
import { STOREFRONT_MAX_WIDTH } from "../../lib/storefront-ui";
import {
  destinationFor,
  categoryIonicon,
  alcoholPurchaseAllowed
} from "../../lib/storefront-categories";
import type { RootStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "MarketplaceCategory">;

export function MarketplaceCategoryScreen({ route, navigation }: Props) {
  const browse = useShopBrowse();
  const dest = destinationFor(route.params.slug);
  const label = dest?.label ?? "Category";
  const comingSoon = dest?.state === "COMING_SOON";
  const restricted = Boolean(dest?.restricted || dest?.state === "RESTRICTED");
  const catalogName = dest?.catalogName ?? (restricted ? "Alcohol" : undefined);

  const productsQuery = useQuery({
    queryKey: ["commerce-marketplace-category", catalogName, ...browse.queryKey],
    queryFn: () =>
      api.commerceNearbyProducts(
        { ...(browse.geo ?? {}), category: catalogName, limit: 24, offset: 0 },
        browse.token
      ),
    enabled: Boolean(browse.ready && restricted && catalogName && !comingSoon)
  });

  const products = (productsQuery.data?.products ?? []) as ProductCardData[];
  const showCatalog = restricted && products.length > 0;

  function goHome() {
    navigation.navigate("MainTabs", { screen: "Home" });
  }

  return (
    <View className="flex-1 bg-background">
      <StoreHeader compact showCategories={false} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <StorePage>
          <View className="mt-10 items-center px-4" style={{ maxWidth: STOREFRONT_MAX_WIDTH }}>
            <View
              className="h-16 w-16 items-center justify-center rounded-full"
              style={{ backgroundColor: "#F4EEFF" }}
            >
              <Ionicons name={categoryIonicon(label)} size={28} color={DUTS.purple} />
            </View>
            {comingSoon ? (
              <>
                <Text className="mt-5 text-center text-2xl font-black text-ink">{label} is coming to DUTS</Text>
                <Text className="mt-2 text-center text-base text-muted">
                  We're bringing more local stores and sellers to DUTS.
                </Text>
                <Text className="mt-3 text-sm font-semibold text-muted">Coming soon</Text>
              </>
            ) : (
              <>
                <Text className="mt-5 text-center text-2xl font-black text-ink">{label}</Text>
                <Text className="mt-2 text-center text-base font-semibold text-ink">Age-restricted products</Text>
                <Text className="mt-2 text-center text-base text-muted">Alcohol ordering is coming at launch.</Text>
              </>
            )}
            <Pressable
              onPress={goHome}
              accessibilityRole="button"
              accessibilityLabel="Back to shopping"
              className="mt-6 rounded-full px-5 py-3"
              style={{ backgroundColor: DUTS.purple }}
            >
              <Text className="font-extrabold text-white">BACK TO SHOPPING</Text>
            </Pressable>
          </View>

          {showCatalog ? (
            <View className="mt-10">
              <Text className="mb-3 text-lg font-extrabold text-ink">{label}</Text>
              <Text className="mb-4 text-sm text-muted">Browse the catalog. Ordering is not available yet.</Text>
              <ProductGrid
                products={products}
                loading={productsQuery.isLoading}
                onPress={(p) =>
                  navigation.navigate("ProductDetail", {
                    catalogProductId: p.catalogProductId ?? undefined,
                    productId: alcoholPurchaseAllowed(p.category) ? p.productId ?? undefined : undefined
                  })
                }
              />
            </View>
          ) : null}
        </StorePage>
      </ScrollView>
    </View>
  );
}
