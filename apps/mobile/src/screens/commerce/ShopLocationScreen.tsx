import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { GeoPointInput } from "@gigflow/shared";
import { AppButton } from "../../components/AppButton";
import { AddressAutocomplete } from "../../components/AddressAutocomplete";
import { listAddresses } from "../../lib/addresses-store";
import { api } from "../../lib/api";
import { useSessionStore } from "../../stores/session.store";
import { useShopLocationStore } from "../../stores/shop-location.store";
import type { RootStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "ShopLocation">;

export function ShopLocationScreen({ navigation, route }: Props) {
  const session = useSessionStore((s) => s.session);
  const setLocation = useShopLocationStore((s) => s.setLocation);
  const useDeviceLocation = useShopLocationStore((s) => s.useDeviceLocation);
  const [query, setQuery] = useState("");
  const [resolved, setResolved] = useState<GeoPointInput | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAddress, setShowAddress] = useState(false);
  const [saved, setSaved] = useState<Awaited<ReturnType<typeof listAddresses>>>([]);
  const nextCheckout = route.params?.next === "checkout";

  useEffect(() => {
    if (!session?.user.id) {
      setSaved([]);
      return;
    }
    void listAddresses(session.user.id).then(setSaved);
  }, [session?.user.id]);

  function finish() {
    if (nextCheckout) navigation.replace("CommerceCheckout");
    else navigation.goBack();
  }

  async function chooseGps() {
    setBusy(true);
    setError("");
    try {
      const loc = await useDeviceLocation();
      try {
        const rev = await api.reverseGeocode(loc.latitude, loc.longitude, session?.token);
        const label = rev.location.formattedAddress || loc.label;
        if (label && label !== loc.label) {
          await setLocation({ ...loc, label });
        }
      } catch {
        /* keep Current location */
      }
      finish();
    } catch {
      setShowAddress(true);
      setError("We couldn't use your current location. Enter your delivery address instead.");
    } finally {
      setBusy(false);
    }
  }

  async function saveEntered() {
    if (!resolved) {
      setError("Enter a delivery address, then tap Use this address.");
      return;
    }
    await setLocation({
      latitude: resolved.latitude,
      longitude: resolved.longitude,
      label: resolved.formattedAddress || query || "Delivery address"
    });
    finish();
  }

  return (
    <ScrollView className="flex-1 bg-background px-5" contentContainerStyle={{ paddingBottom: 40, paddingTop: 12 }}>
      <Text className="text-2xl font-black text-ink">Where should we deliver?</Text>
      <Text className="mt-2 text-base text-muted">We only need this to complete your order.</Text>

      <View className="mt-5">
        <AppButton
          label={busy ? "Finding you…" : "USE MY CURRENT LOCATION"}
          onPress={() => void chooseGps()}
          disabled={busy}
        />
      </View>

      <View className="mt-3">
        <AppButton
          label="ENTER DELIVERY ADDRESS"
          variant="secondary"
          onPress={() => {
            setShowAddress(true);
            setError("");
          }}
        />
      </View>

      {showAddress ? (
        <View className="mt-6">
          <Text className="mb-2 text-sm font-semibold uppercase text-muted">Delivery address</Text>
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
            <AppButton label="Use this address" onPress={() => void saveEntered()} variant="secondary" />
          </View>
        </View>
      ) : error ? (
        <Text className="mt-4 text-sm text-danger">{error}</Text>
      ) : null}

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
                }).then(finish);
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
