import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { View } from "react-native";
import { ClientTabs } from "./ClientTabs";
import { WorkerTabs } from "./WorkerTabs";
import { GigDetailScreen } from "../screens/shared/GigDetailScreen";
import { ChatScreen } from "../screens/shared/ChatScreen";
import type { RootStackParamList } from "./types";
import { useSessionStore } from "../stores/session.store";

const Stack = createNativeStackNavigator<RootStackParamList>();

function RoleTabs() {
  const activeRole = useSessionStore((state) => state.activeRole);
  return activeRole === "WORKER" ? <WorkerTabs key="worker" /> : <ClientTabs key="client" />;
}

export function AppNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        contentStyle: { backgroundColor: "#020617" },
        headerStyle: { backgroundColor: "#0f172a" },
        headerTintColor: "#ffffff",
        headerTitleStyle: { fontWeight: "800" }
      }}
    >
      <Stack.Screen name="MainTabs" component={RoleTabs} options={{ headerShown: false }} />
      <Stack.Screen name="GigDetail" component={GigDetailScreen} options={{ title: "Gig tracking" }} />
      <Stack.Screen name="Chat" component={ChatScreen} options={({ route }) => ({ title: route.params.title })} />
    </Stack.Navigator>
  );
}

export function AppHeader() {
  return <View className="h-0" />;
}
