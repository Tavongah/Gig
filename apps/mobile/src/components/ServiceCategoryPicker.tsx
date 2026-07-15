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
  comingSoon: _comingSoon = [],
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
                accessibilityRole="button"
                accessibilityLabel={category.name}
                accessibilityState={{ selected, disabled }}
                className={`min-h-[44px] justify-center rounded-full px-4 py-2 ${selected ? "bg-brand" : "bg-[#F1F5F9]"}`}
              >
                <Text className={`font-bold ${selected ? "text-white" : "text-label"}`}>{category.name}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}
