import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ShopHomeScreen, ShopSearchTabScreen } from "../screens/commerce/ShopHomeScreen";
import { CommerceOrdersScreen } from "../screens/commerce/CommerceOrdersScreen";
import { CartScreen } from "../screens/commerce/CartScreen";
import { ProfileScreen } from "../screens/shared/ProfileScreen";
import type { ClientTabParamList } from "./types";
import { DUTS } from "../lib/theme";
import { useCommerceCartStore } from "../stores/commerce-cart.store";
import { useStorefrontLayout } from "../lib/storefront-ui";

const Tab = createBottomTabNavigator<ClientTabParamList>();

const TAB_CONFIG: Record<
  keyof ClientTabParamList,
  { label: string; icon: keyof typeof Ionicons.glyphMap; iconFocused: keyof typeof Ionicons.glyphMap }
> = {
  Home: { label: "Home", icon: "home-outline", iconFocused: "home" },
  Search: { label: "Search", icon: "search-outline", iconFocused: "search" },
  Orders: { label: "Orders", icon: "receipt-outline", iconFocused: "receipt" },
  Cart: { label: "Cart", icon: "cart-outline", iconFocused: "cart" },
  Account: { label: "Account", icon: "person-outline", iconFocused: "person" }
};

function TabIcon({
  routeName,
  focused,
  badge
}: {
  routeName: keyof ClientTabParamList;
  focused: boolean;
  badge?: number;
}) {
  const config = TAB_CONFIG[routeName];
  const color = focused ? DUTS.purple : DUTS.navInactive;

  return (
    <View
      accessibilityRole="button"
      accessibilityLabel={badge ? `${config.label}, ${badge} items` : config.label}
      accessibilityState={{ selected: focused }}
      className="min-h-[44px] min-w-[64px] items-center justify-center gap-0.5"
    >
      <View>
        <Ionicons name={focused ? config.iconFocused : config.icon} size={22} color={color} />
        {badge && badge > 0 ? (
          <View
            className="absolute -right-2 -top-1 min-w-[16px] items-center rounded-full px-1"
            style={{ backgroundColor: DUTS.purple }}
          >
            <Text style={{ color: "#fff", fontSize: 9, fontWeight: "800" }}>
              {badge > 99 ? "99+" : badge}
            </Text>
          </View>
        ) : null}
      </View>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
        allowFontScaling={false}
        style={{ color, fontSize: 10, fontWeight: "700", textAlign: "center", width: "100%" }}
      >
        {config.label}
      </Text>
    </View>
  );
}

export function ClientTabs() {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 8);
  const cartCount = useCommerceCartStore((s) =>
    s.lines.reduce((n, l) => n + l.quantity, 0)
  );
  const { isDesktopNav } = useStorefrontLayout();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: isDesktopNav
          ? { display: "none", height: 0, overflow: "hidden" as const }
          : {
              backgroundColor: DUTS.card,
              borderTopColor: DUTS.border,
              height: 58 + bottomPad,
              paddingBottom: bottomPad,
              paddingTop: 6
            },
        tabBarShowLabel: false,
        tabBarItemStyle: {
          flex: 1,
          alignItems: "center",
          justifyContent: "center"
        },
        tabBarIcon: ({ focused }) => (
          <TabIcon
            routeName={route.name as keyof ClientTabParamList}
            focused={focused}
            badge={route.name === "Cart" ? cartCount : undefined}
          />
        )
      })}
    >
      <Tab.Screen name="Home" component={ShopHomeScreen} options={{ title: "Home" }} />
      <Tab.Screen name="Search" component={ShopSearchTabScreen} options={{ title: "Search" }} />
      <Tab.Screen name="Orders" component={CommerceOrdersScreen} options={{ title: "Orders" }} />
      <Tab.Screen name="Cart" component={CartScreen} options={{ title: "Cart" }} />
      <Tab.Screen name="Account" component={ProfileScreen} options={{ title: "Account" }} />
    </Tab.Navigator>
  );
}
