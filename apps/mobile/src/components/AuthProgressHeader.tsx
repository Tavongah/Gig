import { Text, View } from "react-native";
import type { AuthStep } from "../lib/auth";

const STEPS: Array<{ id: AuthStep; label: string }> = [
  { id: "account", label: "Create account" },
  { id: "email", label: "Verify email" },
  { id: "phone", label: "Verify phone" },
  { id: "profile", label: "Complete profile" }
];

function stepIndex(step: AuthStep): number {
  if (step === "ready") return STEPS.length;
  const index = STEPS.findIndex((item) => item.id === step);
  return index >= 0 ? index : 0;
}

interface AuthProgressHeaderProps {
  currentStep: AuthStep;
}

export function AuthProgressHeader({ currentStep }: AuthProgressHeaderProps) {
  const activeIndex = stepIndex(currentStep);

  return (
    <View className="gap-3">
      <Text className="text-xs font-bold uppercase tracking-wider text-muted">Getting started</Text>
      <View className="flex-row flex-wrap gap-2">
        {STEPS.map((step, index) => {
          const done = index < activeIndex;
          const active = index === activeIndex;
          return (
            <View
              key={step.id}
              className={`rounded-full px-3 py-1 ${done ? "bg-brand/15" : active ? "bg-brand" : "bg-surface"}`}
            >
              <Text className={`text-xs font-bold ${active ? "text-white" : done ? "text-brand" : "text-muted"}`}>
                {index + 1}. {step.label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
