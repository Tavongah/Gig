import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { DUTS } from "../lib/theme";
import { categoryIonicon, type ResolvedStorefrontCategory } from "../lib/storefront-categories";

type Props = {
  category: ResolvedStorefrontCategory;
  onPress: () => void;
  compact?: boolean;
};

export function StorefrontCategoryCard({ category, onPress, compact }: Props) {
  const comingSoon = category.state === "COMING_SOON";
  const restricted = category.state === "RESTRICTED" || category.restricted;
  const status = comingSoon ? "Coming soon" : restricted ? "Launching with DUTS" : null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={status ? `${category.label}, ${status}` : `Shop ${category.label}`}
      className={`items-center rounded-2xl border border-border bg-card ${compact ? "px-2 py-3" : "px-2 py-4"}`}
      style={{ width: compact ? "100%" : 108 }}
    >
      <View
        className="items-center justify-center rounded-full"
        style={{
          height: compact ? 36 : 44,
          width: compact ? 36 : 44,
          backgroundColor: restricted ? "#F4EEFF" : "#F4EEFF"
        }}
      >
        <Ionicons name={categoryIonicon(category.label)} size={compact ? 18 : 22} color={DUTS.purple} />
      </View>
      <Text className="mt-2 text-center text-sm font-bold text-ink" numberOfLines={2}>
        {category.label}
      </Text>
      {status ? (
        <Text className="mt-0.5 text-center text-[10px] font-semibold text-muted" numberOfLines={1}>
          {status}
        </Text>
      ) : (
        <View className="h-3" />
      )}
    </Pressable>
  );
}
