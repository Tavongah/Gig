import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { DUTS_GRADIENT, DUTS_GRADIENT_LOCATIONS } from "../lib/theme";

interface DutsGradientProps {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  className?: string;
  /** Horizontal (logo direction) by default */
  vertical?: boolean;
  startOpacity?: number;
  endOpacity?: number;
}

/**
 * Official DUTS logo gradient: Orange → Pink → Purple → Blue → Teal
 */
export function DutsGradient({
  children,
  style,
  className,
  vertical = false
}: DutsGradientProps) {
  return (
    <LinearGradient
      colors={[...DUTS_GRADIENT]}
      locations={[...DUTS_GRADIENT_LOCATIONS]}
      start={vertical ? { x: 0.5, y: 0 } : { x: 0, y: 0.5 }}
      end={vertical ? { x: 0.5, y: 1 } : { x: 1, y: 0.5 }}
      className={className}
      style={style}
    >
      {children}
    </LinearGradient>
  );
}

/** Soft wash for hero / light brand surfaces (not a solid purple wash). */
export function DutsGradientWash({ children, style }: { children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.washWrap, style]}>
      <LinearGradient
        colors={["#FFF7ED", "#FDF2F8", "#F5F3FF", "#EFF6FF", "#F0FDFA"]}
        locations={[0, 0.25, 0.5, 0.75, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  washWrap: {
    overflow: "hidden"
  }
});
