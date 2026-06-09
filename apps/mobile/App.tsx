import "./global.css";

import { useEffect } from "react";

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

import { AuthNavigator } from "./src/navigation/AuthNavigator";

import { AppNavigator } from "./src/navigation/AppNavigator";

import { ErrorBoundary } from "./src/components/ErrorBoundary";

import { useSessionStore } from "./src/stores/session.store";

import { PendingApprovalScreen } from "./src/screens/auth/PendingApprovalScreen";

import { RejectedScreen } from "./src/screens/auth/RejectedScreen";

import { SuspendedScreen } from "./src/screens/auth/SuspendedScreen";

import { isWorkerUser, workerGateStatus } from "./src/lib/auth";



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



  useEffect(() => {

    void bootstrap();

  }, [bootstrap]);



  if (!hydrated) {

    return <LoadingShell />;

  }



  if (!session) {

    return (

      <NavigationContainer>

        <AuthNavigator />

      </NavigationContainer>

    );

  }



  const user = session.user;



  if (user.accountStatus === "SUSPENDED") {

    return <SuspendedScreen />;

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

    <NavigationContainer>

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

    return null;

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

