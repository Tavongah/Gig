import type { PropsWithChildren } from "react";
import { View } from "react-native";

export function TabScreen({ children }: PropsWithChildren) {
  return <View className="flex-1 bg-slate-950 px-5 pt-2">{children}</View>;
}
