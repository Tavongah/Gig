import { Text, View } from "react-native";
import { TRACKING_STATUSES, statusIndex } from "../lib/gig-status";
import { formatStatus } from "../lib/format";

interface StatusTimelineProps {
  status: string;
}

export function StatusTimeline({ status }: StatusTimelineProps) {
  const currentIndex = statusIndex(status);

  return (
    <View className="gap-4 rounded-3xl bg-slate-900 p-5">
      <Text className="text-sm font-bold uppercase tracking-[3px] text-brand">Live status</Text>
      {TRACKING_STATUSES.map((step, index) => {
        const done = index <= currentIndex;
        const active = index === currentIndex;
        return (
          <View key={step} className="flex-row items-center gap-4">
            <View className={`h-10 w-10 items-center justify-center rounded-full ${done ? "bg-brand" : "bg-slate-700"}`}>
              <Text className="font-black text-ink">{index + 1}</Text>
            </View>
            <View className="flex-1">
              <Text className={`font-bold ${active ? "text-white" : done ? "text-slate-300" : "text-slate-500"}`}>
                {formatStatus(step)}
              </Text>
              {active ? <Text className="text-sm text-brand">Current step</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
