import { Alert, Platform } from "react-native";

export function showAlert(title: string, message?: string): void {
  if (Platform.OS === "web") {
    window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }

  Alert.alert(title, message);
}

export function showConfirm(
  title: string,
  message: string,
  onConfirm: () => void,
  options?: { confirmLabel?: string; cancelLabel?: string; destructive?: boolean }
): void {
  if (Platform.OS === "web") {
    if (window.confirm(`${title}\n\n${message}`)) {
      onConfirm();
    }
    return;
  }

  Alert.alert(title, message, [
    { text: options?.cancelLabel ?? "Cancel", style: "cancel" },
    {
      text: options?.confirmLabel ?? "OK",
      style: options?.destructive ? "destructive" : "default",
      onPress: onConfirm
    }
  ]);
}
