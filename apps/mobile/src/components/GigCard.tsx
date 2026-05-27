import { Text, View } from "react-native";
import { Pressable } from "react-native";
import type { GigDetail } from "../lib/api";
import { formatCents, formatStatus } from "../lib/format";
import { statusColor } from "../lib/gig-status";

interface GigCardProps {
  gig: GigDetail;
  subtitle?: string;
  onPress?: () => void;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
}

export function GigCard({ gig, subtitle, onPress, actionLabel, onAction, actionDisabled }: GigCardProps) {
  return (
    <Pressable onPress={onPress} className="rounded-3xl bg-white p-5 active:opacity-90">
      <View className="mb-3 flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text className="text-lg font-black text-ink">{gig.title}</Text>
          {gig.serviceCategory ? <Text className="text-sm text-slate-500">{gig.serviceCategory.name}</Text> : null}
        </View>
        <View className={`rounded-full px-3 py-1 ${statusColor(gig.status)}`}>
          <Text className="text-xs font-bold text-white">{formatStatus(gig.status)}</Text>
        </View>
      </View>

      {subtitle ? <Text className="mb-2 text-slate-600">{subtitle}</Text> : null}

      <View className="flex-row items-center justify-between">
        <Text className="text-xl font-black text-ink">{formatCents(gig.totalCents)}</Text>
        {gig.workerPayoutCents ? (
          <Text className="font-bold text-brand">Payout {formatCents(gig.workerPayoutCents)}</Text>
        ) : null}
      </View>

      {actionLabel && onAction ? (
        <Pressable
          disabled={actionDisabled}
          onPress={(event) => {
            event.stopPropagation?.();
            onAction();
          }}
          className="mt-4 rounded-2xl bg-ink px-4 py-3"
        >
          <Text className="text-center font-black text-white">{actionLabel}</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}
