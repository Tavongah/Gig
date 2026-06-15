import { Text, View } from "react-native";
import { Screen } from "../../components/Screen";
import { DutsCard } from "../../components/DutsCard";
import { HeroBanner } from "../../components/HeroBanner";
import { APP_NAME } from "../../lib/brand";
import { AppButton } from "../../components/AppButton";
import { disconnectSocket } from "../../hooks/useSocket";
import { useSessionStore } from "../../stores/session.store";

export function PendingApprovalScreen() {
  const profile = useSessionStore((state) => state.profile);
  const signOut = useSessionStore((state) => state.signOut);

  function handleSignOut(): void {
    disconnectSocket();
    void signOut();
  }

  return (
    <Screen>
      <View className="gap-6">
        <HeroBanner eyebrow="Worker application" title="Pending approval" subtitle={`Thanks for applying to ${APP_NAME}.`} />
        <DutsCard className="gap-4 p-5">
          <Text className="text-base leading-6 text-ink">
            Your worker account has been submitted for review. You&apos;ll be able to accept gigs once your account is
            approved.
          </Text>
          <Text className="text-sm text-muted">Your account is still under review.</Text>
          {profile ? (
            <View className="rounded-2xl bg-surface p-4">
              <Text className="font-bold text-ink">{profile.fullName}</Text>
              <Text className="text-sm text-muted">{profile.email}</Text>
              <Text className="mt-2 text-xs font-bold uppercase tracking-wider text-brand">Status: Pending approval</Text>
            </View>
          ) : null}
          <AppButton label="Sign out" variant="secondary" onPress={handleSignOut} />
        </DutsCard>
      </View>
    </Screen>
  );
}
