import { z } from "zod";
import { normalizeProductSearchName } from "./commerce.js";

export const catalogProductStatuses = ["PENDING", "APPROVED", "REJECTED", "ARCHIVED"] as const;
export type CatalogProductStatus = (typeof catalogProductStatuses)[number];

export const catalogProductSources = ["DUTS_ADMIN", "MERCHANT_SUBMISSION", "IMPORT"] as const;
export type CatalogProductSource = (typeof catalogProductSources)[number];

export function normalizeBarcode(barcode: string | null | undefined): string | null {
  if (!barcode) return null;
  const digits = barcode.replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

export const createCatalogProductSchema = z.object({
  name: z.string().min(1).max(160),
  brand: z.string().max(120).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  category: z.string().min(1).max(80),
  subcategory: z.string().max(80).optional().nullable(),
  sizeLabel: z.string().max(80).optional().nullable(),
  unit: z.string().max(40).optional().nullable(),
  barcode: z.string().max(32).optional().nullable(),
  primaryImageUrl: z.string().url().max(2048).optional().nullable(),
  status: z.enum(catalogProductStatuses).optional(),
  source: z.enum(catalogProductSources).optional()
});

export const updateCatalogProductSchema = createCatalogProductSchema.partial().extend({
  status: z.enum(catalogProductStatuses).optional()
});

export const searchCatalogProductsSchema = z.object({
  q: z.string().max(160).optional().default(""),
  status: z.enum(catalogProductStatuses).optional(),
  /** When true (admin list), return all statuses unless `status` is set. */
  adminList: z.boolean().optional().default(false),
  includePendingForMerchantId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).optional().default(30)
});

export const linkMerchantOfferSchema = z.object({
  catalogProductId: z.string().uuid(),
  priceCents: z.number().int().min(1).max(10_000_000),
  currency: z.string().length(3).default("usd"),
  available: z.boolean().default(true)
});

export const submitMerchantCatalogProductSchema = z.object({
  name: z.string().min(1).max(160),
  brand: z.string().max(120).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  category: z.string().min(1).max(80),
  sizeLabel: z.string().max(80).optional().nullable(),
  unit: z.string().max(40).optional().nullable(),
  barcode: z.string().max(32).optional().nullable(),
  primaryImageUrl: z.string().url().max(2048),
  priceCents: z.number().int().min(1).max(10_000_000),
  currency: z.string().length(3).default("usd"),
  available: z.boolean().default(true),
  forceCreate: z.boolean().optional().default(false)
});

export function catalogSearchHaystack(input: {
  name: string;
  brand?: string | null;
  sizeLabel?: string | null;
  barcode?: string | null;
  category?: string | null;
}): string {
  return normalizeProductSearchName(
    [input.name, input.brand, input.sizeLabel, input.barcode, input.category].filter(Boolean).join(" ")
  );
}
