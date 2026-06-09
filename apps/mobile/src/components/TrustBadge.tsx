import { Text, View } from "react-native";

interface TrustBadgeProps {
  emoji: string;
  label: string;
}

export function TrustBadge({ emoji, label }: TrustBadgeProps) {
  return (
    <View className="flex-row items-center gap-2 rounded-2xl border border-teal/20 bg-teal/10 px-3 py-2">
      <Text className="text-sm">{emoji}</Text>
      <Text className="text-xs font-semibold text-teal">{label}</Text>
    </View>
  );
}
