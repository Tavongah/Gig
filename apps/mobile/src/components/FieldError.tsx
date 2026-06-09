import { Text } from "react-native";

interface FieldErrorProps {
  message?: string | null;
}

export function FieldError({ message }: FieldErrorProps) {
  if (!message) {
    return null;
  }

  return <Text className="text-sm font-semibold text-red-600">{message}</Text>;
}
