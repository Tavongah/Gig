import { Text, View } from "react-native";
import { TRACKING_STATUSES, statusIndex, statusLabel } from "../lib/gig-status";
import { DutsCard } from "./DutsCard";

interface StatusTimelineProps {
  status: string;
}

export function StatusTimeline({ status }: StatusTimelineProps) {
  const currentIndex = statusIndex(status);

  return (
    <DutsCard className="gap-4 p-5">
      <Text className="text-sm font-bold uppercase tracking-[3px] text-brand">Live status</Text>
      {TRACKING_STATUSES.map((step, index) => {
        const done = index <= currentIndex;
        const active = index === currentIndex;
        return (
          <View key={step} className="flex-row items-center gap-4">
            <View className={`h-10 w-10 items-center justify-center rounded-full ${done ? "bg-brand" : "bg-surface"}`}>
              <Text className={`font-black ${done ? "text-white" : "text-muted"}`}>{index + 1}</Text>
            </View>
            <View className="flex-1">
              <Text className={`font-bold ${active ? "text-brand" : done ? "text-ink" : "text-muted"}`}>
                {statusLabel(step)}
              </Text>
              {active ? <Text className="text-sm text-teal">Current step</Text> : null}
            </View>
          </View>
        );
      })}
    </DutsCard>
  );
}
