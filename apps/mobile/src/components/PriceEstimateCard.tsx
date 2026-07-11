import { Text, View } from "react-native";
import type { PricingType } from "@gigflow/shared";
import type { PriceEstimate } from "../lib/api";
import { formatCents } from "../lib/format";
import { DutsCard } from "./DutsCard";

interface PriceEstimateCardProps {
  estimate?: PriceEstimate | null;
  isLoading?: boolean;
  isComplete?: boolean;
  pricingType?: PricingType;
}

function pricingSubtitle(pricingType: PricingType): string {
  switch (pricingType) {
    case "FIXED":
      return "Fixed price estimate";
    case "ESTIMATE_TIMER":
      return "Estimated total for booked hours";
    default:
      return "Hourly estimate";
  }
}

function pricingFootnote(pricingType: PricingType): string {
  switch (pricingType) {
    case "FIXED":
      return "Final fixed price is confirmed when you select a worker. Payment is captured only after you approve completion.";
    case "ESTIMATE_TIMER":
      return "If work runs past booked hours, billing pauses until you approve extra time.";
    default:
      return "Final total depends on tracked hours. Billed in 15-minute blocks with a 1-hour minimum.";
  }
}

function LineItem({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="text-muted">{label}</Text>
      <Text className="font-semibold text-ink">{value}</Text>
    </View>
  );
}

export function PriceEstimateCard({ estimate, isLoading, isComplete, pricingType = "FIXED" }: PriceEstimateCardProps) {
  return (
    <DutsCard className="gap-3 border border-brand/20 p-5">
      <Text className="text-sm font-bold uppercase tracking-wider text-brand">{pricingSubtitle(pricingType)}</Text>
      <Text className="text-4xl font-black text-ink">
        {estimate ? formatCents(estimate.totalCents) : isLoading ? "Calculating..." : "Complete the form"}
      </Text>

      {estimate && isComplete ? (
        <View className="gap-2 border-t border-border pt-3">
          <LineItem label="Base service price" value={formatCents(estimate.baseRateCents)} />
          {pricingType !== "FIXED" && estimate.laborCents > 0 ? (
            <LineItem label={`Labor (${estimate.estimatedHours}h)`} value={formatCents(estimate.laborCents)} />
          ) : null}
          {estimate.urgencyFeeCents > 0 ? (
            <LineItem label="Urgency fee" value={formatCents(estimate.urgencyFeeCents)} />
          ) : null}
          <LineItem
            label={`Platform fee (${Math.round(estimate.commissionRate * 100)}%)`}
            value={formatCents(estimate.platformFeeCents)}
          />
          <LineItem label="Worker receives" value={formatCents(estimate.workerPayoutCents)} />
          <Text className="pt-1 text-xs text-muted">{pricingFootnote(pricingType)}</Text>
        </View>
      ) : null}
    </DutsCard>
  );
}
