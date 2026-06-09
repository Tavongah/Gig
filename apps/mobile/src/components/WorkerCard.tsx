import { Text, View } from "react-native";
import type { AvailableWorker } from "../lib/api";
import { formatCents, initials } from "../lib/format";
import { AppButton } from "./AppButton";
import { DutsCard } from "./DutsCard";
import { VerifiedBadge } from "./VerifiedBadge";

interface WorkerCardProps {
  worker: AvailableWorker;
  onRequest: () => void;
}

export function WorkerCard({ worker, onRequest }: WorkerCardProps) {
  const serviceNames = worker.services.map((service) => service.name).join(" · ");

  return (
    <DutsCard className="gap-4 p-5">
      <View className="flex-row items-start gap-3">
        <View className="h-14 w-14 items-center justify-center rounded-full bg-hero">
          <Text className="text-lg font-black text-brand">{initials(worker.fullName)}</Text>
        </View>
        <View className="flex-1 gap-1">
          <View className="flex-row flex-wrap items-center gap-2">
            <Text className="text-lg font-black text-ink">{worker.fullName}</Text>
            <VerifiedBadge />
          </View>
          <Text className="text-sm font-semibold text-orange">
            ★ {worker.ratingAverage.toFixed(1)} · {worker.completedGigCount} gigs
          </Text>
        </View>
        <View className="rounded-full border border-border bg-surface px-3 py-1.5">
          <Text className="text-xs font-bold text-muted">{worker.distanceMiles} mi</Text>
        </View>
      </View>

      <Text className="text-sm text-muted">{serviceNames}</Text>
      <Text className="text-sm text-muted">
        Est. response: {worker.estimatedResponseMinutes} min
        {worker.hourlyRateCents ? ` · from ${formatCents(worker.hourlyRateCents)}/hr` : ""}
      </Text>

      <AppButton label="Request Now" onPress={onRequest} variant="primary" size="md" />
    </DutsCard>
  );
}
