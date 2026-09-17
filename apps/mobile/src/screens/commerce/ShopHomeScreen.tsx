import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
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
import { DUTS } from "../../lib/theme";
import type { ClientTabParamList, RootStackParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";
import { useShopLocationStore } from "../../stores/shop-location.store";
import { useCommerceCartStore } from "../../stores/commerce-cart.store";

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<ClientTabParamList, "Home">,
  NativeStackNavigationProp<RootStackParamList>
>;

const GUEST_CATEGORIES = ["Drinks", "Groceries", "Snacks", "Household"];

export function ShopHomeScreen() {
  const navigation = useNavigation<Nav>();
  const session = useSessionStore((s) => s.session);
  const token = session?.token;
  const userId = session?.user.id;
  const location = useShopLocationStore((s) => s.location);
  const hydrated = useShopLocationStore((s) => s.hydrated);
  const hydrate = useShopLocationStore((s) => s.hydrate);
  const useDeviceLocation = useShopLocationStore((s) => s.useDeviceLocation);
  const useSavedAddress = useShopLocationStore((s) => s.useSavedAddress);
  const addOffer = useCommerceCartStore((s) => s.addOffer);
  const pendingCheckout = useCommerceCartStore((s) => s.pendingCheckout);
  const setPendingCheckout = useCommerceCartStore((s) => s.setPendingCheckout);
  const lines = useCommerceCartStore((s) => s.lines);
  const [locBusy, setLocBusy] = useState(false);
  const [locError, setLocError] = useState("");

  useEffect(() => {
    void hydrate(userId);
  }, [hydrate, userId]);

  useEffect(() => {
    if (session && pendingCheckout && lines.length) {
      setPendingCheckout(false);
      navigation.navigate("CommerceCheckout");
    }
  }, [session, pendingCheckout, lines.length, navigation, setPendingCheckout]);

  const geo = location;
  const productsQuery = useQuery({
    queryKey: ["commerce-products", geo?.latitude, geo?.longitude],
    queryFn: () =>
      api.commerceNearbyProducts({ lat: geo!.latitude, lng: geo!.longitude, limit: 24 }, token),
    enabled: Boolean(geo)
  });
  const categoriesQuery = useQuery({
    queryKey: ["commerce-categories", geo?.latitude, geo?.longitude],
    queryFn: () => api.commerceCategories(geo!.latitude, geo!.longitude, token),
    enabled: Boolean(geo)
  });
  const shopsQuery = useQuery({
    queryKey: ["commerce-shops", geo?.latitude, geo?.longitude],
    queryFn: () => api.commerceNearbyShops(geo!.latitude, geo!.longitude, token),
    enabled: Boolean(geo)
  });

  const categories = useMemo(() => {
    const fromApi = (categoriesQuery.data?.categories ?? []).map((c) => c.name);
    if (fromApi.length) return fromApi.slice(0, 8);
    return GUEST_CATEGORIES;
  }, [categoriesQuery.data]);

  async function enableLocation() {
    setLocBusy(true);
    setLocError("");
    try {
      if (userId) {
        const fromSaved = await useSavedAddress(userId);
        if (fromSaved) return;
      }
      await useDeviceLocation();
    } catch {
      setLocError("We couldn't get your location. Check permissions and try again.");
    } finally {
      setLocBusy(false);
    }
  }

  function openSignIn() {
    navigation.navigate("MainTabs", { screen: "SignIn" });
  }

  function addFromCard(p: {
    catalogProductId: string | null;
    productId: string;
  }) {
    if (!location) return;
    if (!token) logDutsFlow("GUEST_ADD_TO_CART");
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
  }

  return (
    <TabScreen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}>
        <View className="flex-row items-center justify-between">
          <Text className="text-2xl font-black text-ink">DUTS</Text>
          {!session ? (
            <Pressable onPress={openSignIn} accessibilityRole="button" accessibilityLabel="Sign in">
              <Text className="text-base font-bold" style={{ color: DUTS.purple }}>
                Sign in
              </Text>
            </Pressable>
          ) : null}
        </View>
        <Text className="mt-1 text-sm text-muted">Shop nearby · delivered to you</Text>

        <Pressable
          onPress={() => navigation.navigate("ShopLocation")}
          className="mt-4 rounded-2xl border border-border bg-surface px-4 py-3"
          accessibilityRole="button"
          accessibilityLabel="Set delivery location"
        >
          <Text className="text-xs font-semibold uppercase text-muted">Deliver to</Text>
          <Text className="mt-1 text-base font-bold text-ink">
            {location?.label ?? "Set your location"}
          </Text>
        </Pressable>
        {locError ? <Text className="mt-2 text-sm text-danger">{locError}</Text> : null}

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
                  if (!location) {
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

        {!hydrated || locBusy ? (
          <ActivityIndicator className="mt-8" color={DUTS.purple} />
        ) : !location ? (
          <View className="mt-8 gap-3">
            <Text className="text-base text-muted">
              Set your location to see products available near you.
            </Text>
            <AppButton label="Set location" onPress={() => navigation.navigate("ShopLocation")} />
            <AppButton label="Use my location" variant="secondary" onPress={() => void enableLocation()} />
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
                  accessibilityLabel={`${shop.name}, ${shop.distanceKm} kilometers`}
                >
                  <Text className="text-base font-bold text-ink">{shop.name}</Text>
                  <Text className="mt-1 text-sm text-muted">
                    {shop.distanceKm} km · {shop.locationLabel}
                  </Text>
                </Pressable>
              ))}
            </View>

            {session ? (
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
    </TabScreen>
  );
}

/** Lightweight search tab entry — navigates to ProductSearch with query. */
export function ShopSearchTabScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const location = useShopLocationStore((s) => s.location);
  const [q, setQ] = useState("");

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
        onSubmitEditing={() => {
          if (!location) {
            navigation.navigate("ShopLocation");
            return;
          }
          if (q.trim()) navigation.navigate("ProductSearch", { q: q.trim() });
        }}
        accessibilityLabel="Search products"
      />
      <View className="mt-3">
        <AppButton
          label="Search"
          onPress={() => {
            if (!location) {
              navigation.navigate("ShopLocation");
              return;
            }
            if (q.trim()) navigation.navigate("ProductSearch", { q: q.trim() });
          }}
        />
      </View>
    </TabScreen>
  );
}
