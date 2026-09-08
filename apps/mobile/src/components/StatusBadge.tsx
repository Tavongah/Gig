import { Text, View } from "react-native";
import { statusColor, statusLabel } from "../lib/gig-status";

interface StatusBadgeProps {
  status: string;
  fulfillmentType?: string | null;
}

export function StatusBadge({ status, fulfillmentType }: StatusBadgeProps) {
  return (
    <View className={`rounded-full px-3 py-1 ${statusColor(status)}`}>
      <Text className="text-xs font-bold text-white">{statusLabel(status, fulfillmentType)}</Text>
    </View>
  );
}
