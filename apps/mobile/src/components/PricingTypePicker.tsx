import { useEffect } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import type { PricingType } from "@gigflow/shared";
import { REQUEST_GIG_PRICING_TYPES } from "@gigflow/shared";
import { APP_NAME } from "../lib/brand";

export interface PricingTypeOption {
  value: PricingType;
  label: string;
  subtitle: string;
  description: string;
  examples: string[];
  showInfo?: boolean;
}

export const REQUEST_PRICING_OPTIONS: PricingTypeOption[] = [
  {
    value: "FIXED",
    label: "Fixed Price",
    subtitle: "Know the total cost before work begins.",
    description: "Best for jobs with a clear finish.",
    examples: [
      "Lawn Mowing",
      "Furniture Assembly",
      "Car Detailing",
      "Junk Removal",
      "TV Mounting",
      "Picture Hanging",
      "Small Handyman Jobs"
    ]
  },
  {
    value: "ESTIMATE_TIMER",
    label: "Estimate + Timer",
    subtitle: "Start with an estimate and only pay for extra time if you approve it.",
    description: "Perfect for jobs where the exact time is difficult to predict.",
    examples: [
      "Large Furniture Assembly",
      "Deep Cleaning (future)",
      "Large Moving Jobs (future)",
      "Long Home Projects",
      "Multi-room Jobs"
    ],
    showInfo: true
  }
];

const ESTIMATE_TIMER_INFO =
  `Your worker cannot charge additional time without your approval. If more time is needed, ${APP_NAME} will ask for your permission before any extra charges are added.`;

interface PricingTypePickerProps {
  value: PricingType;
  onChange: (value: PricingType) => void;
  recommendedPricing: PricingType;
  error?: string | null;
}

function RecommendedBadge() {
  return (
    <View className="self-start rounded-full bg-brand/15 px-2.5 py-1">
      <Text className="text-[11px] font-bold text-brand">⭐ Recommended</Text>
    </View>
  );
}

function PricingOptionCard({
  option,
  selected,
  recommended,
  onSelect
}: {
  option: PricingTypeOption;
  selected: boolean;
  recommended: boolean;
  onSelect: () => void;
}) {
  const scale = useSharedValue(selected ? 1 : 0.995);

  useEffect(() => {
    scale.value = withTiming(selected ? 1 : 0.995, { duration: 180 });
  }, [scale, selected]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }]
  }));

  function showEstimateInfo(): void {
    Alert.alert("Estimate + Timer", ESTIMATE_TIMER_INFO, [{ text: "Got it" }]);
  }

  return (
    <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={animatedStyle}>
      <Pressable
        onPress={onSelect}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        className={`rounded-3xl border-2 px-5 py-4 active:opacity-95 ${
          selected ? "border-brand bg-brand/10 shadow-sm" : "border-border bg-card"
        }`}
      >
        {recommended ? <RecommendedBadge /> : null}

        <View className={`flex-row items-start gap-3 ${recommended ? "mt-3" : ""}`}>
          <View
            className={`mt-1 h-6 w-6 items-center justify-center rounded-full border-2 ${
              selected ? "border-brand bg-brand" : "border-muted/60 bg-card"
            }`}
          >
            {selected ? <Text className="text-xs font-black text-white">✓</Text> : null}
          </View>

          <View className="flex-1 gap-2">
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className={`text-lg font-black ${selected ? "text-brand" : "text-ink"}`}>{option.label}</Text>
              {option.showInfo ? (
                <Pressable
                  onPress={(event) => {
                    event.stopPropagation?.();
                    showEstimateInfo();
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Learn how Estimate plus Timer works"
                  className="h-6 w-6 items-center justify-center rounded-full bg-surface"
                >
                  <Text className="text-sm font-bold text-brand">ⓘ</Text>
                </Pressable>
              ) : null}
            </View>

            <Text className="text-sm font-semibold leading-5 text-ink">{option.subtitle}</Text>
            <Text className="text-sm leading-5 text-muted">{option.description}</Text>

            <View className="gap-1 pt-1">
              {option.examples.map((example) => (
                <Text key={example} className="text-xs leading-5 text-muted">
                  • {example}
                </Text>
              ))}
            </View>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

export function PricingTypePicker({ value, onChange, recommendedPricing, error }: PricingTypePickerProps) {
  const options = REQUEST_PRICING_OPTIONS.filter((option) =>
    REQUEST_GIG_PRICING_TYPES.includes(option.value as (typeof REQUEST_GIG_PRICING_TYPES)[number])
  );

  return (
    <View className="gap-3">
      <View className="gap-1">
        <Text className="text-base font-black text-ink">How would you like to pay for this job?</Text>
        <Text className="text-sm text-muted">No hidden fees. You stay in control of any extra charges.</Text>
      </View>

      <View className="gap-3">
        {options.map((option) => (
          <PricingOptionCard
            key={option.value}
            option={option}
            selected={value === option.value}
            recommended={recommendedPricing === option.value}
            onSelect={() => onChange(option.value)}
          />
        ))}
      </View>

      {error ? <Text className="text-sm font-semibold text-danger">{error}</Text> : null}
    </View>
  );
}

export function estimatedHoursLabel(pricingType: PricingType): string {
  switch (pricingType) {
    case "FIXED":
      return "Expected duration (hours)";
    case "ESTIMATE_TIMER":
      return "Booked hours";
    default:
      return "Estimated hours";
  }
}

export function estimatedHoursHint(pricingType: PricingType): string {
  switch (pricingType) {
    case "FIXED":
      return "Used for scheduling only — it does not change your fixed price.";
    case "ESTIMATE_TIMER":
      return "Timer pauses at this limit until you approve extra time.";
    default:
      return "Worker time is tracked and billed in 15-minute increments.";
  }
}
