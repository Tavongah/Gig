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
      return "Final price is confirmed when you select a worker. Payment is collected when you confirm the booking.";
    case "ESTIMATE_TIMER":
      return `Final charge = billed hours × ${formatHourlyRateLabel(DEFAULT_HOURLY_RATE_CENTS)}. If work runs past estimated time, billing pauses until you approve extra time.`;
    default:
      return "Payment is collected when you confirm the booking. The worker is paid after completion.";
  }
}

export function PriceEstimateCard({ estimate, isLoading, isComplete, pricingType = "FIXED" }: PriceEstimateCardProps) {
  const timed = isTimeBasedPricing(pricingType);
  const hourlyRateCents = estimate?.hourlyRateCents ?? DEFAULT_HOURLY_RATE_CENTS;

  return (
    <DutsCard className="gap-2 border border-brand/20 p-5">
      <Text className="text-sm font-bold uppercase tracking-wider text-brand">Estimated Total</Text>
      <Text className="text-4xl font-black text-ink">
        {estimate ? formatCents(estimate.totalCents) : isLoading ? "Calculating..." : "Complete the form"}
      </Text>
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
