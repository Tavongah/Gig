import { Text, View } from "react-native";
import { Screen } from "../../components/Screen";
import { DutsCard } from "../../components/DutsCard";
import { HeroBanner } from "../../components/HeroBanner";
import { AppButton } from "../../components/AppButton";
import { DeleteAccountButton } from "../../components/DeleteAccountButton";
import { disconnectSocket } from "../../hooks/useSocket";
import { useSessionStore } from "../../stores/session.store";

export function SuspendedScreen() {
  const signOut = useSessionStore((state) => state.signOut);

  return (
    <Screen>
      <View className="gap-6">
        <HeroBanner eyebrow="Account status" title="Account suspended" />
        <DutsCard className="gap-4 p-5">
          <Text className="text-base leading-6 text-ink">
            Your account has been suspended. Contact info@duts.tech if you believe this is a mistake.
          </Text>
          <AppButton label="Sign out" variant="secondary" onPress={() => { disconnectSocket(); void signOut(); }} />
          <DeleteAccountButton />
        </DutsCard>
      </View>
    </Screen>
  );
}
