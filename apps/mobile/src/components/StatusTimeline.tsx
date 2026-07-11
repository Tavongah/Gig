import { Text, View } from "react-native";
import { CUSTOMER_JOURNEY_PROGRESS, customerJourneyProgressIndex, resolveCustomerJourneyStage } from "@gigflow/shared";
import { DutsCard } from "./DutsCard";

interface StatusTimelineProps {
  status: string;
  paymentStatus?: string | null;
  interestCount?: number;
}

export function StatusTimeline({ status, paymentStatus, interestCount }: StatusTimelineProps) {
  const stage = resolveCustomerJourneyStage({ status, paymentStatus, interestCount });
  const currentIndex = customerJourneyProgressIndex(stage);

  return (
    <DutsCard className="gap-4 p-5">
      <Text className="text-sm font-bold uppercase tracking-[3px] text-brand">Your booking progress</Text>
      {CUSTOMER_JOURNEY_PROGRESS.map((step, index) => {
        const done = index <= currentIndex;
        const active = index === currentIndex;
        return (
          <View key={step.stage} className="flex-row items-center gap-4">
            <View className={`h-10 w-10 items-center justify-center rounded-full ${done ? "bg-brand" : "bg-surface"}`}>
              <Text className={`font-black ${done ? "text-white" : "text-muted"}`}>{index + 1}</Text>
            </View>
            <View className="flex-1">
              <Text className={`font-bold ${active ? "text-brand" : done ? "text-ink" : "text-muted"}`}>
                {step.label}
              </Text>
              {active ? <Text className="text-sm text-teal">Current step</Text> : null}
            </View>
          </View>
        );
      })}
    </DutsCard>
  );
}
