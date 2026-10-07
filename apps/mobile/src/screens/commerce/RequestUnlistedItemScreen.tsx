import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { AppButton } from "../../components/AppButton";
import { DutsInlineBanner } from "../../components/DutsInlineBanner";
import { StoreHeader, StorePage } from "../../components/StoreHeader";
import { api } from "../../lib/api";
import { useShopBrowse } from "../../lib/shop-browse";
import { DUTS } from "../../lib/theme";
import type { RootStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "RequestUnlistedItem">;

export function RequestUnlistedItemScreen({ route, navigation }: Props) {
  const browse = useShopBrowse();
  const [item, setItem] = useState(route.params?.q ?? "");
  const [quantity, setQuantity] = useState("1");
  const [budget, setBudget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  const config = useQuery({
    queryKey: ["commerce-public-config"],
    queryFn: () => api.commercePublicConfig()
  });
  const enabled = config.data?.unlistedItemRequestEnabled === true;

  const geoPayload = useMemo(() => {
    if (browse.geo && "lat" in browse.geo) return { lat: browse.geo.lat, lng: browse.geo.lng };
    if (browse.geo && "areaId" in browse.geo) return { areaId: browse.geo.areaId };
    return {};
  }, [browse.geo]);

  const create = useMutation({
    mutationFn: () =>
      api.createUnlistedRequest(
        {
          originalRequestText: item.trim(),
          quantity: Math.max(1, Math.min(20, Number(quantity) || 1)),
          optionalMaxBudgetCents: budget.trim() ? Math.round(Number(budget) * 100) : null,
          ...geoPayload,
          deliveryLabel: browse.area?.name
        },
        browse.token
      ),
    onSuccess: (data) => setSubmittedId(data.request.id),
    onError: (err: Error) => setError(err.message)
  });

  const live = useQuery({
    queryKey: ["unlisted-request", submittedId],
    queryFn: () => api.getUnlistedRequest(submittedId!, browse.token),
    enabled: Boolean(submittedId),
    refetchInterval: 8_000
  });
  const request = live.data?.request;

  return (
    <View className="flex-1 bg-background">
      <StoreHeader compact />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <StorePage>
          <Text className="mt-4 text-xl font-black text-ink">Request an item</Text>
          <Text className="mt-1 text-sm text-muted">
            We'll ask a courier to look for it. You approve the real price before paying.
          </Text>

          {!enabled ? (
            <View className="mt-6">
              <DutsInlineBanner
                tone="info"
                title="Not available yet"
                body="Unlisted item requests are off until DUTS finishes a physical test."
              />
            </View>
          ) : submittedId ? (
            <View className="mt-6 gap-3">
              <DutsInlineBanner
                tone="success"
                title="We're looking for it"
                body={`${request?.parsedItemName ?? item}. Status: ${request?.status ?? "REQUESTED"}. You will not be charged until you approve a quote.`}
              />
              {request?.status === "FOUND_AWAITING_CUSTOMER" && request.approvalId ? (
                <View className="gap-2">
                  <Text className="text-base font-bold text-ink">
                    {request.foundProductName} · ${((request.foundPriceCents ?? 0) / 100).toFixed(2)}
                  </Text>
                  <Text className="text-sm text-muted">
                    Delivery ${((request.deliveryFeeCents ?? 0) / 100).toFixed(2)} · Total $
                    {((request.totalCents ?? 0) / 100).toFixed(2)}
                  </Text>
                  {request.foundMerchantName ? (
                    <Text className="text-sm text-muted">Found at {request.foundMerchantName}</Text>
                  ) : null}
                  <AppButton
                    label="Buy it"
                    onPress={() =>
                      navigation.navigate("UnlistedItemQuote", { requestId: request.id, approvalId: request.approvalId! })
                    }
                  />
                </View>
              ) : null}
            </View>
          ) : (
            <View className="mt-6 gap-4">
              {error ? <DutsInlineBanner title="Couldn't send request" body={error} /> : null}
              {!browse.geo ? (
                <DutsInlineBanner
                  tone="info"
                  title="Delivery location needed"
                  body="Set your delivery area first so we know where to look."
                  actions={[{ label: "Set location", onPress: () => navigation.navigate("ShopLocation") }]}
                />
              ) : null}
              <Text className="text-sm font-bold text-ink">What do you need?</Text>
              <TextInput
                value={item}
                onChangeText={setItem}
                placeholder="Colgate herbal toothpaste"
                className="rounded-2xl border border-border bg-card px-4 py-3 text-base text-ink"
                placeholderTextColor={DUTS.placeholder}
              />
              <Text className="text-sm font-bold text-ink">Quantity</Text>
              <TextInput
                value={quantity}
                onChangeText={setQuantity}
                keyboardType="number-pad"
                className="rounded-2xl border border-border bg-card px-4 py-3 text-base text-ink"
              />
              <Text className="text-sm font-bold text-ink">Optional maximum budget</Text>
              <TextInput
                value={budget}
                onChangeText={setBudget}
                keyboardType="decimal-pad"
                placeholder="$4.00"
                className="rounded-2xl border border-border bg-card px-4 py-3 text-base text-ink"
                placeholderTextColor={DUTS.placeholder}
              />
              <AppButton
                label="Request this item"
                disabled={!item.trim() || !browse.geo || create.isPending}
                loading={create.isPending}
                onPress={() => {
                  setError(null);
                  create.mutate();
                }}
              />
              <Pressable onPress={() => navigation.goBack()}>
                <Text className="text-center text-sm font-bold text-muted">Try another search</Text>
              </Pressable>
            </View>
          )}
        </StorePage>
      </ScrollView>
    </View>
  );
}
