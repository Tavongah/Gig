import type { TextInputProps } from "react-native";
import { Text, TextInput, View } from "react-native";
import { DUTS } from "../lib/theme";
import { ErrorMessage } from "./ErrorMessage";

interface TextAreaInputProps extends TextInputProps {
  label: string;
  error?: string | null;
}

export function TextAreaInput({ label, error, className, ...props }: TextAreaInputProps) {
  return (
    <View className="gap-2">
      <Text className="text-sm font-bold uppercase tracking-wider text-label">{label}</Text>
      <TextInput
        className={`min-h-24 rounded-2xl border border-border bg-surface px-4 py-4 text-ink ${className ?? ""}`}
        placeholderTextColor={DUTS.placeholder}
        multiline
        {...props}
      />
      <ErrorMessage message={error} />
    </View>
  );
}
