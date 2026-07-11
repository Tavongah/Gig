import { AntDesign } from "@expo/vector-icons";

interface IconProps {
  size?: number;
}

export function GoogleIcon({ size = 20 }: IconProps) {
  return <AntDesign name="google" size={size} color="#4285F4" accessibilityLabel="Google" />;
}

export function AppleIcon({ size = 20 }: IconProps) {
  return <AntDesign name="apple" size={size} color="#111827" accessibilityLabel="Apple" />;
}
