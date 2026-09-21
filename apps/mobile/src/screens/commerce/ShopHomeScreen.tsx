import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useInfiniteQuery, useQueries, useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { ProductGrid, ProductRail } from "../../components/ProductGrid";
import { StoreHeader, StorePage } from "../../components/StoreHeader";
import { type ProductCardData } from "../../components/ProductCard";
import { api } from "../../lib/api";
import { addStorefrontProduct } from "../../lib/storefront-cart";
import { useShopBrowse } from "../../lib/shop-browse";
import { DUTS } from "../../lib/theme";
import { moreOnDutsCategories, shopByCategories } from "../../lib/storefront-categories";
import { openStorefrontCategory } from "../../lib/storefront-nav";
import { StorefrontCategoryCard } from "../../components/StorefrontCategoryCard";
import type { RootStackParamList } from "../../navigation/types";
import { useShopAreaStore, timezoneAreaHint } from "../../stores/shop-area.store";
import { useCommerceCartStore } from "../../stores/commerce-cart.store";

const GUEST_CATEGORIES = ["Drinks", "Groceries", "Snacks", "Household"];
const FALLBACK_AREAS = [
  { id: "harare", name: "Harare", shopCount: 0 },
  { id: "bulawayo", name: "Bulawayo", shopCount: 0 },
  { id: "gweru", name: "Gweru", shopCount: 0 }
];

export function ShopHomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const browse = useShopBrowse();
  const setArea = useShopAreaStore((s) => s.setArea);
  const pendingCheckout = useCommerceCartStore((s) => s.pendingCheckout);
  const setPendingCheckout = useCommerceCartStore((s) => s.setPendingCheckout);
  const lines = useCommerceCartStore((s) => s.lines);

  useEffect(() => {
    if (!browse.isGuest && pendingCheckout && lines.length && browse.ready) {
      setPendingCheckout(false);
      navigation.navigate(browse.exact ? "CommerceCheckout" : "ShopLocation");
    }
  }, [browse.isGuest, browse.ready, browse.exact, pendingCheckout, lines.length, navigation, setPendingCheckout]);

  const areasQuery = useQuery({
    queryKey: ["commerce-shopping-areas"],
    queryFn: () => api.commerceShoppingAreas(),
    enabled: browse.isGuest
  });

  useEffect(() => {
    if (!browse.isGuest || !browse.ready) return;
    if (areasQuery.isLoading && !areasQuery.data && !areasQuery.isError) return;
    const areas = areasQuery.data?.areas.length ? areasQuery.data.areas : FALLBACK_AREAS;
    if (browse.area && areas.some((a) => a.id === browse.area?.id)) return;
    const hinted = timezoneAreaHint();
    const pick = areas.find((a) => a.id === hinted) ?? areas[0];
    if (pick) void setArea({ id: pick.id, name: pick.name });
  }, [browse.isGuest, browse.ready, browse.area, areasQuery.data, areasQuery.isLoading, areasQuery.isError, setArea]);

  const productsQuery = useInfiniteQuery({
    queryKey: ["commerce-products", ...browse.queryKey],
    queryFn: ({ pageParam }) =>
      api.commerceNearbyProducts({ ...(browse.geo ?? {}), limit: 24, offset: pageParam }, browse.token),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasMore ? last.offset + last.products.length : undefined),
    enabled: browse.ready
  });
  const categoriesQuery = useQuery({
    queryKey: ["commerce-categories", ...browse.queryKey],
    queryFn: () => api.commerceCategories(browse.geo, browse.token),
    enabled: browse.ready
  });
  const shopsQuery = useQuery({
    queryKey: ["commerce-shops", ...browse.queryKey],
    queryFn: () => api.commerceNearbyShops(browse.geo!, browse.token),
    enabled: Boolean(browse.geo)
  });

  const catalogNames = useMemo(() => {
    const fromApi = (categoriesQuery.data?.categories ?? []).map((c) => c.name);
    if (fromApi.length) return fromApi;
    return GUEST_CATEGORIES;
  }, [categoriesQuery.data]);

  const shopBy = shopByCategories(catalogNames);
  const moreOnDuts = moreOnDutsCategories(catalogNames);

  const sectionCategories = (categoriesQuery.data?.categories ?? [])
    .filter((c) => c.count >= 6)
    .slice(0, 4);

  const sectionQueries = useQueries({
    queries: sectionCategories.map((cat) => ({
      queryKey: ["commerce-section", cat.name, ...browse.queryKey],
      queryFn: () =>
        api.commerceNearbyProducts(
          { ...(browse.geo ?? {}), category: cat.name, limit: 10, offset: 0 },
          browse.token
        ),
      enabled: browse.ready
    }))
  });

  function openProduct(p: ProductCardData) {
    navigation.navigate("ProductDetail", {
      catalogProductId: p.catalogProductId ?? undefined,
      productId: p.productId ?? undefined
    });
  }

  function addProduct(p: ProductCardData) {
    addStorefrontProduct({ product: p, geo: browse.geo, token: browse.token, isGuest: browse.isGuest });
  }

  const products = productsQuery.data?.pages.flatMap((page) => page.products) ?? [];

  return (
    <View className="flex-1 bg-background">
      <StoreHeader categories={catalogNames} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 36 }}>
        <StorePage>
          <Text className="mt-4 text-sm text-muted">Need it? DUTS it. Shop local. Get it delivered.</Text>

          {shopBy.length > 0 ? (
            <View className="mt-5">
              <Text className="mb-3 text-lg font-extrabold text-ink">Shop by category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 8 }}>
                {shopBy.map((cat) => (
                  <StorefrontCategoryCard
                    key={cat.slug}
                    category={cat}
                    onPress={() => openStorefrontCategory(navigation, cat, catalogNames)}
                  />
                ))}
              </ScrollView>
            </View>
          ) : null}

          {sectionCategories.length > 0 ? (
            <View className="mt-6">
              {sectionCategories.map((cat, i) => {
                const rows = (sectionQueries[i]?.data?.products ?? []) as ProductCardData[];
                return (
                  <View key={cat.name} className="mb-6">
                    <View className="mb-3 flex-row items-center justify-between">
                      <Text className="text-lg font-extrabold text-ink">{cat.name}</Text>
                      <Pressable
                        onPress={() => navigation.navigate("ProductSearch", { category: cat.name, q: undefined })}
                        accessibilityRole="button"
                        accessibilityLabel={`See all ${cat.name}`}
                        className="flex-row items-center"
                      >
                        <Text className="text-sm font-bold" style={{ color: DUTS.purple }}>
                          See all
                        </Text>
                        <Ionicons name="chevron-forward" size={16} color={DUTS.purple} />
                      </Pressable>
                    </View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <ProductRail
                        products={rows}
                        loading={sectionQueries[i]?.isLoading}
                        onPress={openProduct}
                        onAdd={addProduct}
                      />
                    </ScrollView>
                  </View>
                );
              })}
            </View>
          ) : null}

          {moreOnDuts.length > 0 ? (
            <View className="mt-2">
              <View className="mb-3 flex-row items-center justify-between">
                <Text className="text-lg font-extrabold text-ink">More on DUTS</Text>
                <Pressable
                  onPress={() => navigation.navigate("AllCategories")}
                  accessibilityRole="button"
                  accessibilityLabel="All categories"
                >
                  <Text className="text-sm font-bold" style={{ color: DUTS.purple }}>
                    All categories
                  </Text>
                </Pressable>
              </View>
              <View className="flex-row flex-wrap" style={{ gap: 10 }}>
                {moreOnDuts.map((cat) => (
                  <View key={cat.slug} style={{ width: "22%", minWidth: 72, flexGrow: 1, maxWidth: 140 }}>
                    <StorefrontCategoryCard
                      category={cat}
                      compact
                      onPress={() => openStorefrontCategory(navigation, cat, catalogNames)}
                    />
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          <View className="mt-6">
            <Text className="mb-3 text-lg font-extrabold text-ink">Explore products</Text>
            {products.length === 0 && !productsQuery.isLoading ? (
              <Text className="text-sm text-muted">No products found. Try another search.</Text>
            ) : (
              <ProductGrid
                products={products}
                loading={productsQuery.isLoading}
                onPress={openProduct}
                onAdd={addProduct}
                pricePrefix={(p) => ((p.merchantOfferCount ?? 0) > 1 ? "From " : "")}
              />
            )}
            {productsQuery.hasNextPage ? (
              <Pressable
                onPress={() => void productsQuery.fetchNextPage()}
                accessibilityRole="button"
                accessibilityLabel="Show more products"
                className="mt-5 self-center rounded-full border border-border bg-card px-5 py-3"
              >
                <Text className="text-center text-sm font-extrabold text-ink">
                  {productsQuery.isFetchingNextPage ? "Loading…" : "SHOW MORE PRODUCTS"}
                </Text>
              </Pressable>
            ) : null}
          </View>

          <View className="mt-8">
            <Text className="mb-3 text-lg font-extrabold text-ink">Nearby shops</Text>
            {!browse.isGuest && !browse.geo ? (
              <Text className="text-sm text-muted">Set your location to see shops that can deliver to you.</Text>
            ) : (shopsQuery.data?.shops ?? []).length === 0 ? (
              <Text className="text-sm text-muted">No shops nearby yet. You can still browse the DUTS catalog.</Text>
            ) : (
              (shopsQuery.data?.shops ?? []).map((shop) => (
                <Pressable
                  key={shop.id}
                  onPress={() => navigation.navigate("ShopDetail", { merchantId: shop.id })}
                  className="mb-2 rounded-2xl border border-border bg-card px-4 py-3.5"
                  accessibilityRole="button"
                  accessibilityLabel={browse.isGuest ? shop.name : `${shop.name}, ${shop.distanceKm} kilometers`}
                >
                  <Text className="text-base font-bold text-ink">{shop.name}</Text>
                  <Text className="mt-0.5 text-sm text-muted">
                    {browse.isGuest ? shop.locationLabel : `${shop.distanceKm} km · ${shop.locationLabel}`}
                  </Text>
                </Pressable>
              ))
            )}
          </View>

          {!browse.isGuest ? (
            <View className="mt-8 gap-2 border-t border-border pt-6">
              <Text className="text-sm font-semibold text-muted">Also on DUTS</Text>
              <Pressable
                onPress={() => navigation.navigate("DeliveryRequest")}
                className="rounded-2xl border border-border bg-card px-4 py-3"
              >
                <Text className="font-bold text-ink">Send a Package</Text>
              </Pressable>
              <Pressable onPress={() => navigation.navigate("PostGig")} className="rounded-2xl border border-border bg-card px-4 py-3">
                <Text className="font-bold text-ink">Request Help</Text>
              </Pressable>
            </View>
          ) : null}
        </StorePage>
      </ScrollView>
    </View>
  );
}

export function ShopSearchTabScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [q, setQ] = useState("");

  function runSearch() {
    if (q.trim()) navigation.navigate("ProductSearch", { q: q.trim() });
  }

  return (
    <View className="flex-1 bg-background">
      <StoreHeader showCategories={false} compact />
      <StorePage>
        <Text className="mt-5 text-2xl font-black text-ink">Search</Text>
        <View className="mt-4 flex-row items-center rounded-full border border-border bg-surface px-3.5 py-2.5">
          <Ionicons name="search" size={18} color={DUTS.muted} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search products and shops"
            placeholderTextColor={DUTS.placeholder}
            className="ml-2 flex-1 text-base text-ink"
            returnKeyType="search"
            onSubmitEditing={runSearch}
            accessibilityLabel="Search products"
            autoFocus
          />
        </View>
      </StorePage>
    </View>
  );
}
