import { Pressable, Text, View } from "react-native";
import { packageCategoryLabels, type PackageCategory } from "@gigflow/shared";
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

function milesToKmLabel(miles: number | null | undefined): string | null {
  if (miles == null || Number.isNaN(Number(miles))) return null;
  return `${(Number(miles) * 1.60934).toFixed(1)} km`;
}

export function NearbyGigCard({ gig, onView, onAccept, onDecline, acceptDisabled }: NearbyGigCardProps) {
  const isDelivery = gig.fulfillmentType === "DELIVERY" || gig.offer?.fulfillmentType === "DELIVERY";
  const offer = gig.offer;
  const packageLabel =
    offer?.packageCategory && offer.packageCategory in packageCategoryLabels
      ? packageCategoryLabels[offer.packageCategory as PackageCategory]
      : offer?.packageCategory ?? gig.packageCategory ?? null;

  if (isDelivery) {
    const pickup = offer?.pickupArea ?? gig.locationSummary ?? `${gig.city}, ${gig.region}`;
    const dropoff = offer?.dropoffArea ?? (gig.dropoffCity ? `${gig.dropoffCity}` : "Drop-off");
    const deliveryKm =
      offer?.estimatedDistanceKm != null
        ? `${Number(offer.estimatedDistanceKm).toFixed(1)} km`
        : gig.estimatedDistanceKm != null
          ? `${Number(gig.estimatedDistanceKm).toFixed(1)} km`
          : null;
    const toPickup = milesToKmLabel(offer?.distanceToPickupMiles ?? gig.distanceMiles);
    const earnings = offer?.estimatedEarningsCents ?? gig.workerPayoutCents ?? gig.totalCents;

    return (
      <DutsCard className="gap-4 p-5">
        <View className="flex-row items-start justify-between gap-2">
          <Pressable className="flex-1 gap-1" onPress={onView}>
            <Text className="text-xs font-bold uppercase text-brand">New delivery</Text>
            <Text className="text-xl font-black text-ink">{packageLabel ?? "Package"}</Text>
          </Pressable>
          <StatusBadge status={gig.status} fulfillmentType="DELIVERY" />
        </View>

        <View className="gap-2">
          <Text className="text-sm text-muted">
            Pickup <Text className="font-bold text-ink">{pickup}</Text>
          </Text>
          <Text className="text-sm text-muted">
            Drop-off <Text className="font-bold text-ink">{dropoff}</Text>
          </Text>
          {packageLabel ? (
            <Text className="text-sm text-muted">
              Package <Text className="font-bold text-ink">{packageLabel}</Text>
            </Text>
          ) : null}
        </View>

        <View className="flex-row flex-wrap gap-2">
          {deliveryKm ? (
            <View className="rounded-full border border-border bg-surface px-3 py-1.5">
              <Text className="text-xs font-bold text-muted">Delivery {deliveryKm}</Text>
            </View>
          ) : null}
          {toPickup ? (
            <View className="rounded-full border border-border bg-surface px-3 py-1.5">
              <Text className="text-xs font-bold text-muted">{toPickup} to pickup</Text>
            </View>
          ) : null}
          <View className="rounded-full bg-hero px-3 py-1.5">
            <Text className="text-xs font-bold text-brand">You earn {formatCents(earnings)}</Text>
          </View>
        </View>

        <View className="flex-row gap-2">
          {onDecline ? (
            <View className="flex-1">
              <AppButton label="Decline" onPress={onDecline} variant="secondary" size="md" />
            </View>
          ) : (
            <View className="flex-1">
              <AppButton label="View" onPress={onView} variant="secondary" size="md" />
            </View>
          )}
          <View className="flex-1">
            <AppButton
              label="Accept delivery"
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
          <Text className="text-xs font-bold text-brand">Your earnings {formatCents(gig.workerPayoutCents ?? 0)}</Text>
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
