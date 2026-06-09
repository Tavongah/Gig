import { AppButton } from "./AppButton";

interface GradientButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  size?: "md" | "lg";
}

/** @deprecated Use AppButton instead */
export function GradientButton(props: GradientButtonProps) {
  return <AppButton {...props} variant="primary" />;
}
