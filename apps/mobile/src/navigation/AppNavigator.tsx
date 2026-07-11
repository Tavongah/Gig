import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { ClientTabs } from "./ClientTabs";
import { WorkerTabs } from "./WorkerTabs";
import { GigDetailScreen } from "../screens/shared/GigDetailScreen";
import { GigTrackingScreen } from "../screens/shared/GigTrackingScreen";
import { GigPaymentScreen } from "../screens/shared/GigPaymentScreen";
import { GigSelectWorkersScreen } from "../screens/shared/GigSelectWorkersScreen";
import { GigWorkerSummaryScreen } from "../screens/shared/GigWorkerSummaryScreen";
import { GigCompletionReviewScreen } from "../screens/shared/GigCompletionReviewScreen";
import { PaymentSuccessScreen } from "../screens/shared/PaymentSuccessScreen";
import { PaymentFailedScreen } from "../screens/shared/PaymentFailedScreen";
import { WorkerStripeConnectScreen } from "../screens/worker/WorkerStripeConnectScreen";
import { WorkerWorkPreferencesScreen } from "../screens/worker/WorkerWorkPreferencesScreen";
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
      <Stack.Screen name="GigSelectWorkers" component={GigSelectWorkersScreen} options={{ title: "Choose your worker" }} />
      <Stack.Screen name="GigWorkerSummary" component={GigWorkerSummaryScreen} options={{ title: "Worker summary" }} />
      <Stack.Screen name="GigPayment" component={GigPaymentScreen} options={{ title: "Confirm booking" }} />
      <Stack.Screen name="GigCompletionReview" component={GigCompletionReviewScreen} options={{ title: "Review completion" }} />
      <Stack.Screen name="PaymentSuccess" component={PaymentSuccessScreen} options={{ title: "Payment success" }} />
      <Stack.Screen name="PaymentFailed" component={PaymentFailedScreen} options={{ title: "Payment failed" }} />
      <Stack.Screen name="GigTracking" component={GigTrackingScreen} options={{ title: "Live tracking" }} />
      <Stack.Screen name="WorkerStripeConnect" component={WorkerStripeConnectScreen} options={{ title: "Stripe payouts" }} />
      <Stack.Screen name="WorkerWorkPreferences" component={WorkerWorkPreferencesScreen} options={{ title: "Work preferences" }} />
      <Stack.Screen name="Chat" component={ChatScreen} options={({ route }) => ({ title: route.params.title })} />
      <Stack.Screen name="Review" component={ReviewScreen} options={{ title: "Leave a review" }} />
    </Stack.Navigator>
  );
}
