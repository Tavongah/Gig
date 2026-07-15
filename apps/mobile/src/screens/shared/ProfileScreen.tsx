import type { ReactNode } from "react";
import { Alert, Image, Pressable, ScrollView, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { CompositeNavigationProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { AppButton } from "../../components/AppButton";
import { TabScreen } from "../../components/TabScreen";
import { DutsCard } from "../../components/DutsCard";
import { VerifiedBadge } from "../../components/VerifiedBadge";
import { disconnectSocket } from "../../hooks/useSocket";
import { api } from "../../lib/api";
import { initials } from "../../lib/format";
import { APP_NAME } from "../../lib/brand";
import { DUTS } from "../../lib/theme";
import type { ClientTabParamList, RootStackParamList, WorkerTabParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";

type NavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<ClientTabParamList & WorkerTabParamList, "Profile">,
  NativeStackNavigationProp<RootStackParamList>
>;

function accountTypeLabel(roles: string[]): string {
  const isClient = roles.includes("CLIENT");
  const isWorker = roles.includes("WORKER");
  if (isClient && isWorker) return "Customer & Worker";
  if (isWorker) return "Worker";
  return "Customer";
}

function ProfileRow({
  icon,
  label,
  onPress,
  danger
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="min-h-[48px] flex-row items-center gap-3 border-b border-border px-1 py-3.5 active:opacity-80"
    >
      <Ionicons name={icon} size={20} color={danger ? DUTS.error : DUTS.purple} />
      <Text className={`flex-1 text-base font-semibold ${danger ? "text-danger" : "text-ink"}`}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={DUTS.navInactive} />
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <DutsCard className="overflow-hidden p-4">
      <Text className="mb-1 text-xs font-bold uppercase tracking-wider text-muted">{title}</Text>
      {children}
    </DutsCard>
  );
}

export function ProfileScreen() {
  const session = useSessionStore((state) => state.session)!;
  const profile = useSessionStore((state) => state.profile);
  const activeRole = useSessionStore((state) => state.activeRole);
  const setActiveRole = useSessionStore((state) => state.setActiveRole);
  const signOut = useSessionStore((state) => state.signOut);
  const navigation = useNavigation<NavigationProp>();

  const user = profile ?? session.user;
  const roles = user.roles ?? [];
  const isWorkerProfile = Boolean(user.workerProfile) || roles.includes("WORKER");
  const showWorkerSection = isWorkerProfile && activeRole === "WORKER";
  const canSwitch =
    roles.includes("CLIENT") && roles.includes("WORKER") && user.accountStatus === "APPROVED";

  function handleSignOut(): void {
    Alert.alert("Log out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log out",
        style: "destructive",
        onPress: () => {
          disconnectSocket();
          void signOut();
        }
      }
    ]);
  }

  function handleDeleteAccount(): void {
    Alert.alert(
      "Delete account",
      "This permanently disables your account and signs you out. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            Alert.alert("Confirm deletion", `Delete your ${APP_NAME} account?`, [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete account",
                style: "destructive",
                onPress: () => {
                  void (async () => {
                    try {
                      await api.deleteAccount(session.token);
                      disconnectSocket();
                      await signOut();
                    } catch (error) {
                      Alert.alert(
                        "Could not delete account",
                        error instanceof Error ? error.message : "Please try again."
                      );
                    }
                  })();
                }
              }
            ]);
          }
        }
      ]
    );
  }

  return (
    <TabScreen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 36, gap: 14 }}>
        <DutsCard className="gap-4 p-5">
          <View className="flex-row items-center gap-4">
            <View className="h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-hero">
              {user.avatarUrl ? (
                <Image source={{ uri: user.avatarUrl }} className="h-20 w-20" />
              ) : (
                <Text className="text-2xl font-black text-brand">{initials(user.fullName)}</Text>
              )}
            </View>
            <View className="flex-1 gap-1">
              <View className="flex-row flex-wrap items-center gap-2">
                <Text className="text-xl font-black text-ink">{user.fullName}</Text>
                {user.isVerified || user.accountStatus === "APPROVED" ? <VerifiedBadge /> : null}
              </View>
              <Text className="text-sm text-muted">{user.email}</Text>
              {user.phoneNumber ? <Text className="text-sm text-muted">{user.phoneNumber}</Text> : null}
              <Text className="text-xs font-bold uppercase tracking-wider text-brand">
                {accountTypeLabel(roles)}
              </Text>
            </View>
          </View>
          <AppButton label="Edit Profile" variant="secondary" onPress={() => navigation.navigate("EditProfile")} />
        </DutsCard>

        {canSwitch ? (
          <DutsCard className="gap-3 p-5">
            <Text className="text-sm font-bold uppercase tracking-wider text-label">Switch mode</Text>
            <View className="flex-row gap-3">
              {(["CLIENT", "WORKER"] as const).map((role) => {
                const selected = activeRole === role;
                return (
                  <Pressable
                    key={role}
                    onPress={() => setActiveRole(role)}
                    className={`min-h-[48px] flex-1 justify-center rounded-full px-4 py-3 ${
                      selected ? "bg-brand" : "border border-brand bg-card"
                    }`}
                  >
                    <Text className={`text-center font-black ${selected ? "text-white" : "text-brand"}`}>
                      {role === "CLIENT" ? "Customer" : "Worker"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </DutsCard>
        ) : null}

        <Section title="Account">
          <ProfileRow icon="person-outline" label="Personal Information" onPress={() => navigation.navigate("EditProfile")} />
          <ProfileRow icon="location-outline" label="Addresses" onPress={() => navigation.navigate("Addresses")} />
          <ProfileRow icon="card-outline" label="Payment Methods" onPress={() => navigation.navigate("PaymentMethods")} />
          <ProfileRow icon="notifications-outline" label="Notifications" onPress={() => navigation.navigate("Notifications")} />
          <ProfileRow icon="shield-checkmark-outline" label="Security" onPress={() => navigation.navigate("Security")} />
          <ProfileRow icon="key-outline" label="Password" onPress={() => navigation.navigate("ChangePassword")} />
          <ProfileRow
            icon="id-card-outline"
            label="Identity Verification"
            onPress={() => navigation.navigate("IdentityVerification")}
          />
        </Section>

        <Section title="Activity">
          <ProfileRow icon="list-outline" label="My Gigs" onPress={() => navigation.navigate("MyGigsActivity")} />
          <ProfileRow
            icon="receipt-outline"
            label="Payment History"
            onPress={() => navigation.navigate("PaymentHistory")}
          />
          <ProfileRow icon="document-text-outline" label="Receipts" onPress={() => navigation.navigate("Receipts")} />
          <ProfileRow
            icon="star-outline"
            label="Ratings & Reviews"
            onPress={() => navigation.navigate("RatingsReviews")}
          />
        </Section>

        {showWorkerSection ? (
          <Section title="Worker">
            <ProfileRow
              icon="construct-outline"
              label="Worker Profile"
              onPress={() => navigation.navigate("WorkerWorkPreferences")}
            />
            <ProfileRow
              icon="briefcase-outline"
              label="Services Offered"
              onPress={() => navigation.navigate("WorkerWorkPreferences")}
            />
            <ProfileRow
              icon="map-outline"
              label="Service Area"
              onPress={() => navigation.navigate("WorkerWorkPreferences")}
            />
            <ProfileRow icon="time-outline" label="Availability" onPress={() => navigation.navigate("Home")} />
            <ProfileRow icon="wallet-outline" label="Earnings" onPress={() => navigation.navigate("Earnings")} />
            <ProfileRow
              icon="cash-outline"
              label="Payout Methods"
              onPress={() => navigation.navigate("WorkerStripeConnect")}
            />
            <ProfileRow
              icon="document-attach-outline"
              label="Verification Documents"
              onPress={() => navigation.navigate("IdentityVerification")}
            />
            <ProfileRow icon="radio-outline" label="Go Online / Offline" onPress={() => navigation.navigate("Home")} />
          </Section>
        ) : null}

        <Section title="Account actions">
          <ProfileRow icon="log-out-outline" label="Log Out" onPress={handleSignOut} danger />
          <ProfileRow icon="trash-outline" label="Delete Account" onPress={handleDeleteAccount} danger />
        </Section>
      </ScrollView>
    </TabScreen>
  );
}
