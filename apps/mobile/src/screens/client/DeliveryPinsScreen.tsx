import { useState } from "react";
import { Pressable, Share, Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { api } from "../../lib/api";
import { friendlyDeliveryError } from "../../lib/delivery-errors";
import { showAlert, showConfirm } from "../../lib/confirm";
import { AppButton } from "../../components/AppButton";
import { DutsCard } from "../../components/DutsCard";
import { LoadingButton } from "../../components/LoadingButton";
import { Screen } from "../../components/Screen";
import type { RootStackParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";

export function DeliveryPinsScreen() {
  const session = useSessionStore((state) => state.session)!;
  const route = useRoute<RouteProp<RootStackParamList, "DeliveryPins">>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [pickupPin, setPickupPin] = useState(route.params.pickupPin);
  const [deliveryPin, setDeliveryPin] = useState(route.params.deliveryPin);

  const regenMutation = useMutation({
    mutationFn: () => api.regenerateDeliveryPins(route.params.gigId, session.token),
    onSuccess: (result) => {
      setPickupPin(result.secrets.pickupPin);
      setDeliveryPin(result.secrets.deliveryPin);
      showAlert("Codes updated", "Previous codes no longer work. Share the new codes only.");
    },
    onError: (error: Error) => showAlert("Could not regenerate", friendlyDeliveryError(error))
  });

  async function sharePin(label: string, pin: string, message: string): Promise<void> {
    try {
      await Share.share({ message, title: label });
    } catch {
      showAlert(label, pin);
    }
  }

  return (
    <Screen>
      <View className="gap-1 px-1">
        <Text className="text-xs font-bold uppercase tracking-[2px] text-brand">Keep these codes</Text>
        <Text className="text-2xl font-black text-ink">Your delivery PINs</Text>
        <Text className="text-sm text-muted">
          These codes are shown once here. If you leave this screen, regenerate them from the delivery
          details.
        </Text>
        {route.params.replay ? (
          <Text className="text-sm font-semibold text-orange">
            This request was already created. Regenerate codes if you no longer have them.
          </Text>
        ) : null}
      </View>

      <DutsCard className="gap-3 p-5">
        <Text className="text-xs font-bold uppercase text-brand">Pickup PIN</Text>
        <Text className="text-4xl font-black tracking-[8px] text-ink">{pickupPin || "————"}</Text>
        <Text className="text-sm text-muted">
          Give this code to the courier when the package is collected.
        </Text>
        <AppButton
          label="Share pickup PIN"
          variant="secondary"
          onPress={() =>
            void sharePin(
              "Pickup PIN",
              pickupPin,
              `DUTS Pickup PIN: ${pickupPin}\nGive this code only to the courier when they collect the package.`
            )
          }
        />
      </DutsCard>

      <DutsCard className="gap-3 p-5">
        <Text className="text-xs font-bold uppercase text-brand">Delivery PIN</Text>
        <Text className="text-4xl font-black tracking-[8px] text-ink">{deliveryPin || "————"}</Text>
        <Text className="text-sm text-muted">
          Give this code to the recipient. They will provide it to the courier at drop-off.
        </Text>
        <AppButton
          label="Share delivery PIN"
          onPress={() =>
            void sharePin(
              "Delivery PIN",
              deliveryPin,
              `DUTS Delivery PIN: ${deliveryPin}\nGive this code only to the courier when the package arrives.`
            )
          }
        />
      </DutsCard>

      <Pressable
        onPress={() =>
          showConfirm(
            "Regenerate codes?",
            "The previous pickup and delivery codes will stop working immediately.",
            () => regenMutation.mutate(),
            { confirmLabel: "Regenerate", destructive: true }
          )
        }
      >
        <Text className="text-center text-sm font-semibold text-orange">
          {regenMutation.isPending ? "Regenerating…" : "Lost your codes? Regenerate"}
        </Text>
      </Pressable>

      <LoadingButton
        label="Find a courier"
        onPress={() => navigation.replace("DeliveryJob", { gigId: route.params.gigId })}
      />
    </Screen>
  );
}
