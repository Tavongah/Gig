import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { DUTS } from "../lib/theme";
import { CountBadge } from "./motion/CountBadge";
import { STOREFRONT_GUTTER, categoryIcon, storefrontShellStyle, useStorefrontLayout } from "../lib/storefront-ui";
import { headerChipCategories, isSmartBasketEnabled } from "../lib/storefront-categories";
import { openStorefrontCategory } from "../lib/storefront-nav";
import { useShopBrowse } from "../lib/shop-browse";
import { useCommerceCartStore } from "../stores/commerce-cart.store";
import { useDesiredBasketStore } from "../stores/desired-basket.store";
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
  const merchantCount = useCommerceCartStore((s) => s.lines.reduce((n, l) => n + l.quantity, 0));
  const listCount = useDesiredBasketStore((s) => s.lines.reduce((n, l) => n + l.quantity, 0));
  const cartCount = merchantCount + (isSmartBasketEnabled() ? listCount : 0);
  const insets = useSafeAreaInsets();
  const { isDesktopNav } = useStorefrontLayout();
  const [q, setQ] = useState(initialQuery);
  const [areaOpen, setAreaOpen] = useState(false);
  const useAreaPicker = browse.isGuest || !browse.exact;
  const areasQuery = useQuery({
    queryKey: ["commerce-shopping-areas"],
    queryFn: () => api.commerceShoppingAreas(),
    enabled: useAreaPicker
  });
  const areas = areasQuery.data?.areas.length ? areasQuery.data.areas : FALLBACK_AREAS;

  const areaName = useAreaPicker
    ? (browse.area?.name ?? "your area")
    : (browse.exact?.label ?? "your area");

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
    if (useAreaPicker) {
      setAreaOpen(true);
      return;
    }
    navigation.navigate("ShopLocation");
  }

  const searchField = (
    <View className={`flex-row items-center rounded-full border border-border bg-surface px-3.5 ${isDesktopNav ? "py-2.5" : "py-2"}`}>
      <Ionicons name="search" size={18} color={DUTS.muted} />
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Search DUTS"
        placeholderTextColor={DUTS.placeholder}
        className="ml-2 flex-1 text-base text-ink"
        returnKeyType="search"
        onSubmitEditing={() => runSearch()}
        accessibilityLabel="Search products"
        accessibilityRole="search"
      />
    </View>
  );

  const areaControl = (
    <Pressable
      onPress={onAreaPress}
      accessibilityRole="button"
      accessibilityLabel={useAreaPicker ? "Change shopping area" : "Change delivery location"}
      className="flex-row items-center"
      hitSlop={6}
    >
      <Ionicons name="location-outline" size={16} color={DUTS.purple} />
      <View className="ml-1">
        <Text className="text-[10px] font-semibold uppercase tracking-wide text-muted">
          {useAreaPicker ? "Shopping near" : "Deliver to"}
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
        <CountBadge count={cartCount} />
      </View>
      {isDesktopNav ? (
        <Text className="ml-2 text-sm font-bold text-ink">Cart{cartCount ? ` (${cartCount})` : ""}</Text>
      ) : null}
    </Pressable>
  );

  const chips = headerChipCategories(categories, isDesktopNav);

  const categoryRow =
    showCategories && (chips.length > 0 || categories.length > 0) ? (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className={`duts-chip-row ${isDesktopNav ? "mt-3" : "mt-2"}`}
        style={{ marginHorizontal: -STOREFRONT_GUTTER }}
        contentContainerStyle={{
          gap: 8,
          paddingLeft: STOREFRONT_GUTTER,
          paddingRight: STOREFRONT_GUTTER + 20
        }}
      >
        {chips.map((cat) => (
          <Pressable
            key={cat.slug}
            onPress={() => openStorefrontCategory(navigation, cat, categories)}
            accessibilityRole="button"
            accessibilityLabel={`Category ${cat.label}`}
            className="duts-chip flex-row items-center rounded-full border border-border bg-card px-3 py-2"
            style={({ pressed }) => ({
              transform: [{ scale: pressed ? 0.97 : 1 }],
              backgroundColor: pressed ? DUTS.surface : DUTS.card
            })}
          >
            <Ionicons name={categoryIcon(cat.label)} size={16} color={DUTS.purple} />
            <Text className="ml-1.5 text-sm font-semibold text-ink">{cat.label}</Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => navigation.navigate("AllCategories")}
          accessibilityRole="button"
          accessibilityLabel="All categories"
          className="duts-chip flex-row items-center rounded-full border border-border bg-card px-3 py-2"
          style={({ pressed }) => ({
            transform: [{ scale: pressed ? 0.97 : 1 }],
            backgroundColor: pressed ? DUTS.surface : DUTS.card
          })}
        >
          <Ionicons name="grid-outline" size={16} color={DUTS.purple} />
          <Text className="ml-1.5 text-sm font-semibold text-ink">All categories</Text>
        </Pressable>
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
      <View className={`w-full self-center ${isDesktopNav ? "py-3" : "py-2"}`} style={storefrontShellStyle}>
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
            <View className="mt-2">{searchField}</View>
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
    <View className="w-full flex-1 self-center" style={storefrontShellStyle}>
      {children}
    </View>
  );
}
