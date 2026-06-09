import { Text, View } from "react-native";

export function VerifiedBadge() {
  return (
    <View className="rounded-full bg-verified px-2.5 py-1">
      <Text className="text-[10px] font-bold text-verified-text">Verified</Text>
    </View>
  );
}
