import type { ReactNode } from "react";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

interface CollapsibleSectionProps {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({ title, subtitle, defaultOpen = false, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <View className="overflow-hidden rounded-2xl border border-border bg-surface">
      <Pressable
        onPress={() => setOpen((current) => !current)}
        className="flex-row items-center justify-between px-4 py-3 active:opacity-80"
      >
        <View className="flex-1 gap-0.5 pr-3">
          <Text className="text-sm font-bold text-ink">{title}</Text>
          {subtitle ? <Text className="text-xs text-muted">{subtitle}</Text> : null}
        </View>
        <Text className="text-lg font-black text-brand">{open ? "−" : "+"}</Text>
      </Pressable>
      {open ? <View className="border-t border-border px-4 py-3">{children}</View> : null}
    </View>
  );
}
