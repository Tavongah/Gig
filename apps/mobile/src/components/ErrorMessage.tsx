import { Text } from "react-native";

interface ErrorMessageProps {
  message?: string | null;
}

export function ErrorMessage({ message }: ErrorMessageProps) {
  if (!message) {
    return null;
  }

  return <Text className="text-sm font-semibold text-danger">{message}</Text>;
}
