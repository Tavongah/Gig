import { Pressable, Text, View } from "react-native";
import type { ServiceCategory } from "../lib/api";
import { formatCents } from "../lib/format";
import { cardShadow, serviceAccentColor } from "../lib/theme";

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
  const accent = serviceAccentColor(category.name);
  const startingPrice = category.baseRateCents ? formatCents(category.baseRateCents) : null;

  return (
    <Pressable
      onPress={onPress}
      className={`gap-2 rounded-4xl bg-card p-4 active:opacity-95 ${compact ? "w-full" : "w-44"}`}
      style={cardShadow}
    >
      <View
        className="h-11 w-11 items-center justify-center rounded-full"
        style={{ backgroundColor: `${accent}18` }}
      >
        <Text className="text-xl">{icon}</Text>
      </View>
      <Text className="text-base font-black text-ink" numberOfLines={2}>
        {category.name}
      </Text>
      {startingPrice ? <Text className="text-sm font-bold text-brand">From {startingPrice}</Text> : null}
    </Pressable>
  );
}
