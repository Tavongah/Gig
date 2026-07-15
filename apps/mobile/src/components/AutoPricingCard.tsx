import { Alert, Pressable, Text, View } from "react-native";
import type { PricingType } from "@gigflow/shared";
import { APP_NAME } from "../lib/brand";
import { DutsCard } from "./DutsCard";

const PRICING_COPY: Record<
  "FIXED" | "ESTIMATE_TIMER",
  { label: string; body: string; why: string }
> = {
  FIXED: {
    label: "Fixed Price",
    body: "You'll know the total cost before work begins.",
    why: `${APP_NAME} chose Fixed Price because this job has a clear scope. The total is agreed before work starts, with no surprise hourly charges.`
  },
  ESTIMATE_TIMER: {
    label: "Estimate + Timer",
    body: "Start with an estimate and approve any extra time before you're charged.",
    why: `${APP_NAME} chose Estimate + Timer because job duration can vary. The timer starts when work begins and pauses at the estimate until you approve extra time.`
  }
};

interface AutoPricingCardProps {
  pricingType: PricingType;
}

export function AutoPricingCard({ pricingType }: AutoPricingCardProps) {
  const key = pricingType === "ESTIMATE_TIMER" ? "ESTIMATE_TIMER" : "FIXED";
  const copy = PRICING_COPY[key];

  return (
    <DutsCard className="gap-2 border border-brand/20 p-4">
      <Text className="text-sm font-bold uppercase tracking-wider text-brand">Pricing</Text>
      <Text className="text-xl font-black text-ink">{copy.label}</Text>
      <Text className="text-sm leading-5 text-muted">{copy.body}</Text>
      <Pressable
        onPress={() => Alert.alert("Why this pricing?", copy.why, [{ text: "Got it" }])}
        hitSlop={8}
        className="self-start pt-1"
      >
        <Text className="text-sm font-bold text-brand">Why this pricing?</Text>
      </Pressable>
    </DutsCard>
  );
}

export function estimatedHoursLabel(pricingType: PricingType): string {
  switch (pricingType) {
    case "ESTIMATE_TIMER":
      return "Estimated Time";
    case "FIXED":
      return "Expected duration (hours)";
    default:
      return "Estimated hours";
  }
}

export function estimatedHoursHint(pricingType: PricingType): string {
  switch (pricingType) {
    case "ESTIMATE_TIMER":
      return "This is the starting estimate. You must approve any additional time.";
    case "FIXED":
      return "Used for scheduling only — it does not change your fixed price.";
    default:
      return "Worker time is tracked and billed in 15-minute increments.";
  }
}
