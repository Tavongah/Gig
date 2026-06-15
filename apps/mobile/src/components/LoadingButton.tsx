import { AppButton, type AppButtonVariantInput } from "./AppButton";

interface LoadingButtonProps {
  label: string;
  loadingLabel?: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: AppButtonVariantInput;
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
