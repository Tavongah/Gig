import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { DutsCard } from "../../components/DutsCard";
import { Screen } from "../../components/Screen";
import { disconnectSocket } from "../../hooks/useSocket";
import { clearDeviceSession, ensureDeviceSession, listLoginHistory } from "../../lib/security-prefs";
import { DUTS } from "../../lib/theme";
import { useSessionStore } from "../../stores/session.store";

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function SecurityScreen() {
  const session = useSessionStore((state) => state.session)!;
  const signOut = useSessionStore((state) => state.signOut);
  const [deviceLabel, setDeviceLabel] = useState("This device");
  const [signedInAt, setSignedInAt] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ id: string; label: string; at: string }>>([]);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const device = await ensureDeviceSession(session.user.id);
        setDeviceLabel(device.deviceLabel);
        setSignedInAt(device.signedInAt);
        setHistory(await listLoginHistory(session.user.id));
      })();
    }, [session.user.id])
  );

  function signOutThisDevice(): void {
    Alert.alert("Sign out", "Sign out of DUTS on this device?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () => {
          void (async () => {
            await clearDeviceSession(session.user.id);
            disconnectSocket();
            await signOut();
          })();
        }
      }
    ]);
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 32 }}>
        <DutsCard className="gap-3 p-5">
          <Text className="text-xs font-bold uppercase tracking-wider text-muted">This device</Text>
          <View className="flex-row items-center gap-3">
            <Ionicons name="phone-portrait-outline" size={22} color={DUTS.purple} />
            <View className="flex-1">
              <Text className="font-black text-ink">{deviceLabel}</Text>
              <Text className="text-sm text-muted">
                Active session{signedInAt ? ` · since ${formatWhen(signedInAt)}` : ""}
              </Text>
            </View>
          </View>
          <Pressable
            onPress={signOutThisDevice}
            accessibilityRole="button"
            accessibilityLabel="Sign out on this device"
            className="min-h-[48px] justify-center"
          >
            <Text className="font-bold text-danger">Sign out on this device</Text>
          </Pressable>
        </DutsCard>

        <DutsCard className="gap-3 p-5">
          <Text className="text-xs font-bold uppercase tracking-wider text-muted">Login history</Text>
          {history.length === 0 ? (
            <Text className="text-sm text-muted">No recent login events recorded on this device.</Text>
          ) : (
            history.map((event) => (
              <View key={event.id} className="border-b border-border py-2">
                <Text className="font-semibold text-ink">{event.label}</Text>
                <Text className="text-sm text-muted">{formatWhen(event.at)}</Text>
              </View>
            ))
          )}
        </DutsCard>

        <DutsCard className="gap-2 p-5">
          <Text className="font-semibold text-ink">Password</Text>
          <Text className="text-sm text-muted">
            Change your password from Profile → Password. Use a unique password and keep your email verified.
          </Text>
        </DutsCard>
      </ScrollView>
    </Screen>
  );
}
