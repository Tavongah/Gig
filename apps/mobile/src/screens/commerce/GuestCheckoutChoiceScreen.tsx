import { useState } from "react";
import { Linking, Platform, ScrollView, Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { AppButton } from "../../components/AppButton";
import { api } from "../../lib/api";
import { logDutsFlow } from "../../lib/flow-log";
import { DUTS } from "../../lib/theme";
import type { GuestStackParamList } from "../../navigation/types";
import { useShopAreaStore } from "../../stores/shop-area.store";
import { useCommerceCartStore } from "../../stores/commerce-cart.store";

type Props = NativeStackScreenProps<GuestStackParamList, "GuestCheckoutChoice">;

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
    onError: (e: Error) => setError(e.message)
  });

  function chooseAccount() {
    setPendingCheckout(true);
    logDutsFlow("GUEST_AUTH_CHECKOUT", { itemCount: lines.length });
    navigation.navigate("MainTabs", { screen: "SignIn" });
  }

  return (
    <ScrollView className="flex-1 bg-background px-5" contentContainerStyle={{ paddingBottom: 40, paddingTop: 12 }}>
      <Text className="text-2xl font-black text-ink">How would you like to order?</Text>
      <Text className="mt-3 text-base text-muted">
        Create an account to track orders and save your details.
      </Text>

      {error ? <Text className="mt-4 text-sm text-danger">{error}</Text> : null}

      <View className="mt-8 gap-3">
        <AppButton
          label={handoffMut.isPending ? "Opening WhatsApp…" : "Continue on WhatsApp"}
          onPress={() => {
            setError("");
            logDutsFlow("GUEST_CHECKOUT_STARTED", { channel: "whatsapp" });
            handoffMut.mutate();
          }}
          disabled={handoffMut.isPending}
        />
        <AppButton
          label="Sign in / Create account"
          variant="secondary"
          onPress={chooseAccount}
        />
      </View>

      <Text className="mt-6 text-sm text-muted" style={{ color: DUTS.muted }}>
        WhatsApp is the fastest way to confirm with DUTS. We re-check prices before you confirm.
      </Text>
    </ScrollView>
  );
}
