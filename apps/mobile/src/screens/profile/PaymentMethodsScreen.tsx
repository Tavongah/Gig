import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { AppButton } from "../../components/AppButton";
import { DutsCard } from "../../components/DutsCard";
import { EmptyState } from "../../components/EmptyState";
import { Screen } from "../../components/Screen";
import { api } from "../../lib/api";
import { DUTS } from "../../lib/theme";
import { useSessionStore } from "../../stores/session.store";

type PaymentMethod = {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
};

export function PaymentMethodsScreen() {
  const session = useSessionStore((state) => state.session)!;
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [stripeConfigured, setStripeConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.listPaymentMethods(session.token);
      setMethods(result.methods);
      setStripeConfigured(result.stripeConfigured);
    } catch (error) {
      Alert.alert("Could not load cards", error instanceof Error ? error.message : "Try again.");
    } finally {
      setLoading(false);
    }
  }, [session.token]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  async function addCard(): Promise<void> {
    try {
      const { url } = await api.createPaymentMethodsPortal(session.token);
      await Linking.openURL(url);
    } catch (error) {
      Alert.alert(
        "Add a card",
        error instanceof Error
          ? error.message
          : "Cards are saved securely when you confirm a booking checkout."
      );
    }
  }

  async function removeCard(method: PaymentMethod): Promise<void> {
    Alert.alert("Remove card", `Remove ${method.brand.toUpperCase()} •••• ${method.last4}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          void (async () => {
            setBusyId(method.id);
            try {
              await api.removePaymentMethod(method.id, session.token);
              await refresh();
            } catch (error) {
              Alert.alert("Could not remove card", error instanceof Error ? error.message : "Try again.");
            } finally {
              setBusyId(null);
            }
          })();
        }
      }
    ]);
  }

  async function makeDefault(method: PaymentMethod): Promise<void> {
    setBusyId(method.id);
    try {
      await api.setDefaultPaymentMethod(method.id, session.token);
      await refresh();
    } catch (error) {
      Alert.alert("Could not update default", error instanceof Error ? error.message : "Try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 32 }}>
        <Text className="text-sm text-muted">
          Manage cards linked to your DUTS Stripe customer account. Cards used at checkout can appear here.
        </Text>

        {loading ? (
          <ActivityIndicator color={DUTS.purple} />
        ) : !stripeConfigured ? (
          <EmptyState
            emoji="💳"
            title="Payments coming online"
            description="Stripe is not configured yet. Cards will show here once payments are enabled."
          />
        ) : methods.length === 0 ? (
          <EmptyState
            emoji="💳"
            title="No saved cards"
            description="Add a card securely, or complete a booking checkout to save one for next time."
            actionLabel="Add card"
            onAction={() => void addCard()}
          />
        ) : (
          methods.map((method) => (
            <DutsCard key={method.id} className="gap-3 p-5">
              <View className="flex-row items-center gap-3">
                <Ionicons name="card-outline" size={22} color={DUTS.purple} />
                <View className="flex-1">
                  <Text className="text-base font-black text-ink">
                    {method.brand.toUpperCase()} •••• {method.last4}
                  </Text>
                  <Text className="text-sm text-muted">
                    Expires {String(method.expMonth).padStart(2, "0")}/{method.expYear}
                  </Text>
                  {method.isDefault ? (
                    <Text className="mt-1 text-xs font-bold uppercase tracking-wider text-brand">Default</Text>
                  ) : null}
                </View>
              </View>
              <View className="flex-row flex-wrap gap-2">
                {!method.isDefault ? (
                  <AppButton
                    label={busyId === method.id ? "Updating..." : "Set default"}
                    variant="secondary"
                    onPress={() => void makeDefault(method)}
                  />
                ) : null}
                <AppButton
                  label={busyId === method.id ? "Removing..." : "Remove"}
                  variant="secondary"
                  onPress={() => void removeCard(method)}
                />
              </View>
            </DutsCard>
          ))
        )}

        {stripeConfigured ? <AppButton label="Add card" onPress={() => void addCard()} /> : null}
        <Pressable onPress={() => void refresh()}>
          <Text className="text-center font-semibold text-brand">Refresh</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}
