import { StyleSheet, View, type ViewProps } from "react-native";

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#020617",
    paddingHorizontal: 20,
    paddingTop: 8
  }
});

export function TabScreen({ children, style, ...props }: ViewProps) {
  return (
    <View style={[styles.root, style]} {...props}>
      {children}
    </View>
  );
}
