import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { GuestTabs } from "./GuestTabs";
import { ProductSearchScreen } from "../screens/commerce/ProductSearchScreen";
import { ProductDetailScreen } from "../screens/commerce/ProductDetailScreen";
import { ShopDetailScreen } from "../screens/commerce/ShopDetailScreen";
import { GuestCheckoutChoiceScreen } from "../screens/commerce/GuestCheckoutChoiceScreen";
import { ForgotPasswordScreen } from "../screens/auth/ForgotPasswordScreen";
import { ResetPasswordScreen } from "../screens/auth/ResetPasswordScreen";
import { PrivacyPolicyScreen } from "../screens/support/PrivacyPolicyScreen";
import { TermsOfServiceScreen } from "../screens/support/TermsOfServiceScreen";
import type { GuestStackParamList } from "./types";
import { DUTS } from "../lib/theme";

const Stack = createNativeStackNavigator<GuestStackParamList>();

export function GuestAppNavigator() {
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
      <Stack.Screen name="MainTabs" component={GuestTabs} options={{ headerShown: false }} />
      <Stack.Screen name="ProductSearch" component={ProductSearchScreen} options={{ title: "Search" }} />
      <Stack.Screen name="ProductDetail" component={ProductDetailScreen} options={{ title: "Product" }} />
      <Stack.Screen name="ShopDetail" component={ShopDetailScreen} options={{ title: "Shop" }} />
      <Stack.Screen
        name="GuestCheckoutChoice"
        component={GuestCheckoutChoiceScreen}
        options={{ title: "Order" }}
      />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ title: "Reset password" }} />
      <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} options={{ title: "Choose new password" }} />
      <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} options={{ title: "Privacy Policy" }} />
      <Stack.Screen name="TermsOfService" component={TermsOfServiceScreen} options={{ title: "Terms of Service" }} />
    </Stack.Navigator>
  );
}
