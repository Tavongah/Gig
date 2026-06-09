import { Text, View } from "react-native";
import type { PriceEstimate } from "../lib/api";
import { formatCents } from "../lib/format";
import { DutsCard } from "./DutsCard";

interface PriceEstimateCardProps {
  estimate?: PriceEstimate | null;
  isLoading?: boolean;
  isComplete?: boolean;
}

function LineItem({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="text-muted">{label}</Text>
      <Text className="font-semibold text-ink">{value}</Text>
    </View>
  );
}

export function PriceEstimateCard({ estimate, isLoading, isComplete }: PriceEstimateCardProps) {
  return (
    <DutsCard className="gap-3 border border-brand/20 p-5">
      <Text className="text-sm font-bold uppercase tracking-wider text-brand">Instant estimated price</Text>
      <Text className="text-4xl font-black text-ink">
        {estimate ? formatCents(estimate.totalCents) : isLoading ? "Calculating..." : "Complete the form"}
      </Text>

      {estimate && isComplete ? (
        <View className="gap-2 border-t border-border pt-3">
          <LineItem label="Base service price" value={formatCents(estimate.baseRateCents)} />
          <LineItem label={`Labor (${estimate.estimatedHours}h)`} value={formatCents(estimate.laborCents)} />
          {estimate.urgencyFeeCents > 0 ? (
            <LineItem label="Urgency fee" value={formatCents(estimate.urgencyFeeCents)} />
          ) : null}
          <LineItem
            label={`Platform fee (${Math.round(estimate.commissionRate * 100)}%)`}
            value={formatCents(estimate.platformFeeCents)}
          />
          <LineItem label="Worker receives" value={formatCents(estimate.workerPayoutCents)} />
          <Text className="pt-1 text-xs text-muted">Final price may change if job details are updated.</Text>
        </View>
      ) : null}
    </DutsCard>
  );
}
