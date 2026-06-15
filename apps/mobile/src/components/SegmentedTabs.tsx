import { Pressable, Text, View } from "react-native";
import { cardShadow } from "../lib/theme";

interface SegmentedTabsProps<T extends string> {
  tabs: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}

export function SegmentedTabs<T extends string>({ tabs, value, onChange }: SegmentedTabsProps<T>) {
  return (
    <View className="flex-row gap-1 rounded-2xl border border-border bg-card p-1" style={cardShadow}>
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <Pressable
            key={tab.value}
            onPress={() => onChange(tab.value)}
            className={`flex-1 rounded-full px-3 py-3 ${selected ? "bg-brand" : "bg-transparent"}`}
          >
            <Text className={`text-center text-xs font-black ${selected ? "text-white" : "text-brand"}`}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
