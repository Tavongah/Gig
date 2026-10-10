import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing, Text, View } from "react-native";
import { DUTS } from "../../lib/theme";
import { MOTION } from "../../lib/motion";
import { useReducedMotion } from "../../lib/use-reduced-motion";

export function CountBadge({ count }: { count: number }) {
  const reduce = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const previous = useRef(count);

  useEffect(() => {
    if (count === previous.current) return;
    previous.current = count;
    if (reduce || count <= 0) return;
    scale.setValue(1);
    Animated.sequence([
      Animated.timing(scale, {
        toValue: 1.22,
        duration: MOTION.fast,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: MOTION.normal,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true
      })
    ]).start();
  }, [count, reduce, scale]);

  if (count <= 0) return null;

  return (
    <Animated.View
      pointerEvents="none"
      className="absolute -right-2 -top-1 min-w-[16px] items-center rounded-full px-1"
      style={{ backgroundColor: DUTS.purple, transform: [{ scale }] }}
    >
      <Text style={{ color: "#fff", fontSize: 9, fontWeight: "800" }}>{count > 99 ? "99+" : count}</Text>
    </Animated.View>
  );
}

export function CountBadgeSlot({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <View>
      {children}
      <CountBadge count={count ?? 0} />
    </View>
  );
}
