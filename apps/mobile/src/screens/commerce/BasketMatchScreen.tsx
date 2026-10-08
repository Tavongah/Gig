import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { StoreHeader, StorePage } from "../../components/StoreHeader";
import { AppButton } from "../../components/AppButton";
import { api, type SmartBasketMatchDto } from "../../lib/api";
import { useShopBrowse } from "../../lib/shop-browse";
import { DUTS } from "../../lib/theme";
import { logDutsFlow } from "../../lib/flow-log";
import { showConfirm } from "../../lib/confirm";
import type { RootStackParamList } from "../../navigation/types";
import { useDesiredBasketStore } from "../../stores/desired-basket.store";
import { useCommerceCartStore } from "../../stores/commerce-cart.store";

type Props = NativeStackScreenProps<RootStackParamList, "BasketMatch">;

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function BasketMatchScreen({ navigation }: Props) {
  const browse = useShopBrowse();
  const desired = useDesiredBasketStore((s) => s.lines);
  const removeMany = useDesiredBasketStore((s) => s.removeMany);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [changedNote, setChangedNote] = useState("");
  const [showOthers, setShowOthers] = useState(false);

  const items = useMemo(
    () =>
      desired.map((l) => ({
        catalogProductId: l.catalogProductId,
        quantity: l.quantity,
        flavorOptionId: l.flavorOptionId ?? null,
        flavorPreference: l.flavorPreference ?? null,
        flavorName: l.flavorName ?? null
      })),
    [desired]
  );

  const matchQuery = useQuery({
    queryKey: ["smart-basket-match", ...browse.queryKey, items.map((i) => `${i.catalogProductId}:${i.quantity}`).join("|")],
    queryFn: () => {
      logDutsFlow("BASKET_MATCH_STARTED", { requestedLines: items.length });
      return api.commerceBasketMatch({
        ...(browse.geo && "areaId" in browse.geo
          ? { areaId: browse.geo.areaId }
          : browse.geo && "lat" in browse.geo
            ? { location: { latitude: browse.geo.lat, longitude: browse.geo.lng } }
            : {}),
        items
      });
    },
    enabled: Boolean(browse.geo && items.length)
  });

  const matches = matchQuery.data?.matches ?? [];
  const primary = (selectedId ? matches.find((m) => m.merchantId === selectedId) : matches[0]) ?? null;
  const others = matches.filter((m) => m.merchantId !== primary?.merchantId);
  const showDistance = matchQuery.data?.locationMode === "exact" && !browse.isGuest;

  const selectMut = useMutation({
    mutationFn: (input: { match: SmartBasketMatchDto; acceptPartial: boolean }) =>
      api.commerceBasketSelect({
        merchantId: input.match.merchantId,
        acceptPartial: input.acceptPartial,
        expectedFulfilledLines: input.match.fulfilledLineCount,
        deferDelivery: browse.isGuest || matchQuery.data?.locationMode === "discovery",
        ...(browse.geo && "areaId" in browse.geo
          ? { areaId: browse.geo.areaId }
          : browse.geo && "lat" in browse.geo
            ? { location: { latitude: browse.geo.lat, longitude: browse.geo.lng } }
            : {}),
        items
      }),
    onSuccess: (result, vars) => {
      if (result.changed || !result.quote || !result.cartLines.length) {
        setChangedNote(
          result.match
            ? `Something changed at this shop. ${result.match.fulfilledLineCount} of your ${result.requestedLines} items are still available.`
            : "Something changed at this shop. Please review your items."
        );
        void matchQuery.refetch();
        return;
      }

      const apply = () => {
        const imageByCatalog = new Map(desired.map((l) => [l.catalogProductId, l.imageUrl]));
        useCommerceCartStore.getState().replaceCart({
          merchantId: result.quote!.merchant.id,
          merchantName: result.quote!.merchant.name,
          lines: result.cartLines.map((line) => ({
            productId: line.productId,
            catalogProductId: line.catalogProductId || null,
            name: line.name,
            imageUrl: imageByCatalog.get(line.catalogProductId) ?? null,
            sizeLabel: line.sizeLabel,
            unitPriceCents: line.unitPriceCents,
            quantity: line.quantity,
            merchantId: line.merchantId,
            merchantName: line.merchantName,
            flavorOptionId: line.flavorOptionId ?? null,
            flavorPreference: line.flavorPreference ?? null,
            flavorName: line.flavorName ?? null
          }))
        });
        removeMany(result.cartLines.map((l) => l.catalogProductId).filter(Boolean));
        logDutsFlow("BASKET_MATCH_SELECTED", { merchantId: vars.match.merchantId });
        navigation.navigate("MainTabs", { screen: "Cart" });
      };

      const currentMerchant = useCommerceCartStore.getState().merchantId;
      if (currentMerchant && currentMerchant !== result.quote.merchant.id) {
        showConfirm(
          "Different shop",
          "Continuing with this shop will replace your current basket.",
          apply,
          { confirmLabel: "Continue", destructive: true, cancelLabel: "Keep current basket" }
        );
        return;
      }
      apply();
    }
  });

  function continueWith(match: SmartBasketMatchDto) {
    setChangedNote("");
    selectMut.mutate({ match, acceptPartial: !match.complete });
  }

  if (!desired.length) {
    return (
      <View className="flex-1 bg-background">
        <StoreHeader compact showCategories={false} />
        <StorePage>
          <Text className="mt-6 text-2xl font-black text-ink">Your shopping list</Text>
          <Text className="mt-3 text-base text-muted">Your shopping list is empty.</Text>
          <View className="mt-6">
            <AppButton label="Keep shopping" variant="secondary" onPress={() => navigation.navigate("MainTabs", { screen: "Home" })} />
          </View>
        </StorePage>
      </View>
    );
  }

  if (!browse.geo) {
    return (
      <View className="flex-1 bg-background">
        <StoreHeader compact showCategories={false} />
        <StorePage>
          <Text className="mt-6 text-2xl font-black text-ink">Find a shop</Text>
          <Text className="mt-3 text-base text-muted">Choose a shopping area to find nearby shops.</Text>
          <View className="mt-6">
            <AppButton label="Keep shopping" variant="secondary" onPress={() => navigation.navigate("MainTabs", { screen: "Home" })} />
          </View>
        </StorePage>
      </View>
    );
  }

  const loading = matchQuery.isLoading || matchQuery.isFetching;
  const top = primary;

  return (
    <View className="flex-1 bg-background">
      <StoreHeader compact showCategories={false} />
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        <StorePage>
          {loading && !matchQuery.data ? (
            <View className="mt-16 items-center">
              <ActivityIndicator color={DUTS.purple} />
              <Text className="mt-3 text-sm text-muted">Finding a shop…</Text>
            </View>
          ) : !top ? (
            <>
              <Text className="mt-6 text-2xl font-black text-ink">We couldn&apos;t find these items nearby yet.</Text>
              <Text className="mt-3 text-base text-muted">Keep shopping and try a different combination.</Text>
              <View className="mt-6">
                <AppButton
                  label="Keep shopping"
                  variant="secondary"
                  onPress={() => navigation.navigate("MainTabs", { screen: "Home" })}
                />
              </View>
            </>
          ) : (
            <>
              {top.complete ? (
                <>
                  <Text className="mt-6 text-2xl font-black text-ink">We found your items</Text>
                  <Text className="mt-2 text-base text-muted">Everything is available from</Text>
                  <Text className="mt-1 text-xl font-black text-ink">{top.merchantName}</Text>
                  <Text className="mt-2 text-base font-semibold text-ink">
                    {top.fulfilledLineCount} items · {money(top.itemSubtotalCents)}
                    {showDistance && top.distanceKm != null ? ` · ${top.distanceKm} km` : ""}
                  </Text>
                </>
              ) : (
                <>
                  <Text className="mt-6 text-2xl font-black text-ink">
                    We found {top.fulfilledLineCount} of your {top.requestedLineCount} items at one nearby shop
                  </Text>
                  <Text className="mt-2 text-xl font-black text-ink">{top.merchantName}</Text>
                </>
              )}

              {changedNote ? <Text className="mt-4 text-sm text-danger">{changedNote}</Text> : null}
              {selectMut.isError ? (
                <Text className="mt-4 text-sm text-danger">
                  {(selectMut.error as Error).message || "Something changed. Please review your items."}
                </Text>
              ) : null}

              <View className="mt-5 rounded-2xl border border-border bg-card p-4">
                <Text className="text-sm font-extrabold text-ink">Available</Text>
                {top.available.map((row) => (
                  <Text key={row.catalogProductId} className="mt-2 text-base text-ink">
                    ✓ {row.name}
                    {row.sizeLabel ? ` · ${row.sizeLabel}` : ""}
                  </Text>
                ))}
                {top.missing.length ? (
                  <>
                    <Text className="mt-4 text-sm font-extrabold text-ink">Unavailable</Text>
                    {top.missing.map((row) => (
                      <Text key={row.catalogProductId} className="mt-2 text-base text-muted">
                        • {row.name}
                        {row.sizeLabel ? ` · ${row.sizeLabel}` : ""}
                      </Text>
                    ))}
                  </>
                ) : null}
                <Text className="mt-4 text-sm text-muted">
                  Items: {money(top.itemSubtotalCents)}
                  {showDistance && top.distanceKm != null ? ` · ${top.distanceKm} km` : ""}
                </Text>
                <Text className="mt-1 text-xs text-muted">Delivery is calculated after you continue.</Text>
              </View>

              <View className="mt-6">
                <AppButton
                  label={
                    top.complete
                      ? "Continue with this shop"
                      : `Continue with ${top.fulfilledLineCount} item${top.fulfilledLineCount === 1 ? "" : "s"}`
                  }
                  onPress={() => continueWith(top)}
                  disabled={selectMut.isPending}
                />
              </View>
              {!top.complete ? (
                <View className="mt-3">
                  <AppButton
                    label="Try another shop"
                    variant="secondary"
                    onPress={() => setShowOthers(true)}
                  />
                </View>
              ) : others.length ? (
                <Pressable
                  onPress={() => setShowOthers((v) => !v)}
                  className="mt-4 items-center"
                  accessibilityRole="button"
                >
                  <Text className="text-sm font-semibold" style={{ color: DUTS.purple }}>
                    {showOthers ? "Hide other shops" : "Other shops"}
                  </Text>
                </Pressable>
              ) : null}

              {(showOthers || !top.complete) && others.length ? (
                <View className="mt-5">
                  <Text className="text-lg font-black text-ink">Other shops</Text>
                  {others.map((shop) => (
                    <Pressable
                      key={shop.merchantId}
                      onPress={() => {
                        setSelectedId(shop.merchantId);
                        setShowOthers(true);
                        setChangedNote("");
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`${shop.merchantName}, ${shop.fulfilledLineCount} of ${shop.requestedLineCount} items`}
                      className="mt-3 rounded-2xl border border-border bg-card p-4"
                    >
                      <Text className="text-base font-bold text-ink">{shop.merchantName}</Text>
                      <Text className="mt-1 text-sm text-muted">
                        {shop.fulfilledLineCount} of {shop.requestedLineCount} items · {money(shop.itemSubtotalCents)}
                        {showDistance && shop.distanceKm != null ? ` · ${shop.distanceKm} km` : ""}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </>
          )}
        </StorePage>
      </ScrollView>
    </View>
  );
}
