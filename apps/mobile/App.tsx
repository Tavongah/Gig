import "./global.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NavigationContainer } from "@react-navigation/native";
import { Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { OnboardingScreen } from "./src/screens/OnboardingScreen";
import { ProfileSetupScreen } from "./src/screens/ProfileSetupScreen";
import { AppNavigator } from "./src/navigation/AppNavigator";
import { useSessionStore } from "./src/stores/session.store";

const queryClient = new QueryClient();

const rootStyle = Platform.OS === "web" ? ({ flex: 1, minHeight: "100vh" as unknown as number } as const) : ({ flex: 1 } as const);

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
    <SafeAreaProvider>
      <GestureHandlerRootView style={rootStyle}>
        <QueryClientProvider client={queryClient}>
          <View style={rootStyle}>
            <Shell />
          </View>
        </QueryClientProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
