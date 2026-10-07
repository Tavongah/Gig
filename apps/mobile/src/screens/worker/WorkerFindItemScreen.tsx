import { useState } from "react";
import { Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { AppButton } from "../../components/AppButton";
import { DutsInlineBanner } from "../../components/DutsInlineBanner";
import { TabScreen } from "../../components/TabScreen";
import { api } from "../../lib/api";
import { pickProfilePhoto } from "../../lib/pick-profile-photo";
import { DUTS } from "../../lib/theme";
import type { RootStackParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";

type Props = NativeStackScreenProps<RootStackParamList, "WorkerFindItem">;

function money(cents: number | null | undefined) {
  return `$${((cents ?? 0) / 100).toFixed(2)}`;
}

export function WorkerFindItemScreen({ route, navigation }: Props) {
  const session = useSessionStore((s) => s.session)!;
  const queryClient = useQueryClient();
  const requestId = route.params.requestId;
  const [product, setProduct] = useState("");
  const [price, setPrice] = useState("");
  const [shop, setShop] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<{ uri: string; base64: string } | null>(null);
  const [changedPrice, setChangedPrice] = useState("");
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["unlisted-search", requestId],
    queryFn: async () => {
      const list = await api.unlistedSearches(session.token);
      const found = list.searches.find((s) => s.id === requestId);
      if (found) return found;
      const one = await api.getUnlistedRequest(requestId, session.token);
      return one.request;
    },
    refetchInterval: 6_000
  });
  const row = query.data;

  function invalidate() {
    void query.refetch();
    void queryClient.invalidateQueries({ queryKey: ["unlisted-searches"] });
  }

  const accept = useMutation({
    mutationFn: () => api.acceptUnlistedSearch(requestId, session.token),
    onSuccess: invalidate,
    onError: (err: Error) => setError(err.message)
  });
  const quote = useMutation({
    mutationFn: () =>
      api.submitUnlistedQuote(
        requestId,
        {
          foundProductName: product.trim() || row?.parsedItemName || "Item",
          foundPriceCents: Math.round(Number(price) * 100),
          foundMerchantName: shop.trim(),
          foundNote: note.trim() || undefined,
          foundPhotoBase64: photo?.base64
        },
        session.token
      ),
    onSuccess: invalidate,
    onError: (err: Error) => setError(err.message)
  });
  const notFound = useMutation({
    mutationFn: () => api.reportUnlistedNotFound(requestId, session.token),
    onSuccess: () => navigation.goBack(),
    onError: (err: Error) => setError(err.message)
  });
  const release = useMutation({
    mutationFn: () => api.releaseUnlistedSearch(requestId, session.token),
    onSuccess: () => navigation.goBack(),
    onError: (err: Error) => setError(err.message)
  });
  const purchased = useMutation({
    mutationFn: () => api.markUnlistedPurchased(requestId, session.token),
    onSuccess: (data) => {
      invalidate();
      const gigId = data.search.linkedDeliveryGigId;
      if (gigId) navigation.replace("DeliveryJob", { gigId });
    },
    onError: (err: Error) => setError(err.message)
  });
  const priceChange = useMutation({
    mutationFn: () =>
      api.reportUnlistedPriceChange(
        requestId,
        { foundPriceCents: Math.round(Number(changedPrice) * 100) },
        session.token
      ),
    onSuccess: invalidate,
    onError: (err: Error) => setError(err.message)
  });

  const status = row?.status ?? "";
  const waiting =
    status === "FOUND_AWAITING_CUSTOMER" || status === "CUSTOMER_APPROVED" || status === "PAYMENT_PENDING";
  const paid = status === "PAID";
  const purchasedState = status === "PURCHASED" || status === "DELIVERING";

  return (
    <TabScreen>
      <ScrollView contentContainerStyle={{ paddingBottom: 40, gap: 16 }}>
        <Text className="text-xs font-black uppercase tracking-widest" style={{ color: DUTS.orange }}>
          FIND ITEM
        </Text>
        <Text className="text-2xl font-black text-ink">Look for this item</Text>
        {error ? <DutsInlineBanner title="Couldn't continue" body={error} /> : null}

        <View className="rounded-2xl border border-border bg-card p-4 gap-2">
          <Text className="text-base font-bold text-ink">Customer needs</Text>
          <Text className="text-lg font-black text-ink">{row?.parsedItemName ?? "…"}</Text>
          <Text className="text-sm text-muted">Quantity: {row?.quantity ?? 1}</Text>
          <Text className="text-sm text-muted">Area: {row?.deliveryLabel ?? "Nearby"}</Text>
          {row?.optionalMaxBudgetCents != null ? (
            <Text className="text-sm text-muted">Optional maximum: {money(row.optionalMaxBudgetCents)}</Text>
          ) : null}
          <Text className="mt-2 text-xs font-bold text-muted">The customer has not paid yet unless you see PAYMENT CONFIRMED.</Text>
        </View>

        {status === "REQUESTED" ? (
          <AppButton label="ACCEPT SEARCH" loading={accept.isPending} onPress={() => accept.mutate()} />
        ) : null}

        {status === "SEARCHING" ? (
          <View className="gap-3">
            <Text className="text-sm font-bold text-ink">Product found</Text>
            <TextInput
              value={product}
              onChangeText={setProduct}
              placeholder={row?.parsedItemName ?? "Product name"}
              className="rounded-2xl border border-border bg-card px-4 py-3 text-base text-ink"
              placeholderTextColor={DUTS.placeholder}
            />
            <Text className="text-sm font-bold text-ink">Actual selling price</Text>
            <TextInput
              value={price}
              onChangeText={setPrice}
              keyboardType="decimal-pad"
              placeholder="2.50"
              className="rounded-2xl border border-border bg-card px-4 py-3 text-base text-ink"
              placeholderTextColor={DUTS.placeholder}
            />
            <Text className="text-sm font-bold text-ink">Shop / merchant</Text>
            <TextInput
              value={shop}
              onChangeText={setShop}
              placeholder="ABC Tuckshop"
              className="rounded-2xl border border-border bg-card px-4 py-3 text-base text-ink"
              placeholderTextColor={DUTS.placeholder}
            />
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Short note (optional)"
              className="rounded-2xl border border-border bg-card px-4 py-3 text-base text-ink"
              placeholderTextColor={DUTS.placeholder}
            />
            <Pressable
              onPress={() => {
                void pickProfilePhoto().then((picked) => {
                  if (picked) setPhoto({ uri: picked.uri, base64: picked.base64 });
                });
              }}
              className="rounded-2xl border border-border bg-card px-4 py-3"
            >
              <Text className="text-center font-bold text-ink">{photo ? "Photo attached" : "Add product photo"}</Text>
            </Pressable>
            {photo ? <Image source={{ uri: photo.uri }} className="h-40 w-full rounded-2xl" /> : null}
            <AppButton
              label="SEND QUOTE TO CUSTOMER"
              loading={quote.isPending}
              disabled={!shop.trim() || !price.trim()}
              onPress={() => quote.mutate()}
            />
            <AppButton label="ITEM NOT FOUND" variant="secondary" loading={notFound.isPending} onPress={() => notFound.mutate()} />
            <AppButton label="Release search" variant="secondary" loading={release.isPending} onPress={() => release.mutate()} />
          </View>
        ) : null}

        {waiting ? (
          <DutsInlineBanner
            tone="info"
            title="Waiting for the customer"
            body="Do not buy this item yet. Wait for customer approval and payment."
          />
        ) : null}

        {paid ? (
          <View className="gap-3">
            <DutsInlineBanner
              tone="success"
              title="PAYMENT CONFIRMED ✓"
              body={`Purchase: ${row?.foundProductName ?? row?.parsedItemName}. Maximum authorized item price: ${money(row?.foundPriceCents)}. Do not buy a more expensive item.`}
            />
            <Text className="text-sm font-bold text-ink">Shop price changed?</Text>
            <TextInput
              value={changedPrice}
              onChangeText={setChangedPrice}
              keyboardType="decimal-pad"
              placeholder="New price"
              className="rounded-2xl border border-border bg-card px-4 py-3 text-base text-ink"
              placeholderTextColor={DUTS.placeholder}
            />
            <AppButton
              label="Report new price"
              variant="secondary"
              disabled={!changedPrice.trim()}
              loading={priceChange.isPending}
              onPress={() => priceChange.mutate()}
            />
            <AppButton label="I purchased this item" loading={purchased.isPending} onPress={() => purchased.mutate()} />
          </View>
        ) : null}

        {purchasedState ? (
          <DutsInlineBanner
            tone="info"
            title="Deliver this item"
            body="This is now a normal DUTS delivery. Do not release it."
            actions={
              row?.linkedDeliveryGigId
                ? [{ label: "Open delivery", onPress: () => navigation.navigate("DeliveryJob", { gigId: row.linkedDeliveryGigId! }) }]
                : []
            }
          />
        ) : null}

        {status === "NEEDS_ATTENTION" ? (
          <DutsInlineBanner title="Needs DUTS help" body="Do not leave purchased goods. DUTS will help resolve this." />
        ) : null}
      </ScrollView>
    </TabScreen>
  );
}
