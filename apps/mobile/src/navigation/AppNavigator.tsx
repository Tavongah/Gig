import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { ClientTabs } from "./ClientTabs";
import { WorkerTabs } from "./WorkerTabs";
import { GigDetailScreen } from "../screens/shared/GigDetailScreen";
import { GigTrackingScreen } from "../screens/shared/GigTrackingScreen";
import { ChatScreen } from "../screens/shared/ChatScreen";
import { ReviewScreen } from "../screens/shared/ReviewScreen";
import type { RootStackParamList } from "./types";
import { useSessionStore } from "../stores/session.store";
import { DUTS } from "../lib/theme";

const Stack = createNativeStackNavigator<RootStackParamList>();

function RoleTabs() {
  const activeRole = useSessionStore((state) => state.activeRole);
  return activeRole === "WORKER" ? <WorkerTabs key="worker" /> : <ClientTabs key="client" />;
}

export function AppNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        contentStyle: { backgroundColor: DUTS.background },
        headerStyle: { backgroundColor: DUTS.card },
        headerTintColor: DUTS.ink,
        headerTitleStyle: { fontWeight: "800", color: DUTS.ink },
        headerShadowVisible: false
      }}
    >
      <Stack.Screen name="MainTabs" component={RoleTabs} options={{ headerShown: false }} />
      <Stack.Screen name="GigDetail" component={GigDetailScreen} options={{ title: "Gig details" }} />
      <Stack.Screen name="GigTracking" component={GigTrackingScreen} options={{ title: "Live tracking" }} />
      <Stack.Screen name="Chat" component={ChatScreen} options={({ route }) => ({ title: route.params.title })} />
      <Stack.Screen name="Review" component={ReviewScreen} options={{ title: "Leave a review" }} />
    </Stack.Navigator>
  );
}
