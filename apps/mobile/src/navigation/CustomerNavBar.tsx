import { Platform, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { CountBadge } from "../components/motion/CountBadge";
import { isSmartBasketEnabled } from "../lib/storefront-categories";
import { useStorefrontLayout } from "../lib/storefront-ui";
import { DUTS } from "../lib/theme";
import { useCommerceCartStore } from "../stores/commerce-cart.store";
import { useDesiredBasketStore } from "../stores/desired-basket.store";
import { useSessionStore } from "../stores/session.store";
import type { RootStackParamList } from "./types";

const SHOPPING_ROUTES = new Set([
  "ProductSearch",
  "ProductDetail",
  "ShopDetail",
  "MarketplaceCategory",
  "AllCategories"
]);

type NavItem = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconFocused: keyof typeof Ionicons.glyphMap;
  badge?: number;
};

if (Platform.OS === "web" && typeof document !== "undefined") {
  const meta = document.querySelector('meta[name="viewport"]');
  const content = meta?.getAttribute("content") ?? "";
  if (meta && content && !content.includes("viewport-fit")) {
    meta.setAttribute("content", `${content}, viewport-fit=cover`);
  }
}

function useCartCount() {
  const merchantCount = useCommerceCartStore((s) => s.lines.reduce((n, l) => n + l.quantity, 0));
  const listCount = useDesiredBasketStore((s) => s.lines.reduce((n, l) => n + l.quantity, 0));
  return merchantCount + (isSmartBasketEnabled() ? listCount : 0);
}

export function CustomerNavBar({
  items,
  activeKey,
  onPress
}: {
  items: NavItem[];
  activeKey: string | null;
  onPress: (key: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 8);

  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        alignItems: "flex-end",
        backgroundColor: DUTS.card,
        borderTopWidth: 1,
        borderTopColor: DUTS.border,
        paddingBottom: bottom,
        paddingTop: 6
      }}
    >
      {items.map((item) => {
        const focused = item.key === activeKey;
        const color = focused ? DUTS.purple : DUTS.navInactive;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityLabel={item.badge ? `${item.label}, ${item.badge} items` : item.label}
            accessibilityState={{ selected: focused }}
            aria-selected={focused}
            onPress={() => onPress(item.key)}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 48,
              alignItems: "center",
              justifyContent: "center",
              paddingVertical: 2,
              opacity: pressed ? 0.72 : 1
            })}
          >
            <View
              style={{
                width: 28,
                height: 3,
                borderRadius: 2,
                marginBottom: 4,
                backgroundColor: focused ? DUTS.purple : "transparent"
              }}
            />
            <View>
              <Ionicons name={focused ? item.iconFocused : item.icon} size={22} color={color} />
              {item.badge ? <CountBadge count={item.badge} /> : null}
            </View>
            <Text
              numberOfLines={1}
              allowFontScaling={false}
              style={{ color, fontSize: 11, fontWeight: "600", marginTop: 2, textAlign: "center" }}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function customerItems(signedIn: boolean, cartCount: number): NavItem[] {
  return [
    { key: "Home", label: "Home", icon: "home-outline", iconFocused: "home" },
    { key: "Search", label: "Search", icon: "search-outline", iconFocused: "search" },
    { key: "Cart", label: "Cart", icon: "cart-outline", iconFocused: "cart", badge: cartCount },
    signedIn
      ? { key: "Account", label: "Account", icon: "person-outline", iconFocused: "person" }
      : { key: "SignIn", label: "Account", icon: "person-outline", iconFocused: "person" }
  ];
}

/** Website tab bar. Native tabs keep the navigator defaults. */
export function WebCustomerTabBar({ state, navigation }: BottomTabBarProps) {
  const { isDesktopNav } = useStorefrontLayout();
  const cartCount = useCartCount();
  if (Platform.OS !== "web" || isDesktopNav) return null;

  const current = state.routes[state.index]?.name ?? "";
  const signedIn = state.routeNames.includes("Account");
  const activeKey = current === "Orders" ? "Account" : current;

  return (
    <CustomerNavBar
      items={customerItems(signedIn, cartCount)}
      activeKey={activeKey}
      onPress={(key) => {
        const route = state.routes.find((item) => item.name === key);
        if (!route) return;
        const event = navigation.emit({
          type: "tabPress",
          target: route.key,
          canPreventDefault: true
        });
        if (!event.defaultPrevented) navigation.navigate(route.name);
      }}
    />
  );
}

/**
 * Same website bar on shopping screens that sit above the tab navigator.
 * Returns nothing on native, desktop, worker mode, and non-shopping routes.
 */
export function CustomerShoppingNav() {
  const { isDesktopNav } = useStorefrontLayout();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute();
  const session = useSessionStore((s) => s.session);
  const activeRole = useSessionStore((s) => s.activeRole);
  const cartCount = useCartCount();

  if (Platform.OS !== "web" || isDesktopNav) return null;
  if (session && activeRole === "WORKER") return null;
  if (!SHOPPING_ROUTES.has(route.name)) return null;

  const signedIn = Boolean(session);
  return (
    <CustomerNavBar
      items={customerItems(signedIn, cartCount)}
      activeKey="Search"
      onPress={(key) => navigation.navigate("MainTabs", { screen: key as "Home" })}
    />
  );
}

export function webCustomerTabBarHeight(bottomInset: number, desktop: boolean) {
  if (desktop) return 0;
  return 62 + Math.max(bottomInset, 8);
}
