import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ShopHomeScreen, ShopSearchTabScreen } from "../screens/commerce/ShopHomeScreen";
import { CartScreen } from "../screens/commerce/CartScreen";
import { AuthNavigator } from "./AuthNavigator";
import type { GuestTabParamList } from "./types";
import { DUTS } from "../lib/theme";
import { useCommerceCartStore } from "../stores/commerce-cart.store";

const Tab = createBottomTabNavigator<GuestTabParamList>();

const TAB_CONFIG: Record<
  keyof GuestTabParamList,
  { label: string; icon: keyof typeof Ionicons.glyphMap; iconFocused: keyof typeof Ionicons.glyphMap }
> = {
  Home: { label: "Home", icon: "home-outline", iconFocused: "home" },
  Search: { label: "Search", icon: "search-outline", iconFocused: "search" },
  Cart: { label: "Cart", icon: "cart-outline", iconFocused: "cart" },
  SignIn: { label: "Sign in", icon: "person-outline", iconFocused: "person" }
};

function TabIcon({
  routeName,
  focused,
  badge
}: {
  routeName: keyof GuestTabParamList;
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

export function GuestTabs() {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 8);
  const cartCount = useCommerceCartStore((s) => s.lines.reduce((n, l) => n + l.quantity, 0));

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
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
            routeName={route.name as keyof GuestTabParamList}
            focused={focused}
            badge={route.name === "Cart" ? cartCount : undefined}
          />
        )
      })}
    >
      <Tab.Screen name="Home" component={ShopHomeScreen} options={{ title: "Home" }} />
      <Tab.Screen name="Search" component={ShopSearchTabScreen} options={{ title: "Search" }} />
      <Tab.Screen name="Cart" component={CartScreen} options={{ title: "Cart" }} />
      <Tab.Screen name="SignIn" component={AuthNavigator} options={{ title: "Sign in" }} />
    </Tab.Navigator>
  );
}
