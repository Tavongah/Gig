import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Text, View } from "react-native";
import { WorkerOffersScreen } from "../screens/worker/WorkerOffersScreen";
import { WorkerActiveScreen } from "../screens/worker/WorkerActiveScreen";
import { HistoryScreen } from "../screens/shared/HistoryScreen";
import { ProfileScreen } from "../screens/shared/ProfileScreen";
import type { WorkerTabParamList } from "./types";

const Tab = createBottomTabNavigator<WorkerTabParamList>();

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Offers: "⚡",
    Active: "🧰",
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

export function WorkerTabs() {
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
      <Tab.Screen name="Offers" component={WorkerOffersScreen} />
      <Tab.Screen name="Active" component={WorkerActiveScreen} />
      <Tab.Screen name="History" children={() => <HistoryScreen perspective="WORKER" />} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
