import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { ServiceCategory } from "../lib/api";
import { DUTS } from "../lib/theme";
import { CollapsibleSection } from "./CollapsibleSection";
import { ErrorMessage } from "./ErrorMessage";

interface ServiceCategorySelectProps {
  mvp: ServiceCategory[];
  comingSoon?: ServiceCategory[];
  selectedId: string | null;
  onSelect: (categoryId: string) => void;
  error?: string | null;
  disabled?: boolean;
}

export function ServiceCategorySelect({
  mvp,
  comingSoon = [],
  selectedId,
  onSelect,
  error,
  disabled = false
}: ServiceCategorySelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selectedCategory = mvp.find((category) => category.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return mvp;
    return mvp.filter((category) => category.name.toLowerCase().includes(normalized));
  }, [mvp, query]);

  function handleSelect(categoryId: string): void {
    onSelect(categoryId);
    setOpen(false);
    setQuery("");
  }

  return (
    <View className="gap-2">
      <Text className="text-sm font-bold uppercase tracking-wider text-label">Service type</Text>
      <Text className="text-xs text-muted">Choose the type of help you need.</Text>

      <Pressable
        disabled={disabled}
        onPress={() => setOpen((current) => !current)}
        className={`flex-row items-center justify-between rounded-2xl border px-4 py-3.5 ${
          error ? "border-orange bg-surface" : open ? "border-brand bg-card" : "border-border bg-surface"
        }`}
      >
        <Text className={`flex-1 text-base ${selectedCategory ? "font-semibold text-ink" : "text-muted"}`}>
          {selectedCategory?.name ?? "Select service type"}
        </Text>
        <Text className="text-sm font-black text-brand">{open ? "▲" : "▼"}</Text>
      </Pressable>

      {open ? (
        <View className="gap-2 overflow-hidden rounded-2xl border border-border bg-card">
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search services..."
            placeholderTextColor={DUTS.placeholder}
            className="border-b border-border bg-surface px-4 py-3 text-ink"
            autoFocus
          />
          <View className="max-h-48">
            {filtered.length === 0 ? (
              <Text className="px-4 py-3 text-sm text-muted">No matching services.</Text>
            ) : (
              filtered.map((category) => {
                const selected = category.id === selectedId;
                return (
                  <Pressable
                    key={category.id}
                    onPress={() => handleSelect(category.id)}
                    className={`border-b border-border px-4 py-3 active:bg-surface ${selected ? "bg-hero" : ""}`}
                  >
                    <Text className={`text-sm ${selected ? "font-bold text-brand" : "text-ink"}`}>{category.name}</Text>
                  </Pressable>
                );
              })
            )}
          </View>
        </View>
      ) : null}

      <ErrorMessage message={error} />

      {comingSoon.length > 0 ? (
        <CollapsibleSection title="Coming soon services" subtitle="Not available to book yet">
          <View className="gap-2">
            <Text className="text-xs leading-5 text-muted">
              These services need stronger trust and safety systems before launch.
            </Text>
            {comingSoon.map((category) => (
              <View key={category.id} className="rounded-xl bg-disabled px-3 py-2">
                <Text className="text-sm font-medium text-disabled-text">{category.name}</Text>
              </View>
            ))}
          </View>
        </CollapsibleSection>
      ) : null}
    </View>
  );
}
