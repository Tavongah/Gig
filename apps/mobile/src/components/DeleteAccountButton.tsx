import { Alert } from "react-native";
import { AppButton } from "./AppButton";
import { disconnectSocket } from "../hooks/useSocket";
import { api } from "../lib/api";
import { APP_NAME } from "../lib/brand";
import { useSessionStore } from "../stores/session.store";

export function DeleteAccountButton({ variant = "secondary" }: { variant?: "primary" | "secondary" }) {
  const session = useSessionStore((state) => state.session);
  const signOut = useSessionStore((state) => state.signOut);

  function handleDelete(): void {
    if (!session) return;

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
                        error instanceof Error ? error.message : "Please try again or email info@duts.tech."
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

  return <AppButton label="Delete account" variant={variant} onPress={handleDelete} />;
}
