import { Text, View } from "react-native";
import { AppButton } from "./AppButton";
import { DutsCard } from "./DutsCard";

interface EmptyStateProps {
  emoji: string;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ emoji, title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <DutsCard className="items-center gap-4 border border-dashed border-border px-6 py-10">
      <Text className="text-5xl">{emoji}</Text>
      <Text className="text-center text-xl font-black text-ink">{title}</Text>
      <Text className="text-center text-sm leading-5 text-muted">{description}</Text>
      {actionLabel && onAction ? (
        <View className="w-full">
          <AppButton label={actionLabel} onPress={onAction} variant="primary" size="md" />
        </View>
      ) : null}
    </DutsCard>
  );
}
