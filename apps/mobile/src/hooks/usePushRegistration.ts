import { useEffect } from "react";
import { Platform } from "react-native";
import { useSessionStore } from "../stores/session.store";
import { registerForPushNotifications } from "../lib/push";

/** Registers Expo push token after login (native only). */
export function usePushRegistration(): void {
  const session = useSessionStore((state) => state.session);

  useEffect(() => {
    if (Platform.OS === "web") return;
    if (!session?.token || !session.user.id) return;
    void registerForPushNotifications(session.token, session.user.id);
  }, [session?.token, session?.user.id]);
}
