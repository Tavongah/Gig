export const STOREFRONT_CATEGORY_STATES = ["LIVE", "COMING_SOON", "RESTRICTED"] as const;
export type StorefrontCategoryState = (typeof STOREFRONT_CATEGORY_STATES)[number];

/**
 * Storefront category destinations.
 * LIVE catalog names still come from APPROVED CatalogProducts.
 * COMING_SOON / RESTRICTED destinations are configuration-only — no fake inventory.
 */
export type StorefrontCategoryConfig = {
  slug: string;
  label: string;
  icon: string;
  state: StorefrontCategoryState;
  sortOrder: number;
  restricted: boolean;
  featured?: boolean;
  /** Match existing catalog category names without renaming records. */
  catalogMatch?: string[];
  /** Future compliance hooks — not implemented in this task. */
  requiresAgeGate?: boolean;
  requiresLicensedMerchant?: boolean;
  requiresIdAtDelivery?: boolean;
  noUnattendedDelivery?: boolean;
};

export function parseAlcoholCommerceEnabled(value?: string | boolean | null) {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

export function slugifyStorefrontCategory(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const STOREFRONT_CATEGORIES: StorefrontCategoryConfig[] = [
  {
    slug: "groceries",
    label: "Groceries",
    icon: "basket-outline",
    state: "LIVE",
    sortOrder: 10,
    restricted: false,
    featured: true,
    catalogMatch: ["groceries", "grocery"]
  },
  {
    slug: "drinks",
    label: "Drinks",
    icon: "water-outline",
    state: "LIVE",
    sortOrder: 20,
    restricted: false,
    featured: true,
    catalogMatch: ["drinks"]
  },
  {
    slug: "household",
    label: "Household",
    icon: "home-outline",
    state: "LIVE",
    sortOrder: 30,
    restricted: false,
    featured: true,
    catalogMatch: ["household"]
  },
  {
    slug: "personal-care",
    label: "Personal Care",
    icon: "sparkles-outline",
    state: "LIVE",
    sortOrder: 40,
    restricted: false,
    featured: true,
    catalogMatch: ["personal care"]
  },
  {
    slug: "vegetables",
    label: "Vegetables",
    icon: "leaf-outline",
    state: "LIVE",
    sortOrder: 50,
    restricted: false,
    featured: true,
    catalogMatch: ["vegetables", "vegetable"]
  },
  {
    slug: "alcohol",
    label: "Alcohol",
    icon: "wine-outline",
    state: "RESTRICTED",
    sortOrder: 60,
    restricted: true,
    featured: true,
    catalogMatch: ["alcohol"],
    requiresAgeGate: true,
    requiresLicensedMerchant: true,
    requiresIdAtDelivery: true,
    noUnattendedDelivery: true
  },
  {
    slug: "fashion",
    label: "Fashion",
    icon: "shirt-outline",
    state: "COMING_SOON",
    sortOrder: 110,
    restricted: false
  },
  {
    slug: "shoes",
    label: "Shoes",
    icon: "walk-outline",
    state: "COMING_SOON",
    sortOrder: 120,
    restricted: false
  },
  {
    slug: "electronics",
    label: "Electronics",
    icon: "phone-portrait-outline",
    state: "COMING_SOON",
    sortOrder: 130,
    restricted: false
  },
  {
    slug: "auto-parts",
    label: "Auto Parts",
    icon: "car-outline",
    state: "COMING_SOON",
    sortOrder: 140,
    restricted: false
  },
  {
    slug: "home-furniture",
    label: "Home & Furniture",
    icon: "bed-outline",
    state: "COMING_SOON",
    sortOrder: 150,
    restricted: false
  },
  {
    slug: "beauty",
    label: "Beauty",
    icon: "flower-outline",
    state: "COMING_SOON",
    sortOrder: 160,
    restricted: false
  },
  {
    slug: "baby",
    label: "Baby",
    icon: "heart-outline",
    state: "COMING_SOON",
    sortOrder: 170,
    restricted: false
  },
  {
    slug: "sports-outdoors",
    label: "Sports & Outdoors",
    icon: "football-outline",
    state: "COMING_SOON",
    sortOrder: 180,
    restricted: false
  }
];

const FALLBACK_ICONS: Array<{ match: string; icon: string }> = [
  { match: "drink", icon: "water-outline" },
  { match: "juice", icon: "water-outline" },
  { match: "water", icon: "water-outline" },
  { match: "grocery", icon: "basket-outline" },
  { match: "snack", icon: "fast-food-outline" },
  { match: "dairy", icon: "nutrition-outline" },
  { match: "household", icon: "home-outline" },
  { match: "personal", icon: "sparkles-outline" },
  { match: "breakfast", icon: "sunny-outline" },
  { match: "staple", icon: "nutrition-outline" },
  { match: "vegetable", icon: "leaf-outline" },
  { match: "fruit", icon: "nutrition-outline" },
  { match: "baby", icon: "heart-outline" },
  { match: "biscuit", icon: "cafe-outline" },
  { match: "chicken", icon: "restaurant-outline" },
  { match: "meat", icon: "restaurant-outline" },
  { match: "laundry", icon: "shirt-outline" },
  { match: "cleaning", icon: "sparkles-outline" },
  { match: "bread", icon: "nutrition-outline" },
  { match: "cooking", icon: "flame-outline" },
  { match: "alcohol", icon: "wine-outline" }
];

export function storefrontCategoryIcon(name: string) {
  const configured = STOREFRONT_CATEGORIES.find(
    (c) => c.label.toLowerCase() === name.trim().toLowerCase() || c.slug === slugifyStorefrontCategory(name)
  );
  if (configured) return configured.icon;
  const hay = name.toLowerCase();
  return FALLBACK_ICONS.find((row) => hay.includes(row.match))?.icon ?? "grid-outline";
}

export function isAlcoholRestrictedCategory(name?: string | null) {
  if (!name) return false;
  const hay = name.trim().toLowerCase();
  if (hay === "alcohol" || hay.startsWith("alcohol ")) return true;
  return /\balcohol\b/.test(hay);
}

export function canPurchaseStorefrontCategory(
  name: string | null | undefined,
  alcoholCommerceEnabled: boolean
) {
  if (!isAlcoholRestrictedCategory(name)) return true;
  return alcoholCommerceEnabled;
}

export type ResolvedStorefrontCategory = StorefrontCategoryConfig & {
  catalogName?: string;
};

function matchesCatalog(config: StorefrontCategoryConfig, catalogName: string) {
  const hay = catalogName.trim().toLowerCase();
  if (hay === config.label.toLowerCase()) return true;
  return (config.catalogMatch ?? []).some((m) => hay === m || hay.startsWith(`${m} `));
}

function liveFromCatalog(name: string, sortOrder: number): ResolvedStorefrontCategory {
  return {
    slug: slugifyStorefrontCategory(name),
    label: name,
    icon: storefrontCategoryIcon(name),
    state: isAlcoholRestrictedCategory(name) ? "RESTRICTED" : "LIVE",
    sortOrder,
    restricted: isAlcoholRestrictedCategory(name),
    catalogName: name
  };
}

export function resolveStorefrontCategory(
  input: string | undefined | null,
  catalogNames: string[] = []
): ResolvedStorefrontCategory | undefined {
  const raw = input?.trim();
  if (!raw) return undefined;
  const slug = slugifyStorefrontCategory(raw);
  const configured = STOREFRONT_CATEGORIES.find(
    (c) => c.slug === slug || c.label.toLowerCase() === raw.toLowerCase()
  );
  const catalogHit = catalogNames.find(
    (name) =>
      slugifyStorefrontCategory(name) === slug ||
      name.toLowerCase() === raw.toLowerCase() ||
      (configured ? matchesCatalog(configured, name) : false)
  );

  if (configured?.state === "RESTRICTED") {
    return { ...configured, catalogName: catalogHit };
  }
  if (catalogHit) {
    if (configured?.state === "COMING_SOON") {
      return liveFromCatalog(catalogHit, configured.sortOrder);
    }
    return {
      ...(configured ?? liveFromCatalog(catalogHit, 200)),
      state: isAlcoholRestrictedCategory(catalogHit) ? "RESTRICTED" : "LIVE",
      label: catalogHit,
      catalogName: catalogHit
    };
  }
  if (configured) return { ...configured };
  return undefined;
}

export function featuredLiveCategories(catalogNames: string[]): ResolvedStorefrontCategory[] {
  const rows: ResolvedStorefrontCategory[] = [];
  for (const config of STOREFRONT_CATEGORIES.filter((c) => c.featured).sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (config.state === "RESTRICTED") {
      rows.push({ ...config, catalogName: catalogNames.find((n) => matchesCatalog(config, n)) });
      continue;
    }
    const hit = catalogNames.find((n) => matchesCatalog(config, n));
    if (hit) rows.push({ ...config, label: hit, catalogName: hit, state: "LIVE" });
  }
  return rows;
}

export function comingSoonCategories(catalogNames: string[]): ResolvedStorefrontCategory[] {
  return STOREFRONT_CATEGORIES.filter((c) => c.state === "COMING_SOON")
    .filter((c) => !catalogNames.some((n) => matchesCatalog(c, n) || n.toLowerCase() === c.label.toLowerCase()))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function allLiveCatalogCategories(catalogNames: string[]): ResolvedStorefrontCategory[] {
  const featured = featuredLiveCategories(catalogNames);
  const extra = catalogNames
    .filter((name) => !featured.some((f) => f.catalogName === name || f.label === name))
    .map((name, i) => liveFromCatalog(name, 200 + i));
  return [...featured, ...extra];
}

export function matchComingSoonFromSearch(q: string, catalogNames: string[] = []) {
  const needle = q.trim().toLowerCase();
  if (needle.length < 3) return undefined;
  const slug = slugifyStorefrontCategory(needle);
  return comingSoonCategories(catalogNames).find((c) => {
    const label = c.label.toLowerCase();
    return label === needle || c.slug === slug || label.startsWith(needle) || c.slug.startsWith(slug);
  });
}
