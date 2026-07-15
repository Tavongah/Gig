import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { GeoPointInput } from "@gigflow/shared";
import { Ionicons } from "@expo/vector-icons";
import { AddressAutocomplete } from "../../components/AddressAutocomplete";
import { AppButton } from "../../components/AppButton";
import { DutsCard } from "../../components/DutsCard";
import { FormInput } from "../../components/FormInput";
import { LoadingButton } from "../../components/LoadingButton";
import { Screen } from "../../components/Screen";
import {
  deleteAddress,
  listAddresses,
  setDefaultAddress,
  upsertAddress,
  type SavedAddress
} from "../../lib/addresses-store";
import type { RootStackParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";
import { DUTS } from "../../lib/theme";

type Nav = NativeStackNavigationProp<RootStackParamList, "Addresses">;

export function AddressesScreen() {
  const navigation = useNavigation<Nav>();
  const session = useSessionStore((state) => state.session)!;
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState("Home");
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState<GeoPointInput | null>(null);
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const refresh = useCallback(async () => {
    setAddresses(await listAddresses(session.user.id));
  }, [session.user.id]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  function resetForm(): void {
    setEditingId(null);
    setLabel("Home");
    setQuery("");
    setLocation(null);
    setIsDefault(false);
    setShowForm(false);
  }

  function startEdit(address: SavedAddress): void {
    setEditingId(address.id);
    setLabel(address.label);
    setQuery(address.formattedAddress);
    setLocation({
      formattedAddress: address.formattedAddress,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2,
      city: address.city,
      region: address.region,
      postalCode: address.postalCode,
      country: address.country,
      latitude: address.latitude,
      longitude: address.longitude
    });
    setIsDefault(address.isDefault);
    setShowForm(true);
  }

  async function handleSave(): Promise<void> {
    if (!location) {
      Alert.alert("Address needed", "Search and confirm an address before saving.");
      return;
    }
    setSaving(true);
    try {
      const next = await upsertAddress(session.user.id, {
        id: editingId ?? undefined,
        label,
        formattedAddress: location.formattedAddress,
        addressLine1: location.addressLine1,
        addressLine2: location.addressLine2,
        city: location.city,
        region: location.region,
        postalCode: location.postalCode,
        country: location.country ?? "US",
        latitude: location.latitude,
        longitude: location.longitude,
        isDefault
      });
      setAddresses(next);
      resetForm();
    } catch (error) {
      Alert.alert("Could not save", error instanceof Error ? error.message : "Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: 16, paddingBottom: 32 }}
      >
        <Text className="text-sm text-muted">Manage saved locations for faster gig requests.</Text>

        {addresses.map((address) => (
          <DutsCard key={address.id} className="gap-3 p-5">
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1 gap-1">
                <Text className="text-base font-black text-ink">{address.label}</Text>
                <Text className="text-sm text-muted">{address.formattedAddress}</Text>
                {address.isDefault ? (
                  <Text className="text-xs font-bold uppercase tracking-wider text-brand">Default</Text>
                ) : null}
              </View>
              <Ionicons name="location-outline" size={22} color={DUTS.purple} />
            </View>
            <View className="flex-row flex-wrap gap-2">
              <AppButton label="Edit" variant="secondary" onPress={() => startEdit(address)} />
              {!address.isDefault ? (
                <AppButton
                  label="Set default"
                  variant="secondary"
                  onPress={() => {
                    void setDefaultAddress(session.user.id, address.id).then(setAddresses);
                  }}
                />
              ) : null}
              <AppButton
                label="Delete"
                variant="secondary"
                onPress={() => {
                  Alert.alert("Delete address", "Remove this saved address?", [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Delete",
                      style: "destructive",
                      onPress: () => {
                        void deleteAddress(session.user.id, address.id).then(setAddresses);
                      }
                    }
                  ]);
                }}
              />
            </View>
          </DutsCard>
        ))}

        {!showForm ? (
          <AppButton
            label="Add address"
            onPress={() => {
              resetForm();
              setShowForm(true);
            }}
          />
        ) : (
          <DutsCard className="gap-3 p-5">
            <Text className="text-base font-black text-ink">{editingId ? "Edit address" : "New address"}</Text>
            <FormInput label="Label" value={label} onChangeText={setLabel} placeholder="Home, Work..." />
            <AddressAutocomplete
              token={session.token}
              value={query}
              onChangeText={setQuery}
              selectedLocation={location}
              onLocationResolved={setLocation}
              onLocationCleared={() => setLocation(null)}
            />
            <View className="min-h-[48px] flex-row items-center justify-between">
              <Text className="font-semibold text-ink">Set as default</Text>
              <Switch value={isDefault} onValueChange={setIsDefault} trackColor={{ true: DUTS.purple }} />
            </View>
            <LoadingButton label="Save address" loadingLabel="Saving..." loading={saving} onPress={() => void handleSave()} />
            <Pressable onPress={resetForm}>
              <Text className="text-center font-semibold text-muted">Cancel</Text>
            </Pressable>
          </DutsCard>
        )}

        <AppButton label="Done" variant="secondary" onPress={() => navigation.goBack()} />
      </ScrollView>
    </Screen>
  );
}
