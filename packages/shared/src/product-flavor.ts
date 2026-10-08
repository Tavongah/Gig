/**
 * DUTS product flavor options V1.
 * Flavor is an optional preference. Missing selection = ANY, never a silent default SKU.
 * Flag default OFF until physical E2E.
 */

export function parseProductFlavorOptionsEnabled(value?: string | boolean | null): boolean {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  if (!v) return false;
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

export const FLAVOR_PREFERENCES = ["ANY", "SPECIFIC"] as const;
export type FlavorPreference = (typeof FLAVOR_PREFERENCES)[number];

export type FlavorOptionPublic = {
  id: string;
  name: string;
  sortOrder: number;
};

export function normalizeFlavorName(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cartLineIdentity(productId: string, flavorOptionId?: string | null): string {
  return `${productId}::${flavorOptionId?.trim() || "ANY"}`;
}

export function resolveFlavorPreference(input: {
  flavorOptionId?: string | null;
  flavorPreference?: string | null;
}): FlavorPreference | null {
  const explicit = String(input.flavorPreference ?? "")
    .trim()
    .toUpperCase();
  if (explicit === "ANY") return "ANY";
  if (explicit === "SPECIFIC") return "SPECIFIC";
  if (input.flavorOptionId) return "SPECIFIC";
  return null;
}

/** Customer-facing line. Null when the product has no flavor support. */
export function formatFlavorCustomerLine(
  preference: FlavorPreference | string | null | undefined,
  flavorName?: string | null
): string | null {
  if (!preference) return null;
  if (preference === "SPECIFIC" && flavorName?.trim()) return `Flavor: ${flavorName.trim()}`;
  if (preference === "ANY") return "Flavor: Any";
  return null;
}

/** Merchant/courier line. Null when the product has no flavor support. */
export function formatFlavorFulfillmentLine(
  preference: FlavorPreference | string | null | undefined,
  flavorName?: string | null
): string | null {
  if (!preference) return null;
  if (preference === "SPECIFIC" && flavorName?.trim()) {
    return `FLAVOR: ${flavorName.trim().toUpperCase()}`;
  }
  if (preference === "ANY") return "FLAVOR: ANY";
  return null;
}

const SKIP_FLAVOR_TOKENS = new Set([
  "i",
  "want",
  "please",
  "the",
  "a",
  "an",
  "and",
  "of",
  "for",
  "pack",
  "bottle",
  "bottles",
  "ml",
  "l",
  "ltr",
  "litre",
  "liter",
  "kg",
  "g",
  "x",
  "qty",
  "quantity"
]);

export function matchFlavorFromText(
  query: string,
  flavors: FlavorOptionPublic[]
): FlavorOptionPublic | null {
  const hay = normalizeFlavorName(query);
  if (!hay || !flavors.length) return null;
  const ranked = [...flavors].sort((a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name));
  for (const flavor of ranked) {
    const needle = normalizeFlavorName(flavor.name);
    if (!needle) continue;
    if (hay === needle || hay.includes(` ${needle} `) || hay.startsWith(`${needle} `) || hay.endsWith(` ${needle}`)) {
      return flavor;
    }
    if (hay.includes(needle) && needle.length >= 3) return flavor;
  }
  return null;
}

export function isFlavorInquiry(text: string): boolean {
  const t = String(text ?? "")
    .toLowerCase()
    .replace(/[?.!]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return false;
  return (
    /what flavou?rs?( do you have)?/.test(t) ||
    /which flavou?rs?/.test(t) ||
    /flavou?rs? (do you have|available|please)/.test(t) ||
    /^(flavou?rs?|any flavou?r)$/.test(t)
  );
}

export function unmatchedFlavorMention(
  query: string,
  productName: string,
  flavors: FlavorOptionPublic[]
): string | null {
  const queryTokens = normalizeFlavorName(query).split(" ").filter(Boolean);
  const nameTokens = new Set(normalizeFlavorName(productName).split(" ").filter(Boolean));
  const flavorNames = new Set(flavors.map((f) => normalizeFlavorName(f.name)).filter(Boolean));
  for (const tok of queryTokens) {
    if (tok.length < 3) continue;
    if (SKIP_FLAVOR_TOKENS.has(tok)) continue;
    if (/^\d/.test(tok)) continue;
    if (nameTokens.has(tok)) continue;
    if (flavorNames.has(tok)) continue;
    if ([...flavorNames].some((n) => n.includes(tok) || tok.includes(n))) continue;
    return tok;
  }
  return null;
}

export function merchantCanFulfillFlavor(input: {
  flavorOptionId?: string | null;
  flavorPreference?: FlavorPreference | string | null;
  unavailableFlavorIds?: Iterable<string>;
  activeFlavorIds?: Iterable<string>;
}): boolean {
  const unavailable = new Set(input.unavailableFlavorIds ?? []);
  const active = [...(input.activeFlavorIds ?? [])];
  const preference = resolveFlavorPreference({
    flavorOptionId: input.flavorOptionId,
    flavorPreference: input.flavorPreference
  });
  if (!active.length) return true;
  if (!preference || preference === "ANY") {
    return active.some((id) => !unavailable.has(id));
  }
  if (preference === "SPECIFIC" && input.flavorOptionId) {
    if (!active.includes(input.flavorOptionId)) return false;
    return !unavailable.has(input.flavorOptionId);
  }
  return active.some((id) => !unavailable.has(id));
}
