import { Pressable, Text, View } from "react-native";
import { formatHourlyRateLabel, recommendedPricingForService, DEFAULT_HOURLY_RATE_CENTS } from "@gigflow/shared";
import type { ServiceCategory } from "../lib/api";
import { formatCents } from "../lib/format";
import { cardShadow } from "../lib/theme";
import { DutsGradient } from "./DutsGradient";

const ICONS: Record<string, string> = {
  truck: "🚚",
  sparkles: "✨",
  home: "🏠",
  leaf: "🌿",
  hammer: "🔨",
  car: "🚗",
  wrench: "🔧",
  trash: "🗑️",
  calendar: "📅",
  baby: "👶",
  heart: "💛",
  moon: "🌙",
  briefcase: "💼"
};

interface ServiceCategoryCardProps {
  category: ServiceCategory;
  onPress?: () => void;
  compact?: boolean;
}

export function ServiceCategoryCard({ category, onPress, compact = false }: ServiceCategoryCardProps) {
  const icon = ICONS[category.iconName ?? ""] ?? "📦";
  const pricingType = recommendedPricingForService(category.slug);
  const priceLabel =
    pricingType === "ESTIMATE_TIMER" || pricingType === "HOURLY"
      ? formatHourlyRateLabel(DEFAULT_HOURLY_RATE_CENTS)
      : category.baseRateCents
        ? `From ${formatCents(category.baseRateCents)}`
        : null;

  return (
    <Pressable
      onPress={onPress}
      className={`gap-2.5 bg-card p-4 active:opacity-95 ${compact ? "w-full" : "w-44"}`}
      style={[cardShadow, { borderRadius: 18 }]}
    >
      <DutsGradient style={{ height: 44, width: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" }}>
        <View className="h-9 w-9 items-center justify-center rounded-full bg-white/95">
          <Text className="text-lg">{icon}</Text>
        </View>
      </DutsGradient>
      <Text className="text-base font-black text-ink" numberOfLines={2}>
        {category.name}
      </Text>
      {priceLabel ? <Text className="text-sm font-bold text-brand">{priceLabel}</Text> : null}
    </Pressable>
  );
}
