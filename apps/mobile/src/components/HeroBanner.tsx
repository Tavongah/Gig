import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { cardShadow, DUTS } from "../lib/theme";

interface HeroBannerProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children?: ReactNode;
}

export function HeroBanner({ eyebrow, title, subtitle, children }: HeroBannerProps) {
  return (
    <View
      className="gap-3 rounded-4xl p-6"
      style={[{ backgroundColor: DUTS.heroTint }, cardShadow]}
    >
      {eyebrow ? (
        <Text className="text-xs font-bold uppercase tracking-[3px] text-brand">{eyebrow}</Text>
      ) : null}
      <Text className="text-3xl font-black leading-tight text-ink">{title}</Text>
      {subtitle ? <Text className="text-base leading-6 text-muted">{subtitle}</Text> : null}
      {children}
    </View>
  );
}
