import { Pressable, Text, View } from "react-native";

interface EmptyStateProps {
  emoji: string;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ emoji, title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View className="items-center gap-4 rounded-3xl border border-dashed border-slate-700 bg-slate-900/50 px-6 py-10">
      <Text className="text-5xl">{emoji}</Text>
      <Text className="text-center text-xl font-black text-white">{title}</Text>
      <Text className="text-center text-base leading-6 text-slate-400">{description}</Text>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} className="mt-2 rounded-2xl bg-brand px-6 py-3">
          <Text className="font-black text-ink">{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
