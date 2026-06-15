import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { AddressSuggestion, GeoPointInput } from "@gigflow/shared";
import { api } from "../lib/api";
import { FormInput } from "./FormInput";
import { AppButton } from "./AppButton";
import { ErrorMessage } from "./ErrorMessage";
import { formatLocationSummary } from "../lib/location";

interface AddressAutocompleteProps {
  token: string;
  label?: string;
  value: string;
  onChangeText: (value: string) => void;
  selectedLocation: GeoPointInput | null;
  onLocationResolved: (location: GeoPointInput) => void;
  onLocationCleared: () => void;
  error?: string;
}

export function AddressAutocomplete({
  token,
  label = "Location / address",
  value,
  onChangeText,
  selectedLocation,
  onLocationResolved,
  onLocationCleared,
  error
}: AddressAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  useEffect(() => {
    const query = value.trim();
    if (query.length < 3 || selectedLocation) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const result = await api.autocompleteAddress(query, token);
        setSuggestions(result.suggestions);
      } catch {
        setSuggestions([]);
      } finally {
        setIsSearching(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [selectedLocation, token, value]);

  async function resolveSuggestion(suggestion: AddressSuggestion): Promise<void> {
    setIsResolving(true);
    setResolveError(null);
    try {
      const result = await api.geocodeAddress({ placeId: suggestion.placeId, query: suggestion.formattedAddress }, token);
      onChangeText(result.location.formattedAddress);
      onLocationResolved(result.location);
      setSuggestions([]);
    } catch (error) {
      setResolveError(error instanceof Error ? error.message : "Could not verify this address.");
      onLocationCleared();
    } finally {
      setIsResolving(false);
    }
  }

  async function verifyTypedAddress(): Promise<void> {
    const query = value.trim();
    if (query.length < 8) {
      setResolveError("Enter a complete street address with city, state, and ZIP.");
      onLocationCleared();
      return;
    }

    setIsResolving(true);
    setResolveError(null);
    try {
      const result = await api.geocodeAddress({ query }, token);
      onChangeText(result.location.formattedAddress);
      onLocationResolved(result.location);
      setSuggestions([]);
    } catch (error) {
      setResolveError(error instanceof Error ? error.message : "Could not verify this address.");
      onLocationCleared();
    } finally {
      setIsResolving(false);
    }
  }

  return (
    <View className="gap-2">
      <FormInput
        label={label}
        value={value}
        onChangeText={(nextValue) => {
          onChangeText(nextValue);
          if (selectedLocation) {
            onLocationCleared();
          }
          setResolveError(null);
        }}
        placeholder="Start typing a street address"
        maxLength={240}
        error={error ?? resolveError ?? undefined}
      />

      {isSearching || isResolving ? (
        <View className="flex-row items-center gap-2 px-1">
          <ActivityIndicator size="small" />
          <Text className="text-sm text-muted">{isResolving ? "Verifying address..." : "Searching addresses..."}</Text>
        </View>
      ) : null}

      {suggestions.length > 0 ? (
        <View className="overflow-hidden rounded-2xl border border-border bg-card">
          {suggestions.map((suggestion) => (
            <Pressable
              key={suggestion.placeId}
              className="border-b border-border px-4 py-3 active:bg-surface"
              onPress={() => void resolveSuggestion(suggestion)}
            >
              <Text className="text-sm text-ink">{suggestion.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {!selectedLocation ? (
        <AppButton label="Verify address" variant="secondary" size="md" onPress={() => void verifyTypedAddress()} />
      ) : (
        <View className="rounded-2xl border border-success/30 bg-success/5 px-4 py-3">
          <Text className="text-xs font-bold uppercase tracking-wider text-success">Confirmed address</Text>
          <Text className="mt-1 text-sm text-ink">{formatLocationSummary(selectedLocation)}</Text>
        </View>
      )}
    </View>
  );
}
