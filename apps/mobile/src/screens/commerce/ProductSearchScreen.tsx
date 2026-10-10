import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { ProductGrid } from "../../components/ProductGrid";
import { StoreHeader, StorePage } from "../../components/StoreHeader";
import type { ProductCardData } from "../../components/ProductCard";
import { api } from "../../lib/api";
import { addStorefrontProduct } from "../../lib/storefront-cart";
import { useShopBrowse } from "../../lib/shop-browse";
import { DUTS } from "../../lib/theme";
import { comingSoonFromQuery, destinationFor, isSmartBasketEnabled } from "../../lib/storefront-categories";
import { openStorefrontCategory } from "../../lib/storefront-nav";
import type { RootStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "ProductSearch">;

export function ProductSearchScreen({ route, navigation }: Props) {
  const browse = useShopBrowse();
  const [q] = useState(route.params?.q ?? "");
  const category = route.params?.category;
  const categoriesQuery = useQuery({
    queryKey: ["commerce-categories", ...browse.queryKey],
    queryFn: () => api.commerceCategories(browse.geo, browse.token),
    enabled: browse.ready
  });
  const catalogNames = (categoriesQuery.data?.categories ?? []).map((c) => c.name);
  const dest = destinationFor(category, catalogNames);
  const soonMatch = !category && q.trim() ? comingSoonFromQuery(q, catalogNames) : undefined;
  const skipCatalogFetch = dest?.state === "COMING_SOON" || dest?.state === "RESTRICTED";

  useEffect(() => {
    if (!dest) return;
    if (dest.state === "COMING_SOON" || dest.state === "RESTRICTED") {
      navigation.replace("MarketplaceCategory", { slug: dest.slug });
    }
  }, [dest?.slug, dest?.state, navigation]);

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
    enabled: browse.ready && !skipCatalogFetch
  });

  const configQuery = useQuery({
    queryKey: ["commerce-public-config"],
    queryFn: () => api.commercePublicConfig()
  });
  const unlistedEnabled = configQuery.data?.unlistedItemRequestEnabled === true;
  const products = query.data?.pages.flatMap((page) => page.products) ?? [];
  const title = category ?? (q.trim() ? `Results for “${q.trim()}”` : "Search");

  function openProduct(p: ProductCardData) {
    navigation.navigate("ProductDetail", {
      catalogProductId: p.catalogProductId ?? undefined,
      productId: p.productId ?? undefined
    });
  }

  return (
    <View className="flex-1 bg-background">
      <StoreHeader categories={catalogNames} initialQuery={q} compact={!category} showCategories={!q} />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 40 }}>
        <StorePage>
          <Text className="mt-3 text-lg font-extrabold text-ink">{title}</Text>
          {products.length === 0 && !query.isLoading && !skipCatalogFetch ? (
            <View className="mt-10 items-center px-6">
              <Ionicons name="search-outline" size={32} color={DUTS.placeholder} />
              <Text className="mt-3 text-center text-base font-bold text-ink">
                {unlistedEnabled ? "Can't find what you need?" : "No products found"}
              </Text>
              <Text className="mt-1 text-center text-sm text-muted">
                {unlistedEnabled ? "Try another search, or ask DUTS to look for it." : "Try another search."}
              </Text>
              {unlistedEnabled ? (
                <Pressable
                  onPress={() => navigation.navigate("RequestUnlistedItem", { q: q.trim() || undefined })}
                  accessibilityRole="button"
                  accessibilityLabel="Request an item"
                  className="mt-5 rounded-full bg-ink px-5 py-3"
                >
                  <Text className="text-center text-sm font-extrabold text-white">Request an item</Text>
                </Pressable>
              ) : null}
            </View>
          ) : skipCatalogFetch ? null : (
            <View className="mt-3">
              <ProductGrid>
                products={products}
                loading={query.isLoading}
                onPress={openProduct}
                onAdd={(p) =>
                  addStorefrontProduct({
                    product: p,
                    geo: browse.geo,
                    token: browse.token,
                    isGuest: browse.isGuest
                  })
                }
                pricePrefix={(p) => (isSmartBasketEnabled() || (p.merchantOfferCount ?? 0) > 1 ? "From " : "")}
              />
            </View>
          )}
          {query.hasNextPage ? (
            <Pressable
              onPress={() => void query.fetchNextPage()}
              accessibilityRole="button"
              accessibilityLabel="Show more products"
              className="mt-4 items-center rounded-full border border-border bg-card px-5 py-3"
              style={{ alignSelf: "stretch" }}
            >
              <Text className="text-center text-sm font-extrabold text-ink">
                {query.isFetchingNextPage ? "Loading…" : "SHOW MORE PRODUCTS"}
              </Text>
            </Pressable>
          ) : null}
          {soonMatch ? (
            <Pressable
              onPress={() => openStorefrontCategory(navigation, soonMatch, catalogNames)}
              accessibilityRole="button"
              accessibilityLabel={`${soonMatch.label}, Coming soon`}
              className="mt-8 flex-row items-center rounded-2xl border border-border bg-card px-4 py-3"
            >
              <Ionicons name="time-outline" size={18} color={DUTS.purple} />
              <View className="ml-3 flex-1">
                <Text className="text-base font-bold text-ink">{soonMatch.label}</Text>
                <Text className="text-sm text-muted">Coming soon</Text>
              </View>
            </Pressable>
          ) : null}
        </StorePage>
      </ScrollView>
    </View>
  );
}
