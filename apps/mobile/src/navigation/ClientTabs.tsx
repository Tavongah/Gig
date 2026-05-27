import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Text, View } from "react-native";
import { ClientPostScreen } from "../screens/client/ClientPostScreen";
import { ClientActiveScreen } from "../screens/client/ClientActiveScreen";
import { HistoryScreen } from "../screens/shared/HistoryScreen";
import { ProfileScreen } from "../screens/shared/ProfileScreen";
import type { ClientTabParamList } from "./types";

const Tab = createBottomTabNavigator<ClientTabParamList>();

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Home: "🏠",
    Active: "📍",
    History: "📋",
    Profile: "👤"
  };

  return (
    <View className="items-center gap-1">
      <Text className="text-lg">{icons[label] ?? "•"}</Text>
      <Text className={`text-[10px] font-bold ${focused ? "text-brand" : "text-slate-500"}`}>{label}</Text>
    </View>
  );
}

export function ClientTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "#0f172a",
          borderTopColor: "#1e293b",
          height: 72,
          paddingBottom: 10,
          paddingTop: 8
        },
        tabBarShowLabel: false,
        tabBarIcon: ({ focused }) => <TabIcon label={route.name} focused={focused} />
      })}
    >
      <Tab.Screen name="Home" component={ClientPostScreen} />
      <Tab.Screen name="Active" component={ClientActiveScreen} />
      <Tab.Screen name="History" children={() => <HistoryScreen perspective="CLIENT" />} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
