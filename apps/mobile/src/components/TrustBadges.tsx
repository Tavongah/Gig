import { Text, View } from "react-native";
import { TrustBadge } from "./TrustBadge";

const badges = [
  { emoji: "✓", label: "Verified Workers" },
  { emoji: "🔒", label: "Secure Payments" },
  { emoji: "⭐", label: "Ratings & Reviews" },
  { emoji: "🛡️", label: "Background Checks Soon" }
] as const;

export function TrustBadges() {
  return (
    <View className="gap-3">
      <Text className="text-sm font-bold uppercase tracking-wider text-muted">Trust & Safety</Text>
      <View className="flex-row flex-wrap gap-2">
        {badges.map((badge) => (
          <TrustBadge key={badge.label} emoji={badge.emoji} label={badge.label} />
        ))}
      </View>
    </View>
  );
}
