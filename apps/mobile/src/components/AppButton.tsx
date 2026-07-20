import { ActivityIndicator, Pressable, Text } from "react-native";
import { DutsGradient } from "./DutsGradient";
import { DUTS } from "../lib/theme";

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
  const padding = size === "lg" ? "px-6 py-4" : "px-5 py-3";
  const textSize = size === "lg" ? "text-base" : "text-sm";
  const radius = 18;

  if (resolved === "primary" && !isDisabled) {
    return (
      <Pressable
        disabled={isDisabled}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        style={({ pressed }) => [{ opacity: pressed ? 0.88 : 1, borderRadius: radius, overflow: "hidden" }]}
      >
        <DutsGradient style={{ borderRadius: radius, minHeight: 48, justifyContent: "center" }} className={padding}>
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text className={`text-center font-black text-white ${textSize}`}>{label}</Text>
          )}
        </DutsGradient>
      </Pressable>
    );
  }

  const container =
    resolved === "secondary"
      ? isDisabled
        ? "bg-disabled border border-border"
        : "bg-card border border-brand"
      : "bg-disabled";
  const textClass = isDisabled
    ? "text-disabled-text"
    : resolved === "secondary"
      ? "text-brand"
      : "text-white";

  return (
    <Pressable
      disabled={isDisabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      className={`min-h-[48px] justify-center ${padding} ${container} active:opacity-90`}
      style={{ borderRadius: radius }}
    >
      {loading ? (
        <ActivityIndicator color={DUTS.brand} />
      ) : (
        <Text className={`text-center font-black ${textSize} ${textClass}`}>{label}</Text>
      )}
    </Pressable>
  );
}
