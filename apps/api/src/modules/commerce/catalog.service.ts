import {
  ADMIN_CATALOG_LIST_LIMIT,
  CATALOG_PRODUCT_SCAN_LIMIT,
  MERCHANT_CATALOG_SEARCH_LIMIT_MAX,
  UNRESOLVED_LEGACY_CATALOG_PRODUCT_IDS,
  catalogSearchHaystack,
  createCatalogProductSchema,
  expandSearchTerms,
  isUnresolvedLegacyCatalogProduct,
  linkMerchantOfferSchema,
  normalizeBarcode,
  normalizeProductSearchName,
  searchCatalogProductsSchema,
  submitMerchantCatalogProductSchema,
  updateCatalogProductSchema,
  type CatalogProductStatus
} from "@gigflow/shared";
import type { CatalogProduct, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import { browserAccessibleMediaUrl } from "../../lib/catalog-media.js";

export { CATALOG_PRODUCT_SCAN_LIMIT, ADMIN_CATALOG_LIST_LIMIT };

const unresolvedLegacyIds = [...UNRESOLVED_LEGACY_CATALOG_PRODUCT_IDS];

function presentation(product: CatalogProduct) {
  const unresolved = isUnresolvedLegacyCatalogProduct(product.id);
  return {
    id: product.id,
    name: product.name,
    brand: product.brand,
    description: product.description,
    category: product.category,
    subcategory: product.subcategory,
    sizeLabel: product.sizeLabel,
    unit: product.unit,
    barcode: product.barcode,
    primaryImageUrl: browserAccessibleMediaUrl(product.primaryImageUrl),
    status: product.status,
    source: product.source,
    unresolved,
    submittedByMerchantId: product.submittedByMerchantId,
    approvedAt: product.approvedAt,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt
  };
}

type CatalogSearchSummary = {
  total: number;
  approved: number;
  archived: number;
  pending: number;
  rejected: number;
  canonical: number;
  unresolved: number;
  categories: string[];
};

async function loadCatalogSummary(): Promise<CatalogSearchSummary> {
  const [statusGroups, unresolvedApproved, categoryRows] = await Promise.all([
    prisma.catalogProduct.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.catalogProduct.count({
      where: { id: { in: unresolvedLegacyIds }, status: "APPROVED" }
    }),
    prisma.catalogProduct.findMany({
      where: { status: "APPROVED", id: { notIn: unresolvedLegacyIds } },
      distinct: ["category"],
      select: { category: true },
      orderBy: { category: "asc" }
    })
  ]);
  const countOf = (status: CatalogProductStatus) =>
    statusGroups.find((row) => row.status === status)?._count._all ?? 0;
  const approved = countOf("APPROVED");
  return {
    total: statusGroups.reduce((sum, row) => sum + row._count._all, 0),
    approved,
    archived: countOf("ARCHIVED"),
    pending: countOf("PENDING"),
    rejected: countOf("REJECTED"),
    canonical: Math.max(0, approved - unresolvedApproved),
    unresolved: unresolvedApproved,
    categories: categoryRows.map((row) => row.category)
  };
}

function emptyCatalogSummary(): CatalogSearchSummary {
  return {
    total: 0,
    approved: 0,
    archived: 0,
    pending: 0,
    rejected: 0,
    canonical: 0,
    unresolved: 0,
    categories: []
  };
}

function packCatalogSearch(
  products: ReturnType<typeof presentation>[],
  summary: CatalogSearchSummary
) {
  return {
    products,
    total: summary.total,
    approved: summary.approved,
    archived: summary.archived,
    canonical: summary.canonical,
    unresolved: summary.unresolved,
    pending: summary.pending,
    rejected: summary.rejected,
    categories: summary.categories
  };
}

export async function createCatalogProduct(
  input: unknown,
  opts?: { actorUserId?: string; submittedByMerchantId?: string }
) {
  const parsed = createCatalogProductSchema.parse(input);
  const barcode = normalizeBarcode(parsed.barcode);
  if (barcode) {
    const existingBarcode = await prisma.catalogProduct.findUnique({ where: { barcode } });
    if (existingBarcode) {
      throw new AppError("A catalog product with this barcode already exists.", 409, "BARCODE_EXISTS", {
        catalogProductId: existingBarcode.id
      });
    }
  }

  const status = parsed.status ?? (opts?.submittedByMerchantId ? "PENDING" : "APPROVED");
  const source = parsed.source ?? (opts?.submittedByMerchantId ? "MERCHANT_SUBMISSION" : "DUTS_ADMIN");

  const created = await prisma.catalogProduct.create({
    data: {
      name: parsed.name.trim(),
      normalizedName: normalizeProductSearchName(parsed.name),
      brand: parsed.brand?.trim() || null,
      description: parsed.description?.trim() || null,
      category: parsed.category.trim(),
      subcategory: parsed.subcategory?.trim() || null,
      sizeLabel: parsed.sizeLabel?.trim() || null,
      unit: parsed.unit?.trim() || null,
      barcode,
      primaryImageUrl: browserAccessibleMediaUrl(parsed.primaryImageUrl) || null,
      status,
      source,
      submittedByMerchantId: opts?.submittedByMerchantId ?? null,
      approvedAt: status === "APPROVED" ? new Date() : null,
      approvedByUserId: status === "APPROVED" ? opts?.actorUserId ?? null : null,
      ...(parsed.primaryImageUrl
        ? {
            images: {
              create: {
                url: browserAccessibleMediaUrl(parsed.primaryImageUrl) || parsed.primaryImageUrl,
                sortOrder: 0,
                isPrimary: true
              }
            }
          }
        : {})
    }
  });

  return presentation(created);
}

export async function updateCatalogProduct(
  id: string,
  input: unknown,
  opts?: { actorUserId?: string }
) {
  const existing = await prisma.catalogProduct.findUnique({ where: { id } });
  if (!existing) throw new AppError("Catalog product not found.", 404, "CATALOG_PRODUCT_NOT_FOUND");

  const parsed = updateCatalogProductSchema.parse(input);
  const barcode =
    parsed.barcode === undefined ? undefined : normalizeBarcode(parsed.barcode);

  if (barcode) {
    const clash = await prisma.catalogProduct.findFirst({
      where: { barcode, NOT: { id } }
    });
    if (clash) {
      throw new AppError("A catalog product with this barcode already exists.", 409, "BARCODE_EXISTS", {
        catalogProductId: clash.id
      });
    }
  }

  const nextStatus = parsed.status ?? existing.status;
  const updated = await prisma.catalogProduct.update({
    where: { id },
    data: {
      ...(parsed.name !== undefined
        ? { name: parsed.name.trim(), normalizedName: normalizeProductSearchName(parsed.name) }
        : {}),
      ...(parsed.brand !== undefined ? { brand: parsed.brand?.trim() || null } : {}),
      ...(parsed.description !== undefined ? { description: parsed.description?.trim() || null } : {}),
      ...(parsed.category !== undefined ? { category: parsed.category.trim() } : {}),
      ...(parsed.subcategory !== undefined ? { subcategory: parsed.subcategory?.trim() || null } : {}),
      ...(parsed.sizeLabel !== undefined ? { sizeLabel: parsed.sizeLabel?.trim() || null } : {}),
      ...(parsed.unit !== undefined ? { unit: parsed.unit?.trim() || null } : {}),
      ...(barcode !== undefined ? { barcode } : {}),
      ...(parsed.primaryImageUrl !== undefined
        ? { primaryImageUrl: browserAccessibleMediaUrl(parsed.primaryImageUrl) || null }
        : {}),
      ...(parsed.status !== undefined ? { status: parsed.status } : {}),
      ...(parsed.status === "APPROVED" && existing.status !== "APPROVED"
        ? { approvedAt: new Date(), approvedByUserId: opts?.actorUserId ?? null }
        : {}),
      ...(parsed.status === "ARCHIVED" || nextStatus === "ARCHIVED" ? {} : {})
    }
  });

  if (parsed.primaryImageUrl) {
    await prisma.catalogProductImage.updateMany({
      where: { catalogProductId: id, isPrimary: true },
      data: { isPrimary: false }
    });
    await prisma.catalogProductImage.create({
      data: {
        catalogProductId: id,
        url: browserAccessibleMediaUrl(parsed.primaryImageUrl) || parsed.primaryImageUrl,
        sortOrder: 0,
        isPrimary: true
      }
    });
  }

  return presentation(updated);
}

export async function setCatalogProductStatus(
  id: string,
  status: CatalogProductStatus,
  actorUserId?: string
) {
  return updateCatalogProduct(id, { status }, { actorUserId });
}

export async function findCatalogProductByBarcode(barcodeRaw: string) {
  const barcode = normalizeBarcode(barcodeRaw);
  if (!barcode) return null;
  return prisma.catalogProduct.findUnique({ where: { barcode } });
}

export async function findSimilarCatalogProducts(input: {
  name: string;
  brand?: string | null;
  sizeLabel?: string | null;
  barcode?: string | null;
  limit?: number;
}) {
  const barcode = normalizeBarcode(input.barcode);
  if (barcode) {
    const exact = await prisma.catalogProduct.findUnique({ where: { barcode } });
    if (exact && exact.status !== "ARCHIVED") {
      return { exactBarcodeMatch: presentation(exact), similar: [] as ReturnType<typeof presentation>[] };
    }
  }

  const needle = catalogSearchHaystack(input);
  const candidates = await prisma.catalogProduct.findMany({
    where: { status: { in: ["APPROVED", "PENDING"] } },
    take: 200,
    orderBy: { updatedAt: "desc" }
  });

  const similar = candidates
    .map((p) => {
      const hay = catalogSearchHaystack(p);
      let score = 0;
      if (hay === needle) score = 100;
      else if (hay.includes(needle) || needle.includes(hay)) score = 60;
      else if (
        p.normalizedName === normalizeProductSearchName(input.name) &&
        (p.sizeLabel || "") === (input.sizeLabel || "")
      ) {
        score = 80;
      } else if (p.normalizedName === normalizeProductSearchName(input.name)) {
        score = 50;
      }
      return { product: p, score };
    })
    .filter((row) => row.score >= 50)
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit ?? 5)
    .map((row) => presentation(row.product));

  return { exactBarcodeMatch: null, similar };
}

export async function searchCatalogProducts(input: unknown) {
  const parsed = searchCatalogProductsSchema.parse(input);
  const q = normalizeProductSearchName(parsed.q ?? "");
  const barcode = normalizeBarcode(parsed.q ?? "");
  const maxLimit = parsed.adminList ? ADMIN_CATALOG_LIST_LIMIT : MERCHANT_CATALOG_SEARCH_LIMIT_MAX;
  const limit = Math.min(parsed.limit, maxLimit);

  const statusFilter: Prisma.CatalogProductWhereInput = parsed.status
    ? { status: parsed.status }
    : parsed.view === "canonical" || (parsed.adminList && !parsed.view)
      ? { status: "APPROVED", id: { notIn: unresolvedLegacyIds } }
      : parsed.view === "archived"
        ? { status: "ARCHIVED" }
        : parsed.view === "unresolved"
          ? { id: { in: unresolvedLegacyIds } }
          : parsed.view === "all" || parsed.adminList
            ? {}
            : parsed.includePendingForMerchantId
              ? {
                  OR: [
                    { status: "APPROVED" },
                    {
                      status: "PENDING",
                      submittedByMerchantId: parsed.includePendingForMerchantId
                    }
                  ]
                }
              : { status: "APPROVED" };

  if (parsed.category?.trim()) {
    statusFilter.category = parsed.category.trim();
  }

  const summary = parsed.adminList ? await loadCatalogSummary() : emptyCatalogSummary();

  if (barcode) {
    const byBarcode = await prisma.catalogProduct.findFirst({
      where: { ...statusFilter, barcode }
    });
    if (byBarcode) return packCatalogSearch([presentation(byBarcode)], summary);
  }

  const rows = await prisma.catalogProduct.findMany({
    where: statusFilter,
    orderBy: [{ name: "asc" }],
    take: CATALOG_PRODUCT_SCAN_LIMIT
  });

  if (!q) {
    return packCatalogSearch(rows.slice(0, limit).map(presentation), summary);
  }

  const terms = expandSearchTerms(q);
  const scored = rows
    .map((p) => {
      const hay = catalogSearchHaystack(p);
      let score = 0;
      for (const t of terms) {
        if (!t) continue;
        if (hay === t || p.normalizedName === t) score += 100;
        else if (hay.includes(t)) score += 40;
      }
      return { p, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
    .slice(0, limit)
    .map((row) => presentation(row.p));

  return packCatalogSearch(scored, summary);
}

export async function getCatalogProduct(id: string) {
  const product = await prisma.catalogProduct.findUnique({
    where: { id },
    include: { images: { orderBy: { sortOrder: "asc" } } }
  });
  if (!product) throw new AppError("Catalog product not found.", 404, "CATALOG_PRODUCT_NOT_FOUND");
  return {
    product: presentation(product),
    images: product.images
  };
}

/** Link an APPROVED (or own PENDING) catalog product as a merchant offer (Product row). */
export async function linkCatalogProductToMerchant(merchantId: string, input: unknown) {
  const parsed = linkMerchantOfferSchema.parse(input);
  const catalog = await prisma.catalogProduct.findUnique({ where: { id: parsed.catalogProductId } });
  if (!catalog || catalog.status === "ARCHIVED" || catalog.status === "REJECTED") {
    throw new AppError("Catalog product not available.", 404, "CATALOG_PRODUCT_NOT_FOUND");
  }
  if (catalog.status === "PENDING" && catalog.submittedByMerchantId !== merchantId) {
    throw new AppError("Pending catalog products can only be used by the submitting merchant.", 403, "FORBIDDEN");
  }

  const existing = await prisma.product.findFirst({
    where: { merchantId, catalogProductId: catalog.id, archived: false }
  });
  if (existing) {
    return prisma.product.update({
      where: { id: existing.id },
      data: {
        priceCents: parsed.priceCents,
        currency: parsed.currency,
        available: parsed.available,
        name: catalog.name,
        normalizedName: catalog.normalizedName,
        description: catalog.description,
        category: catalog.category,
        unit: catalog.unit ?? catalog.sizeLabel,
        imageUrl: browserAccessibleMediaUrl(catalog.primaryImageUrl)
      }
    });
  }

  const aliases = [...new Set(expandSearchTerms(catalog.name))].filter(Boolean);
  return prisma.product.create({
    data: {
      merchantId,
      catalogProductId: catalog.id,
      name: catalog.name,
      normalizedName: catalog.normalizedName,
      description: catalog.description,
      category: catalog.category,
      priceCents: parsed.priceCents,
      currency: parsed.currency,
      available: parsed.available,
      unit: catalog.unit ?? catalog.sizeLabel,
      imageUrl: browserAccessibleMediaUrl(catalog.primaryImageUrl),
      searchAliases: aliases
    }
  });
}

/** Merchant "not found" path: create PENDING catalog + offer in one transaction. */
export async function submitMerchantNewCatalogProduct(merchantId: string, input: unknown) {
  const parsed = submitMerchantCatalogProductSchema.parse(input);
  if (!parsed.primaryImageUrl) {
    throw new AppError("Product photo is required for new catalog products.", 400, "IMAGE_REQUIRED");
  }

  const similar = await findSimilarCatalogProducts(parsed);
  if (!parsed.forceCreate) {
    if (similar.exactBarcodeMatch) {
      return {
        requiresConfirmation: true as const,
        reason: "BARCODE_MATCH" as const,
        matches: [similar.exactBarcodeMatch]
      };
    }
    if (similar.similar.length > 0) {
      return {
        requiresConfirmation: true as const,
        reason: "SIMILAR_PRODUCTS" as const,
        matches: similar.similar
      };
    }
  }

  return prisma.$transaction(async (tx) => {
    const barcode = normalizeBarcode(parsed.barcode);
    if (barcode) {
      const existingBarcode = await tx.catalogProduct.findUnique({ where: { barcode } });
      if (existingBarcode) {
        throw new AppError("A catalog product with this barcode already exists.", 409, "BARCODE_EXISTS", {
          catalogProductId: existingBarcode.id
        });
      }
    }

    const catalog = await tx.catalogProduct.create({
      data: {
        name: parsed.name.trim(),
        normalizedName: normalizeProductSearchName(parsed.name),
        brand: parsed.brand?.trim() || null,
        description: parsed.description?.trim() || null,
        category: parsed.category.trim(),
        sizeLabel: parsed.sizeLabel?.trim() || null,
        unit: parsed.unit?.trim() || null,
        barcode,
        primaryImageUrl: browserAccessibleMediaUrl(parsed.primaryImageUrl),
        status: "PENDING",
        source: "MERCHANT_SUBMISSION",
        submittedByMerchantId: merchantId,
        images: {
          create: {
            url: browserAccessibleMediaUrl(parsed.primaryImageUrl) || parsed.primaryImageUrl,
            sortOrder: 0,
            isPrimary: true
          }
        }
      }
    });

    const aliases = [...new Set(expandSearchTerms(catalog.name))].filter(Boolean);
    const offer = await tx.product.create({
      data: {
        merchantId,
        catalogProductId: catalog.id,
        name: catalog.name,
        normalizedName: catalog.normalizedName,
        description: catalog.description,
        category: catalog.category,
        priceCents: parsed.priceCents,
        currency: parsed.currency,
        available: parsed.available,
        unit: catalog.unit ?? catalog.sizeLabel,
        imageUrl: browserAccessibleMediaUrl(catalog.primaryImageUrl),
        searchAliases: aliases
      }
    });

    return {
      requiresConfirmation: false as const,
      catalogProduct: presentation(catalog),
      product: offer
    };
  });
}

/**
 * Backfill: one CatalogProduct per existing Product (no aggressive dedupe).
 * Preserves price/stock/merchant ownership. Idempotent for already-linked rows.
 */
export async function migrateExistingProductsToCatalog(): Promise<{
  merchantProductsBefore: number;
  alreadyLinked: number;
  canonicalCreated: number;
  merchantOffersLinked: number;
  uncertain: number;
  errors: Array<{ productId: string; message: string }>;
}> {
  const products = await prisma.product.findMany({ orderBy: { createdAt: "asc" } });
  let alreadyLinked = 0;
  let canonicalCreated = 0;
  let merchantOffersLinked = 0;
  const uncertain = 0;
  const errors: Array<{ productId: string; message: string }> = [];

  for (const product of products) {
    try {
      if (product.catalogProductId) {
        alreadyLinked += 1;
        continue;
      }

      const catalog = await prisma.catalogProduct.create({
        data: {
          name: product.name,
          normalizedName: product.normalizedName,
          description: product.description,
          category: product.category?.trim() || "Uncategorized",
          sizeLabel: product.unit,
          unit: product.unit,
          primaryImageUrl: product.imageUrl,
          status: "APPROVED",
          source: "IMPORT",
          approvedAt: new Date(),
          ...(product.imageUrl
            ? {
                images: {
                  create: {
                    url: product.imageUrl,
                    sortOrder: 0,
                    isPrimary: true
                  }
                }
              }
            : {})
        }
      });
      canonicalCreated += 1;

      await prisma.product.update({
        where: { id: product.id },
        data: { catalogProductId: catalog.id }
      });
      merchantOffersLinked += 1;
    } catch (err) {
      errors.push({
        productId: product.id,
        message: err instanceof Error ? err.message : String(err)
      });
    }
  }

  return {
    merchantProductsBefore: products.length,
    alreadyLinked,
    canonicalCreated,
    merchantOffersLinked,
    uncertain,
    errors
  };
}

/** Ensure upsert paths dual-write a catalog link when missing. */
export async function ensureCatalogLinkForProduct(productId: string) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return null;
  if (product.catalogProductId) return product.catalogProductId;

  const catalog = await prisma.catalogProduct.create({
    data: {
      name: product.name,
      normalizedName: product.normalizedName,
      description: product.description,
      category: product.category?.trim() || "Uncategorized",
      sizeLabel: product.unit,
      unit: product.unit,
      primaryImageUrl: product.imageUrl,
      status: "APPROVED",
      source: "IMPORT",
      approvedAt: new Date()
    }
  });

  await prisma.product.update({
    where: { id: product.id },
    data: { catalogProductId: catalog.id }
  });
  return catalog.id;
}
