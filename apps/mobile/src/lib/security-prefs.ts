import AsyncStorage from "@react-native-async-storage/async-storage";

export type SecurityPreferences = {
  biometricUnlock: boolean;
};

type LoginEvent = {
  id: string;
  label: string;
  at: string;
};

const prefsKey = (userId: string) => `duts.securityPrefs.${userId}`;
const historyKey = (userId: string) => `duts.loginHistory.${userId}`;
const deviceKey = (userId: string) => `duts.deviceSession.${userId}`;

const DEFAULTS: SecurityPreferences = {
  biometricUnlock: false
};

export async function getSecurityPreferences(userId: string): Promise<SecurityPreferences> {
  const raw = await AsyncStorage.getItem(prefsKey(userId));
  if (!raw) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SecurityPreferences>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function setSecurityPreferences(userId: string, prefs: SecurityPreferences): Promise<void> {
  await AsyncStorage.setItem(prefsKey(userId), JSON.stringify(prefs));
}

export async function ensureDeviceSession(userId: string): Promise<{
  deviceLabel: string;
  signedInAt: string;
}> {
  const raw = await AsyncStorage.getItem(deviceKey(userId));
  if (raw) {
    try {
      return JSON.parse(raw) as { deviceLabel: string; signedInAt: string };
    } catch {
      // fall through
    }
  }
  const session = {
    deviceLabel: "This device",
    signedInAt: new Date().toISOString()
  };
  await AsyncStorage.setItem(deviceKey(userId), JSON.stringify(session));
  await recordLoginEvent(userId, "Signed in on this device");
  return session;
}

export async function listLoginHistory(userId: string): Promise<LoginEvent[]> {
  const raw = await AsyncStorage.getItem(historyKey(userId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as LoginEvent[];
    return Array.isArray(parsed) ? parsed.slice(0, 20) : [];
  } catch {
    return [];
  }
}

export async function recordLoginEvent(userId: string, label: string): Promise<void> {
  const existing = await listLoginHistory(userId);
  const next: LoginEvent[] = [
    { id: `login_${Date.now()}`, label, at: new Date().toISOString() },
    ...existing
  ].slice(0, 20);
  await AsyncStorage.setItem(historyKey(userId), JSON.stringify(next));
}

export async function clearDeviceSession(userId: string): Promise<void> {
  await AsyncStorage.removeItem(deviceKey(userId));
}
