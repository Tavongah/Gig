import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { DUTS } from "../lib/theme";
import { STOREFRONT_MAX_WIDTH, categoryIcon, useStorefrontLayout } from "../lib/storefront-ui";
import { useShopBrowse } from "../lib/shop-browse";
import { useCommerceCartStore } from "../stores/commerce-cart.store";
import { useShopAreaStore } from "../stores/shop-area.store";
import { api } from "../lib/api";
import type { RootStackParamList } from "../navigation/types";
import type { ReactNode } from "react";

const FALLBACK_AREAS = [
  { id: "harare", name: "Harare", shopCount: 0 },
  { id: "bulawayo", name: "Bulawayo", shopCount: 0 },
  { id: "gweru", name: "Gweru", shopCount: 0 }
];

type Props = {
  categories?: string[];
  initialQuery?: string;
  showCategories?: boolean;
  compact?: boolean;
};

export function StoreHeader({ categories = [], initialQuery = "", showCategories = true, compact }: Props) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const browse = useShopBrowse();
  const setArea = useShopAreaStore((s) => s.setArea);
  const cartCount = useCommerceCartStore((s) => s.lines.reduce((n, l) => n + l.quantity, 0));
  const insets = useSafeAreaInsets();
  const { isDesktopNav } = useStorefrontLayout();
  const [q, setQ] = useState(initialQuery);
  const [areaOpen, setAreaOpen] = useState(false);
  const areasQuery = useQuery({
    queryKey: ["commerce-shopping-areas"],
    queryFn: () => api.commerceShoppingAreas(),
    enabled: browse.isGuest
  });
  const areas = areasQuery.data?.areas.length ? areasQuery.data.areas : FALLBACK_AREAS;

  const areaName = browse.isGuest
    ? (browse.area?.name ?? "your area")
    : (browse.exact?.label ?? "Set your location");

  function runSearch(value = q) {
    const next = value.trim();
    if (!next) {
      navigation.navigate("MainTabs", { screen: "Search" });
      return;
    }
    navigation.navigate("ProductSearch", { q: next });
  }

  function openAccount() {
    if (browse.isGuest) navigation.navigate("MainTabs", { screen: "SignIn" });
    else navigation.navigate("MainTabs", { screen: "Account" });
  }

  function openCart() {
    navigation.navigate("MainTabs", { screen: "Cart" });
  }

  function onAreaPress() {
    if (browse.isGuest) {
      setAreaOpen(true);
      return;
    }
    navigation.navigate("ShopLocation");
  }

  const searchField = (
    <View className="flex-row items-center rounded-full border border-border bg-surface px-3.5 py-2.5">
      <Ionicons name="search" size={18} color={DUTS.muted} />
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Search DUTS"
        placeholderTextColor={DUTS.placeholder}
        className="ml-2 flex-1 text-base text-ink"
        returnKeyType="search"
        onSubmitEditing={() => runSearch()}
        accessibilityLabel="Search products and shops"
        accessibilityRole="search"
      />
    </View>
  );

  const areaControl = (
    <Pressable
      onPress={onAreaPress}
      accessibilityRole="button"
      accessibilityLabel={browse.isGuest ? "Change shopping area" : "Set delivery location"}
      className="flex-row items-center"
      hitSlop={6}
    >
      <Ionicons name="location-outline" size={16} color={DUTS.purple} />
      <View className="ml-1">
        <Text className="text-[10px] font-semibold uppercase tracking-wide text-muted">
          {browse.isGuest ? "Shopping near" : "Deliver to"}
        </Text>
        <Text className="text-sm font-bold text-ink" numberOfLines={1}>
          {areaName} ▾
        </Text>
      </View>
    </Pressable>
  );

  const cartControl = (
    <Pressable
      onPress={openCart}
      accessibilityRole="button"
      accessibilityLabel={cartCount ? `Cart (${cartCount})` : "Cart"}
      className="flex-row items-center"
      hitSlop={8}
    >
      <View>
        <Ionicons name="cart-outline" size={22} color={DUTS.ink} />
        {cartCount > 0 ? (
          <View
            className="absolute -right-2 -top-1 min-w-[16px] items-center rounded-full px-1"
            style={{ backgroundColor: DUTS.purple }}
          >
            <Text style={{ color: "#fff", fontSize: 9, fontWeight: "800" }}>
              {cartCount > 99 ? "99+" : cartCount}
            </Text>
          </View>
        ) : null}
      </View>
      {isDesktopNav ? (
        <Text className="ml-2 text-sm font-bold text-ink">Cart{cartCount ? ` (${cartCount})` : ""}</Text>
      ) : null}
    </Pressable>
  );

  const categoryRow =
    showCategories && categories.length > 0 ? (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className={isDesktopNav ? "mt-3" : "mt-4"}
        contentContainerStyle={{ gap: 8, paddingRight: 8 }}
      >
        {categories.slice(0, isDesktopNav ? 8 : 12).map((name) => (
          <Pressable
            key={name}
            onPress={() => navigation.navigate("ProductSearch", { category: name, q: undefined })}
            accessibilityRole="button"
            accessibilityLabel={`Category ${name}`}
            className="flex-row items-center rounded-full border border-border bg-card px-3 py-2"
          >
            <Ionicons name={categoryIcon(name)} size={16} color={DUTS.purple} />
            <Text className="ml-1.5 text-sm font-semibold text-ink">{name}</Text>
          </Pressable>
        ))}
      </ScrollView>
    ) : null;

  return (
    <View
      className="border-b border-border bg-background"
      style={[
        { paddingTop: Math.max(insets.top, 8) },
        isDesktopNav ? ({ position: "sticky", top: 0, zIndex: 30 } as object) : undefined
      ]}
    >
      <View className="w-full self-center px-4 py-3" style={{ maxWidth: STOREFRONT_MAX_WIDTH }}>
        {isDesktopNav ? (
          <>
            <View className="flex-row items-center gap-4">
              <Pressable onPress={() => navigation.navigate("MainTabs", { screen: "Home" })} accessibilityRole="button" accessibilityLabel="DUTS home">
                <Text className="text-2xl font-black text-ink">DUTS</Text>
              </Pressable>
              <View className="min-w-0 flex-1">{searchField}</View>
              {areaControl}
              <Pressable onPress={openAccount} accessibilityRole="button" accessibilityLabel={browse.isGuest ? "Sign in" : "Account"}>
                <Text className="text-sm font-bold" style={{ color: DUTS.purple }}>
                  {browse.isGuest ? "Sign in" : "Account"}
                </Text>
              </Pressable>
              {cartControl}
            </View>
            {compact ? null : categoryRow}
          </>
        ) : (
          <>
            <View className="flex-row items-center justify-between">
              <Text className="text-xl font-black text-ink">DUTS</Text>
              <Pressable onPress={openAccount} accessibilityRole="button" accessibilityLabel={browse.isGuest ? "Sign in" : "Account"}>
                <Text className="text-sm font-bold" style={{ color: DUTS.purple }}>
                  {browse.isGuest ? "Sign in" : "Account"}
                </Text>
              </Pressable>
            </View>
            <View className="mt-2">{areaControl}</View>
            <View className="mt-3">{searchField}</View>
            {compact ? null : categoryRow}
          </>
        )}
      </View>

      <Modal visible={areaOpen} transparent animationType="fade" onRequestClose={() => setAreaOpen(false)}>
        <Pressable
          className="flex-1 justify-end"
          style={{ backgroundColor: "rgba(0,0,0,0.35)" }}
          onPress={() => setAreaOpen(false)}
        >
          <Pressable className="rounded-t-3xl bg-background px-5 pb-10 pt-5" onPress={(e) => e.stopPropagation?.()}>
            <Text className="text-lg font-extrabold text-ink">Change area</Text>
            <Text className="mt-1 text-sm text-muted">Approximate shopping area for browsing DUTS.</Text>
            {areas.map((item) => (
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
    </View>
  );
}

export function StorePage({ children }: { children: ReactNode }) {
  return (
    <View className="w-full flex-1 self-center px-4" style={{ maxWidth: STOREFRONT_MAX_WIDTH }}>
      {children}
    </View>
  );
}
