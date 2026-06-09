import { AppButton } from "./AppButton";

interface LoadingButtonProps {
  label: string;
  loadingLabel?: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: "primary" | "secondary" | "accept" | "urgent" | "cancel" | "danger";
}

export function LoadingButton({
  label,
  loadingLabel,
  onPress,
  disabled = false,
  loading = false,
  variant = "primary"
}: LoadingButtonProps) {
  return (
    <AppButton
      label={loading ? (loadingLabel ?? label) : label}
      onPress={onPress}
      disabled={disabled}
      loading={loading}
      variant={variant}
    />
  );
}
