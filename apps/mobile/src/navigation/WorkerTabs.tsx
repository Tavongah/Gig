import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WorkerHomeScreen } from "../screens/worker/WorkerHomeScreen";
import { WorkerNearbyGigsScreen } from "../screens/worker/WorkerNearbyGigsScreen";
import { WorkerEarningsScreen } from "../screens/worker/WorkerEarningsScreen";
import { ProfileScreen } from "../screens/shared/ProfileScreen";
import { SupportHomeScreen } from "../screens/support/SupportHomeScreen";
import type { WorkerTabParamList } from "./types";
import { DUTS } from "../lib/theme";

const Tab = createBottomTabNavigator<WorkerTabParamList>();

const TAB_CONFIG: Record<
  keyof WorkerTabParamList,
  { label: string; icon: keyof typeof Ionicons.glyphMap; iconFocused: keyof typeof Ionicons.glyphMap }
> = {
  Home: { label: "Home", icon: "home-outline", iconFocused: "home" },
  NearbyGigs: { label: "Nearby", icon: "locate-outline", iconFocused: "locate" },
  Support: { label: "Support", icon: "help-circle-outline", iconFocused: "help-circle" },
  Earnings: { label: "Earnings", icon: "wallet-outline", iconFocused: "wallet" },
  Profile: { label: "Profile", icon: "person-outline", iconFocused: "person" }
};

function TabIcon({ routeName, focused }: { routeName: keyof WorkerTabParamList; focused: boolean }) {
  const config = TAB_CONFIG[routeName];
  const color = focused ? DUTS.purple : DUTS.navInactive;

  return (
    <View
      accessibilityRole="button"
      accessibilityLabel={config.label}
      accessibilityState={{ selected: focused }}
      className="min-h-[44px] min-w-[64px] items-center justify-center gap-0.5"
    >
      <Ionicons name={focused ? config.iconFocused : config.icon} size={22} color={color} />
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        allowFontScaling={false}
        style={{ color, fontSize: 10, fontWeight: "700", textAlign: "center", width: "100%" }}
      >
        {config.label}
      </Text>
    </View>
  );
}

export function WorkerTabs() {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 8);

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
          <TabIcon routeName={route.name as keyof WorkerTabParamList} focused={focused} />
        )
      })}
    >
      <Tab.Screen name="Home" component={WorkerHomeScreen} options={{ title: "Home" }} />
      <Tab.Screen name="NearbyGigs" component={WorkerNearbyGigsScreen} options={{ title: "Nearby" }} />
      <Tab.Screen name="Support" component={SupportHomeScreen} options={{ title: "Support" }} />
      <Tab.Screen name="Earnings" component={WorkerEarningsScreen} options={{ title: "Earnings" }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: "Profile" }} />
    </Tab.Navigator>
  );
}
