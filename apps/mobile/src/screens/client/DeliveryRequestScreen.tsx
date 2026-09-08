import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  View
} from "react-native";
import { useMutation } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { GeoPointInput } from "@gigflow/shared";
import { packageCategories, packageCategoryLabels } from "@gigflow/shared";
import { api, type DeliveryQuote } from "../../lib/api";
import { friendlyDeliveryError } from "../../lib/delivery-errors";
import { formatCents } from "../../lib/format";
import { getCurrentCoordinates, friendlyLocationError } from "../../lib/location";
import { showAlert } from "../../lib/confirm";
import { AddressAutocomplete } from "../../components/AddressAutocomplete";
import { AppButton } from "../../components/AppButton";
import { DutsCard } from "../../components/DutsCard";
import { FormInput } from "../../components/FormInput";
import { LoadingButton } from "../../components/LoadingButton";
import { Screen } from "../../components/Screen";
import type { RootStackParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";

type Step = 1 | 2 | 3 | 4;

type StopDraft = {
  query: string;
  location: GeoPointInput | null;
  contactName: string;
  contactPhone: string;
  instructions: string;
};

function emptyStop(defaults?: { name?: string; phone?: string }): StopDraft {
  return {
    query: "",
    location: null,
    contactName: defaults?.name ?? "",
    contactPhone: defaults?.phone ?? "",
    instructions: ""
  };
}

function toDeliveryStop(stop: StopDraft) {
  const loc = stop.location!;
  return {
    latitude: Number(loc.latitude),
    longitude: Number(loc.longitude),
    formattedAddress: loc.formattedAddress || stop.query,
    addressLine1: loc.addressLine1,
    city: loc.city || "Harare",
    region: loc.region || "Harare",
    postalCode: loc.postalCode,
    country: (loc.country as string) || "ZW",
    contactName: stop.contactName.trim(),
    contactPhone: stop.contactPhone.trim(),
    instructions: stop.instructions.trim() || undefined
  };
}

export function DeliveryRequestScreen() {
  const session = useSessionStore((state) => state.session)!;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const user = session.user;

  const [step, setStep] = useState<Step>(1);
  const [pickup, setPickup] = useState<StopDraft>(() =>
    emptyStop({ name: user.fullName, phone: user.phoneNumber ?? "" })
  );
  const [dropoff, setDropoff] = useState<StopDraft>(() => emptyStop());
  const [category, setCategory] = useState<(typeof packageCategories)[number]>("SMALL_PARCEL");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [prohibitedAck, setProhibitedAck] = useState(false);
  const [quote, setQuote] = useState<DeliveryQuote | null>(null);
  const [locating, setLocating] = useState(false);
  const [idempotencyKey] = useState(() => { try { return crypto.randomUUID(); } catch { return "del-"+Date.now()+"-"+Math.random().toString(36).slice(2); } });


  async function useMyLocation(which: "pickup" | "dropoff"): Promise<void> {
    setLocating(true);
    try {
      const coords = await getCurrentCoordinates();
      const { location } = await api.reverseGeocode(coords.latitude, coords.longitude, session.token);
      const next: StopDraft = {
        ...(which === "pickup" ? pickup : dropoff),
        query: location.formattedAddress,
        location
      };
      if (which === "pickup") setPickup(next);
      else setDropoff(next);
    } catch (error) {
      showAlert("Location unavailable", friendlyLocationError(error));
    } finally {
      setLocating(false);
    }
  }

  const quoteMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        pickup: toDeliveryStop(pickup),
        dropoff: toDeliveryStop(dropoff),
        package: {
          category,
          description: description.trim(),
          notes: notes.trim() || undefined
        },
        prohibitedItemsAck: true
      };
      const result = await api.quoteDelivery(payload, session.token);
      return result.quote;
    },
    onSuccess: (q) => {
      setQuote(q);
      setStep(4);
    },
    onError: (error: Error) => showAlert("Could not get quote", friendlyDeliveryError(error))
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!prohibitedAck) throw new Error("Confirm the package does not contain prohibited items.");
      const payload = {
        pickup: toDeliveryStop(pickup),
        dropoff: toDeliveryStop(dropoff),
        package: {
          category,
          description: description.trim(),
          notes: notes.trim() || undefined
        },
        prohibitedItemsAck: true as const,
        orderSource: "APP" as const
      };
      return api.createDelivery(payload, session.token, { idempotencyKey, orderSource: "APP" });
    },
    onSuccess: (result) => {
      navigation.replace("DeliveryPins", {
        gigId: result.gigId,
        pickupPin: result.secrets?.pickupPin ?? "",
        deliveryPin: result.secrets?.deliveryPin ?? "",
        replay: Boolean(result.idempotentReplay)
      });
    },
    onError: (error: Error) => showAlert("Could not request delivery", friendlyDeliveryError(error))
  });

  function validateStep(current: Step): boolean {
    if (current === 1) {
      if (!pickup.location) {
        showAlert("Pickup needed", "Choose a pickup location on the map or from search.");
        return false;
      }
      if (pickup.contactName.trim().length < 2 || pickup.contactPhone.trim().length < 7) {
        showAlert("Contact needed", "Enter a pickup contact name and phone number.");
        return false;
      }
      return true;
    }
    if (current === 2) {
      if (!dropoff.location) {
        showAlert("Drop-off needed", "Choose where we should deliver the package.");
        return false;
      }
      if (dropoff.contactName.trim().length < 2 || dropoff.contactPhone.trim().length < 7) {
        showAlert("Recipient needed", "Enter the recipient name and phone number.");
        return false;
      }
      return true;
    }
    if (current === 3) {
      if (description.trim().length < 3) {
        showAlert("Describe the package", "Add a short description of what you are sending.");
        return false;
      }
      if (!prohibitedAck) {
        showAlert("Confirmation required", "Confirm the package does not contain prohibited items.");
        return false;
      }
      return true;
    }
    return true;
  }

  function goNext(): void {
    if (!validateStep(step)) return;
    if (step === 3) {
      quoteMutation.mutate();
      return;
    }
    setStep((step + 1) as Step);
  }

  return (
    <Screen>
      <View className="gap-1 px-1" style={{ paddingBottom: 8 }}>
        <Text className="text-xs font-bold uppercase tracking-[2px] text-brand">DUTS Delivery</Text>
        <Text className="text-2xl font-black text-ink">
          {step === 1
            ? "Where should we collect the package?"
            : step === 2
              ? "Where should we deliver it?"
              : step === 3
                ? "What are you sending?"
                : "Confirm your delivery"}
        </Text>
        <Text className="text-sm text-muted">Step {step} of 4</Text>
      </View>

      <View style={{ gap: 14, paddingBottom: 24 }}>
        {step === 1 ? (
          <DutsCard className="gap-3 p-4">
            <AddressAutocomplete
              token={session.token}
              label="Pickup location"
              value={pickup.query}
              onChangeText={(query) => setPickup((s) => ({ ...s, query, location: null }))}
              selectedLocation={pickup.location}
              onLocationResolved={(location) => setPickup((s) => ({ ...s, location, query: location.formattedAddress }))}
              onLocationCleared={() => setPickup((s) => ({ ...s, location: null }))}
            />
            <AppButton
              label={locating ? "Getting location…" : "Use my current location"}
              variant="secondary"
              onPress={() => void useMyLocation("pickup")}
              disabled={locating}
            />
            <FormInput
              label="Pickup contact name"
              value={pickup.contactName}
              onChangeText={(contactName) => setPickup((s) => ({ ...s, contactName }))}
            />
            <FormInput
              label="Pickup phone"
              keyboardType="phone-pad"
              value={pickup.contactPhone}
              onChangeText={(contactPhone) => setPickup((s) => ({ ...s, contactPhone }))}
            />
            <FormInput
              label="Pickup instructions (optional)"
              value={pickup.instructions}
              onChangeText={(instructions) => setPickup((s) => ({ ...s, instructions }))}
              placeholder="Gate code, landmark, floor…"
            />
          </DutsCard>
        ) : null}

        {step === 2 ? (
          <DutsCard className="gap-3 p-4">
            <AddressAutocomplete
              token={session.token}
              label="Drop-off location"
              value={dropoff.query}
              onChangeText={(query) => setDropoff((s) => ({ ...s, query, location: null }))}
              selectedLocation={dropoff.location}
              onLocationResolved={(location) =>
                setDropoff((s) => ({ ...s, location, query: location.formattedAddress }))
              }
              onLocationCleared={() => setDropoff((s) => ({ ...s, location: null }))}
            />
            <AppButton
              label={locating ? "Getting location…" : "Use my current location"}
              variant="secondary"
              onPress={() => void useMyLocation("dropoff")}
              disabled={locating}
            />
            <FormInput
              label="Recipient name"
              value={dropoff.contactName}
              onChangeText={(contactName) => setDropoff((s) => ({ ...s, contactName }))}
            />
            <FormInput
              label="Recipient phone"
              keyboardType="phone-pad"
              value={dropoff.contactPhone}
              onChangeText={(contactPhone) => setDropoff((s) => ({ ...s, contactPhone }))}
            />
            <FormInput
              label="Delivery instructions (optional)"
              value={dropoff.instructions}
              onChangeText={(instructions) => setDropoff((s) => ({ ...s, instructions }))}
              placeholder="Who to ask for, landmark…"
            />
          </DutsCard>
        ) : null}

        {step === 3 ? (
          <DutsCard className="gap-3 p-4">
            <Text className="text-sm font-semibold text-ink">Package type</Text>
            <View className="flex-row flex-wrap gap-2">
              {packageCategories.map((value) => {
                const selected = category === value;
                return (
                  <Pressable
                    key={value}
                    onPress={() => setCategory(value)}
                    className={`rounded-full border px-3 py-2 ${
                      selected
                        ? "border-brand bg-brand/10"
                        : "border-border bg-white"
                    }`}
                  >
                    <Text
                      className={`text-sm ${
                        selected ? "font-semibold text-brand" : "text-ink"
                      }`}
                    >
                      {packageCategoryLabels[value]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <FormInput
              label="Short description"
              value={description}
              onChangeText={setDescription}
              placeholder="e.g. Envelope with documents"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              style={{ minHeight: 72 }}
            />
            <FormInput
              label="Notes (optional)"
              value={notes}
              onChangeText={setNotes}
              placeholder="Fragile, keep upright…"
              multiline
              numberOfLines={2}
              textAlignVertical="top"
              style={{ minHeight: 56 }}
            />
            <Pressable
              className="flex-row items-start gap-3 rounded-2xl border border-border bg-surface px-4 py-3"
              onPress={() => setProhibitedAck((v) => !v)}
            >
              <View
                className={`mt-0.5 h-5 w-5 items-center justify-center rounded-md border ${
                  prohibitedAck ? "border-brand bg-brand" : "border-border bg-white"
                }`}
              >
                {prohibitedAck ? <Text className="text-xs font-black text-white">✓</Text> : null}
              </View>
              <Text className="flex-1 text-sm text-ink">
                I confirm this package does not contain prohibited items (cash, weapons, illegal goods,
                hazardous materials).
              </Text>
            </Pressable>
          </DutsCard>
        ) : null}

        {step === 4 && quote ? (
          <DutsCard className="gap-4 p-5">
            <View className="gap-1">
              <Text className="text-xs font-bold uppercase text-muted">Pickup</Text>
              <Text className="text-base font-semibold text-ink">
                {pickup.location?.city || pickup.query}
              </Text>
            </View>
            <View className="gap-1">
              <Text className="text-xs font-bold uppercase text-muted">Drop-off</Text>
              <Text className="text-base font-semibold text-ink">
                {dropoff.location?.city || dropoff.query}
              </Text>
            </View>
            <View className="flex-row justify-between">
              <Text className="text-muted">Distance</Text>
              <Text className="font-bold text-ink">{quote.distanceKm.toFixed(1)} km</Text>
            </View>
            <View className="flex-row justify-between">
              <Text className="text-muted">Package</Text>
              <Text className="font-bold text-ink">{packageCategoryLabels[category]}</Text>
            </View>
            <View className="rounded-2xl bg-hero px-4 py-3">
              <Text className="text-xs font-bold uppercase text-brand">Delivery fee</Text>
              <Text className="text-3xl font-black text-ink">{formatCents(quote.totalCents)}</Text>
              <Text className="mt-1 text-xs text-muted">{quote.pricingNote}</Text>
            </View>
          </DutsCard>
        ) : null}

        {quoteMutation.isPending ? (
          <View className="items-center py-4">
            <ActivityIndicator />
            <Text className="mt-2 text-sm text-muted">Getting your quote…</Text>
          </View>
        ) : null}

        <View className="flex-row gap-2">
          {step > 1 ? (
            <View className="flex-1">
              <AppButton
                label="Back"
                variant="secondary"
                onPress={() => setStep((step - 1) as Step)}
                disabled={createMutation.isPending || quoteMutation.isPending}
              />
            </View>
          ) : null}
          <View className="flex-1">
            {step < 4 ? (
              <LoadingButton
                label={step === 3 ? "Get quote" : "Continue"}
                onPress={goNext}
                loading={quoteMutation.isPending}
              />
            ) : (
              <LoadingButton
                label="Request delivery"
                onPress={() => createMutation.mutate()}
                loading={createMutation.isPending}
              />
            )}
          </View>
        </View>
      </View>
    </Screen>
  );
}
