import { Text, View } from "react-native";

export function AuthOrDivider() {
  return (
    <View className="flex-row items-center gap-3">
      <View className="h-px flex-1 bg-border" />
      <Text className="text-[10px] font-bold uppercase tracking-wider text-muted">Or continue with</Text>
      <View className="h-px flex-1 bg-border" />
    </View>
  );
}
