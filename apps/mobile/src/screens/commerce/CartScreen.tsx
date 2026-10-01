import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { TabScreen } from "../../components/TabScreen";
import { StoreHeader } from "../../components/StoreHeader";
import { AppButton } from "../../components/AppButton";
import { api } from "../../lib/api";
import { useShopBrowse } from "../../lib/shop-browse";
import { DUTS } from "../../lib/theme";
import { isSmartBasketEnabled } from "../../lib/storefront-categories";
import type { RootStackParamList } from "../../navigation/types";
import { useCommerceCartStore } from "../../stores/commerce-cart.store";
import { useDesiredBasketStore } from "../../stores/desired-basket.store";

export function CartScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const browse = useShopBrowse();
  const lines = useCommerceCartStore((s) => s.lines);
  const setQuantity = useCommerceCartStore((s) => s.setQuantity);
  const clear = useCommerceCartStore((s) => s.clear);
  const desired = useDesiredBasketStore((s) => s.lines);
  const setDesiredQty = useDesiredBasketStore((s) => s.setQuantity);
  const removeDesired = useDesiredBasketStore((s) => s.remove);
  const clearDesired = useDesiredBasketStore((s) => s.clear);
  const smartBasket = isSmartBasketEnabled();
  const [quoteError, setQuoteError] = useState("");

  const quoteMut = useMutation({
    mutationFn: () => {
      if (browse.isGuest) {
        return api.commerceCartQuote({
          deferDelivery: true,
          lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity }))
        });
      }
      if (!browse.exact) throw new Error("Set delivery location first.");
      return api.commerceCartQuote(
        {
          lat: browse.exact.latitude,
          lng: browse.exact.longitude,
          lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity }))
        },
        browse.token
      );
    },
    onError: (e: Error) => {
      const message = e.message;
      setQuoteError(
        /VALIDATION_ERROR|Invalid uuid|Required|INTERNAL_ERROR|Prisma|Zod/i.test(message)
          ? "Something changed with your cart. Please review it."
          : message
      );
    }
  });

  useEffect(() => {
    setQuoteError("");
    if (!lines.length) return;
    if (browse.isGuest || browse.exact) quoteMut.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, browse.isGuest, browse.exact?.latitude, browse.exact?.longitude]);

  const shoppingList = smartBasket ? desired : [];
  const empty = !lines.length && !shoppingList.length;

  function shoppingListBlock() {
    if (!shoppingList.length) return null;
    return (
      <View className={lines.length ? "mb-8" : undefined}>
        <Text className="text-2xl font-black text-ink">Your shopping list</Text>
        <Text className="mt-1 text-sm text-muted">Add products, then find one shop that has them.</Text>
        {shoppingList.map((line) => (
          <View key={line.catalogProductId} className="mt-4 flex-row gap-3 border-b border-border pb-4">
            <View className="h-16 w-16 items-center justify-center overflow-hidden rounded-xl bg-surface">
              {line.imageUrl ? (
                <Image
                  source={{ uri: line.imageUrl }}
                  className="h-full w-full"
                  resizeMode="contain"
                  {...({ loading: "lazy" } as object)}
                />
              ) : (
                <Text className="text-[10px] text-muted">No photo</Text>
              )}
            </View>
            <View className="flex-1">
              <Text className="text-base font-bold text-ink">{line.name}</Text>
              {line.sizeLabel ? <Text className="text-xs text-muted">{line.sizeLabel}</Text> : null}
              {line.fromPriceCents != null ? (
                <Text className="mt-1 text-sm font-semibold text-muted">From ${(line.fromPriceCents / 100).toFixed(2)}</Text>
              ) : null}
              <View className="mt-2 flex-row items-center gap-3">
                <Pressable
                  onPress={() => setDesiredQty(line.catalogProductId, line.quantity - 1)}
                  accessibilityLabel="Decrease quantity"
                  className="h-11 w-11 items-center justify-center rounded-full border border-border"
                >
                  <Text className="text-lg font-bold">−</Text>
                </Pressable>
                <Text className="min-w-[20px] text-center font-bold">{line.quantity}</Text>
                <Pressable
                  onPress={() => setDesiredQty(line.catalogProductId, line.quantity + 1)}
                  accessibilityLabel="Increase quantity"
                  className="h-11 w-11 items-center justify-center rounded-full border border-border"
                >
                  <Text className="text-lg font-bold">+</Text>
                </Pressable>
                <Pressable onPress={() => removeDesired(line.catalogProductId)} accessibilityRole="button">
                  <Text className="text-sm font-semibold text-muted">Remove</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ))}
        <View className="mt-6">
          <AppButton label="Find a shop" onPress={() => navigation.navigate("BasketMatch")} />
        </View>
        <Pressable onPress={() => clearDesired()} className="mt-3 items-center" accessibilityRole="button">
          <Text className="text-sm font-semibold text-muted">Clear shopping list</Text>
        </Pressable>
      </View>
    );
  }

  if (empty) {
    return (
      <View className="flex-1 bg-background">
        <StoreHeader compact showCategories={false} />
        <TabScreen style={{ paddingTop: 8 }}>
          <Text className="text-2xl font-black text-ink">{smartBasket ? "Your shopping list" : "Your cart"}</Text>
          <Text className="mt-4 text-base text-muted">Your cart is empty. Browse products to get started.</Text>
          <View className="mt-6">
            <AppButton label="Continue shopping" variant="secondary" onPress={() => navigation.navigate("MainTabs", { screen: "Home" })} />
          </View>
        </TabScreen>
      </View>
    );
  }

  if (!lines.length) {
    return (
      <View className="flex-1 bg-background">
        <StoreHeader compact showCategories={false} />
        <TabScreen style={{ paddingTop: 8 }}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
            {shoppingListBlock()}
          </ScrollView>
        </TabScreen>
      </View>
    );
  }

  if (!browse.isGuest && !browse.exact) {
    return (
      <View className="flex-1 bg-background">
        <StoreHeader compact showCategories={false} />
        <TabScreen style={{ paddingTop: 8 }}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
            {shoppingListBlock()}
            <Text className="text-2xl font-black text-ink">Your cart</Text>
            <Text className="mt-4 text-base text-muted">Set your location to see products available near you.</Text>
            <View className="mt-6">
              <AppButton label="Set location" onPress={() => navigation.navigate("ShopLocation")} />
            </View>
          </ScrollView>
        </TabScreen>
      </View>
    );
  }

  const quote = quoteMut.data;
  const quotedLine = (productId: string) => quote?.lines.find((l) => l.productId === productId);
  const deferred = browse.isGuest || quote?.deliveryQuoteStatus === "deferred";
  const notice = useCommerceCartStore((s) => s.notice);
  const shopGroups = (() => {
    const map = new Map<string, { merchantId: string; merchantName: string; lines: typeof lines }>();
    for (const line of lines) {
      const existing = map.get(line.merchantId);
      if (existing) existing.lines.push(line);
      else map.set(line.merchantId, { merchantId: line.merchantId, merchantName: line.merchantName, lines: [line] });
    }
    return [...map.values()];
  })();
  const shopCount = quote?.shopCount ?? shopGroups.length;

  function renderLine(line: (typeof lines)[number]) {
    const priced = quotedLine(line.productId);
    const lineTotal = priced?.lineTotalCents ?? line.unitPriceCents * line.quantity;
    return (
      <View key={line.productId} className="mt-3 flex-row gap-3">
        <View className="h-14 w-14 items-center justify-center overflow-hidden rounded-xl bg-surface">
          {line.imageUrl ? (
            <Image
              source={{ uri: line.imageUrl }}
              className="h-full w-full"
              resizeMode="contain"
              {...({ loading: "lazy" } as object)}
            />
          ) : (
            <Text className="text-[10px] text-muted">No photo</Text>
          )}
        </View>
        <View className="flex-1">
          <Text className="text-base font-bold text-ink">{priced?.productName ?? line.name}</Text>
          {line.sizeLabel ? <Text className="text-xs text-muted">{line.sizeLabel}</Text> : null}
          <Text className="mt-1 text-sm font-extrabold text-ink">${(lineTotal / 100).toFixed(2)}</Text>
          <View className="mt-2 flex-row items-center gap-3">
            <Pressable
              onPress={() => setQuantity(line.productId, line.quantity - 1)}
              accessibilityLabel="Decrease quantity"
              className="h-11 w-11 items-center justify-center rounded-full border border-border"
            >
              <Text className="text-lg font-bold">−</Text>
            </Pressable>
            <Text className="min-w-[20px] text-center font-bold">{line.quantity}</Text>
            <Pressable
              onPress={() => setQuantity(line.productId, line.quantity + 1)}
              accessibilityLabel="Increase quantity"
              className="h-11 w-11 items-center justify-center rounded-full border border-border"
            >
              <Text className="text-lg font-bold">+</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <StoreHeader compact showCategories={false} />
    <TabScreen style={{ paddingTop: 8 }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {shoppingListBlock()}
        <Text className="text-2xl font-black text-ink">Your cart</Text>
        {notice ? <Text className="mt-2 text-sm font-semibold text-ink">{notice}</Text> : null}

        {shopGroups.map((group) => (
          <View key={group.merchantId} className="mt-4 rounded-2xl border border-border bg-card p-4">
            <Text className="text-base font-extrabold text-ink">{group.merchantName}</Text>
            <Text className="mt-0.5 text-xs text-muted">
              {group.lines.reduce((s, l) => s + l.quantity, 0)}{" "}
              {group.lines.reduce((s, l) => s + l.quantity, 0) === 1 ? "item" : "items"}
            </Text>
            <View className="mt-2 h-px bg-border" />
            {group.lines.map(renderLine)}
          </View>
        ))}

        {quoteMut.isPending ? <ActivityIndicator className="mt-4" color={DUTS.purple} /> : null}
        {quoteError ? <Text className="mt-3 text-sm text-danger">{quoteError}</Text> : null}

        {quote ? (
          <View className="mt-6 gap-1 rounded-2xl border border-border bg-surface p-4">
            <Text className="text-sm text-muted">Items          ${(quote.subtotalCents / 100).toFixed(2)}</Text>
            <Text className="text-sm text-muted">
              Delivery       {deferred ? "Calculated at checkout" : `$${(quote.deliveryFeeCents / 100).toFixed(2)}`}
            </Text>
            {!deferred && quote.serviceFeeCents > 0 ? (
              <Text className="text-sm text-muted">Service        ${(quote.serviceFeeCents / 100).toFixed(2)}</Text>
            ) : null}
            {!deferred ? (
              <Text className="mt-2 text-lg font-black text-ink">
                Total          ${(quote.totalCents / 100).toFixed(2)}
              </Text>
            ) : null}
          </View>
        ) : null}

        {shopCount > 1 ? (
          <Text className="mt-3 text-sm font-semibold text-muted">
            {shopCount} shops • One delivery
          </Text>
        ) : null}

        <View className="mt-6">
          <AppButton
            label="Continue to order"
            onPress={() =>
              browse.isGuest ? navigation.navigate("GuestCheckoutChoice") : navigation.navigate("CommerceCheckout")
            }
            disabled={!quote || quoteMut.isPending}
          />
        </View>
        <Pressable
          onPress={() => navigation.navigate("MainTabs", { screen: "Home" })}
          className="mt-4 items-center"
          accessibilityRole="button"
        >
          <Text className="text-sm font-semibold text-muted">Continue shopping</Text>
        </Pressable>
        <Pressable onPress={() => clear()} className="mt-3 items-center" accessibilityRole="button">
          <Text className="text-sm font-semibold text-muted">Clear basket</Text>
        </Pressable>
      </ScrollView>
    </TabScreen>
    </View>
  );
}
