import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { CompositeNavigationProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { TabScreen } from "../../components/TabScreen";
import { ProductCard } from "../../components/ProductCard";
import { AppButton } from "../../components/AppButton";
import { api } from "../../lib/api";
import { logDutsFlow } from "../../lib/flow-log";
import { useShopBrowse } from "../../lib/shop-browse";
import { DUTS } from "../../lib/theme";
import type { ClientTabParamList, RootStackParamList } from "../../navigation/types";
import { useShopAreaStore, timezoneAreaHint } from "../../stores/shop-area.store";
import { useCommerceCartStore } from "../../stores/commerce-cart.store";

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<ClientTabParamList, "Home">,
  NativeStackNavigationProp<RootStackParamList>
>;

const GUEST_CATEGORIES = ["Drinks", "Groceries", "Snacks", "Household"];
const FALLBACK_AREAS = [
  { id: "harare", name: "Harare", shopCount: 0 },
  { id: "bulawayo", name: "Bulawayo", shopCount: 0 },
  { id: "gweru", name: "Gweru", shopCount: 0 }
];

export function ShopHomeScreen() {
  const navigation = useNavigation<Nav>();
  const browse = useShopBrowse();
  const setArea = useShopAreaStore((s) => s.setArea);
  const addOffer = useCommerceCartStore((s) => s.addOffer);
  const pendingCheckout = useCommerceCartStore((s) => s.pendingCheckout);
  const setPendingCheckout = useCommerceCartStore((s) => s.setPendingCheckout);
  const lines = useCommerceCartStore((s) => s.lines);
  const [areaOpen, setAreaOpen] = useState(false);

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

  const productsQuery = useQuery({
    queryKey: ["commerce-products", ...browse.queryKey],
    queryFn: () => api.commerceNearbyProducts({ ...browse.geo!, limit: 24 }, browse.token),
    enabled: Boolean(browse.geo)
  });
  const categoriesQuery = useQuery({
    queryKey: ["commerce-categories", ...browse.queryKey],
    queryFn: () => api.commerceCategories(browse.geo!, browse.token),
    enabled: Boolean(browse.geo)
  });
  const shopsQuery = useQuery({
    queryKey: ["commerce-shops", ...browse.queryKey],
    queryFn: () => api.commerceNearbyShops(browse.geo!, browse.token),
    enabled: Boolean(browse.geo)
  });

  const categories = useMemo(() => {
    const fromApi = (categoriesQuery.data?.categories ?? []).map((c) => c.name);
    if (fromApi.length) return fromApi.slice(0, 8);
    return GUEST_CATEGORIES;
  }, [categoriesQuery.data]);

  function openSignIn() {
    navigation.navigate("MainTabs", { screen: "SignIn" });
  }

  function addFromCard(p: {
    catalogProductId: string | null;
    productId: string;
  }) {
    if (!browse.geo) return;
    if (browse.isGuest) logDutsFlow("GUEST_ADD_TO_CART");
    void api
      .commerceProductDetail(
        {
          ...browse.geo,
          catalogProductId: p.catalogProductId ?? undefined,
          productId: p.productId
        },
        browse.token
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
  }

  const canBrowse = Boolean(browse.geo);
  const areaName = browse.area?.name ?? "your area";

  return (
    <TabScreen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}>
        <View className="flex-row items-center justify-between">
          <Text className="text-2xl font-black text-ink">DUTS</Text>
          {browse.isGuest ? (
            <Pressable onPress={openSignIn} accessibilityRole="button" accessibilityLabel="Sign in">
              <Text className="text-base font-bold" style={{ color: DUTS.purple }}>
                Sign in
              </Text>
            </Pressable>
          ) : null}
        </View>
        <Text className="mt-1 text-sm text-muted">Shop nearby · delivered to you</Text>

        {browse.isGuest ? (
          <Pressable
            onPress={() => setAreaOpen(true)}
            className="mt-4 rounded-2xl border border-border bg-surface px-4 py-3"
            accessibilityRole="button"
            accessibilityLabel="Change shopping area"
          >
            <Text className="text-xs font-semibold uppercase text-muted">Shopping near</Text>
            <Text className="mt-1 text-base font-bold text-ink">{areaName} ▼</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => navigation.navigate("ShopLocation")}
            className="mt-4 rounded-2xl border border-border bg-surface px-4 py-3"
            accessibilityRole="button"
            accessibilityLabel="Set delivery location"
          >
            <Text className="text-xs font-semibold uppercase text-muted">Deliver to</Text>
            <Text className="mt-1 text-base font-bold text-ink">
              {browse.exact?.label ?? "Set your location"}
            </Text>
          </Pressable>
        )}

        <Pressable
          onPress={() => navigation.navigate("Search")}
          className="mt-3 rounded-2xl border border-border bg-card px-4 py-3.5"
          accessibilityRole="button"
          accessibilityLabel="Search products"
        >
          <Text className="text-base text-muted">Search products…</Text>
        </Pressable>

        <View className="mt-6">
          <Text className="mb-3 text-lg font-extrabold text-ink">Categories</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {categories.map((name) => (
              <Pressable
                key={name}
                onPress={() => {
                  if (!browse.isGuest && !browse.geo) {
                    navigation.navigate("ShopLocation");
                    return;
                  }
                  navigation.navigate("ProductSearch", { category: name, q: undefined });
                }}
                className="mr-2 rounded-full border border-border bg-card px-4 py-2.5"
                accessibilityRole="button"
                accessibilityLabel={`Category ${name}`}
              >
                <Text className="text-sm font-semibold text-ink">{name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {!browse.ready || (browse.isGuest && areasQuery.isLoading && !browse.geo) ? (
          <ActivityIndicator className="mt-8" color={DUTS.purple} />
        ) : !canBrowse && !browse.isGuest ? (
          <View className="mt-8 gap-3">
            <Text className="text-base text-muted">
              Set your location to see products available near you.
            </Text>
            <AppButton label="Set location" onPress={() => navigation.navigate("ShopLocation")} />
          </View>
        ) : (
          <>
            <View className="mt-6">
              <Text className="mb-3 text-lg font-extrabold text-ink">Products near you</Text>
              {productsQuery.isLoading ? (
                <ActivityIndicator color={DUTS.purple} />
              ) : (productsQuery.data?.products ?? []).length === 0 ? (
                <Text className="text-sm text-muted">
                  No shops nearby yet. We&apos;re still expanding DUTS in this area.
                </Text>
              ) : (
                <View className="flex-row flex-wrap justify-between">
                  {productsQuery.data!.products.map((p) => (
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
                      onAdd={() => addFromCard(p)}
                    />
                  ))}
                </View>
              )}
            </View>

            <View className="mt-6">
              <Text className="mb-3 text-lg font-extrabold text-ink">Nearby shops</Text>
              {(shopsQuery.data?.shops ?? []).map((shop) => (
                <Pressable
                  key={shop.id}
                  onPress={() => navigation.navigate("ShopDetail", { merchantId: shop.id })}
                  className="mb-3 rounded-2xl border border-border bg-card px-4 py-4"
                  accessibilityRole="button"
                  accessibilityLabel={
                    browse.isGuest ? shop.name : `${shop.name}, ${shop.distanceKm} kilometers`
                  }
                >
                  <Text className="text-base font-bold text-ink">{shop.name}</Text>
                  <Text className="mt-1 text-sm text-muted">
                    {browse.isGuest ? shop.locationLabel : `${shop.distanceKm} km · ${shop.locationLabel}`}
                  </Text>
                </Pressable>
              ))}
            </View>

            {!browse.isGuest ? (
              <View className="mt-8 gap-2 border-t border-border pt-6">
                <Text className="text-sm font-semibold text-muted">Also on DUTS</Text>
                <AppButton
                  label="Send a Package"
                  variant="secondary"
                  onPress={() => navigation.navigate("DeliveryRequest")}
                />
                <AppButton
                  label="Request Help"
                  variant="secondary"
                  onPress={() => navigation.navigate("PostGig")}
                />
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      <Modal visible={areaOpen} transparent animationType="fade" onRequestClose={() => setAreaOpen(false)}>
        <Pressable
          className="flex-1 justify-end"
          style={{ backgroundColor: "rgba(0,0,0,0.35)" }}
          onPress={() => setAreaOpen(false)}
        >
          <Pressable className="rounded-t-3xl bg-background px-5 pb-10 pt-5" onPress={(e) => e.stopPropagation?.()}>
            <Text className="text-lg font-extrabold text-ink">Change area</Text>
            {(areasQuery.data?.areas.length ? areasQuery.data.areas : FALLBACK_AREAS).map((item) => (
              <Pressable
                key={item.id}
                onPress={() => {
                  void setArea({ id: item.id, name: item.name });
                  setAreaOpen(false);
                }}
                className="mt-3 rounded-2xl border border-border bg-card px-4 py-3.5"
                accessibilityRole="button"
                accessibilityLabel={item.name}
              >
                <Text className="text-base font-bold text-ink">{item.name}</Text>
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </TabScreen>
  );
}

/** Lightweight search tab entry — navigates to ProductSearch with query. */
export function ShopSearchTabScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const browse = useShopBrowse();
  const [q, setQ] = useState("");

  function runSearch() {
    if (!browse.isGuest && !browse.geo) {
      navigation.navigate("ShopLocation");
      return;
    }
    if (q.trim()) navigation.navigate("ProductSearch", { q: q.trim() });
  }

  return (
    <TabScreen>
      <Text className="text-2xl font-black text-ink">Search</Text>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Mazoe, bread, milk…"
        placeholderTextColor={DUTS.placeholder}
        className="mt-4 rounded-2xl border border-border bg-card px-4 py-3.5 text-base text-ink"
        returnKeyType="search"
        onSubmitEditing={runSearch}
        accessibilityLabel="Search products"
      />
      <View className="mt-3">
        <AppButton label="Search" onPress={runSearch} />
      </View>
    </TabScreen>
  );
}
