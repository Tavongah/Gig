import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { formatFlavorCustomerLine, resolveCustomerPrimaryMerchant } from "@gigflow/shared";
import { TabScreen } from "../../components/TabScreen";
import { StoreHeader } from "../../components/StoreHeader";
import { AppButton } from "../../components/AppButton";
import { api } from "../../lib/api";
import { friendlyCheckoutError, moneyLabel } from "../../lib/checkout-flow";
import { logDutsFlow } from "../../lib/flow-log";
import { useShopBrowse } from "../../lib/shop-browse";
import { DUTS } from "../../lib/theme";
import { isSmartBasketEnabled } from "../../lib/storefront-categories";
import type { RootStackParamList } from "../../navigation/types";
import { cartLineKey, useCommerceCartStore } from "../../stores/commerce-cart.store";
import { desiredFlavorLabel, desiredLineKey, useDesiredBasketStore } from "../../stores/desired-basket.store";
import { toCheckoutLine } from "../../lib/storefront-cart";
import { useReducedMotion } from "../../lib/use-reduced-motion";

export function CartScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const browse = useShopBrowse();
  const lines = useCommerceCartStore((s) => s.lines);
  const setQuantity = useCommerceCartStore((s) => s.setQuantity);
  const clear = useCommerceCartStore((s) => s.clear);
  const notice = useCommerceCartStore((s) => s.notice);
  const setPendingCheckout = useCommerceCartStore((s) => s.setPendingCheckout);
  const desired = useDesiredBasketStore((s) => s.lines);
  const setDesiredQty = useDesiredBasketStore((s) => s.setQuantity);
  const removeDesired = useDesiredBasketStore((s) => s.remove);
  const removeMany = useDesiredBasketStore((s) => s.removeMany);
  const clearDesired = useDesiredBasketStore((s) => s.clear);
  const smartBasket = isSmartBasketEnabled();
  const [quoteError, setQuoteError] = useState("");
  const [working, setWorking] = useState(false);
  const [ctaCue, setCtaCue] = useState(false);
  const ctaReadyOnce = useRef(false);
  const reduceMotion = useReducedMotion();

  const quoteMut = useMutation({
    mutationFn: () => {
      if (browse.isGuest || !browse.exact) {
        return api.commerceCartQuote({
          deferDelivery: true,
          lines: lines.map(toCheckoutLine)
        });
      }
      return api.commerceCartQuote(
        {
          lat: browse.exact.latitude,
          lng: browse.exact.longitude,
          lines: lines.map(toCheckoutLine)
        },
        browse.token
      );
    },
    onError: (e: Error) => setQuoteError(friendlyCheckoutError(e.message))
  });

  useEffect(() => {
    setQuoteError("");
    if (!lines.length) return;
    quoteMut.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, browse.isGuest, browse.exact?.latitude, browse.exact?.longitude]);

  useEffect(() => {
    if (!lines.length) {
      ctaReadyOnce.current = false;
      setCtaCue(false);
      return;
    }
    if (ctaReadyOnce.current || reduceMotion) return;
    ctaReadyOnce.current = true;
    setCtaCue(true);
    const timer = setTimeout(() => setCtaCue(false), 360);
    return () => clearTimeout(timer);
  }, [lines.length, reduceMotion]);

  const shoppingList = smartBasket ? desired : [];
  const empty = !lines.length && !shoppingList.length;

  function browsePayload() {
    return browse.geo && "areaId" in browse.geo
      ? { areaId: browse.geo.areaId }
      : browse.geo && "lat" in browse.geo
        ? { location: { latitude: browse.geo.lat, longitude: browse.geo.lng } }
        : {};
  }

  function applyBasketSelect(result: Awaited<ReturnType<typeof api.commerceBasketSelect>>) {
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
  }

  async function autoSelectBestShop(): Promise<boolean> {
    if (!shoppingList.length) return true;
    if (!browse.geo) {
      setQuoteError("Choose a shopping area to continue.");
      return false;
    }
    const items = shoppingList.map((l) => ({
      catalogProductId: l.catalogProductId,
      quantity: l.quantity,
      flavorOptionId: l.flavorOptionId ?? null,
      flavorPreference: l.flavorPreference ?? null,
      flavorName: l.flavorName ?? null
    }));
    try {
      const data = await api.commerceBasketMatch({ ...browsePayload(), items });
      const top = data.matches[0];
      if (!top) {
        setQuoteError("We couldn't find these items nearby yet.");
        return false;
      }
      if (!top.complete) {
        navigation.navigate("BasketMatch");
        return false;
      }
      const result = await api.commerceBasketSelect({
        merchantId: top.merchantId,
        acceptPartial: false,
        expectedFulfilledLines: top.fulfilledLineCount,
        deferDelivery: browse.isGuest || data.locationMode === "discovery",
        ...browsePayload(),
        items
      });
      if (result.changed || !result.quote || !result.cartLines.length) {
        navigation.navigate("BasketMatch");
        return false;
      }
      applyBasketSelect(result);
      return true;
    } catch (e) {
      setQuoteError(friendlyCheckoutError((e as Error).message));
      navigation.navigate("BasketMatch");
      return false;
    }
  }

  async function startGuestWhatsApp() {
    const current = useCommerceCartStore.getState().lines;
    if (!current.length) return;
    logDutsFlow("GUEST_CHECKOUT_STARTED", { channel: "whatsapp" });
    const result = await api.commerceGuestHandoff({
      shoppingAreaId: browse.area?.id,
      lines: current.map(toCheckoutLine)
    });
    logDutsFlow("GUEST_WHATSAPP_HANDOFF", { itemCount: current.length });
    if (!result.whatsappUrl) {
      setQuoteError("WhatsApp ordering isn't available right now. Sign in to complete your order.");
      return;
    }
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.open(result.whatsappUrl, "_blank");
      return;
    }
    await Linking.openURL(result.whatsappUrl);
  }

  async function continuePrimary() {
    setQuoteError("");
    setWorking(true);
    try {
      if (shoppingList.length && !useCommerceCartStore.getState().lines.length) {
        const selected = await autoSelectBestShop();
        if (!selected) return;
      }
      const current = useCommerceCartStore.getState().lines;
      if (!current.length) return;
      if (browse.isGuest) {
        await startGuestWhatsApp();
        return;
      }
      if (!browse.exact) {
        navigation.navigate("ShopLocation", { next: "checkout" });
        return;
      }
      navigation.navigate("CommerceCheckout");
    } catch (e) {
      setQuoteError(friendlyCheckoutError((e as Error).message));
    } finally {
      setWorking(false);
    }
  }

  function chooseAccount() {
    setPendingCheckout(true);
    logDutsFlow("GUEST_CHECKOUT_STARTED", { channel: "account" });
    logDutsFlow("GUEST_AUTH_CHECKOUT", { itemCount: lines.length });
    navigation.navigate("MainTabs", { screen: "SignIn" });
  }

  function shoppingListBlock() {
    if (!shoppingList.length) return null;
    return (
      <View className={lines.length ? "mb-8" : undefined}>
        <Text className="text-2xl font-black text-ink">Your shopping list</Text>
        <Text className="mt-1 text-sm text-muted">Add products, then continue.</Text>
        {shoppingList.map((line) => (
          <View key={desiredLineKey(line)} className="mt-4 flex-row gap-3 border-b border-border pb-4">
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
              {desiredFlavorLabel(line) ? (
                <Text className="text-xs text-muted">{desiredFlavorLabel(line)}</Text>
              ) : null}
              {line.fromPriceCents != null ? (
                <Text className="mt-1 text-sm font-semibold text-muted">From ${(line.fromPriceCents / 100).toFixed(2)}</Text>
              ) : null}
              <View className="mt-2 flex-row items-center gap-3">
                <Pressable
                  onPress={() => setDesiredQty(desiredLineKey(line), line.quantity - 1)}
                  accessibilityLabel="Decrease quantity"
                  className="h-11 w-11 items-center justify-center rounded-full border border-border"
                >
                  <Text className="text-lg font-bold">−</Text>
                </Pressable>
                <Text className="min-w-[20px] text-center font-bold">{line.quantity}</Text>
                <Pressable
                  onPress={() => setDesiredQty(desiredLineKey(line), line.quantity + 1)}
                  accessibilityLabel="Increase quantity"
                  className="h-11 w-11 items-center justify-center rounded-full border border-border"
                >
                  <Text className="text-lg font-bold">+</Text>
                </Pressable>
                <Pressable onPress={() => removeDesired(desiredLineKey(line))} accessibilityRole="button">
                  <Text className="text-sm font-semibold text-muted">Remove</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ))}
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
          <View className="mt-6 items-center">
            <Ionicons name="cart-outline" size={36} color={DUTS.placeholder} />
          </View>
          <Text className="mt-4 text-center text-base text-muted">Your cart is empty. Browse products to get started.</Text>
          <View className="mt-6">
            <AppButton label="Continue shopping" variant="secondary" onPress={() => navigation.navigate("MainTabs", { screen: "Home" })} />
          </View>
        </TabScreen>
      </View>
    );
  }

  const quote = quoteMut.data;
  const quotedLine = (line: (typeof lines)[number]) =>
    quote?.lines.find(
      (l) => l.productId === line.productId && (l.flavorOptionId ?? null) === (line.flavorOptionId ?? null)
    );
  const deferred = browse.isGuest || !browse.exact || quote?.deliveryQuoteStatus === "deferred";
  const shopGroups = (() => {
    const map = new Map<string, { merchantId: string; merchantName: string; lines: typeof lines }>();
    for (const line of lines) {
      const existing = map.get(line.merchantId);
      if (existing) existing.lines.push(line);
      else map.set(line.merchantId, { merchantId: line.merchantId, merchantName: line.merchantName, lines: [line] });
    }
    return [...map.values()];
  })();
  const primaryShop = resolveCustomerPrimaryMerchant(
    shopGroups.map((group) => ({
      merchantId: group.merchantId,
      merchantName: group.merchantName,
      quantity: group.lines.reduce((s, l) => s + l.quantity, 0),
      subtotalCents: group.lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0)
    }))
  );
  const canContinue = shoppingList.length && !lines.length
    ? !working
    : Boolean(quote) && !quoteMut.isPending && !quoteError && !working;

  function renderLine(line: (typeof lines)[number]) {
    const priced = quotedLine(line);
    const lineTotal = priced?.lineTotalCents ?? line.unitPriceCents * line.quantity;
    const flavor =
      formatFlavorCustomerLine(line.flavorPreference, line.flavorName) ??
      formatFlavorCustomerLine(priced?.flavorPreference, priced?.flavorName);
    return (
      <View key={cartLineKey(line)} className="mt-4 flex-row gap-3 border-b border-border pb-4">
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
          {flavor ? <Text className="text-xs text-muted">{flavor}</Text> : null}
          <Text className="mt-1 text-sm font-extrabold text-ink">${(lineTotal / 100).toFixed(2)}</Text>
          <View className="mt-2 flex-row items-center gap-3">
            <Pressable
              onPress={() => setQuantity(cartLineKey(line), line.quantity - 1)}
              accessibilityLabel="Decrease quantity"
              className="h-11 w-11 items-center justify-center rounded-full border border-border"
              style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.94 : 1 }] }]}
            >
              <Text className="text-lg font-bold">−</Text>
            </Pressable>
            <Text className="min-w-[20px] text-center font-bold">{line.quantity}</Text>
            <Pressable
              onPress={() => setQuantity(cartLineKey(line), line.quantity + 1)}
              accessibilityLabel="Increase quantity"
              className="h-11 w-11 items-center justify-center rounded-full border border-border"
              style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.94 : 1 }] }]}
            >
              <Text className="text-lg font-bold">+</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  const primaryLabel = browse.isGuest ? "Continue with WhatsApp" : "Continue";

  return (
    <View className="flex-1 bg-background">
      <StoreHeader compact showCategories={false} />
      <TabScreen style={{ paddingTop: 8, flex: 1 }}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
          {shoppingListBlock()}
          {lines.length ? (
            <>
              <Text className="text-2xl font-black text-ink">Your cart</Text>
              {primaryShop ? (
                <Text className="mt-1 text-sm font-semibold text-muted">Shop: {primaryShop.merchantName}</Text>
              ) : null}
              {notice ? <Text className="mt-2 text-sm font-semibold text-ink">{notice}</Text> : null}
              {lines.map(renderLine)}
            </>
          ) : null}

          {quoteMut.isPending ? <ActivityIndicator className="mt-4" color={DUTS.purple} /> : null}
          {quoteError ? <Text className="mt-3 text-sm text-danger">{quoteError}</Text> : null}

          {quote ? (
            <View className="mt-6 gap-1 rounded-2xl border border-border bg-surface p-4">
              <Text className="text-sm text-muted">Subtotal       {moneyLabel(quote.subtotalCents)}</Text>
              <Text className="text-sm text-muted">
                Delivery       {deferred ? "Calculated at checkout" : moneyLabel(quote.deliveryFeeCents)}
              </Text>
              {!deferred && quote.serviceFeeCents > 0 ? (
                <Text className="text-sm text-muted">Service        {moneyLabel(quote.serviceFeeCents)}</Text>
              ) : null}
              {!deferred ? (
                <Text className="mt-2 text-lg font-black text-ink">Total          {moneyLabel(quote.totalCents)}</Text>
              ) : null}
            </View>
          ) : null}

          <Pressable
            onPress={() => navigation.navigate("MainTabs", { screen: "Home" })}
            className="mt-4 items-center"
            accessibilityRole="button"
          >
            <Text className="text-sm font-semibold text-muted">Continue shopping</Text>
          </Pressable>
          {lines.length ? (
            <Pressable onPress={() => clear()} className="mt-3 items-center" accessibilityRole="button">
              <Text className="text-sm font-semibold text-muted">Clear basket</Text>
            </Pressable>
          ) : null}
        </ScrollView>
        <View className={`border-t border-border bg-background px-1 pb-5 pt-3${ctaCue ? " duts-cta-ready" : ""}`}>
          <AppButton
            label={primaryLabel}
            onPress={() => void continuePrimary()}
            disabled={!canContinue}
            loading={working}
          />
          {browse.isGuest ? (
            <Pressable onPress={chooseAccount} className="mt-3 items-center" accessibilityRole="button">
              <Text className="text-sm font-semibold text-muted">Sign in or create account</Text>
            </Pressable>
          ) : null}
        </View>
      </TabScreen>
    </View>
  );
}
