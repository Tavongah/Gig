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
          const isSoon = option.value === "SOON";
          const isUrgent = option.value === "URGENT";

          let containerClass = "bg-card border border-border";
          let textClass = "text-ink";
          let hintClass = "text-muted";

          if (selected && isUrgent) {
            containerClass = "bg-magenta border border-magenta";
            textClass = "text-white";
            hintClass = "text-white/90";
          } else if (selected && isSoon) {
            containerClass = "bg-card border-2 border-orange";
            textClass = "text-orange";
            hintClass = "text-orange";
          } else if (selected) {
            containerClass = "bg-card border-2 border-brand";
            textClass = "text-brand";
            hintClass = "text-brand";
          }

          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              className={`flex-1 rounded-2xl px-3 py-3 ${containerClass}`}
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
