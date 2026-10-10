import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, View, type ViewProps } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { MOTION } from "../../lib/motion";
import { useReducedMotion } from "../../lib/use-reduced-motion";

type Props = ViewProps & { children: ReactNode };

export function SectionReveal({ children, style, ...rest }: Props) {
  const reduce = useReducedMotion();
  const ref = useRef<View>(null);
  const [visible, setVisible] = useState(reduce || Platform.OS !== "web");

  useEffect(() => {
    if (reduce) {
      setVisible(true);
      return;
    }
    if (Platform.OS !== "web" || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const node = ref.current as unknown as Element | null;
    if (!node) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [reduce]);

  if (reduce) {
    return (
      <View ref={ref} style={style} {...rest}>
        {children}
      </View>
    );
  }

  if (Platform.OS !== "web") {
    return (
      <Animated.View entering={FadeIn.duration(MOTION.section)} style={style} {...rest}>
        {children}
      </Animated.View>
    );
  }

  return (
    <View
      ref={ref}
      {...rest}
      className={`duts-section-reveal${visible ? " duts-section-reveal--in" : ""}`}
      style={style}
    >
      {children}
    </View>
  );
}
