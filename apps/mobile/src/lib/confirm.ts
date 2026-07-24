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
  options?: { confirmLabel?: string; cancelLabel?: string; destructive?: boolean; onCancel?: () => void }
): void {
  if (Platform.OS === "web") {
    if (window.confirm(`${title}\n\n${message}`)) {
      onConfirm();
    } else {
      options?.onCancel?.();
    }
    return;
  }

  Alert.alert(title, message, [
    { text: options?.cancelLabel ?? "Cancel", style: "cancel", onPress: () => options?.onCancel?.() },
    {
      text: options?.confirmLabel ?? "OK",
      style: options?.destructive ? "destructive" : "default",
      onPress: onConfirm
    }
  ]);
}

export function showPrompt(
  title: string,
  message: string,
  onSubmit: (value: string) => void,
  options?: { confirmLabel?: string; cancelLabel?: string; placeholder?: string; defaultValue?: string }
): void {
  if (Platform.OS === "web") {
    const value = window.prompt(`${title}\n\n${message}`, options?.defaultValue ?? "");
    if (value != null && value.trim().length > 0) {
      onSubmit(value.trim());
    }
    return;
  }

  if (Platform.OS === "ios" && typeof Alert.prompt === "function") {
    Alert.prompt(
      title,
      message,
      [
        { text: options?.cancelLabel ?? "Cancel", style: "cancel" },
        {
          text: options?.confirmLabel ?? "Continue",
          onPress: (value?: string) => {
            const trimmed = (value ?? "").trim();
            if (trimmed.length > 0) onSubmit(trimmed);
            else showAlert("Reason required", "Please enter a short cancellation reason.");
          }
        }
      ],
      "plain-text",
      options?.defaultValue ?? "",
      "default"
    );
    return;
  }

  Alert.alert(title, message, [
    { text: options?.cancelLabel ?? "Cancel", style: "cancel" },
    {
      text: "Schedule conflict",
      onPress: () => onSubmit("Schedule conflict — unable to complete this gig")
    },
    {
      text: "Emergency",
      style: "destructive",
      onPress: () => onSubmit("Emergency — unable to complete this gig")
    },
    {
      text: "Other",
      onPress: () => onSubmit(options?.defaultValue?.trim() || "Worker cancelled before completing the gig")
    }
  ]);
}
