import { Linking, Text, View } from "react-native";
import { initials } from "../lib/format";
import { AppButton } from "./AppButton";
import { DutsCard } from "./DutsCard";
import { VerifiedBadge } from "./VerifiedBadge";

interface AssignedWorkerCardProps {
  fullName: string;
  phoneNumber?: string | null;
  ratingAverage?: number;
  completedGigCount?: number;
  distanceMiles?: number;
  onMessage: () => void;
}

export function AssignedWorkerCard({
  fullName,
  phoneNumber,
  ratingAverage = 5,
  completedGigCount = 0,
  distanceMiles,
  onMessage
}: AssignedWorkerCardProps) {
  return (
    <DutsCard className="gap-4 p-5">
      <View className="flex-row items-center gap-3">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-hero">
          <Text className="text-2xl font-black text-brand">{initials(fullName)}</Text>
        </View>
        <View className="flex-1">
          <Text className="text-xl font-black text-ink">{fullName}</Text>
          <Text className="text-sm font-semibold text-orange">
            ★ {ratingAverage.toFixed(1)} · {completedGigCount} gigs completed
          </Text>
          {distanceMiles != null ? (
            <Text className="text-sm font-bold text-muted">{distanceMiles.toFixed(1)} miles away</Text>
          ) : null}
        </View>
        <VerifiedBadge />
      </View>

      <View className="flex-row gap-2">
        <View className="flex-1">
          <AppButton label="Message Worker" onPress={onMessage} variant="secondary" size="md" />
        </View>
        {phoneNumber ? (
          <View className="flex-1">
            <AppButton label="Call Worker" onPress={() => void Linking.openURL(`tel:${phoneNumber}`)} variant="primary" size="md" />
          </View>
        ) : null}
      </View>
    </DutsCard>
  );
}
