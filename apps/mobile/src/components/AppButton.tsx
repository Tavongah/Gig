import { ActivityIndicator, Pressable, Text } from "react-native";

type AppButtonVariant = "primary" | "secondary" | "accept" | "urgent" | "cancel" | "danger";

interface AppButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: AppButtonVariant;
  size?: "md" | "lg";
}

const VARIANTS: Record<AppButtonVariant, { container: string; text: string; disabledContainer: string }> = {
  primary: {
    container: "bg-brand",
    text: "text-white",
    disabledContainer: "bg-disabled"
  },
  secondary: {
    container: "bg-card border border-brand",
    text: "text-brand",
    disabledContainer: "bg-disabled border border-border"
  },
  accept: {
    container: "bg-success",
    text: "text-white",
    disabledContainer: "bg-disabled"
  },
  urgent: {
    container: "bg-orange",
    text: "text-white",
    disabledContainer: "bg-disabled"
  },
  cancel: {
    container: "bg-card border border-danger",
    text: "text-danger",
    disabledContainer: "bg-disabled border border-border"
  },
  danger: {
    container: "bg-danger",
    text: "text-white",
    disabledContainer: "bg-disabled"
  }
};

export function AppButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  variant = "primary",
  size = "lg"
}: AppButtonProps) {
  const isDisabled = disabled || loading;
  const styles = VARIANTS[variant];
  const padding = size === "lg" ? "px-6 py-4" : "px-5 py-3";
  const textSize = size === "lg" ? "text-base" : "text-sm";

  return (
    <Pressable
      disabled={isDisabled}
      onPress={onPress}
      className={`rounded-2xl ${padding} ${isDisabled ? styles.disabledContainer : styles.container} active:opacity-90`}
    >
      {loading ? (
        <ActivityIndicator color={variant === "secondary" || variant === "cancel" ? "#6A1B9A" : "#FFFFFF"} />
      ) : (
        <Text
          className={`text-center font-black ${textSize} ${isDisabled ? "text-disabled-text" : styles.text}`}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}
