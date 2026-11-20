import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { DUTS } from "../lib/theme";
import { registerWebCartConfirm } from "../lib/web-cart-confirm";

export function WebCartConfirm() {
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    registerWebCartConfirm(
      () =>
        new Promise((resolve) => {
          resolveRef.current = resolve;
          setOpen(true);
        })
    );
    return () => registerWebCartConfirm(null);
  }, []);

  function settle(confirmed: boolean) {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setOpen(false);
    resolve?.(confirmed);
  }

  if (Platform.OS !== "web" || !open) return null;

  return (
    <View
      accessibilityViewIsModal
      accessibilityRole="alert"
      accessibilityLabel="Start a new cart?"
      style={{
        position: "fixed" as "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 1000,
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        backgroundColor: "rgba(17, 24, 39, 0.4)"
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cancel"
        onPress={() => settle(false)}
        style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
      />
      <View
        className="w-full max-w-sm rounded-2xl border border-border bg-card px-5 py-5"
        style={{ backgroundColor: DUTS.card, zIndex: 1 }}
      >
        <Text className="text-xl font-black text-ink">Start a new cart?</Text>
        <Text className="mt-2 text-base leading-6 text-label">Your cart contains items from another shop.</Text>
        <View className="mt-5 flex-row gap-3">
          <Pressable
            onPress={() => settle(false)}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            className="h-12 flex-1 items-center justify-center rounded-full border border-border bg-card"
          >
            <Text className="font-extrabold text-ink">Cancel</Text>
          </Pressable>
          <Pressable
            onPress={() => settle(true)}
            accessibilityRole="button"
            accessibilityLabel="Continue"
            className="h-12 flex-1 items-center justify-center rounded-full"
            style={{ backgroundColor: DUTS.purple }}
          >
            <Text className="font-extrabold text-white">Continue</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
