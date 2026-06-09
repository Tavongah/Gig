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
}

export function ServiceCategoryCard({ category, onPress }: ServiceCategoryCardProps) {
  const icon = ICONS[category.iconName ?? ""] ?? "📦";
  const accent = serviceAccentColor(category.name);
  const startingPrice = category.baseRateCents ? formatCents(category.baseRateCents) : null;

  return (
    <Pressable
      onPress={onPress}
      className="w-44 gap-3 rounded-4xl bg-card p-4 active:opacity-95"
      style={cardShadow}
    >
      <View
        className="h-12 w-12 items-center justify-center rounded-full"
        style={{ backgroundColor: `${accent}18` }}
      >
        <Text className="text-2xl">{icon}</Text>
      </View>
      <Text className="text-base font-black text-ink">{category.name}</Text>
      {startingPrice ? <Text className="text-sm font-bold text-brand">From {startingPrice}</Text> : null}
      <Text className="text-xs leading-5 text-muted" numberOfLines={3}>
        {category.description}
      </Text>
    </Pressable>
  );
}
