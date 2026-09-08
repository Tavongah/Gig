import { useState } from "react";
import { Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { phase1TransportModes, transportModeLabels } from "@gigflow/shared";
import { api } from "../../lib/api";
import { friendlyDeliveryError } from "../../lib/delivery-errors";
import { transportModeEmoji } from "../../lib/delivery-status";
import { showAlert } from "../../lib/confirm";
import { DutsCard } from "../../components/DutsCard";
import { LoadingButton } from "../../components/LoadingButton";
import { Screen } from "../../components/Screen";
import { SelectButtonGroup } from "../../components/SelectButtonGroup";
import type { RootStackParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";

export function WorkerDeliverySetupScreen() {
  const session = useSessionStore((state) => state.session)!;
  const profile = useSessionStore((state) => state.profile);
  const setProfile = useSessionStore((state) => state.setProfile);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const currentMode = (profile?.workerProfile?.transportMode as (typeof phase1TransportModes)[number] | null) ?? "BICYCLE";
  const [transportMode, setTransportMode] = useState<(typeof phase1TransportModes)[number]>(
    phase1TransportModes.includes(currentMode as (typeof phase1TransportModes)[number])
      ? (currentMode as (typeof phase1TransportModes)[number])
      : "BICYCLE"
  );

  const enableMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const result = await api.setDeliveryEligibility({ transportMode, enabled }, session.token);
      const { user } = await api.getMe(session.token);
      setProfile(user);
      return result;
    },
    onSuccess: (result) => {
      showAlert(
        result.deliveryEligible ? "Delivery enabled" : "Delivery disabled",
        result.deliveryEligible
          ? "You can go online and receive delivery offers near you."
          : "You will no longer receive delivery offers."
      );
      if (result.deliveryEligible) navigation.goBack();
    },
    onError: (error: Error) => showAlert("Could not update", friendlyDeliveryError(error))
  });

  const eligible = Boolean(profile?.workerProfile?.deliveryEligible);

  return (
    <Screen>
      <View className="gap-1 px-1">
          <Text className="text-xs font-bold uppercase tracking-[2px] text-brand">DUTS Delivery</Text>
          <Text className="text-2xl font-black text-ink">Courier setup</Text>
          <Text className="text-sm text-muted">
            Choose how you normally complete deliveries. You can change this later.
          </Text>
        </View>

        <DutsCard className="gap-4 p-4">
          <SelectButtonGroup
            label="How do you deliver?"
            options={phase1TransportModes.map((value) => ({
              value,
              label: `${transportModeEmoji(value)} ${transportModeLabels[value]}`
            }))}
            value={transportMode}
            onChange={setTransportMode}
          />

          <Text className="text-sm text-muted">
            Status: {eligible ? "Ready for delivery offers" : "Not enabled for delivery yet"}
          </Text>

          <LoadingButton
            label={eligible ? "Update transport mode" : "Enable delivery work"}
            loading={enableMutation.isPending}
            onPress={() => enableMutation.mutate(true)}
          />

          {eligible ? (
            <LoadingButton
              label="Turn off delivery offers"
              variant="secondary"
              loading={enableMutation.isPending}
              onPress={() => enableMutation.mutate(false)}
            />
          ) : null}
        </DutsCard>
    </Screen>
  );
}
