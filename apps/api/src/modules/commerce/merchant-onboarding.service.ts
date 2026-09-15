/**
 * Pilot merchant onboarding helpers: readiness, bulk catalog preview/import, test basket.
 * Reuses catalog matching from merchant.service — does not duplicate basket logic.
 */

import {
  distanceKmBetween,
  normalizeProductSearchName,
  PILOT_READY_MIN_PRODUCTS,
  type RequestedShoppingItem
} from "@gigflow/shared";
import type { Merchant, Product } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import {
  listMerchantProducts,
  scoreProductMatch,
  upsertProductForMerchant,
  type BasketLine
} from "./merchant.service.js";

export type MerchantReadinessCheck = {
  status: "READY" | "NOT_READY";
  checks: {
    whatsapp: "PASS" | "FAIL";
    location: "PASS" | "FAIL";
    openingHours: "PASS" | "FAIL";
    active: "PASS" | "FAIL";
    acceptsOrders: "PASS" | "FAIL";
    catalog: "PASS" | "WARN" | "FAIL";
  };
  availableProductCount: number;
  missing: string[];
  summary: string;
};

export function assertValidMerchantCoordinates(lat: number, lng: number): void {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new AppError("Latitude and longitude are required.", 400, "INVALID_COORDINATES");
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new AppError("Invalid latitude/longitude.", 400, "INVALID_COORDINATES");
  }
  // Reject null-island / placeholder zeros often pasted by mistake in ZW pilot.
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) {
    throw new AppError("Enter a real shop location (lat/lng cannot be 0,0).", 400, "INVALID_COORDINATES");
  }
}

export async function getMerchantReadiness(merchantId: string): Promise<MerchantReadinessCheck> {
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    include: {
      products: { where: { archived: false, available: true }, select: { id: true } }
    }
  });
  if (!merchant) throw new AppError("Merchant not found.", 404, "MERCHANT_NOT_FOUND");

  const availableProductCount = merchant.products.length;
  const whatsappOk = Boolean(merchant.whatsappPhone?.startsWith("+") && merchant.whatsappPhone.length >= 10);
  const locationOk =
    Number.isFinite(Number(merchant.latitude)) &&
    Number.isFinite(Number(merchant.longitude)) &&
    !(Math.abs(Number(merchant.latitude)) < 0.0001 && Math.abs(Number(merchant.longitude)) < 0.0001);
  const hoursOk = Boolean(merchant.openingHours?.trim());
  const activeOk = merchant.isActive;
  const acceptsOk = merchant.acceptsOrders;

  let catalog: "PASS" | "WARN" | "FAIL" = "FAIL";
  if (availableProductCount >= PILOT_READY_MIN_PRODUCTS) catalog = "PASS";
  else if (availableProductCount >= 1) catalog = "WARN";

  const missing: string[] = [];
  if (!whatsappOk) missing.push("Valid authorized WhatsApp number");
  if (!locationOk) missing.push("Valid latitude/longitude");
  if (!hoursOk) missing.push("Opening hours");
  if (!activeOk) missing.push("Merchant isActive");
  if (!acceptsOk) missing.push("Accepts DUTS orders");
  if (availableProductCount < 1) missing.push("At least 1 available product");
  else if (availableProductCount < PILOT_READY_MIN_PRODUCTS) {
    missing.push(`Prefer >= ${PILOT_READY_MIN_PRODUCTS} available products (have ${availableProductCount})`);
  }

  const readyCore =
    whatsappOk && locationOk && hoursOk && activeOk && acceptsOk && availableProductCount >= 1;
  // Pilot READY requires preferred catalog size; otherwise NOT_READY with WARN catalog.
  const status: "READY" | "NOT_READY" =
    readyCore && availableProductCount >= PILOT_READY_MIN_PRODUCTS ? "READY" : "NOT_READY";

  const summary = [
    "Merchant readiness:",
    `- WhatsApp: ${whatsappOk ? "PASS" : "FAIL"}`,
    `- Location: ${locationOk ? "PASS" : "FAIL"}`,
    `- Opening hours: ${hoursOk ? "PASS" : "FAIL"}`,
    `- Active catalog: ${availableProductCount} products`,
    `- Accepts DUTS orders: ${acceptsOk ? "PASS" : "FAIL"}`,
    `- Active merchant: ${activeOk ? "PASS" : "FAIL"}`,
    `- Pilot readiness: ${status}`
  ].join("\n");

  return {
    status,
    checks: {
      whatsapp: whatsappOk ? "PASS" : "FAIL",
      location: locationOk ? "PASS" : "FAIL",
      openingHours: hoursOk ? "PASS" : "FAIL",
      active: activeOk ? "PASS" : "FAIL",
      acceptsOrders: acceptsOk ? "PASS" : "FAIL",
      catalog
    },
    availableProductCount,
    missing,
    summary
  };
}

export type BulkCatalogPreviewLine = {
  line: string;
  name?: string;
  priceCents?: number;
  status: "ok" | "invalid" | "duplicate";
  warning?: string;
};

/**
 * Preview ambassador bulk catalog. Supports:
 * Bread | 1.20
 * Eggs 6-pack | 2.50
 * Bread $1.20
 */
export function previewBulkCatalogImport(
  text: string,
  existingNames: string[] = []
): {
  lines: BulkCatalogPreviewLine[];
  valid: Array<{ name: string; priceCents: number }>;
  invalid: string[];
  duplicates: string[];
} {
  const existingNorm = new Set(existingNames.map((n) => normalizeProductSearchName(n)));
  const seen = new Set<string>();
  const lines: BulkCatalogPreviewLine[] = [];
  const valid: Array<{ name: string; priceCents: number }> = [];
  const invalid: string[] = [];
  const duplicates: string[] = [];

  const rawLines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of rawLines) {
    const pipe = line.match(/^(.+?)\s*\|\s*\$?\s*(\d+(?:\.\d{1,2})?)\s*$/);
    let name: string | undefined;
    let priceCents: number | undefined;
    if (pipe?.[1] && pipe[2]) {
      name = pipe[1].trim();
      priceCents = Math.round(Number(pipe[2]) * 100);
    } else {
      const dollar = line.match(/^(.+?)\s+\$\s*(\d+(?:\.\d{1,2})?)\s*$/);
      const bare = line.match(/^(.+?)\s+(\d+(?:\.\d{1,2})?)\s*$/);
      const m = dollar || bare;
      if (m?.[1] && m[2] && !/^(accept|reject|ready|order)\b/i.test(m[1])) {
        name = m[1].replace(/^add\s+/i, "").trim();
        priceCents = Math.round(Number(m[2]) * 100);
      }
    }

    if (!name || !priceCents || priceCents < 1 || name.length < 2) {
      lines.push({ line, status: "invalid", warning: "Could not parse name and price" });
      invalid.push(line);
      continue;
    }

    const norm = normalizeProductSearchName(name);
    if (seen.has(norm) || existingNorm.has(norm)) {
      lines.push({
        line,
        name,
        priceCents,
        status: "duplicate",
        warning: existingNorm.has(norm)
          ? "Name already exists in catalog"
          : "Duplicate name in this import"
      });
      duplicates.push(name);
      continue;
    }

    seen.add(norm);
    valid.push({ name, priceCents });
    lines.push({ line, name, priceCents, status: "ok" });
  }

  return { lines, valid, invalid, duplicates };
}

export async function confirmBulkCatalogImport(
  merchantId: string,
  text: string,
  opts?: { skipDuplicates?: boolean }
): Promise<{
  created: Product[];
  skipped: BulkCatalogPreviewLine[];
  invalid: string[];
}> {
  const merchant = await prisma.merchant.findUnique({ where: { id: merchantId } });
  if (!merchant) throw new AppError("Merchant not found.", 404, "MERCHANT_NOT_FOUND");

  const existing = await listMerchantProducts(merchantId, true);
  const preview = previewBulkCatalogImport(
    text,
    existing.map((p) => p.name)
  );

  if (preview.invalid.length > 0 && preview.valid.length === 0) {
    throw new AppError(
      "No valid catalog lines to import.",
      400,
      "BULK_CATALOG_INVALID",
      Object.fromEntries(preview.invalid.map((l, i) => [`line${i}`, l]))
    );
  }

  const created: Product[] = [];
  for (const row of preview.valid) {
    const product = await upsertProductForMerchant(merchantId, {
      name: row.name,
      priceCents: row.priceCents,
      currency: "usd",
      available: true,
      searchAliases: []
    });
    created.push(product);
  }

  const skipped = opts?.skipDuplicates === false
    ? preview.lines.filter((l) => l.status === "duplicate")
    : preview.lines.filter((l) => l.status !== "ok");

  return { created, skipped, invalid: preview.invalid };
}

/**
 * Test whether a specific merchant can fulfil a basket for a customer location.
 * Uses the same product scoring as live WhatsApp matching.
 */
export async function testMerchantBasket(input: {
  merchantId: string;
  customerLat: number;
  customerLng: number;
  items: RequestedShoppingItem[];
}): Promise<{
  eligible: boolean;
  reason?: string;
  distanceKm: number;
  withinRadius: boolean;
  radiusKm: number;
  matched: BasketLine[];
  missing: string[];
  itemSubtotalCents: number;
  canFulfilFullBasket: boolean;
  merchant: Pick<Merchant, "id" | "name" | "whatsappPhone" | "isActive" | "acceptsOrders" | "locationLabel">;
}> {
  const { getMarketplaceSettings } = await import("./merchant.service.js");
  const settings = await getMarketplaceSettings();
  const merchant = await prisma.merchant.findUnique({ where: { id: input.merchantId } });
  if (!merchant) throw new AppError("Merchant not found.", 404, "MERCHANT_NOT_FOUND");

  const distanceKm = distanceKmBetween(
    { latitude: input.customerLat, longitude: input.customerLng },
    { latitude: Number(merchant.latitude), longitude: Number(merchant.longitude) }
  );
  const withinRadius = distanceKm <= settings.merchantRadiusKm;

  let eligible = true;
  let reason: string | undefined;
  if (!merchant.isActive) {
    eligible = false;
    reason = "Merchant is inactive";
  } else if (!merchant.acceptsOrders) {
    eligible = false;
    reason = "Merchant is not accepting DUTS orders";
  }

  const products = await listMerchantProducts(merchant.id, false);
  const available = products.filter((p) => p.available && !p.archived);

  const matched: BasketLine[] = [];
  const missing: string[] = [];

  for (const item of input.items) {
    const scored = available
      .map((p) => ({ product: p, score: scoreProductMatch(p, item.query) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best) {
      missing.push(item.query);
      continue;
    }
    matched.push({
      productId: best.product.id,
      productName: best.product.name,
      quantity: item.quantity,
      unitPriceCents: best.product.priceCents,
      lineTotalCents: best.product.priceCents * item.quantity,
      merchantId: merchant.id
    });
  }

  const canFulfilFullBasket = missing.length === 0 && matched.length === input.items.length;
  const itemSubtotalCents = matched.reduce((s, l) => s + l.lineTotalCents, 0);

  return {
    eligible: eligible && withinRadius,
    reason: !eligible ? reason : !withinRadius ? `Outside ${settings.merchantRadiusKm}km radius` : undefined,
    distanceKm: Math.round(distanceKm * 1000) / 1000,
    withinRadius,
    radiusKm: settings.merchantRadiusKm,
    matched,
    missing,
    itemSubtotalCents,
    canFulfilFullBasket,
    merchant: {
      id: merchant.id,
      name: merchant.name,
      whatsappPhone: merchant.whatsappPhone,
      isActive: merchant.isActive,
      acceptsOrders: merchant.acceptsOrders,
      locationLabel: merchant.locationLabel
    }
  };
}
