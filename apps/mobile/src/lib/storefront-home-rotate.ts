const SESSION_KEY = "duts.storefront.visitSeed";

let memorySeed: number | null = null;

function newVisitSeed(): number {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      if (buf[0]) return buf[0] >>> 0;
    }
  } catch {
    /* private mode / non-browser */
  }
  return (Date.now() ^ 0x9e3779b9) >>> 0;
}

/** One seed per storefront visit/session. Not regenerated on React re-renders. */
export function storefrontVisitSeed(): number {
  if (memorySeed != null) return memorySeed;
  try {
    if (typeof sessionStorage !== "undefined") {
      const existing = sessionStorage.getItem(SESSION_KEY);
      if (existing) {
        const n = Number(existing);
        if (Number.isFinite(n) && n !== 0) {
          memorySeed = n >>> 0;
          return memorySeed;
        }
      }
      const seed = newVisitSeed() || 1;
      sessionStorage.setItem(SESSION_KEY, String(seed));
      memorySeed = seed;
      return seed;
    }
  } catch {
    /* native / storage blocked */
  }
  memorySeed = newVisitSeed() || 1;
  return memorySeed;
}

/** Deterministic Fisher–Yates. Does not mutate `items` or product identities. */
export function rotateStorefrontProducts<T>(items: readonly T[], seed: number, salt = 0): T[] {
  const out = items.slice();
  let s = (seed + salt) >>> 0;
  if (s === 0) s = 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}
