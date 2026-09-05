import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Server render and first paint assume motion is allowed, then correct on mount.
 * Every looping animation in the marketing components is gated on this value.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const mql = window.matchMedia(QUERY);
    const sync = () => setReduced(mql.matches);
    sync();

    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", sync);
      return () => mql.removeEventListener("change", sync);
    }

    mql.addListener(sync);
    return () => mql.removeListener(sync);
  }, []);

  return reduced;
}

export default usePrefersReducedMotion;
