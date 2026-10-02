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
    const commerce = offer?.commerce ?? (gig.commercePickup?.paymentLabel ? {
      shopName: gig.commercePickup.shopName,
      itemCount: gig.commercePickup.items.reduce((n, i) => n + i.quantity, 0),
      pickupCount: gig.commercePickup.pickupCount ?? 1,
      paymentLabel: gig.commercePickup.paymentLabel,
      collectCash: Boolean(gig.commercePickup.collectCash),
      paid: Boolean(gig.commercePickup.paid)
    } : null);
    const pickup = commerce?.shopName ?? offer?.pickupArea ?? gig.locationSummary ?? `${gig.city}, ${gig.region}`;
    const dropoff = offer?.dropoffArea ?? (gig.dropoffCity ? `${gig.dropoffCity}` : "Drop-off area");
    const deliveryDist =
      offer?.estimatedDistanceKm != null
        ? `${Number(offer.estimatedDistanceKm).toFixed(1)} km`
        : gig.estimatedDistanceKm != null
          ? `${Number(gig.estimatedDistanceKm).toFixed(1)} km`
          : null;
    const toShop = milesLabel(offer?.distanceToPickupMiles ?? gig.distanceMiles);
    const itemCount = commerce?.itemCount ?? gig.commercePickup?.items.reduce((n, i) => n + i.quantity, 0);
    const pickupCount = commerce?.pickupCount ?? gig.commercePickup?.pickupCount ?? 1;

    return (
      <DutsCard className="gap-4 p-5">
        <Pressable className="gap-1" onPress={onView}>
          <Text className="text-xs font-bold uppercase text-brand">DUTS DELIVERY</Text>
          <Text className="text-xl font-black text-ink">{pickup}</Text>
          {itemCount ? (
            <Text className="text-sm font-semibold text-ink">
              {pickupCount} pickup{pickupCount === 1 ? "" : "s"} · {itemCount} item{itemCount === 1 ? "" : "s"}
            </Text>
          ) : null}
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
            Deliver to <Text className="font-bold text-ink">{dropoff}</Text>
          </Text>
          {deliveryDist ? (
            <Text className="text-sm text-muted">
              Route <Text className="font-bold text-ink">{deliveryDist}</Text>
            </Text>
          ) : null}
          {commerce ? (
            <Text className="text-sm text-muted">
              Payment <Text className="font-black text-ink">{commerce.paymentLabel}</Text>
            </Text>
          ) : null}
        </View>

        <View className="flex-row gap-2">
          {onDecline ? (
            <View className="flex-1">
              <AppButton label="Decline" onPress={onDecline} variant="secondary" size="md" />
            </View>
          ) : null}
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
