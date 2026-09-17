import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { GeoPointInput } from "@gigflow/shared";
import { AppButton } from "../../components/AppButton";
import { AddressAutocomplete } from "../../components/AddressAutocomplete";
import { listAddresses } from "../../lib/addresses-store";
import { useSessionStore } from "../../stores/session.store";
import { useShopLocationStore } from "../../stores/shop-location.store";
import type { RootStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "ShopLocation">;

export function ShopLocationScreen({ navigation }: Props) {
  const session = useSessionStore((s) => s.session);
  const setLocation = useShopLocationStore((s) => s.setLocation);
  const useDeviceLocation = useShopLocationStore((s) => s.useDeviceLocation);
  const [query, setQuery] = useState("");
  const [resolved, setResolved] = useState<GeoPointInput | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Awaited<ReturnType<typeof listAddresses>>>([]);

  useEffect(() => {
    if (!session?.user.id) {
      setSaved([]);
      return;
    }
    void listAddresses(session.user.id).then(setSaved);
  }, [session?.user.id]);

  async function chooseGps() {
    setBusy(true);
    setError("");
    try {
      await useDeviceLocation();
      navigation.goBack();
    } catch {
      setError("We couldn't get your location. Check permissions and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function saveEntered() {
    if (!resolved) {
      setError("Enter a location, then tap Use this location.");
      return;
    }
    await setLocation({
      latitude: resolved.latitude,
      longitude: resolved.longitude,
      label: resolved.formattedAddress || query || "Delivery location"
    });
    navigation.goBack();
  }

  return (
    <ScrollView className="flex-1 bg-background px-5" contentContainerStyle={{ paddingBottom: 40, paddingTop: 12 }}>
      <Text className="text-2xl font-black text-ink">Deliver to</Text>
      <Text className="mt-2 text-base text-muted">
        Set your location to see products available near you.
      </Text>

      <View className="mt-5">
        <AppButton label={busy ? "Finding you…" : "Use my location"} onPress={() => void chooseGps()} disabled={busy} />
      </View>

      <Text className="mt-6 mb-2 text-sm font-semibold uppercase text-muted">Enter location</Text>
      <AddressAutocomplete
        token={session?.token}
        label="Street, suburb, or city"
        value={query}
        onChangeText={(v) => {
          setQuery(v);
          setError("");
        }}
        selectedLocation={resolved}
        onLocationResolved={setResolved}
        onLocationCleared={() => setResolved(null)}
        error={error}
      />

      <View className="mt-4">
        <AppButton label="Use this location" onPress={() => void saveEntered()} variant="secondary" />
      </View>

      {session && saved.length > 0 ? (
        <View className="mt-8">
          <Text className="mb-2 text-sm font-semibold uppercase text-muted">Saved addresses</Text>
          {saved.map((a) => (
            <Pressable
              key={a.id}
              onPress={() => {
                void setLocation({
                  latitude: a.latitude,
                  longitude: a.longitude,
                  label: a.label || a.formattedAddress || "Saved address"
                }).then(() => navigation.goBack());
              }}
              className="mb-2 rounded-2xl border border-border bg-card px-4 py-3.5"
              accessibilityRole="button"
              accessibilityLabel={a.label || a.formattedAddress}
            >
              <Text className="font-bold text-ink">{a.label || "Address"}</Text>
              <Text className="mt-1 text-sm text-muted">{a.formattedAddress}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
