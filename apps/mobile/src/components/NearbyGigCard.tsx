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
  acceptDisabled?: boolean;
}

export function NearbyGigCard({ gig, onView, onAccept, acceptDisabled }: NearbyGigCardProps) {
  return (
    <DutsCard className="gap-4 p-5">
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1 gap-1">
          <Text className="text-xs font-bold uppercase text-brand">{gig.serviceCategory?.name ?? "Gig"}</Text>
          <Text className="text-xl font-black text-ink">{gig.title}</Text>
        </View>
        <StatusBadge status={gig.status} />
      </View>

      <View className="flex-row flex-wrap gap-2">
        {gig.distanceMiles != null ? (
          <View className="rounded-full border border-border bg-surface px-3 py-1.5">
            <Text className="text-xs font-bold text-muted">{gig.distanceMiles} mi away</Text>
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
        <Pressable onPress={onView} className="flex-1 rounded-2xl border border-border bg-card px-4 py-3.5">
          <Text className="text-center font-black text-ink">View Details</Text>
        </Pressable>
        <View className="flex-1">
          <AppButton label="Accept Gig" onPress={onAccept} disabled={acceptDisabled} variant="accept" size="md" />
        </View>
      </View>
    </DutsCard>
  );
}
