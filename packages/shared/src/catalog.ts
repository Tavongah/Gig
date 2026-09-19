import { z } from "zod";
import { normalizeProductSearchName } from "./commerce.js";

export const catalogProductStatuses = ["PENDING", "APPROVED", "REJECTED", "ARCHIVED"] as const;
export type CatalogProductStatus = (typeof catalogProductStatuses)[number];

export const catalogProductSources = ["DUTS_ADMIN", "MERCHANT_SUBMISSION", "IMPORT"] as const;
export type CatalogProductSource = (typeof catalogProductSources)[number];

/**
 * Admin/catalog search scans at most this many CatalogProduct rows, then scores/slices.
 * Independent of WhatsApp reply caps (those stay at 5 / 12 nearby merchant offers).
 */
export const CATALOG_PRODUCT_SCAN_LIMIT = 1000;

/** Max rows an ADMIN master-catalog request may return. Must stay ≤ scan limit. */
export const ADMIN_CATALOG_LIST_LIMIT = 1000;

/** Max rows merchant catalog-search / non-admin callers may return. */
export const MERCHANT_CATALOG_SEARCH_LIMIT_MAX = 100;

/**
 * Legacy APPROVED rows kept after the canonical rebuild. Visible to admin,
 * never counted as canonical, never mutated by the visibility fix.
 * Dragon / Starbucks / 500ml and Pepsi zero sugar / Coca-Cola / 400ml.
 */
export const UNRESOLVED_LEGACY_CATALOG_PRODUCT_IDS = [
  "cd5ff8f9-14ea-4193-88a2-85d97114ea26",
  "4eb36208-3c3d-4fbc-b856-c62767a7093e"
] as const;

export function isUnresolvedLegacyCatalogProduct(id: string): boolean {
  return (UNRESOLVED_LEGACY_CATALOG_PRODUCT_IDS as readonly string[]).includes(id);
}

export const adminCatalogViews = ["canonical", "archived", "unresolved", "all"] as const;
export type AdminCatalogView = (typeof adminCatalogViews)[number];

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

export const searchCatalogProductsSchema = z
  .object({
    q: z.string().max(160).optional().default(""),
    status: z.enum(catalogProductStatuses).optional(),
    /** When true (admin list), return all statuses unless `status`/`view` is set. */
    adminList: z.boolean().optional().default(false),
    includePendingForMerchantId: z.string().uuid().optional(),
    category: z.string().max(80).optional(),
    view: z.enum(adminCatalogViews).optional(),
    limit: z.number().int().min(1).max(ADMIN_CATALOG_LIST_LIMIT).optional().default(30)
  })
  .superRefine((data, ctx) => {
    if (!data.adminList && (data.limit ?? 30) > MERCHANT_CATALOG_SEARCH_LIMIT_MAX) {
      ctx.addIssue({
        code: "custom",
        path: ["limit"],
        message: `Non-admin catalog search limit cannot exceed ${MERCHANT_CATALOG_SEARCH_LIMIT_MAX}`
      });
    }
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

export const catalogImageAcquisitionStatuses = [
  "NEEDS_IMAGE_ACQUISITION",
  "PHOTO_RECEIVED",
  "VALIDATION_REQUIRED",
  "VALIDATED",
  "REJECTED",
  "UPLOADED"
] as const;
export type CatalogImageAcquisitionStatus = (typeof catalogImageAcquisitionStatuses)[number];

export const catalogImageQueueKinds = ["BRANDED", "GENERIC_EXCEPTION", "LEGACY_REVIEW"] as const;
export type CatalogImageQueueKind = (typeof catalogImageQueueKinds)[number];

export const catalogImageQueueTabs = [
  "all-missing",
  "branded",
  "exceptions",
  "human-review",
  "completed",
  "legacy"
] as const;
export type CatalogImageQueueTab = (typeof catalogImageQueueTabs)[number];

export const catalogImageAcquisitionPacks = [
  "PACK_A_BEVERAGES",
  "PACK_B_HOUSEHOLD",
  "PACK_C_SNACKS",
  "PACK_D_BREAKFAST",
  "PACK_E_PERSONAL_CARE"
] as const;
export type CatalogImageAcquisitionPack = (typeof catalogImageAcquisitionPacks)[number];

export const catalogImageAcquisitionPriorities = [
  "BRANDED_PRIORITY_A",
  "BRANDED_PRIORITY_B",
  "BRANDED_PRIORITY_C"
] as const;
export type CatalogImageAcquisitionPriority = (typeof catalogImageAcquisitionPriorities)[number];

export const catalogImageSourceTypes = ["MERCHANT_SUPPLIED_PHOTO", "DUTS_OWN_PHOTO"] as const;
export type CatalogImageSourceType = (typeof catalogImageSourceTypes)[number];

export const catalogImageRejectionReasons = [
  "WRONG_BRAND",
  "WRONG_PRODUCT",
  "WRONG_SIZE",
  "WRONG_VARIANT",
  "BLURRY",
  "GLARE",
  "PACKAGE_OBSTRUCTED",
  "WATERMARK",
  "REGIONAL_PACKAGE_MISMATCH",
  "OTHER"
] as const;
export type CatalogImageRejectionReason = (typeof catalogImageRejectionReasons)[number];

export const catalogImageValidationChecksSchema = z.object({
  brandMatches: z.literal(true),
  productMatches: z.literal(true),
  sizeMatches: z.literal(true),
  flavorMatches: z.literal(true),
  packageTypeMatches: z.literal(true),
  imageClear: z.literal(true),
  noWatermark: z.literal(true),
  noPriceOverlay: z.literal(true),
  regionalPackageConfirmed: z.boolean().optional()
});

export const assignCatalogImageAcquisitionSchema = z.object({
  catalogProductId: z.string().uuid(),
  sourceType: z.enum(catalogImageSourceTypes),
  capturedByLabel: z.string().trim().max(80).optional().nullable(),
  checks: catalogImageValidationChecksSchema
});

export const rejectCatalogImageAcquisitionSchema = z.object({
  reason: z.enum(catalogImageRejectionReasons),
  notes: z.string().trim().max(500).optional().nullable()
});

export const listCatalogImageQueueSchema = z.object({
  tab: z.enum(catalogImageQueueTabs).optional().default("branded"),
  pack: z.enum(catalogImageAcquisitionPacks).optional(),
  priority: z.enum(catalogImageAcquisitionPriorities).optional(),
  q: z.string().max(160).optional().default("")
});

