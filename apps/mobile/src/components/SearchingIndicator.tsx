import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { DutsCard } from "./DutsCard";
import { DutsGradient } from "./DutsGradient";

export function SearchingIndicator({
  title = "Matching workers near you...",
  message = "Your request was sent to nearby verified workers who can accept or submit offers."
}: {
  title?: string;
  message?: string;
}) {
  const pulse = useSharedValue(0.4);

  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(withTiming(1, { duration: 800 }), withTiming(0.35, { duration: 800 })),
      -1,
      false
    );
  }, [pulse]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.85 + pulse.value * 0.25 }],
    opacity: 0.15 + pulse.value * 0.2
  }));

  return (
    <DutsCard className="items-center gap-5 p-8">
      <View className="h-24 w-24 items-center justify-center">
        <Animated.View style={ringStyle} className="absolute h-24 w-24 rounded-full bg-surface" />
        <DutsGradient style={{ height: 56, width: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" }}>
          <Text className="text-2xl">📡</Text>
        </DutsGradient>
      </View>
      <Text className="text-center text-lg font-black text-ink">{title}</Text>
      <Text className="text-center text-sm leading-5 text-muted">{message}</Text>
      <View className="flex-row gap-2">
        {[0, 1, 2].map((dot) => (
          <View key={dot} className="h-2 w-2 rounded-full bg-brand/35" />
        ))}
      </View>
    </DutsCard>
  );
}
