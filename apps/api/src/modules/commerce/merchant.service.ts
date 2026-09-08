import {
  DEFAULT_MARKETPLACE_MERCHANT_RADIUS_KM,
  distanceKmBetween,
  expandSearchTerms,
  normalizeProductSearchName,
  upsertProductSchema,
  type RequestedShoppingItem
} from "@gigflow/shared";
import { MerchantCategory, type Merchant, type Product } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import { normalizePhoneNumber } from "../auth/access.service.js";

export function normalizeMerchantPhone(phone: string): string {
  return normalizePhoneNumber(phone);
}

export async function getMarketplaceSettings() {
  const settings = await prisma.platformSetting.findUnique({ where: { id: "default" } });
  return {
    merchantRadiusKm: settings
      ? Number(settings.marketplaceMerchantRadiusKm)
      : DEFAULT_MARKETPLACE_MERCHANT_RADIUS_KM,
    serviceFeeCents: settings?.marketplaceServiceFeeCents ?? 0,
    merchantCommissionRate: settings ? Number(settings.marketplaceMerchantCommissionRate) : 0.1
  };
}

export async function createMerchant(input: {
  name: string;
  contactName: string;
  phone: string;
  whatsappPhone: string;
  locationLabel: string;
  latitude: number;
  longitude: number;
  category?: MerchantCategory;
  logoUrl?: string;
  openingHours?: string;
  ownerUserId?: string;
}) {
  const whatsappPhone = normalizeMerchantPhone(input.whatsappPhone);
  const existing = await prisma.merchant.findUnique({ where: { whatsappPhone } });
  if (existing) {
    throw new AppError("A merchant is already linked to this WhatsApp number.", 409, "MERCHANT_PHONE_TAKEN");
  }

  return prisma.merchant.create({
    data: {
      name: input.name.trim(),
      contactName: input.contactName.trim(),
      phone: normalizeMerchantPhone(input.phone),
      whatsappPhone,
      locationLabel: input.locationLabel.trim(),
      latitude: input.latitude,
      longitude: input.longitude,
      category: input.category ?? MerchantCategory.TUCK_SHOP,
      logoUrl: input.logoUrl,
      openingHours: input.openingHours,
      ownerUserId: input.ownerUserId,
      isActive: true,
      acceptsOrders: true
    }
  });
}

export async function findMerchantByWhatsApp(phone: string): Promise<Merchant | null> {
  return prisma.merchant.findUnique({
    where: { whatsappPhone: normalizeMerchantPhone(phone) }
  });
}

/** Require an active merchant authorized for this WhatsApp number before catalog/order mutations. */
export async function requireAuthorizedMerchant(phone: string): Promise<Merchant> {
  const merchant = await findMerchantByWhatsApp(phone);
  if (!merchant || !merchant.isActive) {
    throw new AppError(
      "This WhatsApp number is not linked to an active DUTS merchant. Ask admin to onboard your shop first.",
      403,
      "MERCHANT_NOT_AUTHORIZED"
    );
  }
  return merchant;
}

export async function setMerchantAcceptsOrders(merchantId: string, acceptsOrders: boolean) {
  return prisma.merchant.update({
    where: { id: merchantId },
    data: { acceptsOrders }
  });
}

export async function upsertProductForMerchant(
  merchantId: string,
  input: unknown,
  productId?: string
) {
  const parsed = upsertProductSchema.parse(input);
  const normalizedName = normalizeProductSearchName(parsed.name);
  const aliases = [
    ...new Set([
      ...(parsed.searchAliases ?? []).map((a: string) => normalizeProductSearchName(a)),
      ...expandSearchTerms(parsed.name)
    ])
  ].filter(Boolean);

  if (productId) {
    const existing = await prisma.product.findFirst({ where: { id: productId, merchantId } });
    if (!existing) throw new AppError("Product not found.", 404, "PRODUCT_NOT_FOUND");
    return prisma.product.update({
      where: { id: productId },
      data: {
        name: parsed.name.trim(),
        normalizedName,
        description: parsed.description,
        category: parsed.category,
        priceCents: parsed.priceCents,
        currency: parsed.currency,
        available: parsed.available,
        quantityApprox: parsed.quantityApprox,
        unit: parsed.unit,
        imageUrl: parsed.imageUrl,
        searchAliases: aliases
      }
    });
  }

  return prisma.product.create({
    data: {
      merchantId,
      name: parsed.name.trim(),
      normalizedName,
      description: parsed.description,
      category: parsed.category,
      priceCents: parsed.priceCents,
      currency: parsed.currency,
      available: parsed.available,
      quantityApprox: parsed.quantityApprox,
      unit: parsed.unit,
      imageUrl: parsed.imageUrl,
      searchAliases: aliases
    }
  });
}

export async function setProductAvailability(merchantId: string, productId: string, available: boolean) {
  const product = await prisma.product.findFirst({ where: { id: productId, merchantId, archived: false } });
  if (!product) throw new AppError("Product not found.", 404, "PRODUCT_NOT_FOUND");
  return prisma.product.update({ where: { id: productId }, data: { available } });
}

export async function archiveProduct(merchantId: string, productId: string) {
  const product = await prisma.product.findFirst({ where: { id: productId, merchantId } });
  if (!product) throw new AppError("Product not found.", 404, "PRODUCT_NOT_FOUND");
  return prisma.product.update({ where: { id: productId }, data: { archived: true, available: false } });
}

export async function listMerchantProducts(merchantId: string, includeUnavailable = true) {
  return prisma.product.findMany({
    where: {
      merchantId,
      archived: false,
      ...(includeUnavailable ? {} : { available: true })
    },
    orderBy: { name: "asc" }
  });
}

export async function findNearbyMerchants(lat: number, lng: number, radiusKm?: number) {
  const settings = await getMarketplaceSettings();
  const maxKm = radiusKm ?? settings.merchantRadiusKm;
  const merchants = await prisma.merchant.findMany({
    where: { isActive: true, acceptsOrders: true }
  });
  return merchants
    .map((m) => ({
      merchant: m,
      distanceKm: distanceKmBetween(
        { latitude: lat, longitude: lng },
        { latitude: Number(m.latitude), longitude: Number(m.longitude) }
      )
    }))
    .filter((row) => row.distanceKm <= maxKm + 1e-6)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

export type ProductMatch = {
  product: Product;
  merchant: Merchant;
  distanceKm: number;
  score: number;
};

function scoreProductMatch(product: Product, query: string): number {
  const terms = expandSearchTerms(query);
  const normalizedQuery = normalizeProductSearchName(query);
  const hay = `${product.normalizedName} ${product.searchAliases.join(" ")}`;
  let score = 0;
  for (const t of terms) {
    if (!t) continue;
    if (hay === t || product.normalizedName === t) score += 100;
    else if (hay.includes(t)) score += 40;
    else if (t.includes(product.normalizedName) && product.normalizedName.length >= 3) score += 20;
    else {
      // Light typo tolerance: edit distance ≤ 1 for tokens length ≥ 4
      const tokens = hay.split(/\s+/);
      for (const tok of tokens) {
        if (tok.length >= 4 && t.length >= 4 && editDistanceAtMost1(tok, t)) {
          score += 25;
          break;
        }
      }
    }
  }
  // Size hints: 2l / 500ml
  if (/\b2l\b/.test(normalizedQuery) && /\b2\s*l\b|\b2l\b/.test(hay)) score += 15;
  if (/\b1l\b/.test(normalizedQuery) && /\b1\s*l\b|\b1l\b/.test(hay)) score += 15;
  if (/\b500/.test(normalizedQuery) && /500/.test(hay)) score += 15;
  return score;
}

function editDistanceAtMost1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  if (i < a.length || j < b.length) edits += 1;
  return edits <= 1;
}

/** Safe unmatched-term log for catalog improvement (no PII beyond coords region). */
export async function logUnmatchedSearch(query: string, lat: number, lng: number): Promise<void> {
  const { logDutsFlow } = await import("../../lib/flow-log.js");
  logDutsFlow("WHATSAPP_SEARCH", {
    query: normalizeProductSearchName(query).slice(0, 80),
    matchType: "NO_MATCH",
    lat: Math.round(lat * 100) / 100,
    lng: Math.round(lng * 100) / 100
  });
}

/** Search real catalog products only — never invents products. */
export async function searchProductsNear(
  lat: number,
  lng: number,
  query: string,
  opts?: { merchantId?: string; availableOnly?: boolean }
): Promise<ProductMatch[]> {
  const nearby = opts?.merchantId
    ? (
        await prisma.merchant.findMany({
          where: { id: opts.merchantId, isActive: true }
        })
      ).map((m) => ({
        merchant: m,
        distanceKm: distanceKmBetween(
          { latitude: lat, longitude: lng },
          { latitude: Number(m.latitude), longitude: Number(m.longitude) }
        )
      }))
    : await findNearbyMerchants(lat, lng);

  if (nearby.length === 0) return [];

  const merchantIds = nearby.map((n) => n.merchant.id);
  const products = await prisma.product.findMany({
    where: {
      merchantId: { in: merchantIds },
      archived: false,
      ...(opts?.availableOnly === false ? {} : { available: true })
    },
    include: { merchant: true }
  });

  const merchantDist = new Map(nearby.map((n) => [n.merchant.id, n.distanceKm]));
  const matches: ProductMatch[] = [];
  for (const product of products) {
    const score = scoreProductMatch(product, query);
    if (score <= 0) continue;
    matches.push({
      product,
      merchant: product.merchant,
      distanceKm: merchantDist.get(product.merchantId) ?? 99,
      score
    });
  }

  return matches.sort((a, b) => b.score - a.score || a.distanceKm - b.distanceKm);
}

export type BasketLine = {
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  merchantId: string;
};

/**
 * Prefer ONE merchant that can fulfill the entire requested basket.
 * Does not split across shops.
 * If preferredMerchantId can still fulfill, keep it; otherwise switch to closest full cover.
 */
export async function buildOneStoreBasket(
  lat: number,
  lng: number,
  requested: RequestedShoppingItem[],
  opts?: { preferredMerchantId?: string }
): Promise<{
  ok: true;
  merchant: Merchant;
  distanceKm: number;
  lines: BasketLine[];
  missing: string[];
  switchedFromPreferred: boolean;
} | {
  ok: false;
  missing: string[];
  partialByMerchant: Array<{ merchant: Merchant; covered: string[]; missing: string[] }>;
}> {
  const nearby = await findNearbyMerchants(lat, lng);
  if (nearby.length === 0) {
    return { ok: false, missing: requested.map((r) => r.query), partialByMerchant: [] };
  }

  const evaluations = [];
  for (const { merchant, distanceKm } of nearby) {
    const lines: BasketLine[] = [];
    const missing: string[] = [];
    const covered: string[] = [];

    for (const item of requested) {
      const matches = await searchProductsNear(lat, lng, item.query, {
        merchantId: merchant.id,
        availableOnly: true
      });
      const best = matches[0];
      if (!best) {
        missing.push(item.query);
        continue;
      }
      covered.push(item.query);
      lines.push({
        productId: best.product.id,
        productName: best.product.name,
        quantity: item.quantity,
        unitPriceCents: best.product.priceCents,
        lineTotalCents: best.product.priceCents * item.quantity,
        merchantId: merchant.id
      });
    }

    evaluations.push({ merchant, distanceKm, lines, missing, covered });
  }

  const full = evaluations
    .filter((e) => e.missing.length === 0 && e.lines.length > 0)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  const preferred = opts?.preferredMerchantId
    ? full.find((e) => e.merchant.id === opts.preferredMerchantId)
    : undefined;
  const chosen = preferred ?? full[0];

  if (chosen) {
    return {
      ok: true,
      merchant: chosen.merchant,
      distanceKm: chosen.distanceKm,
      lines: chosen.lines,
      missing: [],
      switchedFromPreferred: Boolean(
        opts?.preferredMerchantId && preferred == null && full[0]
      )
    };
  }

  return {
    ok: false,
    missing: [...new Set(evaluations.flatMap((e) => e.missing))],
    partialByMerchant: evaluations
      .filter((e) => e.covered.length > 0)
      .slice(0, 5)
      .map((e) => ({
        merchant: e.merchant,
        covered: e.covered,
        missing: e.missing
      }))
  };
}

/** Parse "Add Mazoe Orange 2L for $2.50" style merchant catalog commands (deterministic). */
export function parseMerchantAddProductText(text: string): {
  name: string;
  priceCents: number;
  unit?: string;
} | null {
  const t = text.trim();
  const m =
    t.match(/^add\s+(.+?)\s+for\s+\$?\s*(\d+(?:\.\d{1,2})?)\s*$/i) ||
    t.match(/^add\s+(.+?)\s+@\s*\$?\s*(\d+(?:\.\d{1,2})?)\s*$/i) ||
    t.match(/^add\s+(.+?)\s+\$?\s*(\d+(?:\.\d{1,2})?)\s*$/i);
  if (!m?.[1] || !m[2]) return null;
  const name = m[1].trim();
  const priceCents = Math.round(Number(m[2]) * 100);
  if (!name || !Number.isFinite(priceCents) || priceCents < 1) return null;
  return { name, priceCents };
}

/**
 * Bulk catalog lines (one product per line):
 * Bread $1.20
 * Coke 2L $2.00
 * Add Mazoe Orange 2L for $2.50
 */
export function parseMerchantBulkCatalogText(text: string): {
  valid: Array<{ name: string; priceCents: number }>;
  invalid: string[];
} {
  const lines = text
    .split(/\r?\n|;/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return { valid: [], invalid: [] };

  const valid: Array<{ name: string; priceCents: number }> = [];
  const invalid: string[] = [];
  for (const line of lines) {
    const add = parseMerchantAddProductText(line);
    if (add) {
      valid.push(add);
      continue;
    }
    const m = line.match(/^(.+?)\s+\$?\s*(\d+(?:\.\d{1,2})?)\s*$/);
    if (m?.[1] && m[2] && !/^(accept|reject|ready|order)\b/i.test(m[1])) {
      const priceCents = Math.round(Number(m[2]) * 100);
      const name = m[1].replace(/^add\s+/i, "").trim();
      if (name.length >= 2 && priceCents >= 1) {
        valid.push({ name, priceCents });
        continue;
      }
    }
    invalid.push(line);
  }
  return { valid, invalid };
}

export function parseMerchantPriceUpdateText(text: string): { query: string; priceCents: number } | null {
  const m =
    text.trim().match(/^(.+?)\s+is\s+now\s+\$?\s*(\d+(?:\.\d{1,2})?)\s*$/i) ||
    text.trim().match(/^(.+?)\s+(?:price|costs?)\s+\$?\s*(\d+(?:\.\d{1,2})?)\s*$/i) ||
    text.trim().match(/^(.+?)\s+is\s+\$?\s*(\d+(?:\.\d{1,2})?)\s*$/i);
  if (!m?.[1] || !m[2]) return null;
  const priceCents = Math.round(Number(m[2]) * 100);
  if (!Number.isFinite(priceCents) || priceCents < 1) return null;
  return { query: m[1].trim(), priceCents };
}

export function parseOutOfStockText(text: string): string | null {
  const m =
    text.trim().match(/^(.+?)\s+is\s+out\s+of\s+stock\s*$/i) ||
    text.trim().match(/^(?:mark\s+)?(.+?)\s+(?:unavailable|out)\s*$/i);
  return m?.[1] ? m[1].trim() : null;
}

export function parseBackInStockText(text: string): string | null {
  const m =
    text.trim().match(/^(.+?)\s+is\s+(?:available|back(?:\s+in\s+stock)?)\s*$/i) ||
    text.trim().match(/^(.+?)\s+available\s*$/i);
  return m?.[1] ? m[1].trim() : null;
}

/** Ranked product matches for a merchant — used for ambiguity prompts. */
export async function findMerchantProductsByQuery(
  merchantId: string,
  query: string,
  limit = 5
): Promise<Array<{ product: Product; score: number }>> {
  const products = await listMerchantProducts(merchantId, true);
  const scored = products
    .map((p) => ({ product: p, score: scoreProductMatch(p, query) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export async function findMerchantProductByQuery(merchantId: string, query: string) {
  const matches = await findMerchantProductsByQuery(merchantId, query, 1);
  return matches[0]?.score ? matches[0].product : null;
}
