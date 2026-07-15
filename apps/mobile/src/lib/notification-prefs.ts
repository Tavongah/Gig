import AsyncStorage from "@react-native-async-storage/async-storage";

export type NotificationPreferences = {
  pushNotifications: boolean;
  emailNotifications: boolean;
  bookingUpdates: boolean;
  promotions: boolean;
  messages: boolean;
};

const DEFAULTS: NotificationPreferences = {
  pushNotifications: true,
  emailNotifications: true,
  bookingUpdates: true,
  promotions: false,
  messages: true
};

const keyForUser = (userId: string) => `duts.notificationPrefs.${userId}`;

export async function getNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  const raw = await AsyncStorage.getItem(keyForUser(userId));
  if (!raw) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<NotificationPreferences>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function setNotificationPreferences(
  userId: string,
  prefs: NotificationPreferences
): Promise<void> {
  await AsyncStorage.setItem(keyForUser(userId), JSON.stringify(prefs));
}
