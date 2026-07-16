import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { ClientTabs } from "./ClientTabs";
import { WorkerTabs } from "./WorkerTabs";
import { GigDetailScreen } from "../screens/shared/GigDetailScreen";
import { WorkerMatchingScreen } from "../screens/worker/WorkerMatchingScreen";
import { GigTrackingScreen } from "../screens/shared/GigTrackingScreen";
import { GigPaymentScreen } from "../screens/shared/GigPaymentScreen";
import { GigSelectWorkersScreen } from "../screens/shared/GigSelectWorkersScreen";
import { GigWorkerSummaryScreen } from "../screens/shared/GigWorkerSummaryScreen";
import { GigCompletionReviewScreen } from "../screens/shared/GigCompletionReviewScreen";
import { PaymentSuccessScreen } from "../screens/shared/PaymentSuccessScreen";
import { PaymentFailedScreen } from "../screens/shared/PaymentFailedScreen";
import { WorkerStripeConnectScreen } from "../screens/worker/WorkerStripeConnectScreen";
import { WorkerWorkPreferencesScreen } from "../screens/worker/WorkerWorkPreferencesScreen";
import { EditProfileScreen } from "../screens/shared/EditProfileScreen";
import { ChatScreen } from "../screens/shared/ChatScreen";
import { ReviewScreen } from "../screens/shared/ReviewScreen";
import { ClientPostScreen } from "../screens/client/ClientPostScreen";
import { AddressesScreen } from "../screens/profile/AddressesScreen";
import { PaymentMethodsScreen } from "../screens/profile/PaymentMethodsScreen";
import { NotificationsScreen } from "../screens/profile/NotificationsScreen";
import { SecurityScreen } from "../screens/profile/SecurityScreen";
import { ChangePasswordScreen } from "../screens/profile/ChangePasswordScreen";
import { IdentityVerificationScreen } from "../screens/profile/IdentityVerificationScreen";
import { MyGigsActivityScreen } from "../screens/profile/MyGigsActivityScreen";
import { PaymentHistoryScreen } from "../screens/profile/PaymentHistoryScreen";
import { ReceiptsScreen } from "../screens/profile/ReceiptsScreen";
import { RatingsReviewsScreen } from "../screens/profile/RatingsReviewsScreen";
import { SafetyScreen } from "../screens/support/SafetyScreen";
import { FaqScreen } from "../screens/support/FaqScreen";
import { AboutDutsScreen } from "../screens/support/AboutDutsScreen";
import { PrivacyPolicyScreen } from "../screens/support/PrivacyPolicyScreen";
import { TermsOfServiceScreen } from "../screens/support/TermsOfServiceScreen";
import type { RootStackParamList } from "./types";
import { useSessionStore } from "../stores/session.store";
import { APP_NAME } from "../lib/brand";
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
      <Stack.Screen name="PostGig" component={ClientPostScreen} options={{ title: "Request Help" }} />
      <Stack.Screen name="GigDetail" component={GigDetailScreen} options={{ title: "Gig details" }} />
      <Stack.Screen name="WorkerMatching" component={WorkerMatchingScreen} options={{ title: "Matching" }} />
      <Stack.Screen name="GigSelectWorkers" component={GigSelectWorkersScreen} options={{ title: "Choose your worker" }} />
      <Stack.Screen name="GigWorkerSummary" component={GigWorkerSummaryScreen} options={{ title: "Worker summary" }} />
      <Stack.Screen name="GigPayment" component={GigPaymentScreen} options={{ title: "Confirm booking" }} />
      <Stack.Screen name="GigCompletionReview" component={GigCompletionReviewScreen} options={{ title: "Review completion" }} />
      <Stack.Screen name="PaymentSuccess" component={PaymentSuccessScreen} options={{ title: "Payment success" }} />
      <Stack.Screen name="PaymentFailed" component={PaymentFailedScreen} options={{ title: "Payment failed" }} />
      <Stack.Screen name="GigTracking" component={GigTrackingScreen} options={{ title: "Live tracking" }} />
      <Stack.Screen name="WorkerStripeConnect" component={WorkerStripeConnectScreen} options={{ title: "Stripe payouts" }} />
      <Stack.Screen name="WorkerWorkPreferences" component={WorkerWorkPreferencesScreen} options={{ title: "Work preferences" }} />
      <Stack.Screen name="EditProfile" component={EditProfileScreen} options={{ title: "Personal information" }} />
      <Stack.Screen name="Addresses" component={AddressesScreen} options={{ title: "Addresses" }} />
      <Stack.Screen name="PaymentMethods" component={PaymentMethodsScreen} options={{ title: "Payment methods" }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "Notifications" }} />
      <Stack.Screen name="Security" component={SecurityScreen} options={{ title: "Security" }} />
      <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} options={{ title: "Password" }} />
      <Stack.Screen name="IdentityVerification" component={IdentityVerificationScreen} options={{ title: "Identity verification" }} />
      <Stack.Screen name="MyGigsActivity" component={MyGigsActivityScreen} options={{ title: "My gigs" }} />
      <Stack.Screen name="PaymentHistory" component={PaymentHistoryScreen} options={{ title: "Payment history" }} />
      <Stack.Screen name="Receipts" component={ReceiptsScreen} options={{ title: "Receipts" }} />
      <Stack.Screen name="RatingsReviews" component={RatingsReviewsScreen} options={{ title: "Ratings & reviews" }} />
      <Stack.Screen name="Safety" component={SafetyScreen} options={{ title: "Safety" }} />
      <Stack.Screen name="Faq" component={FaqScreen} options={{ title: "FAQ" }} />
      <Stack.Screen name="AboutDuts" component={AboutDutsScreen} options={{ title: `About ${APP_NAME}` }} />
      <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} options={{ title: "Privacy Policy" }} />
      <Stack.Screen name="TermsOfService" component={TermsOfServiceScreen} options={{ title: "Terms of Service" }} />
      <Stack.Screen name="Chat" component={ChatScreen} options={({ route }) => ({ title: route.params.title })} />
      <Stack.Screen name="Review" component={ReviewScreen} options={{ title: "Leave a review" }} />
    </Stack.Navigator>
  );
}
