import { StyleSheet, View, type ViewProps } from "react-native";
import { DUTS } from "../lib/theme";

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: DUTS.background,
    paddingHorizontal: 20,
    paddingTop: 12
  }
});

export function TabScreen({ children, style, ...props }: ViewProps) {
  return (
    <View style={[styles.root, style]} {...props}>
      {children}
    </View>
  );
}
