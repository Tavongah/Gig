import "react-native-gesture-handler";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Pressable, Text, View } from "react-native";
import { OnboardingScreen } from "./src/screens/OnboardingScreen";
import { ClientHomeScreen } from "./src/screens/ClientHomeScreen";
import { WorkerHomeScreen } from "./src/screens/WorkerHomeScreen";
import { useSessionStore } from "./src/stores/session.store";

const queryClient = new QueryClient();

function Shell(): JSX.Element {
  const session = useSessionStore((state) => state.session);
  const activeRole = useSessionStore((state) => state.activeRole);
  const setActiveRole = useSessionStore((state) => state.setActiveRole);

  if (!session) {
    return <OnboardingScreen />;
  }

  return (
    <View className="flex-1 bg-slate-950">
      <View className="flex-row gap-2 px-5 pt-14">
        {(["CLIENT", "WORKER"] as const).map((role) => (
          <Pressable
            key={role}
            onPress={() => setActiveRole(role)}
            className={`flex-1 rounded-full px-4 py-3 ${activeRole === role ? "bg-brand" : "bg-slate-800"}`}
          >
            <Text className={`text-center font-black ${activeRole === role ? "text-ink" : "text-white"}`}>{role}</Text>
          </Pressable>
        ))}
      </View>
      {activeRole === "CLIENT" ? <ClientHomeScreen /> : <WorkerHomeScreen />}
    </View>
  );
}

export default function App(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  );
}
