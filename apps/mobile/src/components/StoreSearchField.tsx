import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Keyboard, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { useShopBrowse } from "../lib/shop-browse";
import { DUTS } from "../lib/theme";
import type { RootStackParamList } from "../navigation/types";
import { mountSearchOverlay } from "./search-overlay";

const RECENT_KEY = "duts.search.recent";
const RECENT_LIMIT = 6;
const PANEL_GAP = 8;
const PANEL_CAP = 360;

type PanelFrame = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

type SuggestionProduct = {
  catalogProductId: string | null;
  productId: string | null;
  name: string;
  imageUrl: string | null;
  purchasable: boolean;
  fromPriceCents: number | null;
  merchantOfferCount: number;
};

type Props = {
  initialQuery?: string;
  onSubmit: (query: string) => void;
};

function shownPrice(product: SuggestionProduct) {
  if (!product.purchasable || product.fromPriceCents == null) return null;
  const amount = `$${(product.fromPriceCents / 100).toFixed(2)}`;
  return product.merchantOfferCount > 1 ? `From ${amount}` : amount;
}

async function readRecent() {
  try {
    const raw = await AsyncStorage.getItem(RECENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

async function writeRecent(items: string[]) {
  await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(items.slice(0, RECENT_LIMIT)));
}

export function StoreSearchField({ initialQuery = "", onSubmit }: Props) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const browse = useShopBrowse();
  const [q, setQ] = useState(initialQuery);
  const [debounced, setDebounced] = useState(initialQuery.trim());
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [active, setActive] = useState(-1);
  const [hiddenImages, setHiddenImages] = useState<Record<string, boolean>>({});
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [panelFrame, setPanelFrame] = useState<PanelFrame | null>(null);
  const anchorRef = useRef<View>(null);
  const { height: windowHeight } = useWindowDimensions();

  useEffect(() => {
    setQ(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(handle);
  }, [q]);

  useEffect(() => {
    if (!open) return;
    void readRecent().then(setRecent);
  }, [open]);

  const suggest = useQuery({
    queryKey: ["commerce-search-suggest", ...browse.queryKey, debounced],
    queryFn: () =>
      api.commerceNearbyProducts({ ...(browse.geo ?? {}), q: debounced, limit: 5, offset: 0 }, browse.token),
    enabled: open && debounced.length > 0 && browse.ready
  });

  const products = (suggest.data?.products ?? []) as SuggestionProduct[];
  const options = useMemo(() => {
    const rows: Array<{ key: string; kind: "recent" | "product" | "all"; label: string; product?: SuggestionProduct }> = [];
    if (!q.trim()) {
      for (const term of recent) rows.push({ key: `recent:${term}`, kind: "recent", label: term });
      return rows;
    }
    for (const product of products) {
      rows.push({
        key: `product:${product.catalogProductId ?? product.productId ?? product.name}`,
        kind: "product",
        label: product.name,
        product
      });
    }
    if (q.trim()) rows.push({ key: "all", kind: "all", label: `View all results for “${q.trim()}”` });
    return rows;
  }, [products, q, recent]);

  useEffect(() => {
    setActive(-1);
  }, [debounced, open]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const show = Keyboard.addListener("keyboardDidShow", (event) => setKeyboardHeight(event.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setPanelFrame(null);
      return;
    }
    let frame = 0;
    const measure = () => {
      const node = anchorRef.current as unknown as {
        getBoundingClientRect?: () => { top: number; left: number; bottom: number; width: number };
        measureInWindow?: (callback: (x: number, y: number, width: number, height: number) => void) => void;
      } | null;
      if (!node) return;
      if (Platform.OS === "web" && typeof document !== "undefined" && typeof window !== "undefined") {
        const anchor = document.getElementById("duts-store-search");
        const rect = anchor?.getBoundingClientRect() ?? node.getBoundingClientRect?.();
        if (!rect) return;
        const viewport = window.visualViewport;
        const viewportBottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight);
        const tabList = document.querySelector('[role="tablist"]');
        let tabTop = viewportBottom;
        if (tabList) {
          const tabStyle = getComputedStyle(tabList);
          const tabRect = tabList.getBoundingClientRect();
          const tabVisible =
            tabStyle.display !== "none" &&
            tabStyle.visibility !== "hidden" &&
            tabRect.height >= 8 &&
            tabRect.top < viewportBottom &&
            tabRect.bottom > 0;
          if (tabVisible) tabTop = tabRect.top;
        }
        const limit = Math.min(viewportBottom, tabTop);
        const available = Math.max(96, limit - rect.bottom - PANEL_GAP * 2);
        setPanelFrame({
          top: rect.bottom + PANEL_GAP,
          left: rect.left,
          width: rect.width,
          maxHeight: Math.min(PANEL_CAP, available)
        });
        return;
      }
      node.measureInWindow?.((x, y, width, height) => {
        const available = Math.max(96, windowHeight - keyboardHeight - (y + height) - PANEL_GAP * 2);
        setPanelFrame({
          top: height,
          left: 0,
          width,
          maxHeight: Math.min(PANEL_CAP, available)
        });
      });
    };
    const schedule = () => {
      frame = requestAnimationFrame(measure);
    };
    schedule();
    if (Platform.OS !== "web" || typeof window === "undefined") return () => cancelAnimationFrame(frame);
    const viewport = window.visualViewport;
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, true);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", schedule, true);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
    };
  }, [open, keyboardHeight, windowHeight, q, products.length]);

  useEffect(() => {
    if (Platform.OS !== "web" || !open || typeof document === "undefined") return;
    const close = (event: Event) => {
      const root = document.getElementById("duts-store-search");
      const panel = document.getElementById("duts-search-suggestions");
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (root?.contains(target) || panel?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  async function remember(term: string) {
    const next = term.trim();
    if (!next) return;
    const stored = await readRecent();
    const items = [next, ...stored.filter((item) => item.toLowerCase() !== next.toLowerCase())].slice(0, RECENT_LIMIT);
    await writeRecent(items);
    setRecent(items);
  }

  function submit(term = q) {
    const next = term.trim();
    if (!next) {
      onSubmit("");
      setOpen(false);
      return;
    }
    void remember(next);
    setOpen(false);
    onSubmit(next);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option) {
      submit();
      return;
    }
    if (option.kind === "recent") {
      setQ(option.label);
      submit(option.label);
      return;
    }
    if (option.kind === "all") {
      submit();
      return;
    }
    const product = option.product;
    setOpen(false);
    if (!product) return;
    navigation.navigate("ProductDetail", {
      catalogProductId: product.catalogProductId ?? undefined,
      productId: product.productId ?? undefined
    });
  }

  function onKeyPress(key: string) {
    if (key === "Escape") {
      setOpen(false);
      setActive(-1);
      return;
    }
    if (!open || options.length === 0) return;
    if (key === "ArrowDown") {
      setActive((current) => (current + 1) % options.length);
      return;
    }
    if (key === "ArrowUp") {
      setActive((current) => (current <= 0 ? options.length - 1 : current - 1));
      return;
    }
  }

  const waiting = debounced.length > 0 && (!browse.ready || (suggest.isFetching && !suggest.data));
  const failed = debounced.length > 0 && suggest.isError;

  const suggestionList = (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
      style={{ maxHeight: panelFrame?.maxHeight ?? PANEL_CAP }}
      contentContainerStyle={{ paddingVertical: 4 }}
    >
      {!q.trim() && recent.length > 0 ? (
        <View className="mb-1 flex-row items-center justify-between px-2">
          <Text className="text-xs font-bold uppercase tracking-wide text-muted">Recent searches</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear recent searches"
            onPress={() => {
              setRecent([]);
              void AsyncStorage.removeItem(RECENT_KEY);
            }}
            className="min-h-[44px] justify-center px-2"
          >
            <Text className="text-xs font-bold" style={{ color: DUTS.purple }}>
              Clear
            </Text>
          </Pressable>
        </View>
      ) : null}
      {!q.trim() && recent.length === 0 ? (
        <Text className="px-3 py-3 text-sm text-muted">Type a product name to search DUTS.</Text>
      ) : null}
      {waiting ? <Text className="px-3 py-2 text-sm text-muted">Searching…</Text> : null}
      {failed ? (
        <Text className="px-3 py-2 text-sm text-muted">Search suggestions are unavailable. You can still view all results.</Text>
      ) : null}
      {!waiting && !failed && q.trim() && suggest.isSuccess && products.length === 0 ? (
        <Text className="px-3 py-2 text-sm text-muted">No matching products.</Text>
      ) : null}
      {options.map((option, index) => {
        const price = option.product ? shownPrice(option.product) : null;
        const imageKey = option.key;
        return (
          <View key={option.key} className="flex-row items-center">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={option.label}
              accessibilityState={{ selected: active === index }}
              onPress={() => choose(index)}
              className="min-h-[44px] flex-1 flex-row items-center rounded-xl px-2 py-1.5"
              style={{ backgroundColor: active === index ? DUTS.surface : "transparent" }}
            >
              {option.kind === "product" && option.product?.imageUrl && !hiddenImages[imageKey] ? (
                <Image
                  source={{ uri: option.product.imageUrl }}
                  onError={() => setHiddenImages((current) => ({ ...current, [imageKey]: true }))}
                  style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: DUTS.surface }}
                  accessibilityIgnoresInvertColors
                />
              ) : (
                <Ionicons
                  name={option.kind === "recent" ? "time-outline" : option.kind === "all" ? "arrow-forward" : "cube-outline"}
                  size={18}
                  color={DUTS.muted}
                />
              )}
              <View className="ml-2 flex-1">
                <Text className="text-sm font-semibold text-ink" numberOfLines={1}>
                  {option.label}
                </Text>
                {price ? <Text className="text-xs font-bold text-ink">{price}</Text> : null}
              </View>
            </Pressable>
            {option.kind === "recent" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${option.label}`}
                onPress={() => {
                  const items = recent.filter((item) => item !== option.label);
                  setRecent(items);
                  void writeRecent(items);
                }}
                className="min-h-[44px] min-w-[44px] items-center justify-center"
              >
                <Ionicons name="close" size={16} color={DUTS.muted} />
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );

  const suggestionPanel =
    open && panelFrame ? (
      <View
        nativeID="duts-search-suggestions"
        accessibilityRole="menu"
        className="duts-search-panel rounded-2xl border border-border bg-card"
        style={
          Platform.OS === "web"
            ? ({
                position: "fixed",
                top: panelFrame.top,
                left: panelFrame.left,
                width: panelFrame.width,
                maxHeight: panelFrame.maxHeight,
                zIndex: 50,
                backgroundColor: DUTS.card,
                borderColor: DUTS.border,
                overflow: "hidden"
              } as object)
            : {
                position: "absolute" as const,
                top: "100%" as const,
                left: 0,
                right: 0,
                marginTop: PANEL_GAP,
                maxHeight: panelFrame.maxHeight,
                zIndex: 2,
                backgroundColor: DUTS.card,
                borderColor: DUTS.border,
                overflow: "hidden" as const
              }
        }
      >
        {suggestionList}
      </View>
    ) : null;

  return (
    <View ref={anchorRef} nativeID="duts-store-search" style={{ position: "relative", zIndex: 2 }}>
      <View className="duts-search-field flex-row items-center rounded-full border border-border bg-surface px-3.5 py-2">
        <Ionicons name="search" size={18} color={DUTS.muted} />
        <TextInput
          value={q}
          onChangeText={(value) => {
            setQ(value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search DUTS"
          placeholderTextColor={DUTS.placeholder}
          className="ml-2 min-h-[44px] flex-1 text-base text-ink"
          style={Platform.OS === "web" ? ({ outlineStyle: "none", outlineWidth: 0 } as object) : undefined}
          returnKeyType="search"
          onSubmitEditing={() => {
            if (active >= 0) choose(active);
            else submit();
          }}
          onKeyPress={(event) => onKeyPress(event.nativeEvent.key)}
          accessibilityLabel="Search products"
          accessibilityRole="search"
        />
        {Platform.OS === "web" && q.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            onPress={() => {
              setQ("");
              setOpen(true);
            }}
            className="ml-1 h-11 w-11 items-center justify-center"
          >
            <Ionicons name="close-circle" size={18} color={DUTS.muted} />
          </Pressable>
        ) : null}
      </View>
      {open && Platform.OS !== "web" ? (
        <Pressable
          accessibilityLabel="Close search suggestions"
          onPress={() => setOpen(false)}
          style={{ position: "absolute", top: "100%", left: 0, right: 0, height: panelFrame?.maxHeight ?? PANEL_CAP, zIndex: 1 }}
        />
      ) : null}
      {Platform.OS === "web" ? mountSearchOverlay(suggestionPanel) : suggestionPanel}
    </View>
  );
}
