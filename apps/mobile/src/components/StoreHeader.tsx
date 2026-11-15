import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { DUTS } from "../lib/theme";
import { CountBadge } from "./motion/CountBadge";
import { StoreSearchField } from "./StoreSearchField";
import { STOREFRONT_GUTTER, categoryIcon, storefrontShellStyle, useStorefrontLayout } from "../lib/storefront-ui";
import { headerChipCategories, isSmartBasketEnabled } from "../lib/storefront-categories";
import { openStorefrontCategory } from "../lib/storefront-nav";
import { useShopBrowse } from "../lib/shop-browse";
import { useCommerceCartStore } from "../stores/commerce-cart.store";
import { useDesiredBasketStore } from "../stores/desired-basket.store";
import type { RootStackParamList } from "../navigation/types";
import type { ReactNode } from "react";

function headerSupportsBlur() {
  if (Platform.OS !== "web") return false;
  const css = (globalThis as { CSS?: { supports?: (property: string, value: string) => boolean } }).CSS;
  return Boolean(css?.supports?.("backdrop-filter", "blur(12px)") || css?.supports?.("-webkit-backdrop-filter", "blur(12px)"));
}

type Props = {
  categories?: string[];
  initialQuery?: string;
  showCategories?: boolean;
  compact?: boolean;
};

export function StoreHeader({ categories = [], initialQuery = "", showCategories = true, compact }: Props) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const browse = useShopBrowse();
  const merchantCount = useCommerceCartStore((s) => s.lines.reduce((n, l) => n + l.quantity, 0));
  const listCount = useDesiredBasketStore((s) => s.lines.reduce((n, l) => n + l.quantity, 0));
  const cartCount = merchantCount + (isSmartBasketEnabled() ? listCount : 0);
  const insets = useSafeAreaInsets();
  const { isDesktopNav } = useStorefrontLayout();
  const blur = headerSupportsBlur();

  function runSearch(value: string) {
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

  function openOrders() {
    if (browse.isGuest) navigation.navigate("MainTabs", { screen: "SignIn" });
    else navigation.navigate("MainTabs", { screen: "Orders" });
  }

  function openCart() {
    navigation.navigate("MainTabs", { screen: "Cart" });
  }

  const searchField = <StoreSearchField initialQuery={initialQuery} onSubmit={runSearch} />;

  const accountControl = (
    <Pressable
      onPress={openAccount}
      accessibilityRole="button"
      accessibilityLabel={browse.isGuest ? "Sign in" : "Account"}
      className="duts-focus-ring min-h-[44px] min-w-[44px] items-center justify-center px-2"
      hitSlop={4}
    >
      <Text className="text-sm font-bold" style={{ color: DUTS.purple }}>
        {browse.isGuest ? "Sign in" : "Account"}
      </Text>
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
        style={{ marginHorizontal: -STOREFRONT_GUTTER, zIndex: 0 }}
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
      className="duts-store-header border-b border-border bg-background"
      style={[
        {
          paddingTop: Math.max(insets.top, 8),
          zIndex: 40,
          backgroundColor: DUTS.background,
          overflow: "visible"
        },
        Platform.OS === "web"
          ? ({
              position: "sticky",
              top: 0,
              backgroundColor: blur ? "rgba(255,255,255,0.85)" : DUTS.background,
              backdropFilter: blur ? "blur(12px)" : "none",
              transitionProperty: "background-color, border-color",
              transitionDuration: "0s"
            } as object)
          : undefined
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
              {browse.isGuest ? null : (
                <Pressable onPress={openOrders} accessibilityRole="button" accessibilityLabel="Orders">
                  <Text className="text-sm font-bold" style={{ color: DUTS.purple }}>
                    Orders
                  </Text>
                </Pressable>
              )}
              {accountControl}
              {cartControl}
            </View>
            {compact ? null : categoryRow}
          </>
        ) : (
          <>
            <View className="flex-row items-center justify-between">
              <Text className="text-xl font-black text-ink">DUTS</Text>
              {accountControl}
            </View>
            <View className="mt-2">{searchField}</View>
            {compact ? null : categoryRow}
          </>
        )}
      </View>
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
