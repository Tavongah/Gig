import { ActivityIndicator, Pressable, Text } from "react-native";

export type AppButtonVariant = "primary" | "secondary";

type LegacyButtonVariant = "accept" | "urgent" | "cancel" | "danger";

export type AppButtonVariantInput = AppButtonVariant | LegacyButtonVariant;

interface AppButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: AppButtonVariantInput;
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
  }
};

function resolveVariant(variant: AppButtonVariantInput): AppButtonVariant {
  if (variant === "secondary" || variant === "cancel") {
    return "secondary";
  }
  return "primary";
}

export function AppButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  variant = "primary",
  size = "lg"
}: AppButtonProps) {
  const isDisabled = disabled || loading;
  const resolved = resolveVariant(variant);
  const styles = VARIANTS[resolved];
  const padding = size === "lg" ? "px-6 py-4" : "px-5 py-3";
  const textSize = size === "lg" ? "text-base" : "text-sm";

  return (
    <Pressable
      disabled={isDisabled}
      onPress={onPress}
      className={`rounded-full ${padding} ${isDisabled ? styles.disabledContainer : styles.container} active:opacity-90`}
    >
      {loading ? (
        <ActivityIndicator color={resolved === "secondary" ? "#6A1B9A" : "#FFFFFF"} />
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
