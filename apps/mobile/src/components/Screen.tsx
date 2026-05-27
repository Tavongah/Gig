import type { PropsWithChildren } from "react";
import { Platform, SafeAreaView, ScrollView, StatusBar, View } from "react-native";

export function Screen({ children }: PropsWithChildren) {
  const containerStyle = Platform.OS === "web" ? ({ flex: 1, minHeight: "100vh" as unknown as number } as const) : ({ flex: 1 } as const);

  if (Platform.OS === "web") {
    return (
      <View className="flex-1 bg-slate-950" style={containerStyle}>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
          <View className="flex-1 px-5 py-6">{children}</View>
        </ScrollView>
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-slate-950" style={containerStyle}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View className="flex-1 px-5 py-6">{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}
