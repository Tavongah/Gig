import { Text, View } from "react-native";
import { formatMoney } from "@gigflow/shared";
import type { GigWorkerInterest } from "../lib/api";
import { initials } from "../lib/format";
import { AppButton } from "./AppButton";
import { DutsCard } from "./DutsCard";
import { VerifiedBadge } from "./VerifiedBadge";

interface WorkerInterestCardProps {
  interest: GigWorkerInterest;
  onChoose: () => void;
  choosing?: boolean;
}

function CertificationBadge({ label }: { label: string }) {
  return (
    <View className="rounded-full bg-teal/10 px-2 py-1">
      <Text className="text-[10px] font-bold text-teal">{label}</Text>
    </View>
  );
}

export function WorkerInterestCard({ interest, onChoose, choosing }: WorkerInterestCardProps) {
  const { worker } = interest;
  const etaMinutes = interest.estimatedArrivalMinutes;
  const completionHours = interest.estimatedHours;

  return (
    <DutsCard className="gap-4 p-5">
      <View className="flex-row items-start gap-3">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-hero">
          {worker.avatarUrl ? (
            <Text className="text-xs text-muted">Photo</Text>
          ) : (
            <Text className="text-xl font-black text-brand">{initials(worker.fullName)}</Text>
          )}
        </View>
        <View className="flex-1 gap-1">
          <View className="flex-row items-center justify-between gap-2">
            <Text className="text-lg font-black text-ink">{worker.fullName}</Text>
            <VerifiedBadge />
          </View>
          <Text className="text-sm font-semibold text-orange">
            ★ {worker.ratingAverage.toFixed(1)} · {worker.completedGigCount} gigs completed
          </Text>
          {interest.distanceMiles != null ? (
            <Text className="text-sm text-muted">
              {interest.distanceMiles} mi away
              {etaMinutes != null ? ` · ~${etaMinutes} min ETA` : ""}
            </Text>
          ) : etaMinutes != null ? (
            <Text className="text-sm text-muted">~{etaMinutes} min ETA</Text>
          ) : null}
        </View>
      </View>

      <View className="flex-row flex-wrap gap-2">
        {worker.emailVerified ? <CertificationBadge label="Email verified" /> : null}
        {worker.phoneVerified ? <CertificationBadge label="Phone verified" /> : null}
        {worker.hourlyRateCents ? (
          <CertificationBadge label={`${formatMoney(worker.hourlyRateCents)}/hr`} />
        ) : null}
      </View>

      <View className="flex-row items-end justify-between gap-3 rounded-2xl bg-surface px-4 py-3">
        <View>
          <Text className="text-xs font-bold uppercase tracking-wider text-muted">Worker charge</Text>
          <Text className="text-2xl font-black text-brand">{formatMoney(interest.offeredWorkerPayoutCents)}</Text>
        </View>
        <View className="items-end">
          <Text className="text-xs text-muted">Est. duration</Text>
          <Text className="text-sm font-bold text-ink">
            {completionHours} hr{completionHours === 1 ? "" : "s"}
          </Text>
        </View>
      </View>

      {interest.message ? (
        <View className="rounded-2xl border border-border bg-card px-4 py-3">
          <Text className="text-xs font-bold uppercase tracking-wider text-muted">Worker note</Text>
          <Text className="mt-1 text-sm leading-5 text-ink">{interest.message}</Text>
        </View>
      ) : null}

      <AppButton label={choosing ? "Opening..." : "Choose Worker"} onPress={onChoose} disabled={choosing} />
    </DutsCard>
  );
}
