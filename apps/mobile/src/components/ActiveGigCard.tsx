import { Text, View } from "react-native";
import type { GigDetail } from "../lib/api";
import { isCustomerRematching } from "@gigflow/shared";
import { statusLabel } from "../lib/gig-status";
import { AppButton } from "./AppButton";
import { DutsCard } from "./DutsCard";

interface ActiveGigCardProps {
  gig: GigDetail;
  onTrack: () => void;
}

export function ActiveGigCard({ gig, onTrack }: ActiveGigCardProps) {
  const isDelivery = gig.fulfillmentType === "DELIVERY";
  const workerName = gig.assignments?.[0]?.worker?.fullName?.split(" ")[0] ?? null;
  const etaMinutes = gig.estimatedResponseMinutes;
  const rematching = isCustomerRematching(gig.status, gig.paymentStatus, gig.payment?.status);
  const searching = gig.status === "SEARCHING_FOR_WORKER" || gig.status === "POSTED";
  const pickup = gig.locationSummary || `${gig.city}, ${gig.region}`;
  const dropoff = gig.dropoffCity
    ? `${gig.dropoffCity}${gig.dropoffRegion ? `, ${gig.dropoffRegion}` : ""}`
    : null;

  return (
    <DutsCard className="gap-3 border border-brand/20 p-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text className="text-xs font-bold uppercase tracking-wider text-brand">
            {isDelivery ? "Active delivery" : "Active job"}
          </Text>
          <Text className="text-lg font-black text-ink">
            {isDelivery
              ? dropoff
                ? `${pickup} → ${dropoff}`
                : pickup
              : (gig.serviceCategory?.name ?? gig.title)}
          </Text>
        </View>
        <View className="rounded-full bg-brand/10 px-3 py-1">
          <Text className="text-xs font-bold text-brand">
            {statusLabel(gig.status, gig.fulfillmentType)}
          </Text>
        </View>
      </View>

      {workerName ? (
        <Text className="text-sm text-muted">
          {isDelivery ? "Courier" : "Worker"}: <Text className="font-bold text-ink">{workerName}</Text>
        </Text>
      ) : (
        <Text className="text-sm text-muted">
          {rematching
            ? isDelivery
              ? "Your courier cancelled. We’re matching you with another courier."
              : "Your worker cancelled. We’re matching you with another worker."
            : searching
              ? isDelivery
                ? "Finding a courier near your pickup…"
                : "Waiting for worker matches"
              : isDelivery
                ? "Finding another courier nearby"
                : "Finding another worker nearby"}
        </Text>
      )}

      {typeof etaMinutes === "number" && etaMinutes > 0 && !isDelivery ? (
        <Text className="text-sm text-muted">
          ETA: <Text className="font-bold text-ink">{etaMinutes} minutes</Text>
        </Text>
      ) : null}

      <AppButton
        label={
          searching
            ? rematching
              ? isDelivery
                ? "Find another courier"
                : "Find another worker"
              : isDelivery
                ? "View courier matches"
                : "View matches"
            : isDelivery
              ? "Track delivery"
              : "Track Live"
        }
        onPress={onTrack}
        variant="primary"
        size="md"
      />
    </DutsCard>
  );
}
