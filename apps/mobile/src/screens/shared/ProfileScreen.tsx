import { Pressable, ScrollView, Text, View } from "react-native";
import { TabScreen } from "../../components/TabScreen";
import { SectionHeader } from "../../components/SectionHeader";
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
    signOut();
  }

  return (
    <TabScreen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32, gap: 16 }}>
        <SectionHeader eyebrow="Profile" title={profile?.fullName ?? session.user.fullName} subtitle={session.user.email} />

        <View className="gap-4 rounded-3xl bg-white p-5">
          <Text className="text-sm font-bold uppercase tracking-wider text-slate-500">Switch mode</Text>
          <View className="flex-row gap-3">
            {(["CLIENT", "WORKER"] as const).map((role) => (
              <Pressable
                key={role}
                onPress={() => setActiveRole(role)}
                className={`flex-1 rounded-2xl px-4 py-4 ${activeRole === role ? "bg-brand" : "bg-slate-100"}`}
              >
                <Text className={`text-center font-black ${activeRole === role ? "text-ink" : "text-slate-600"}`}>
                  {role === "CLIENT" ? "Hire" : "Work"}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {profile?.workerProfile ? (
          <View className="gap-3 rounded-3xl bg-slate-900 p-5">
            <Text className="text-sm font-bold uppercase tracking-wider text-brand">Worker profile</Text>
            <Text className="text-base leading-6 text-slate-300">{profile.workerProfile.bio}</Text>
            <View className="flex-row flex-wrap gap-2">
              {profile.workerProfile.serviceCategories.map((category) => (
                <View key={category.id} className="rounded-full bg-slate-800 px-3 py-1">
                  <Text className="text-sm font-bold text-white">{category.name}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <Pressable onPress={handleSignOut} className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-5 py-4">
          <Text className="text-center font-black text-rose-300">Sign out</Text>
        </Pressable>
      </ScrollView>
    </TabScreen>
  );
}
