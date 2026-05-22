import type { PropsWithChildren } from "react";
import { SafeAreaView, ScrollView, StatusBar, View } from "react-native";

export function Screen({ children }: PropsWithChildren) {
  return (
    <SafeAreaView className="flex-1 bg-slate-950">
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View className="flex-1 px-5 py-6">{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}
