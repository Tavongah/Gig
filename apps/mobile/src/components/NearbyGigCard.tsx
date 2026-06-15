import { Pressable, Text, View } from "react-native";
import type { GigDetail } from "../lib/api";
import { formatCents } from "../lib/format";
import { AppButton } from "./AppButton";
import { DutsCard } from "./DutsCard";
import { StatusBadge } from "./StatusBadge";

interface NearbyGigCardProps {
  gig: GigDetail;
  onView: () => void;
  onAccept: () => void;
  onDecline?: () => void;
  acceptDisabled?: boolean;
}

export function NearbyGigCard({ gig, onView, onAccept, onDecline, acceptDisabled }: NearbyGigCardProps) {
  return (
    <DutsCard className="gap-4 p-5">
      <View className="flex-row items-start justify-between gap-2">
        <Pressable className="flex-1 gap-1" onPress={onView}>
          <Text className="text-xs font-bold uppercase text-brand">{gig.serviceCategory?.name ?? "Gig"}</Text>
          <Text className="text-xl font-black text-ink">{gig.title}</Text>
        </Pressable>
        <StatusBadge status={gig.status} />
      </View>

      <View className="flex-row flex-wrap gap-2">
        {gig.distanceMiles != null ? (
          <View className="rounded-full border border-border bg-surface px-3 py-1.5">
            <Text className="text-xs font-bold text-muted">{gig.distanceLabel ?? `${gig.distanceMiles} mi away`}</Text>
          </View>
        ) : null}
        {gig.locationSummary ? (
          <View className="rounded-full border border-border bg-surface px-3 py-1.5">
            <Text className="text-xs font-bold text-muted">{gig.locationSummary}</Text>
          </View>
        ) : null}
        <View className="rounded-full bg-hero px-3 py-1.5">
          <Text className="text-xs font-bold text-brand">Payout {formatCents(gig.workerPayoutCents)}</Text>
        </View>
        {gig.estimatedHours ? (
          <View className="rounded-full border border-border bg-surface px-3 py-1.5">
            <Text className="text-xs font-bold text-muted">{gig.estimatedHours}h est.</Text>
          </View>
        ) : null}
        <View className="rounded-full bg-orange/10 px-3 py-1.5">
          <Text className="text-xs font-bold text-orange">{gig.urgency}</Text>
        </View>
      </View>

      <View className="flex-row gap-2">
        {onDecline ? (
          <View className="flex-1">
            <AppButton label="Decline" onPress={onDecline} variant="secondary" size="md" />
          </View>
        ) : (
          <View className="flex-1">
            <AppButton label="View Details" onPress={onView} variant="secondary" size="md" />
          </View>
        )}
        <View className="flex-1">
          <AppButton label="Accept" onPress={onAccept} disabled={acceptDisabled} variant="primary" size="md" />
        </View>
      </View>
    </DutsCard>
  );
}
