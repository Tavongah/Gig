import type { TextInputProps } from "react-native";
import { Text, TextInput, View } from "react-native";
import { DUTS } from "../lib/theme";
import { ErrorMessage } from "./ErrorMessage";

interface FormInputProps extends TextInputProps {
  label?: string;
  error?: string | null;
}

export function FormInput({ label, error, className, ...props }: FormInputProps) {
  return (
    <View className="gap-2">
      {label ? (
        <Text className="text-sm font-bold uppercase tracking-wider text-label">{label}</Text>
      ) : null}
      <TextInput
        className={`rounded-2xl border border-border bg-surface px-4 py-4 text-ink ${className ?? ""}`}
        placeholderTextColor={DUTS.placeholder}
        {...props}
      />
      <ErrorMessage message={error} />
    </View>
  );
}
