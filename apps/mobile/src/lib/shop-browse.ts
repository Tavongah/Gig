import { useEffect } from "react";
import { useSessionStore } from "../stores/session.store";
import { useShopLocationStore } from "../stores/shop-location.store";
import { useShopAreaStore } from "../stores/shop-area.store";
import type { CommerceBrowseGeo } from "./api";

export function useShopBrowse() {
  const session = useSessionStore((s) => s.session);
  const token = session?.token;
  const userId = session?.user.id;
  const exact = useShopLocationStore((s) => s.location);
  const exactHydrated = useShopLocationStore((s) => s.hydrated);
  const hydrateExact = useShopLocationStore((s) => s.hydrate);
  const area = useShopAreaStore((s) => s.area);
  const areaHydrated = useShopAreaStore((s) => s.hydrated);
  const hydrateArea = useShopAreaStore((s) => s.hydrate);

  useEffect(() => {
    if (session) void hydrateExact(userId);
    else void hydrateArea();
  }, [session, userId, hydrateExact, hydrateArea]);

  const isGuest = !session;
  const ready = isGuest ? areaHydrated : exactHydrated;
  const geo: CommerceBrowseGeo | null = isGuest
    ? area
      ? { areaId: area.id }
      : null
    : exact
      ? { lat: exact.latitude, lng: exact.longitude }
      : null;

  return {
    isGuest,
    token,
    ready,
    area,
    exact,
    geo,
    queryKey: isGuest ? (["area", area?.id] as const) : (["exact", exact?.latitude, exact?.longitude] as const)
  };
}
