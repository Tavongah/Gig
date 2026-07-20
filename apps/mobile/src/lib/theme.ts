import type { ViewStyle } from "react-native";

/** Official DUTS logo palette — Orange → Pink → Purple → Blue → Teal */
export const DUTS = {
  orange: "#FF7A18",
  pink: "#FF3D81",
  purple: "#7B3FE4",
  blue: "#3B82F6",
  teal: "#12C6C3",

  /** Solid brand accent (logo purple) for text / icons when a single color is needed */
  brand: "#7B3FE4",

  background: "#FFFFFF",
  surface: "#F8FAFC",
  card: "#FFFFFF",
  heroTint: "#F8FAFC",

  ink: "#111827",
  muted: "#6B7280",
  label: "#374151",
  border: "#E5E7EB",
  disabledBg: "#E5E7EB",
  disabledText: "#9CA3AF",
  placeholder: "#9CA3AF",
  error: "#DC2626",
  success: "#12C6C3",
  verifiedBg: "#ECFDF5",
  verifiedText: "#047857",
  inputBg: "#F8FAFC",
  navInactive: "#9CA3AF"
} as const;

/** Left-to-right logo gradient stops */
export const DUTS_GRADIENT = [
  DUTS.orange,
  DUTS.pink,
  DUTS.purple,
  DUTS.blue,
  DUTS.teal
] as const;

export const DUTS_GRADIENT_LOCATIONS = [0, 0.25, 0.5, 0.75, 1] as const;

const SERVICE_ACCENT: Record<string, string> = {
  "moving assistance": DUTS.purple,
  cleaning: DUTS.teal,
  "house cleaning": DUTS.teal,
  "room cleaning": DUTS.blue,
  "lawn cutting": DUTS.teal,
  "short-term labor": DUTS.orange,
  "car detailing": DUTS.blue,
  "furniture assembly": DUTS.purple,
  "junk removal": DUTS.orange,
  "event help": DUTS.pink
};

export function serviceAccentColor(name: string): string {
  return SERVICE_ACCENT[name.toLowerCase()] ?? DUTS.brand;
}

/** Soft elevated card — white, 16–20px radius */
export const cardShadow: ViewStyle = {
  borderRadius: 18,
  shadowColor: "#111827",
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.06,
  shadowRadius: 24,
  elevation: 3
};

export const softShadow: ViewStyle = {
  borderRadius: 16,
  shadowColor: "#111827",
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.04,
  shadowRadius: 12,
  elevation: 2
};
