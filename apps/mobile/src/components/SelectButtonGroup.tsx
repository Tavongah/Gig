import { Pressable, Text, View } from "react-native";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

interface SelectButtonGroupProps<T extends string> {
  label: string;
  options: SelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
  error?: string | null;
}

export function SelectButtonGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  error
}: SelectButtonGroupProps<T>) {
  return (
    <View className="gap-2">
      <Text className="text-sm font-bold uppercase tracking-wider text-label">{label}</Text>
      <View className="flex-row gap-2">
        {options.map((option) => {
          const selected = value === option.value;
          const containerClass = selected
            ? "bg-brand border border-brand"
            : "bg-card border border-brand";
          const textClass = selected ? "text-white" : "text-brand";
          const hintClass = selected ? "text-white/90" : "text-brand/80";

          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              className={`flex-1 rounded-full px-3 py-3 ${containerClass}`}
            >
              <Text className={`text-center text-xs font-black ${textClass}`}>{option.label}</Text>
              {option.hint ? (
                <Text className={`text-center text-[10px] ${hintClass}`}>{option.hint}</Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      {error ? <Text className="text-sm font-semibold text-danger">{error}</Text> : null}
    </View>
  );
}
