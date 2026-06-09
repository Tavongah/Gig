import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { DutsCard } from "./DutsCard";

export function SearchingIndicator() {
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
    opacity: 0.2 + pulse.value * 0.25
  }));

  return (
    <DutsCard className="items-center gap-5 p-8">
      <View className="h-24 w-24 items-center justify-center">
        <Animated.View style={ringStyle} className="absolute h-24 w-24 rounded-full bg-hero" />
        <View className="h-14 w-14 items-center justify-center rounded-full bg-brand">
          <Text className="text-2xl">📡</Text>
        </View>
      </View>
      <Text className="text-center text-lg font-black text-ink">Finding a worker near you...</Text>
      <Text className="text-center text-sm leading-5 text-muted">
        Broadcasting your gig to verified workers who are available now.
      </Text>
      <View className="flex-row gap-2">
        {[0, 1, 2].map((dot) => (
          <View key={dot} className="h-2 w-2 rounded-full bg-brand/40" />
        ))}
      </View>
    </DutsCard>
  );
}
