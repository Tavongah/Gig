import "./global.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NavigationContainer } from "@react-navigation/native";
import { Platform, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { enableScreens } from "react-native-screens";
import { OnboardingScreen } from "./src/screens/OnboardingScreen";
import { ProfileSetupScreen } from "./src/screens/ProfileSetupScreen";
import { AppNavigator } from "./src/navigation/AppNavigator";
import { ErrorBoundary } from "./src/components/ErrorBoundary";
import { useSessionStore } from "./src/stores/session.store";

if (Platform.OS === "web") {
  enableScreens(false);
}

const queryClient = new QueryClient();

const styles = StyleSheet.create({
  root: Platform.select({
    web: { flex: 1, height: "100%", width: "100%" },
    default: { flex: 1 }
  })
});

function Shell() {
  const session = useSessionStore((state) => state.session);
  const onboardingComplete = useSessionStore((state) => state.onboardingComplete);

  if (!session) {
    return <OnboardingScreen />;
  }

  if (!onboardingComplete) {
    return <ProfileSetupScreen />;
  }

  return (
    <NavigationContainer>
      <AppNavigator />
    </NavigationContainer>
  );
}

export default function App() {
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
