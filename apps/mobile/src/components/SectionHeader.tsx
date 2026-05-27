import { Text, View } from "react-native";

interface SectionHeaderProps {
  eyebrow: string;
  title: string;
  subtitle?: string;
}

export function SectionHeader({ eyebrow, title, subtitle }: SectionHeaderProps) {
  return (
    <View className="mb-4 gap-2">
      <Text className="text-sm font-bold uppercase tracking-[3px] text-brand">{eyebrow}</Text>
      <Text className="text-3xl font-black text-white">{title}</Text>
      {subtitle ? <Text className="text-base leading-6 text-slate-300">{subtitle}</Text> : null}
    </View>
  );
}
