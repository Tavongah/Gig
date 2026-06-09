import type { ViewStyle } from "react-native";

export const DUTS = {
  purple: "#6A1B9A",
  orange: "#F7941D",
  success: "#58B947",
  teal: "#3CB6C6",
  magenta: "#C2188B",
  background: "#F8FAFC",
  card: "#FFFFFF",
  heroTint: "#F5F0FF",
  ink: "#111827",
  muted: "#475569",
  label: "#334155",
  border: "#E5E7EB",
  disabledBg: "#E5E7EB",
  disabledText: "#9CA3AF",
  placeholder: "#94A3B8",
  error: "#DC2626",
  verifiedBg: "#DCFCE7",
  verifiedText: "#166534",
  inputBg: "#F8FAFC",
  navInactive: "#64748B"
} as const;

const SERVICE_ACCENT: Record<string, string> = {
  "moving assistance": DUTS.purple,
  cleaning: DUTS.teal,
  "lawn cutting": DUTS.success,
  "short-term labor": DUTS.orange,
  "car detailing": DUTS.teal,
  "furniture assembly": DUTS.purple,
  "junk removal": DUTS.orange,
  "event help": DUTS.magenta
};

export function serviceAccentColor(name: string): string {
  return SERVICE_ACCENT[name.toLowerCase()] ?? DUTS.purple;
}

export const cardShadow: ViewStyle = {
  shadowColor: "#111827",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.06,
  shadowRadius: 12,
  elevation: 3
};

export const softShadow: ViewStyle = {
  shadowColor: "#111827",
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.04,
  shadowRadius: 8,
  elevation: 2
};
