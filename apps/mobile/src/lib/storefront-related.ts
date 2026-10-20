import { rotateStorefrontProducts } from "./storefront-home-rotate";

const RELATED_STOPWORDS = new Set([
  "the",
  "and",
  "with",
  "for",
  "from",
  "into",
  "pack",
  "packs",
  "extra",
  "original",
  "classic",
  "regular",
  "family",
  "value",
  "fresh",
  "premium",
  "size",
  "mini",
  "max",
  "pcs",
  "piece",
  "pieces"
]);

const BROAD_CATEGORIES = new Set([
  "groceries",
  "other",
  "household",
  "personal care",
  "staples",
  "student / everyday essentials",
  "cooking ingredients"
]);

export const MORE_LIKE_THIS_LIMIT = 10;

export type RelatedSeed = {
  catalogProductId?: string | null;
  productId?: string | null;
  name: string;
  brand?: string | null;
  category?: string | null;
  sizeLabel?: string | null;
};

export function relatedProductTokens(...parts: Array<string | null | undefined>): string[] {
  const raw = parts.filter(Boolean).join(" ").toLowerCase();
  const words = raw
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !RELATED_STOPWORDS.has(w) && !/^\d+$/.test(w));
  return [...new Set(words)];
}

export function relatedSearchQuery(seed: RelatedSeed): string {
  return relatedProductTokens(seed.name, seed.brand).slice(0, 3).join(" ");
}

function relatedKey(p: RelatedSeed): string {
  if (p.catalogProductId) return `c:${p.catalogProductId}`;
  if (p.productId) return `p:${p.productId}`;
  return `n:${(p.name ?? "").toLowerCase()}|${(p.brand ?? "").toLowerCase()}|${(p.sizeLabel ?? "").toLowerCase()}`;
}

function isBroadCategory(category?: string | null): boolean {
  return BROAD_CATEGORIES.has((category ?? "").trim().toLowerCase());
}

export function moreLikeThisScore(seed: RelatedSeed, candidate: RelatedSeed): number {
  const seedCat = (seed.category ?? "").trim().toLowerCase();
  const candCat = (candidate.category ?? "").trim().toLowerCase();
  const sameCategory = Boolean(seedCat && candCat && seedCat === candCat);
  const seedBrand = (seed.brand ?? "").trim().toLowerCase();
  const candBrand = (candidate.brand ?? "").trim().toLowerCase();
  const sameBrand = Boolean(seedBrand && candBrand && seedBrand === candBrand);
  const seedTokens = relatedProductTokens(seed.name);
  const candTokens = new Set(relatedProductTokens(candidate.name, candidate.brand));
  let shared = 0;
  for (const t of seedTokens) if (candTokens.has(t)) shared += 1;

  if (!sameCategory && !shared && !sameBrand) return 0;
  if (isBroadCategory(seed.category) && !shared && !sameBrand) return 0;

  let score = 0;
  if (sameCategory) score += 80;
  score += shared * 50;
  if (sameBrand) score += 30;
  return score;
}

export function pickMoreLikeThis<T extends RelatedSeed>(input: {
  seed: RelatedSeed;
  candidates: readonly T[];
  visitSeed: number;
  limit?: number;
}): T[] {
  const limit = input.limit ?? MORE_LIKE_THIS_LIMIT;
  const self = relatedKey(input.seed);
  const seen = new Set<string>([self]);
  const scored: { item: T; score: number }[] = [];
  for (const candidate of input.candidates) {
    const key = relatedKey(candidate);
    if (seen.has(key)) continue;
    const score = moreLikeThisScore(input.seed, candidate);
    if (score <= 0) continue;
    seen.add(key);
    scored.push({ item: candidate, score });
  }
  scored.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  const groups = new Map<number, T[]>();
  for (const row of scored) {
    const list = groups.get(row.score) ?? [];
    list.push(row.item);
    groups.set(row.score, list);
  }
  const ordered: T[] = [];
  for (const score of [...groups.keys()].sort((a, b) => b - a)) {
    ordered.push(...rotateStorefrontProducts(groups.get(score) ?? [], input.visitSeed, score));
  }
  return ordered.slice(0, limit);
}
