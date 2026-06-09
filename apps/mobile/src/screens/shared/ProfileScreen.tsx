import { Pressable, ScrollView, Text, View } from "react-native";
import { TabScreen } from "../../components/TabScreen";
import { DutsCard } from "../../components/DutsCard";
import { HeroBanner } from "../../components/HeroBanner";
import { VerifiedBadge } from "../../components/VerifiedBadge";
import { disconnectSocket } from "../../hooks/useSocket";
import { useSessionStore } from "../../stores/session.store";

export function ProfileScreen() {
  const session = useSessionStore((state) => state.session)!;
  const profile = useSessionStore((state) => state.profile);
  const activeRole = useSessionStore((state) => state.activeRole);
  const setActiveRole = useSessionStore((state) => state.setActiveRole);
  const signOut = useSessionStore((state) => state.signOut);

  function handleSignOut(): void {
    disconnectSocket();
    void signOut();
  }

  return (
    <TabScreen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 36, gap: 16 }}>
        <HeroBanner
          eyebrow="Profile"
          title={profile?.fullName ?? session.user.fullName}
          subtitle={session.user.email}
        />

        {profile?.roles.includes("CLIENT") && profile?.roles.includes("WORKER") && profile.accountStatus === "APPROVED" ? (
          <DutsCard className="gap-4 p-5">
            <Text className="text-sm font-bold uppercase tracking-wider text-label">Switch mode</Text>
            <View className="flex-row gap-3">
              {(["CLIENT", "WORKER"] as const).map((role) => {
                const selected = activeRole === role;
                return (
                  <Pressable
                    key={role}
                    onPress={() => setActiveRole(role)}
                    className={`flex-1 rounded-2xl px-4 py-4 ${
                      selected ? "bg-brand" : "border border-border bg-surface"
                    }`}
                  >
                    <Text className={`text-center font-black ${selected ? "text-white" : "text-label"}`}>
                      {role === "CLIENT" ? "Hire" : "Work"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </DutsCard>
        ) : null}

        {profile?.workerProfile ? (
          <DutsCard className="gap-4 p-5">
            <View className="flex-row items-center justify-between">
              <Text className="text-sm font-bold uppercase tracking-wider text-brand">Worker profile</Text>
              <VerifiedBadge />
            </View>
            <Text className="text-base leading-6 text-muted">{profile.workerProfile.bio}</Text>
            <View className="flex-row flex-wrap gap-2">
              {profile.workerProfile.serviceCategories.map((category) => (
                <View key={category.id} className="rounded-full border border-teal/30 bg-teal/10 px-3 py-1.5">
                  <Text className="text-sm font-bold text-teal">{category.name}</Text>
                </View>
              ))}
            </View>
            <View className="flex-row gap-3">
              <View className="flex-1 rounded-2xl border border-border bg-surface p-3">
                <Text className="text-xs text-muted">Hourly rate</Text>
                <Text className="font-black text-orange">
                  ${((profile.workerProfile.hourlyRateCents ?? 3500) / 100).toFixed(0)}/hr
                </Text>
              </View>
              <View className="flex-1 rounded-2xl border border-border bg-surface p-3">
                <Text className="text-xs text-muted">Travel radius</Text>
                <Text className="font-black text-teal">
                  {Number(profile.workerProfile.travelDistanceMiles ?? 10)} mi
                </Text>
              </View>
            </View>
          </DutsCard>
        ) : null}

        <Pressable onPress={handleSignOut} className="rounded-2xl border border-danger bg-card px-5 py-4">
          <Text className="text-center font-black text-danger">Sign out</Text>
        </Pressable>
      </ScrollView>
    </TabScreen>
  );
}
