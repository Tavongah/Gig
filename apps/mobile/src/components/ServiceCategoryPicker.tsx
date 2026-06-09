import { Pressable, Text, View } from "react-native";
import type { ServiceCategory } from "../lib/api";

interface ServiceCategoryPickerProps {
  mvp: ServiceCategory[];
  comingSoon?: ServiceCategory[];
  selectedId?: string | null;
  selectedIds?: string[];
  onSelect: (categoryId: string) => void;
  disabled?: boolean;
}

function isSelected(categoryId: string, selectedId?: string | null, selectedIds?: string[]): boolean {
  if (selectedIds) {
    return selectedIds.includes(categoryId);
  }
  return selectedId === categoryId;
}

export function ServiceCategoryPicker({
  mvp,
  comingSoon = [],
  selectedId = null,
  selectedIds,
  onSelect,
  disabled = false
}: ServiceCategoryPickerProps) {
  return (
    <View className="gap-4">
      <View className="gap-2">
        <Text className="text-sm font-bold uppercase tracking-wider text-label">Service type</Text>
        <View className="flex-row flex-wrap gap-2">
          {mvp.map((category) => {
            const selected = isSelected(category.id, selectedId, selectedIds);
            return (
              <Pressable
                key={category.id}
                disabled={disabled}
                onPress={() => onSelect(category.id)}
                className={`rounded-full px-4 py-2 ${selected ? "bg-brand" : "bg-[#F1F5F9]"}`}
              >
                <Text className={`font-bold ${selected ? "text-white" : "text-label"}`}>{category.name}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {comingSoon.length > 0 ? (
        <View className="gap-2 rounded-2xl border border-dashed border-border bg-surface p-4">
          <Text className="text-xs font-bold uppercase tracking-wider text-muted">Coming soon</Text>
          <Text className="text-sm text-muted">
            These services need stronger trust and safety systems before launch.
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {comingSoon.map((category) => (
              <View key={category.id} className="rounded-full bg-disabled px-4 py-2">
                <Text className="font-semibold text-disabled-text">{category.name}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}
