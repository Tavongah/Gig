import type { PropsWithChildren } from "react";
import { Platform, SafeAreaView, ScrollView, StatusBar, StyleSheet, View } from "react-native";
import { DUTS } from "../lib/theme";

const styles = StyleSheet.create({
  root: Platform.select({
    web: { flex: 1, height: "100%", width: "100%", backgroundColor: DUTS.background },
    default: { flex: 1, backgroundColor: DUTS.background }
  }),
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingVertical: 24
  }
});

export function Screen({ children }: PropsWithChildren) {
  if (Platform.OS === "web") {
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content} style={{ flex: 1 }}>
          {children}
        </ScrollView>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView>
    </SafeAreaView>
  );
}
