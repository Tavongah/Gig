import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { cardShadow } from "../lib/theme";
import { BrandLogo } from "./BrandLogo";
import { DutsGradientWash } from "./DutsGradient";

interface HeroBannerProps {
  eyebrow?: string;
  showLogo?: boolean;
  title: string;
  subtitle?: string;
  children?: ReactNode;
}

export function HeroBanner({ eyebrow, showLogo, title, subtitle, children }: HeroBannerProps) {
  return (
    <DutsGradientWash style={[cardShadow, { borderRadius: 20 }]}>
      <View className="gap-3 p-6">
        {showLogo ? <BrandLogo size={64} /> : null}
        {eyebrow && !showLogo ? (
          <Text className="text-xs font-bold uppercase tracking-[3px] text-brand">{eyebrow}</Text>
        ) : null}
        <Text className="text-3xl font-black leading-tight text-ink">{title}</Text>
        {subtitle ? <Text className="text-base leading-6 text-muted">{subtitle}</Text> : null}
        {children}
      </View>
    </DutsGradientWash>
  );
}
