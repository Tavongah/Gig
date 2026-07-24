import { Text, View } from "react-native";
import type { PricingType } from "@gigflow/shared";
import { DEFAULT_HOURLY_RATE_CENTS, formatHourlyRateLabel, isTimeBasedPricing } from "@gigflow/shared";
import type { PriceEstimate } from "../lib/api";
import { formatCents } from "../lib/format";
import { DutsCard } from "./DutsCard";

interface PriceEstimateCardProps {
  estimate?: PriceEstimate | null;
  isLoading?: boolean;
  isComplete?: boolean;
  pricingType?: PricingType;
}

function pricingFootnote(pricingType: PricingType): string {
  switch (pricingType) {
    case "FIXED":
      return "Final price is confirmed when you select a worker. Tax is included before payment. Payment is collected when you confirm the booking.";
    case "ESTIMATE_TIMER":
      return `Final charge = billed hours × ${formatHourlyRateLabel(DEFAULT_HOURLY_RATE_CENTS)} + applicable tax. If work runs past estimated time, billing pauses until you approve extra time.`;
    default:
      return "Payment is collected when you confirm the booking. Applicable tax is included in your total.";
  }
}

export function PriceEstimateCard({ estimate, isLoading, isComplete, pricingType = "FIXED" }: PriceEstimateCardProps) {
  const timed = isTimeBasedPricing(pricingType);
  const hourlyRateCents = estimate?.hourlyRateCents ?? DEFAULT_HOURLY_RATE_CENTS;
  const serviceCents = estimate?.totalCents;
  const taxCents = estimate?.taxAmountCents ?? 0;
  const totalCents = estimate?.customerTotalCents ?? (serviceCents != null ? serviceCents + taxCents : undefined);

  return (
    <DutsCard className="gap-2 border border-brand/20 p-5">
      <Text className="text-sm font-bold uppercase tracking-wider text-brand">Estimated Total</Text>
      <Text className="text-4xl font-black text-ink">
        {totalCents != null ? formatCents(totalCents) : isLoading ? "Calculating..." : "Complete the form"}
      </Text>
      {estimate && serviceCents != null ? (
        <View className="gap-1 pt-1">
          <View className="flex-row justify-between">
            <Text className="text-sm text-muted">Service</Text>
            <Text className="text-sm font-semibold text-ink">{formatCents(serviceCents)}</Text>
          </View>
          {taxCents > 0 ? (
            <View className="flex-row justify-between">
              <Text className="text-sm text-muted">Tax</Text>
              <Text className="text-sm font-semibold text-ink">{formatCents(taxCents)}</Text>
            </View>
          ) : null}
          <View className="flex-row justify-between">
            <Text className="text-sm font-bold text-ink">Total</Text>
            <Text className="text-sm font-bold text-ink">{formatCents(totalCents!)}</Text>
          </View>
        </View>
      ) : null}
      {timed ? (
        <Text className="text-sm font-bold text-brand">
          Hourly Rate: {formatHourlyRateLabel(hourlyRateCents)}
        </Text>
      ) : null}
      {estimate && isComplete ? (
        <Text className="pt-1 text-xs leading-5 text-muted">{pricingFootnote(pricingType)}</Text>
      ) : null}
    </DutsCard>
  );
}
