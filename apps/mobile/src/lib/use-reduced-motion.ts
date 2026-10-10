import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform } from "react-native";

export function useReducedMotion() {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let alive = true;
    const apply = (value: boolean) => {
      if (alive) setReduce(value);
    };

    void AccessibilityInfo.isReduceMotionEnabled().then(apply);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", apply);

    let media: MediaQueryList | undefined;
    const onMedia = () => apply(Boolean(media?.matches));
    if (Platform.OS === "web" && typeof window !== "undefined" && typeof window.matchMedia === "function") {
      media = window.matchMedia("(prefers-reduced-motion: reduce)");
      onMedia();
      media.addEventListener("change", onMedia);
    }

    return () => {
      alive = false;
      sub.remove();
      media?.removeEventListener("change", onMedia);
    };
  }, []);

  return reduce;
}
