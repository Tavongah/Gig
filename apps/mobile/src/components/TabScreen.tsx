import { StyleSheet, View, type ViewProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DUTS } from "../lib/theme";

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: DUTS.background,
    paddingHorizontal: 20
  }
});

export function TabScreen({ children, style, ...props }: ViewProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: Math.max(insets.top, 8),
          paddingBottom: 4
        },
        style
      ]}
      {...props}
    >
      {children}
    </View>
  );
}
