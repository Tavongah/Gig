import { Pressable, Text, View } from "react-native";
import type { GigDetail } from "../lib/api";
import { formatCents } from "../lib/format";
import { AppButton } from "./AppButton";
import { DutsCard } from "./DutsCard";

interface NearbyGigCardProps {
  gig: GigDetail;
  onView: () => void;
  onAccept: () => void;
  onDecline?: () => void;
  acceptDisabled?: boolean;
}

function milesLabel(miles: number | null | undefined): string | null {
  if (miles == null || Number.isNaN(Number(miles))) return null;
  return `${Number(miles).toFixed(1)} mi`;
}

export function NearbyGigCard({ gig, onView, onAccept, onDecline, acceptDisabled }: NearbyGigCardProps) {
  const isDelivery = gig.fulfillmentType === "DELIVERY" || gig.offer?.fulfillmentType === "DELIVERY";
  const offer = gig.offer;

  if (isDelivery) {
    const pickup = offer?.pickupArea ?? gig.locationSummary ?? `${gig.city}, ${gig.region}`;
    const dropoff = offer?.dropoffArea ?? (gig.dropoffCity ? `${gig.dropoffCity}` : "Drop-off area");
    const deliveryDist =
      offer?.estimatedDistanceKm != null
        ? `${(Number(offer.estimatedDistanceKm) * 0.621371).toFixed(1)} mi`
        : gig.estimatedDistanceKm != null
          ? `${(Number(gig.estimatedDistanceKm) * 0.621371).toFixed(1)} mi`
          : null;
    const toShop = milesLabel(offer?.distanceToPickupMiles ?? gig.distanceMiles);
    const earnings = offer?.estimatedEarningsCents ?? gig.workerPayoutCents ?? gig.totalCents;

    return (
      <DutsCard className="gap-4 p-5">
        <Pressable className="gap-1" onPress={onView}>
          <Text className="text-xs font-bold uppercase text-brand">Delivery available</Text>
          <Text className="text-xl font-black text-ink">{pickup}</Text>
        </Pressable>

        <View className="gap-2">
          <Text className="text-sm text-muted">
            Pickup <Text className="font-bold text-ink">{pickup}</Text>
          </Text>
          {toShop ? (
            <Text className="text-sm text-muted">
              Distance to shop <Text className="font-bold text-ink">{toShop}</Text>
            </Text>
          ) : null}
          <Text className="text-sm text-muted">
            Drop-off area <Text className="font-bold text-ink">{dropoff}</Text>
          </Text>
          {deliveryDist ? (
            <Text className="text-sm text-muted">
              Estimated delivery <Text className="font-bold text-ink">{deliveryDist}</Text>
            </Text>
          ) : null}
          <Text className="text-sm text-muted">
            Earnings <Text className="font-bold text-ink">{formatCents(earnings)}</Text>
          </Text>
        </View>

        <View className="flex-row gap-2">
          {onDecline ? (
            <View className="flex-1">
              <AppButton label="Decline" onPress={onDecline} variant="secondary" size="md" />
            </View>
          ) : null}
          <View className="flex-1">
            <AppButton
              label="Accept"
              onPress={onAccept}
              disabled={acceptDisabled}
              variant="primary"
              size="md"
            />
          </View>
        </View>
      </DutsCard>
    );
  }

  return (
    <DutsCard className="gap-4 p-5">
      <View className="flex-row items-start justify-between gap-2">
        <Pressable className="flex-1 gap-1" onPress={onView}>
          <Text className="text-xs font-bold uppercase text-brand">
            {gig.serviceCategory?.name ?? "Local help"}
          </Text>
          <Text className="text-xl font-black text-ink">{gig.title}</Text>
        </Pressable>
      </View>

      <View className="flex-row flex-wrap gap-2">
        {gig.distanceMiles != null ? (
          <View className="rounded-full border border-border bg-surface px-3 py-1.5">
            <Text className="text-xs font-bold text-muted">
              {gig.distanceLabel ?? `${gig.distanceMiles} mi away`}
            </Text>
          </View>
        ) : null}
        {gig.locationSummary ? (
          <View className="rounded-full border border-border bg-surface px-3 py-1.5">
            <Text className="text-xs font-bold text-muted">{gig.locationSummary}</Text>
          </View>
        ) : null}
        <View className="rounded-full bg-hero px-3 py-1.5">
          <Text className="text-xs font-bold text-brand">
            Your earnings {formatCents(gig.workerPayoutCents ?? 0)}
          </Text>
        </View>
      </View>

      <View className="flex-row gap-2">
        {onDecline ? (
          <View className="flex-1">
            <AppButton label="Decline" onPress={onDecline} variant="secondary" size="md" />
          </View>
        ) : (
          <View className="flex-1">
            <AppButton label="View details" onPress={onView} variant="secondary" size="md" />
          </View>
        )}
        <View className="flex-1">
          <AppButton label="Accept" onPress={onAccept} disabled={acceptDisabled} variant="primary" size="md" />
        </View>
      </View>
    </DutsCard>
  );
}
