import { useCallback, useState } from "react";
import { ScrollView, Switch, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { DutsCard } from "../../components/DutsCard";
import { Screen } from "../../components/Screen";
import {
  getNotificationPreferences,
  setNotificationPreferences,
  type NotificationPreferences
} from "../../lib/notification-prefs";
import { DUTS } from "../../lib/theme";
import { useSessionStore } from "../../stores/session.store";

const ROWS: Array<{ key: keyof NotificationPreferences; label: string; description: string }> = [
  {
    key: "emailNotifications",
    label: "Email Notifications",
    description: "Account and support emails to your inbox"
  },
  {
    key: "bookingUpdates",
    label: "Booking Updates",
    description: "Prefer updates about your gig status"
  },
  {
    key: "messages",
    label: "Messages",
    description: "Prefer alerts when you have gig chat activity"
  },
  {
    key: "promotions",
    label: "Tips & Promotions",
    description: "Occasional product tips (optional)"
  }
];

export function NotificationsScreen() {
  const session = useSessionStore((state) => state.session)!;
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);

  useFocusEffect(
    useCallback(() => {
      void getNotificationPreferences(session.user.id).then(setPrefs);
    }, [session.user.id])
  );

  async function toggle(key: keyof NotificationPreferences, value: boolean): Promise<void> {
    if (!prefs) return;
    const next = { ...prefs, [key]: value, pushNotifications: false };
    setPrefs(next);
    await setNotificationPreferences(session.user.id, next);
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 32 }}>
        <Text className="text-sm text-muted">
          Choose how you prefer to hear from Duts. These preferences are stored on this device and guide which messages we send.
        </Text>
        <DutsCard className="overflow-hidden p-2">
          {ROWS.map((row, index) => (
            <View
              key={row.key}
              className={`min-h-[56px] flex-row items-center justify-between gap-3 px-3 py-3 ${
                index < ROWS.length - 1 ? "border-b border-border" : ""
              }`}
            >
              <View className="flex-1">
                <Text className="text-base font-semibold text-ink">{row.label}</Text>
                <Text className="text-sm text-muted">{row.description}</Text>
              </View>
              <Switch
                value={prefs?.[row.key] ?? false}
                onValueChange={(value) => void toggle(row.key, value)}
                trackColor={{ true: DUTS.purple }}
                accessibilityLabel={row.label}
              />
            </View>
          ))}
        </DutsCard>
      </ScrollView>
    </Screen>
  );
}
