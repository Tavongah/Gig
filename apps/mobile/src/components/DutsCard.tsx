import type { ViewProps } from "react-native";
import { View } from "react-native";
import { cardShadow } from "../lib/theme";

interface DutsCardProps extends ViewProps {
  elevated?: boolean;
}

export function DutsCard({ children, style, elevated = true, className, ...props }: DutsCardProps) {
  return (
    <View
      className={`bg-card ${className ?? ""}`}
      style={[{ borderRadius: 18 }, elevated ? cardShadow : undefined, style]}
      {...props}
    >
      {children}
    </View>
  );
}
