import "./global.css";

import { useEffect, useRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NavigationContainer } from "@react-navigation/native";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  useFonts
} from "@expo-google-fonts/inter";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import { DUTS } from "./src/lib/theme";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { enableScreens } from "react-native-screens";
import { GuestAppNavigator } from "./src/navigation/GuestAppNavigator";
import { AppNavigator } from "./src/navigation/AppNavigator";
import { ErrorBoundary } from "./src/components/ErrorBoundary";
import { useSessionStore } from "./src/stores/session.store";
import { api } from "./src/lib/api";
import { usePushRegistration } from "./src/hooks/usePushRegistration";
import { PendingApprovalScreen } from "./src/screens/auth/PendingApprovalScreen";
import { RejectedScreen } from "./src/screens/auth/RejectedScreen";
import { SuspendedScreen } from "./src/screens/auth/SuspendedScreen";
import { isWorkerUser, workerGateStatus, needsEmailVerification, needsProfileCompletion } from "./src/lib/auth";
import { EmailVerificationScreen } from "./src/screens/auth/EmailVerificationScreen";
import { CompleteProfileScreen } from "./src/screens/auth/CompleteProfileScreen";
import { appLinkingPrefixes } from "./src/lib/linking";
import { claimCartAfterLogin, hydrateCommerceCart } from "./src/stores/commerce-cart.store";

const resetPasswordLink = {
  path: "reset-password",
  parse: {
    token: (value: string) => value
  }
};

const guestLinking = {
  prefixes: appLinkingPrefixes,
  config: {
    screens: {
      MainTabs: {
        path: "",
        screens: {
          Home: "",
          Search: "search",
          Cart: "cart",
          SignIn: {
            path: "login",
            screens: {
              Login: "",
              RegisterSelection: "register",
              CustomerRegister: "register/customer",
              WorkerRegister: "register/worker",
              ForgotPassword: "forgot-password",
              ResetPassword: "reset-password",
              PrivacyPolicy: "privacy",
              TermsOfService: "terms"
            }
          }
        }
      },
      ProductSearch: "products",
      MarketplaceCategory: "category/:slug",
      AllCategories: "categories",
      ProductDetail: "product",
      ShopDetail: "shop/:merchantId",
      GuestCheckoutChoice: "order",
      ForgotPassword: "forgot-password",
      ResetPassword: resetPasswordLink
    }
  }
};

const appLinking = {
  prefixes: appLinkingPrefixes,
  config: {
    screens: {
      MainTabs: {
        path: "",
        screens: {
          Home: "",
          Search: "search",
          Orders: "orders",
          Cart: "cart",
          Account: "account"
        }
      },
      ProductSearch: "products",
      MarketplaceCategory: "category/:slug",
      AllCategories: "categories",
      ProductDetail: "product",
      ShopDetail: "shop/:merchantId",
      ShopLocation: "deliver-to",
      GuestCheckoutChoice: "order",
      ForgotPassword: "forgot-password",
      ResetPassword: resetPasswordLink,
      PaymentSuccess: {
        path: "payment-success",
        parse: {
          gigId: (value: string) => value
        }
      },
      PaymentFailed: {
        path: "payment-failed",
        parse: {
          gigId: (value: string) => value
        }
      },
      WorkerStripeConnect: "connect-return"
    }
  }
};

if (Platform.OS === "web") {
  enableScreens(false);
}

const queryClient = new QueryClient();

const styles = StyleSheet.create({
  root: Platform.select({
    web: { flex: 1, height: "100%", width: "100%", backgroundColor: DUTS.background },
    default: { flex: 1, backgroundColor: DUTS.background }
  })
});

function LoadingShell() {
  return (
    <View style={[styles.root, { alignItems: "center", justifyContent: "center" }]}>
      <ActivityIndicator size="large" color={DUTS.purple} />
    </View>
  );
}

function Shell() {
  const session = useSessionStore((state) => state.session);
  const hydrated = useSessionStore((state) => state.hydrated);
  const activeRole = useSessionStore((state) => state.activeRole);
  const bootstrap = useSessionStore((state) => state.bootstrap);
  const hadSession = useRef<boolean | null>(null);
  usePushRegistration();

  useEffect(() => {
    void (async () => {
      await hydrateCommerceCart();
      await bootstrap();
    })();
  }, [bootstrap]);

  useEffect(() => {
    if (!hydrated) return;
    const now = Boolean(session);
    if (hadSession.current === false && now && session?.user.id) {
      void claimCartAfterLogin(session.user.id);
    }
    hadSession.current = now;
  }, [hydrated, session, session?.user.id]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("emailVerified") !== "1") return;
    const token = session?.token;
    if (!token) return;
    void api.getMe(token).then(({ user }) => {
      useSessionStore.getState().setProfile(user);
      window.history.replaceState({}, "", window.location.pathname);
    });
  }, [session?.token]);

  if (!hydrated) {
    return <LoadingShell />;
  }

  if (!session) {
    return (
      <NavigationContainer linking={guestLinking}>
        <GuestAppNavigator />
      </NavigationContainer>
    );
  }

  const user = session.user;

  if (user.accountStatus === "SUSPENDED") {
    return <SuspendedScreen />;
  }

  if (needsEmailVerification(user)) {
    return <EmailVerificationScreen />;
  }

  if (needsProfileCompletion(user)) {
    return <CompleteProfileScreen />;
  }

  if (activeRole === "WORKER" && isWorkerUser(user)) {
    const gate = workerGateStatus(user);
    if (gate === "pending") {
      return <PendingApprovalScreen />;
    }
    if (gate === "rejected") {
      return <RejectedScreen />;
    }
    if (gate === "suspended") {
      return <SuspendedScreen />;
    }
  }

  return (
    <NavigationContainer linking={appLinking}>
      <AppNavigator />
    </NavigationContainer>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold
  });

  if (!fontsLoaded) {
    return <LoadingShell />;
  }

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <GestureHandlerRootView style={styles.root}>
          <QueryClientProvider client={queryClient}>
            <View style={styles.root}>
              <Shell />
            </View>
          </QueryClientProvider>
        </GestureHandlerRootView>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
