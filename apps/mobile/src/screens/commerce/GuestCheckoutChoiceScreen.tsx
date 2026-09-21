import { useState } from "react";
import { Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { AppButton } from "../../components/AppButton";
import { StoreHeader } from "../../components/StoreHeader";
import { api } from "../../lib/api";
import { logDutsFlow } from "../../lib/flow-log";
import { DUTS } from "../../lib/theme";
import type { GuestStackParamList } from "../../navigation/types";
import { useShopAreaStore } from "../../stores/shop-area.store";
import { useCommerceCartStore } from "../../stores/commerce-cart.store";

type Props = NativeStackScreenProps<GuestStackParamList, "GuestCheckoutChoice">;

function friendlyCheckoutError(message: string) {
  if (/VALIDATION_ERROR|Invalid uuid|Required|INTERNAL_ERROR|Prisma|Zod/i.test(message)) {
    return "Something changed with your cart. Please review it.";
  }
  return message;
}

export function GuestCheckoutChoiceScreen({ navigation }: Props) {
  const area = useShopAreaStore((s) => s.area);
  const lines = useCommerceCartStore((s) => s.lines);
  const setPendingCheckout = useCommerceCartStore((s) => s.setPendingCheckout);
  const [error, setError] = useState("");

  const handoffMut = useMutation({
    mutationFn: async () => {
      if (!lines.length) throw new Error("Your cart is empty.");
      return api.commerceGuestHandoff({
        shoppingAreaId: area?.id,
        lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity }))
      });
    },
    onSuccess: async (result) => {
      logDutsFlow("GUEST_WHATSAPP_HANDOFF", { itemCount: lines.length });
      if (!result.whatsappUrl) {
        setError("WhatsApp ordering isn't available right now. Sign in to complete your order.");
        return;
      }
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.open(result.whatsappUrl, "_blank");
        return;
      }
      await Linking.openURL(result.whatsappUrl);
    },
    onError: (e: Error) => setError(friendlyCheckoutError(e.message))
  });

  function chooseWhatsApp() {
    setError("");
    logDutsFlow("GUEST_CHECKOUT_STARTED", { channel: "whatsapp" });
    handoffMut.mutate();
  }

  function chooseAccount() {
    setPendingCheckout(true);
    logDutsFlow("GUEST_CHECKOUT_STARTED", { channel: "account" });
    logDutsFlow("GUEST_AUTH_CHECKOUT", { itemCount: lines.length });
    navigation.navigate("MainTabs", { screen: "SignIn" });
  }

  if (!lines.length) {
    return (
      <View className="flex-1 bg-background">
        <StoreHeader compact showCategories={false} />
        <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingBottom: 40, paddingTop: 12 }}>
          <Text className="text-2xl font-black text-ink">How would you like to order?</Text>
          <Text className="mt-3 text-base text-muted">Your cart is empty. Browse products to get started.</Text>
          <View className="mt-6">
            <AppButton
              label="Continue shopping"
              variant="secondary"
              onPress={() => navigation.navigate("MainTabs", { screen: "Home" })}
            />
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <StoreHeader compact showCategories={false} />
      <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingBottom: 40, paddingTop: 12 }}>
        <Text className="text-2xl font-black text-ink">How would you like to order?</Text>
        <Text className="mt-2 text-base text-muted">WhatsApp or a DUTS account — both complete your order.</Text>

        {error ? <Text className="mt-4 text-sm text-danger">{error}</Text> : null}

        <Pressable
          onPress={chooseWhatsApp}
          disabled={handoffMut.isPending}
          accessibilityRole="button"
          accessibilityLabel="Continue on WhatsApp"
          className="mt-8 rounded-2xl border border-border bg-card p-5"
        >
          <View className="h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: "#F4EEFF" }}>
            <Ionicons name="logo-whatsapp" size={26} color={DUTS.purple} />
          </View>
          <Text className="mt-3 text-lg font-extrabold text-ink">
            {handoffMut.isPending ? "Opening WhatsApp…" : "Continue on WhatsApp"}
          </Text>
          <Text className="mt-1 text-sm text-muted">No account needed.</Text>
          <Text className="mt-0.5 text-sm text-muted">We'll confirm your location and total in WhatsApp.</Text>
        </Pressable>

        <Pressable
          onPress={chooseAccount}
          accessibilityRole="button"
          accessibilityLabel="Sign in or create account"
          className="mt-4 rounded-2xl border border-border bg-card p-5"
        >
          <View className="h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: "#F4EEFF" }}>
            <Ionicons name="person-outline" size={24} color={DUTS.purple} />
          </View>
          <Text className="mt-3 text-lg font-extrabold text-ink">Sign in or create account</Text>
          <Text className="mt-1 text-sm text-muted">Use your DUTS account and saved delivery details.</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
