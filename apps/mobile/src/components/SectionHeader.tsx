import { Text, View } from "react-native";

interface SectionHeaderProps {
  eyebrow: string;
  title: string;
  subtitle?: string;
}

export function SectionHeader({ eyebrow, title, subtitle }: SectionHeaderProps) {
  return (
    <View className="mb-2 gap-2">
      <Text className="text-xs font-bold uppercase tracking-[3px] text-brand">{eyebrow}</Text>
      <Text className="text-3xl font-black text-ink">{title}</Text>
      {subtitle ? <Text className="text-base leading-6 text-muted">{subtitle}</Text> : null}
    </View>
  );
}
