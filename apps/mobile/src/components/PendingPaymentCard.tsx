import { Text, View } from "react-native";
import type { GigDetail } from "../lib/api";
import { formatCents } from "../lib/format";
import { AppButton } from "./AppButton";
import { DutsCard } from "./DutsCard";

interface PendingPaymentCardProps {
  gig: GigDetail;
  onPay: () => void;
  payLabel?: string;
  loading?: boolean;
  disabled?: boolean;
}

export function PendingPaymentCard({
  gig,
  onPay,
  payLabel = "Pay with Stripe",
  loading = false,
  disabled = false
}: PendingPaymentCardProps) {
  return (
    <DutsCard className="gap-3 border border-orange/30 bg-orange/5 p-5">
      <Text className="text-xs font-bold uppercase tracking-wider text-orange">Stripe payment needed</Text>
      <Text className="text-lg font-black text-ink">{gig.title}</Text>
      <Text className="text-sm text-muted">
        Complete your Stripe payment to publish this gig and start matching workers.
      </Text>
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-2xl font-black text-brand">{formatCents(gig.totalCents)}</Text>
        <View className="min-w-[148px] flex-1">
          <AppButton label={loading ? "Opening Stripe..." : payLabel} onPress={onPay} size="md" loading={loading} disabled={disabled || loading} />
        </View>
      </View>
    </DutsCard>
  );
}
