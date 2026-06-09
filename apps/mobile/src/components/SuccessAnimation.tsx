import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming
} from "react-native-reanimated";
import { DutsCard } from "./DutsCard";

export function SuccessAnimation() {
  const scale = useSharedValue(0.5);
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 300 });
    scale.value = withSequence(withSpring(1.1, { damping: 8 }), withSpring(1, { damping: 12 }));
  }, [opacity, scale]);

  const circleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value
  }));

  return (
    <DutsCard className="items-center gap-4 p-8">
      <Animated.View
        style={circleStyle}
        className="h-20 w-20 items-center justify-center rounded-full bg-success"
      >
        <Text className="text-4xl text-white">✓</Text>
      </Animated.View>
      <Text className="text-center text-xl font-black text-ink">Gig completed!</Text>
      <Text className="text-center text-sm text-muted">Thanks for using GigFlow. Leave a review below.</Text>
    </DutsCard>
  );
}
