import { normalizeProductSearchName } from "./commerce.js";

/**
 * Canonical CatalogProduct.category labels.
 * Union of production catalog values, admin picker labels, and storefront destinations.
 * Classifier output is always one of these strings (or null when unsure).
 */
export const CANONICAL_CATALOG_CATEGORIES = [
  "Drinks",
  "Soft Drinks",
  "Juices",
  "Energy Drinks",
  "Water",
  "Mahewu",
  "Alcohol",
  "Bread & Bakery",
  "Baking",
  "Biscuits",
  "Dairy",
  "Dairy & Eggs",
  "Snacks",
  "Sweets",
  "Groceries",
  "Staples",
  "Cooking Ingredients",
  "Convenience Foods",
  "Tinned Foods",
  "Breakfast",
  "Household",
  "Household Cleaning",
  "Laundry",
  "Personal Care",
  "Feminine Hygiene",
  "Beauty",
  "Baby Products",
  "Baby",
  "Vegetables",
  "Fruit",
  "Beef",
  "Chicken",
  "Pork",
  "Fish & Protein",
  "Student / Everyday Essentials",
  "Shoes",
  "Fashion",
  "Electronics",
  "Auto Parts",
  "Home & Furniture",
  "Sports & Outdoors",
  "Other"
] as const;

export type CanonicalCatalogCategory = (typeof CANONICAL_CATALOG_CATEGORIES)[number];
export type CategoryConfidence = "HIGH" | "MEDIUM" | "LOW";

export type CatalogCategoryInput = {
  name?: string | null;
  brand?: string | null;
  description?: string | null;
  category?: string | null;
  subcategory?: string | null;
  sizeLabel?: string | null;
};

export type CatalogCategoryClassification = {
  currentCategory: string;
  suggestedCategory: string | null;
  confidence: CategoryConfidence;
  evidence: string[];
  agrees: boolean;
  appliedWouldChange: boolean;
};

type CategorySignals = {
  category: CanonicalCatalogCategory;
  type: string[];
  brand?: string[];
};

const CATEGORY_FAMILIES: Record<string, CanonicalCatalogCategory[]> = {
  drinks: ["Drinks", "Soft Drinks", "Juices", "Energy Drinks", "Water", "Mahewu", "Alcohol"],
  bakery: ["Bread & Bakery", "Baking", "Biscuits"],
  dairy: ["Dairy", "Dairy & Eggs"],
  snacks: ["Snacks", "Sweets", "Biscuits"],
  grocery: ["Groceries", "Staples", "Cooking Ingredients", "Convenience Foods", "Tinned Foods", "Breakfast"],
  household: ["Household", "Household Cleaning", "Laundry"],
  personal: ["Personal Care", "Feminine Hygiene", "Beauty"],
  baby: ["Baby Products", "Baby"],
  produce: ["Vegetables", "Fruit"],
  protein: ["Beef", "Chicken", "Pork", "Fish & Protein"],
  shoes: ["Shoes"],
  fashion: ["Fashion"],
  electronics: ["Electronics"],
  auto: ["Auto Parts"],
  furniture: ["Home & Furniture"],
  sports: ["Sports & Outdoors"],
  student: ["Student / Everyday Essentials"],
  other: ["Other"]
};

/**
 * Type tokens are stronger than brands. Vocabulary is taken from real DUTS
 * catalog names / storefront destinations — not a speculative dictionary.
 */
const CATEGORY_SIGNALS: CategorySignals[] = [
  {
    category: "Shoes",
    type: [
      "shoe",
      "shoes",
      "sneaker",
      "sneakers",
      "trainer",
      "trainers",
      "boot",
      "boots",
      "sandal",
      "sandals",
      "slipper",
      "slippers",
      "loafer",
      "loafers",
      "footwear",
      "slides",
      "crocs",
      "crocks",
      "flipflop",
      "flipflops"
    ],
    brand: ["nike", "adidas", "puma", "vans", "asics", "timberland", "yeezy"]
  },
  {
    category: "Fashion",
    type: ["shirt", "shirts", "dress", "jeans", "hoodie", "jacket", "trousers", "socks", "clothing", "apparel"]
  },
  {
    category: "Bread & Bakery",
    type: ["bread", "loaf", "loaves", "bun", "buns", "bakery", "mandasi"]
  },
  {
    category: "Drinks",
    type: ["drink", "drinks", "beverage", "cola", "squash", "cordial"]
  },
  {
    category: "Soft Drinks",
    type: ["cola", "soft drink", "soft drinks"]
  },
  {
    category: "Juices",
    type: ["juice", "juices"]
  },
  {
    category: "Energy Drinks",
    type: ["energy drink", "energy drinks"]
  },
  {
    category: "Mahewu",
    type: ["mahewu", "maheu"]
  },
  {
    category: "Alcohol",
    type: ["wine", "whisky", "whiskey", "lager", "cider", "alcohol"]
  },
  {
    category: "Personal Care",
    type: [
      "shampoo",
      "lotion",
      "toothpaste",
      "deodorant",
      "soap",
      "body wash",
      "bubble bath",
      "toiletry",
      "toiletries"
    ]
  },
  {
    category: "Feminine Hygiene",
    type: ["tampon", "tampons", "sanitary"]
  },
  {
    category: "Beauty",
    type: ["lipstick", "mascara", "makeup"]
  },
  {
    category: "Household",
    type: ["bleach", "disinfectant", "mop", "broom"]
  },
  {
    category: "Laundry",
    type: ["laundry", "detergent", "washing powder"]
  },
  {
    category: "Snacks",
    type: ["snack", "snacks", "crisps"]
  },
  {
    category: "Biscuits",
    type: ["biscuit", "biscuits"]
  },
  {
    category: "Dairy",
    type: ["yoghurt", "yogurt", "ice cream", "icecream"]
  },
  {
    category: "Dairy & Eggs",
    type: ["eggs"]
  },
  {
    category: "Baby Products",
    type: ["diaper", "diapers", "nappy", "nappies", "baby wipes", "baby powder"]
  },
  {
    category: "Vegetables",
    type: ["vegetable", "vegetables", "cabbage", "spinach"]
  },
  {
    category: "Fish & Protein",
    type: ["kapenta", "matemba"]
  },
  {
    category: "Breakfast",
    type: ["cereal", "porridge", "branflakes", "cornflakes"]
  },
  {
    category: "Staples",
    type: ["mealie", "cooking oil"]
  },
  {
    category: "Tinned Foods",
    type: ["baked beans"]
  },
  {
    category: "Convenience Foods",
    type: ["noodles"]
  },
  {
    category: "Student / Everyday Essentials",
    type: ["exercise book", "counter book", "stationery", "notebook"]
  },
  {
    category: "Electronics",
    type: ["charger", "earphones", "earphone", "headphone", "headphones", "phone case"]
  }
];

const GENERIC_DESCRIPTION = /everyday zimbabwe household shopping/i;

/** Compound names where a type token is not the product type. */
const TYPE_NEGATIVES: Record<string, string[]> = {
  bread: ["short bread", "shortbread"]
};

const TYPE_WEIGHT = 4;
const BRAND_WEIGHT = 1;
const DESC_WEIGHT = 1;

function canonicalLabel(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  const hit = CANONICAL_CATALOG_CATEGORIES.find((c) => c.toLowerCase() === trimmed.toLowerCase());
  return hit ?? trimmed;
}

function familiesOf(category: string): string[] {
  const label = canonicalLabel(category);
  if (!label) return [];
  return Object.entries(CATEGORY_FAMILIES)
    .filter(([, members]) => members.some((m) => m.toLowerCase() === label.toLowerCase()))
    .map(([family]) => family);
}

function familyOf(category: string): string | null {
  return familiesOf(category)[0] ?? null;
}

export function sameCatalogCategoryFamily(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = canonicalLabel(a);
  const right = canonicalLabel(b);
  if (!left || !right) return false;
  if (left.toLowerCase() === right.toLowerCase()) return true;
  const fa = familiesOf(left);
  const fb = new Set(familiesOf(right));
  return fa.some((family) => fb.has(family));
}

function tokenSet(text: string): { words: Set<string>; joined: string } {
  const joined = normalizeProductSearchName(text);
  return { words: new Set(joined.split(" ").filter(Boolean)), joined };
}

function signalHits(hay: { words: Set<string>; joined: string }, signal: string): boolean {
  const needle = normalizeProductSearchName(signal);
  if (!needle) return false;
  if (needle.includes(" ")) return hay.joined.includes(needle);
  return hay.words.has(needle);
}

function descriptionHay(description: string | null | undefined): { words: Set<string>; joined: string } | null {
  const raw = (description ?? "").trim();
  if (!raw || GENERIC_DESCRIPTION.test(raw)) return null;
  return tokenSet(raw);
}

export function classifyCatalogCategory(input: CatalogCategoryInput): CatalogCategoryClassification {
  const currentCategory = canonicalLabel(input.category) || (input.category ?? "").trim();
  const nameHay = tokenSet([input.name, input.sizeLabel, input.subcategory].filter(Boolean).join(" "));
  const brandHay = tokenSet(input.brand ?? "");
  const descHay = descriptionHay(input.description);

  const scores = new Map<string, { score: number; evidence: string[] }>();

  const add = (category: string, amount: number, evidence: string) => {
    const row = scores.get(category) ?? { score: 0, evidence: [] };
    row.score += amount;
    if (!row.evidence.includes(evidence)) row.evidence.push(evidence);
    scores.set(category, row);
  };

  for (const spec of CATEGORY_SIGNALS) {
    for (const type of spec.type) {
      const blocked = (TYPE_NEGATIVES[type] ?? []).some((phrase) => signalHits(nameHay, phrase) || signalHits(brandHay, phrase));
      if (blocked) continue;
      if (signalHits(nameHay, type)) add(spec.category, TYPE_WEIGHT, type);
      else if (signalHits(brandHay, type)) add(spec.category, TYPE_WEIGHT, type);
      else if (descHay && signalHits(descHay, type)) add(spec.category, DESC_WEIGHT, type);
    }
    for (const brand of spec.brand ?? []) {
      if (signalHits(nameHay, brand) || signalHits(brandHay, brand)) {
        add(spec.category, BRAND_WEIGHT, brand);
      }
    }
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
  const familyScores = new Map<string, { score: number; category: string; evidence: string[] }>();
  for (const [category, row] of ranked) {
    const family = familyOf(category) ?? category.toLowerCase();
    const existing = familyScores.get(family);
    if (!existing || row.score > existing.score) {
      familyScores.set(family, { score: row.score, category, evidence: row.evidence });
    }
  }
  const rankedFamilies = [...familyScores.entries()].sort((a, b) => b[1].score - a[1].score);
  const topFamily = rankedFamilies[0];
  const secondFamily = rankedFamilies[1];
  const topScore = topFamily?.[1].score ?? 0;
  const secondScore = secondFamily?.[1].score ?? 0;
  const margin = topScore - secondScore;
  const topCategory = topFamily?.[1].category ?? null;
  const typeInName = Boolean(
    topCategory &&
      CATEGORY_SIGNALS.find((s) => s.category === topCategory)?.type.some((type) => signalHits(nameHay, type))
  );

  const preferredByFamily: Record<string, string> = {
    drinks: "Drinks",
    bakery: "Bread & Bakery",
    dairy: "Dairy",
    snacks: "Snacks",
    grocery: "Groceries",
    household: "Household",
    personal: "Personal Care",
    baby: "Baby Products",
    produce: "Vegetables",
    protein: "Chicken",
    shoes: "Shoes",
    fashion: "Fashion",
    electronics: "Electronics",
    student: "Student / Everyday Essentials"
  };

  let suggestedCategory: string | null = null;
  let confidence: CategoryConfidence = "LOW";
  if (topFamily && topScore >= 2 && topCategory) {
    const familyKey = topFamily[0];
    const preferred = preferredByFamily[familyKey];
    const preferredScore = preferred ? scores.get(preferred)?.score ?? 0 : 0;
    suggestedCategory = preferred && preferredScore > 0 ? preferred : topCategory;
    if (typeInName && topScore >= 4 && margin >= 2) confidence = "HIGH";
    else if (topScore >= 3 && margin >= 2) confidence = "MEDIUM";
    else confidence = "LOW";
    if (secondFamily && margin < 2 && secondScore >= 3) confidence = "LOW";
  }

  const agrees = suggestedCategory
    ? sameCatalogCategoryFamily(currentCategory, suggestedCategory)
    : !suggestedCategory;
  const appliedWouldChange = Boolean(
    confidence === "HIGH" && suggestedCategory && currentCategory && !agrees
  );

  return {
    currentCategory,
    suggestedCategory,
    confidence,
    evidence: topFamily?.[1].evidence.slice(0, 8) ?? [],
    agrees: Boolean(agrees && suggestedCategory),
    appliedWouldChange
  };
}

export function applyFutureCatalogCategory(
  input: CatalogCategoryInput,
  classify: (value: CatalogCategoryInput) => CatalogCategoryClassification = classifyCatalogCategory
): { category: string; classification: CatalogCategoryClassification; applied: boolean } {
  const fallback = (input.category ?? "").trim() || "Other";
  try {
    const classification = classify(input);
    if (classification.appliedWouldChange && classification.suggestedCategory) {
      return { category: classification.suggestedCategory, classification, applied: true };
    }
    return { category: fallback, classification, applied: false };
  } catch {
    return {
      category: fallback,
      classification: {
        currentCategory: fallback,
        suggestedCategory: null,
        confidence: "LOW",
        evidence: ["classifier-error"],
        agrees: false,
        appliedWouldChange: false
      },
      applied: false
    };
  }
}

export function summarizeCategoryClassifications(rows: CatalogCategoryClassification[]) {
  const summary = {
    productsChecked: rows.length,
    categoryAgrees: 0,
    highConfidenceMismatches: 0,
    mediumConfidenceMismatches: 0,
    lowUnsure: 0,
    noSignal: 0
  };
  for (const row of rows) {
    if (!row.suggestedCategory && row.confidence === "LOW") {
      summary.noSignal += 1;
      continue;
    }
    if (row.agrees) {
      summary.categoryAgrees += 1;
      continue;
    }
    if (row.confidence === "HIGH") summary.highConfidenceMismatches += 1;
    else if (row.confidence === "MEDIUM") summary.mediumConfidenceMismatches += 1;
    else summary.lowUnsure += 1;
  }
  return summary;
}
