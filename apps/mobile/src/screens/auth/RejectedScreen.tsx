import { Text, View } from "react-native";
import { Screen } from "../../components/Screen";
import { DutsCard } from "../../components/DutsCard";
import { HeroBanner } from "../../components/HeroBanner";
import { AppButton } from "../../components/AppButton";
import { DeleteAccountButton } from "../../components/DeleteAccountButton";
import { disconnectSocket } from "../../hooks/useSocket";
import { useSessionStore } from "../../stores/session.store";

export function RejectedScreen() {
  const signOut = useSessionStore((state) => state.signOut);

  return (
    <Screen>
      <View className="gap-6">
        <HeroBanner eyebrow="Worker application" title="Application not approved" />
        <DutsCard className="gap-4 p-5">
          <Text className="text-base leading-6 text-ink">
            Your worker application was not approved. Please contact support@duts.tech if you need help.
          </Text>
          <AppButton label="Sign out" variant="secondary" onPress={() => { disconnectSocket(); void signOut(); }} />
          <DeleteAccountButton />
        </DutsCard>
      </View>
    </Screen>
  );
}
