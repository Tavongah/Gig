import { Pressable, Text, View } from "react-native";
import type { GigDetail } from "../lib/api";
import { formatCents } from "../lib/format";
import { AppButton } from "./AppButton";
import { DutsCard } from "./DutsCard";
import { StatusBadge } from "./StatusBadge";

interface GigCardProps {
  gig: GigDetail;
  subtitle?: string;
  onPress?: () => void;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  /** When true, show worker earnings instead of customer total. */
  showWorkerEarnings?: boolean;
}

export function GigCard({
  gig,
  subtitle,
  onPress,
  actionLabel,
  onAction,
  actionDisabled,
  showWorkerEarnings = false
}: GigCardProps) {
  const amount = showWorkerEarnings ? gig.workerPayoutCents : gig.totalCents;
  const amountLabel = showWorkerEarnings ? "Your earnings" : undefined;

  return (
    <Pressable onPress={onPress} disabled={!onPress}>
      <DutsCard className="gap-3 p-5 active:opacity-95">
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1 gap-1">
            <Text className="text-lg font-black text-ink">{gig.title}</Text>
            {gig.serviceCategory ? <Text className="text-sm text-muted">{gig.serviceCategory.name}</Text> : null}
          </View>
          <StatusBadge status={gig.status} />
        </View>

        {subtitle ? <Text className="text-sm text-muted">{subtitle}</Text> : null}

        <View className="gap-1">
          {amountLabel ? <Text className="text-xs font-bold uppercase tracking-wider text-muted">{amountLabel}</Text> : null}
          <Text className="text-2xl font-black text-ink">{formatCents(amount)}</Text>
        </View>

        {actionLabel && onAction ? (
          <AppButton label={actionLabel} onPress={onAction} disabled={actionDisabled} variant="primary" size="md" />
        ) : null}
      </DutsCard>
    </Pressable>
  );
}
