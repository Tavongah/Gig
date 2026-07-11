import { Text, View } from "react-native";
import {
  CUSTOMER_JOURNEY_PROGRESS,
  customerJourneyProgressIndex,
  resolveCustomerJourneyStage,
  type CustomerJourneyStage
} from "@gigflow/shared";

interface CustomerJourneyProgressProps {
  status: string;
  paymentStatus?: string | null;
  interestCount?: number;
  compact?: boolean;
}

export function CustomerJourneyProgress({
  status,
  paymentStatus,
  interestCount,
  compact = false
}: CustomerJourneyProgressProps) {
  const stage = resolveCustomerJourneyStage({ status, paymentStatus, interestCount });
  const currentIndex = customerJourneyProgressIndex(stage);

  if (compact) {
    const step = CUSTOMER_JOURNEY_PROGRESS[currentIndex];
    return (
      <View className="gap-2">
        <View className="h-1.5 overflow-hidden rounded-full bg-surface">
          <View
            className="h-full rounded-full bg-brand"
            style={{ width: `${((currentIndex + 1) / CUSTOMER_JOURNEY_PROGRESS.length) * 100}%` }}
          />
        </View>
        <Text className="text-xs font-semibold text-muted">
          Step {currentIndex + 1} of {CUSTOMER_JOURNEY_PROGRESS.length} · {step?.label ?? stage}
        </Text>
      </View>
    );
  }

  return (
    <View className="gap-3">
      {CUSTOMER_JOURNEY_PROGRESS.map((step, index) => {
        const done = index <= currentIndex;
        const active = index === currentIndex;
        return (
          <View key={step.stage} className="flex-row items-center gap-3">
            <View
              className={`h-8 w-8 items-center justify-center rounded-full ${
                done ? "bg-brand" : "border border-border bg-card"
              }`}
            >
              <Text className={`text-xs font-black ${done ? "text-white" : "text-muted"}`}>{index + 1}</Text>
            </View>
            <View className="flex-1">
              <Text className={`text-sm font-bold ${active ? "text-brand" : done ? "text-ink" : "text-muted"}`}>
                {step.label}
              </Text>
              {active ? <Text className="text-xs text-teal">Current step</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function journeyStageForGig(
  status: string,
  paymentStatus?: string | null,
  interestCount?: number
): CustomerJourneyStage {
  return resolveCustomerJourneyStage({ status, paymentStatus, interestCount });
}
