import { useEffect } from "react";
import { Modal, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { cardShadow, DUTS } from "../lib/theme";

interface AcceptGigAnimationProps {
  visible: boolean;
  onDone: () => void;
}

export function AcceptGigAnimation({ visible, onDone }: AcceptGigAnimationProps) {
  const scale = useSharedValue(0.85);

  useEffect(() => {
    if (!visible) return;
    scale.value = withSpring(1, { damping: 12 });
    const timer = setTimeout(onDone, 1400);
    return () => clearTimeout(timer);
  }, [visible, onDone, scale]);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }]
  }));

  return (
    <Modal transparent visible={visible} animationType="fade">
      <View className="flex-1 items-center justify-center px-8" style={{ backgroundColor: "rgba(17,24,39,0.35)" }}>
        <Animated.View
          style={[cardStyle, cardShadow, { backgroundColor: DUTS.card }]}
          className="w-full items-center gap-4 rounded-4xl p-8"
        >
          <View className="h-16 w-16 items-center justify-center rounded-full bg-verified">
            <Text className="text-3xl">✓</Text>
          </View>
          <Text className="text-center text-2xl font-black text-ink">Gig accepted!</Text>
          <Text className="text-center text-sm text-muted">Head to the gig details to start travel.</Text>
        </Animated.View>
      </View>
    </Modal>
  );
}
