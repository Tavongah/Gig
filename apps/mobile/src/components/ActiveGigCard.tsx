import { Text, View } from "react-native";
import type { GigDetail } from "../lib/api";
import { statusLabel } from "../lib/gig-status";
import { AppButton } from "./AppButton";
import { DutsCard } from "./DutsCard";

interface ActiveGigCardProps {
  gig: GigDetail;
  onTrack: () => void;
}

export function ActiveGigCard({ gig, onTrack }: ActiveGigCardProps) {
  const workerName = gig.assignments?.[0]?.worker?.fullName?.split(" ")[0] ?? null;
  const etaMinutes = gig.estimatedResponseMinutes;

  return (
    <DutsCard className="gap-3 border border-brand/20 p-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text className="text-xs font-bold uppercase tracking-wider text-brand">Active Gig</Text>
          <Text className="text-lg font-black text-ink">{gig.serviceCategory?.name ?? gig.title}</Text>
        </View>
        <View className="rounded-full bg-brand/10 px-3 py-1">
          <Text className="text-xs font-bold text-brand">{statusLabel(gig.status)}</Text>
        </View>
      </View>

      {workerName ? (
        <Text className="text-sm text-muted">
          Worker: <Text className="font-bold text-ink">{workerName}</Text>
        </Text>
      ) : (
        <Text className="text-sm text-muted">Waiting for worker matches</Text>
      )}

      {typeof etaMinutes === "number" && etaMinutes > 0 ? (
        <Text className="text-sm text-muted">
          ETA: <Text className="font-bold text-ink">{etaMinutes} minutes</Text>
        </Text>
      ) : null}

      <AppButton label="Track Live" onPress={onTrack} variant="primary" size="md" />
    </DutsCard>
  );
}
