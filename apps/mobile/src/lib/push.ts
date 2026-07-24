import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { api } from "./api";
import { getNotificationPreferences, setNotificationPreferences } from "./notification-prefs";

const LAST_TOKEN_KEY = "duts.lastExpoPushToken";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true
  })
});

function resolveProjectId(): string | undefined {
  const eas = Constants.easConfig?.projectId;
  if (eas) return eas;
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId;
}

async function rememberToken(token: string | null): Promise<void> {
  if (!token) {
    await AsyncStorage.removeItem(LAST_TOKEN_KEY);
    return;
  }
  await AsyncStorage.setItem(LAST_TOKEN_KEY, token);
}

async function rememberedToken(): Promise<string | null> {
  return AsyncStorage.getItem(LAST_TOKEN_KEY);
}

export async function getExpoPushTokenAsync(): Promise<string | null> {
  if (Platform.OS === "web") return null;

  const permissions = await Notifications.getPermissionsAsync();
  let status = permissions.status;
  if (status !== "granted") {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== "granted") return null;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("duts-default", {
      name: "Duts",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#6C3CE1"
    });
  }

  const projectId = resolveProjectId();
  const tokenResponse = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined
  );
  await rememberToken(tokenResponse.data);
  return tokenResponse.data;
}

/** Register this device for remote push. No-op on web / denied permission. */
export async function registerForPushNotifications(token: string, userId: string): Promise<boolean> {
  if (Platform.OS === "web") return false;

  const prefs = await getNotificationPreferences(userId);
  if (!prefs.pushNotifications) return false;

  try {
    const pushToken = await getExpoPushTokenAsync();
    if (!pushToken) return false;

    await api.registerPushToken(
      {
        token: pushToken,
        platform: Platform.OS === "ios" ? "ios" : "android"
      },
      token
    );
    return true;
  } catch (error) {
    console.warn("[push] register failed", error);
    return false;
  }
}

export async function unregisterPushNotifications(authToken: string): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const pushToken = await rememberedToken();
    await api.unregisterPushToken(authToken, pushToken ?? undefined);
    await rememberToken(null);
  } catch (error) {
    console.warn("[push] unregister failed", error);
  }
}

export async function setPushEnabled(
  authToken: string,
  userId: string,
  enabled: boolean
): Promise<boolean> {
  const prefs = await getNotificationPreferences(userId);
  await setNotificationPreferences(userId, { ...prefs, pushNotifications: enabled });

  if (!enabled) {
    await unregisterPushNotifications(authToken);
    return false;
  }

  return registerForPushNotifications(authToken, userId);
}
