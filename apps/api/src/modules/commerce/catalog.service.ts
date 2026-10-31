import {
  ADMIN_CATALOG_LIST_LIMIT,
  CATALOG_PRODUCT_SCAN_LIMIT,
  MERCHANT_CATALOG_SEARCH_LIMIT_MAX,
  UNRESOLVED_LEGACY_CATALOG_PRODUCT_IDS,
  applyFutureCatalogCategory,
  catalogSearchHaystack,
  createCatalogProductSchema,
  expandSearchTerms,
  canPurchaseStorefrontCategory,
  catalogCategoriesForCustomerQuery,
  categoryFromShopOffer,
  fuzzyCatalogCategoryForCustomerQuery,
  isPublicStorefrontCatalogProduct,
  isUnresolvedLegacyCatalogProduct,
  linkMerchantOfferSchema,
  parseAlcoholCommerceEnabled,
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
  const resolved = applyFutureCatalogCategory({
    name: parsed.name,
    brand: parsed.brand,
    description: parsed.description,
    category: parsed.category,
    subcategory: parsed.subcategory,
    sizeLabel: parsed.sizeLabel
  });
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
      category: resolved.category,
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

  const { flavorNamesByCatalogId } = await import("./flavor.service.js");
  const flavorNames = await flavorNamesByCatalogId(rows.map((p) => p.id));
  const terms = expandSearchTerms(q);
  const scored = rows
    .map((p) => {
      const hay = catalogSearchHaystack({ ...p, flavorNames: flavorNames.get(p.id) });
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

function isolateCatalogQuery(query: string): string {
  const stripped = query
    .replace(/^(?:do you have|have you got|i am looking for|i'm looking for|im looking for|looking for)\s+/i, "")
    .replace(/^(?:i want|i need|give me|get me)\s+/i, "")
    .replace(/[?!.]+/g, " ");
  return normalizeProductSearchName(stripped);
}

function publicCatalogProducts<T extends { id: string; status: string; category?: string | null }>(products: T[]): T[] {
  const alcoholEnabled = parseAlcoholCommerceEnabled(process.env.ALCOHOL_COMMERCE_ENABLED);
  return products.filter(
    (product) =>
      isPublicStorefrontCatalogProduct(product) &&
      canPurchaseStorefrontCategory(product.category, alcoholEnabled)
  );
}

async function productsInCatalogCategories(categories: string[]) {
  if (!categories.length) return [];
  const rows = await prisma.catalogProduct.findMany({
    where: {
      status: "APPROVED",
      OR: [
        { category: { in: categories } },
        ...categories.map((category) => ({
          subcategory: { equals: category, mode: "insensitive" as const }
        }))
      ]
    },
    orderBy: [{ name: "asc" }],
    take: 24
  });
  return publicCatalogProducts(rows.map(presentation)).slice(0, 8);
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  let prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = cur;
  }
  return prev[b.length] ?? 2;
}

async function fuzzyPublicProductNames(query: string) {
  if (query.length < 5 || query.includes(" ")) return [];
  const rows = await prisma.catalogProduct.findMany({
    where: { status: "APPROVED" },
    orderBy: [{ name: "asc" }],
    take: CATALOG_PRODUCT_SCAN_LIMIT
  });
  const ranked = rows
    .map((product) => ({ product, distance: editDistance(query, product.normalizedName) }))
    .filter((row) => row.distance === 1);
  if (!ranked.length) return [];
  return publicCatalogProducts(ranked.map((row) => presentation(row.product))).slice(0, 8);
}

/** Approved DUTS catalog matches for a customer request. Not filtered by merchant or distance. */
export async function matchPublicCatalogDemand(query: string) {
  const cleaned = isolateCatalogQuery(query);
  if (cleaned.length < 2) return [];

  const found = await searchCatalogProducts({ q: cleaned, limit: 8, status: "APPROVED" });
  const direct = publicCatalogProducts(found.products);
  if (direct.length) return direct;

  const namedCategories = catalogCategoriesForCustomerQuery(cleaned);
  const fromCategory = await productsInCatalogCategories(namedCategories);
  if (fromCategory.length) return fromCategory;

  const typoCategory = fuzzyCatalogCategoryForCustomerQuery(cleaned);
  if (typoCategory) {
    const fromTypo = await productsInCatalogCategories([typoCategory]);
    if (fromTypo.length) return fromTypo;
  }

  return fuzzyPublicProductNames(cleaned);
}

export async function getCatalogProduct(id: string) {
  const product = await prisma.catalogProduct.findUnique({
    where: { id },
    include: {
      images: { orderBy: { sortOrder: "asc" } },
      flavorOptions: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }
    }
  });
  if (!product) throw new AppError("Catalog product not found.", 404, "CATALOG_PRODUCT_NOT_FOUND");
  return {
    product: presentation(product),
    images: product.images,
    flavors: product.flavorOptions
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

  const resolved = {
    category: categoryFromShopOffer({
      name: parsed.name,
      category: parsed.category,
      unit: parsed.unit ?? parsed.sizeLabel
    })
  };

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
        category: resolved.category,
        sizeLabel: parsed.sizeLabel?.trim() || null,
        unit: parsed.unit?.trim() || null,
        barcode,
        primaryImageUrl: browserAccessibleMediaUrl(parsed.primaryImageUrl),
        status: parsed.available === false ? "PENDING" : "APPROVED",
        source: "MERCHANT_SUBMISSION",
        submittedByMerchantId: merchantId,
        approvedAt: parsed.available === false ? null : new Date(),
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

export type ShopCatalogOffer = {
  productId: string;
  merchantId: string;
  name: string;
  normalizedName: string;
  unit: string | null;
  category: string | null;
  description: string | null;
  available: boolean;
  archived: boolean;
  imageUrl: string | null;
  priceCents: number;
  catalogProductId: string | null;
  catalogStatus: string | null;
  catalogCategory: string | null;
  catalogNormalizedName: string | null;
  catalogUnit: string | null;
  catalogSizeLabel: string | null;
  catalogImageUrl: string | null;
};

export type ShopCatalogPlanAction =
  | { productId: string; action: "already_public" }
  | { productId: string; action: "publish"; catalogProductId: string; category: string; categoryChanged: boolean; imageFilled: boolean }
  | { productId: string; action: "link"; catalogProductId: string; publish: boolean; category: string | null }
  | { productId: string; action: "create"; category: string; separate: boolean }
  | { productId: string; action: "skip"; reason: "archived" | "inactive" | "rejected" };

function offerSizeKey(unit: string | null | undefined, sizeLabel?: string | null): string {
  return normalizeProductSearchName(unit || sizeLabel || "");
}

/**
 * Read-only plan. Exact normalized name plus size. No fuzzy merge.
 * A shop cannot hold two offers of one catalog product, so a second row is created separately.
 */
export function planShopCatalogSync(
  rows: ShopCatalogOffer[],
  knownCatalogs: Array<{
    id: string;
    normalizedName: string;
    unit: string | null;
    sizeLabel: string | null;
    status: string;
    merchantIds: string[];
  }> = []
): {
  scanned: number;
  alreadyPublic: number;
  published: number;
  linked: number;
  created: number;
  skipped: number;
  categoryCorrected: number;
  actions: ShopCatalogPlanAction[];
} {
  const catalogs = new Map<
    string,
    { id: string; normalizedName: string; size: string; status: string; merchants: Set<string> }
  >();
  for (const known of knownCatalogs) {
    if (!known.normalizedName || known.status === "ARCHIVED" || known.status === "REJECTED") continue;
    catalogs.set(known.id, {
      id: known.id,
      normalizedName: known.normalizedName,
      size: offerSizeKey(known.unit, known.sizeLabel),
      status: known.status,
      merchants: new Set(known.merchantIds)
    });
  }
  for (const row of rows) {
    if (!row.catalogProductId || !row.catalogNormalizedName || !row.catalogStatus) continue;
    if (row.catalogStatus === "ARCHIVED" || row.catalogStatus === "REJECTED") continue;
    const existing = catalogs.get(row.catalogProductId);
    if (existing) {
      existing.merchants.add(row.merchantId);
      continue;
    }
    catalogs.set(row.catalogProductId, {
      id: row.catalogProductId,
      normalizedName: row.catalogNormalizedName,
      size: offerSizeKey(row.catalogUnit, row.catalogSizeLabel),
      status: row.catalogStatus,
      merchants: new Set([row.merchantId])
    });
  }

  const actions: ShopCatalogPlanAction[] = [];
  let alreadyPublic = 0;
  let published = 0;
  let linked = 0;
  let created = 0;
  let skipped = 0;
  let categoryCorrected = 0;

  for (const row of rows) {
    if (row.archived) {
      skipped += 1;
      actions.push({ productId: row.productId, action: "skip", reason: "archived" });
      continue;
    }
    if (!row.available) {
      skipped += 1;
      actions.push({ productId: row.productId, action: "skip", reason: "inactive" });
      continue;
    }
    if (row.catalogStatus === "REJECTED") {
      skipped += 1;
      actions.push({ productId: row.productId, action: "skip", reason: "rejected" });
      continue;
    }
    if (row.catalogStatus === "APPROVED" && row.catalogProductId) {
      alreadyPublic += 1;
      actions.push({ productId: row.productId, action: "already_public" });
      continue;
    }
    if (row.catalogStatus === "PENDING" && row.catalogProductId) {
      const category = categoryFromShopOffer({ name: row.name, category: row.catalogCategory ?? row.category, unit: row.unit });
      const categoryChanged = category !== (row.catalogCategory ?? "");
      if (categoryChanged) categoryCorrected += 1;
      published += 1;
      actions.push({
        productId: row.productId,
        action: "publish",
        catalogProductId: row.catalogProductId,
        category,
        categoryChanged,
        imageFilled: !row.catalogImageUrl && Boolean(row.imageUrl)
      });
      continue;
    }

    const size = offerSizeKey(row.unit);
    const matches = [...catalogs.values()].filter(
      (catalog) => catalog.normalizedName === row.normalizedName && catalog.size === size
    );
    const shareable = matches.filter((catalog) => !catalog.merchants.has(row.merchantId));
    const approved = shareable.filter((catalog) => catalog.status === "APPROVED");
    const chosen = approved.length === 1 ? approved : shareable.length === 1 ? shareable : [];
    if (chosen.length === 1) {
      const match = chosen[0]!;
      match.merchants.add(row.merchantId);
      const category = match.status === "PENDING"
        ? categoryFromShopOffer({ name: row.name, category: row.category, unit: row.unit })
        : null;
      if (match.status === "PENDING") match.status = "APPROVED";
      linked += 1;
      actions.push({
        productId: row.productId,
        action: "link",
        catalogProductId: match.id,
        publish: category !== null,
        category
      });
      continue;
    }

    const category = categoryFromShopOffer({ name: row.name, category: row.category, unit: row.unit });
    const id = `planned-${row.productId}`;
    catalogs.set(id, {
      id,
      normalizedName: row.normalizedName,
      size,
      status: "APPROVED",
      merchants: new Set([row.merchantId])
    });
    created += 1;
    actions.push({ productId: row.productId, action: "create", category, separate: shareable.length === 0 && matches.length > 0 });
  }

  return {
    scanned: rows.length,
    alreadyPublic,
    published,
    linked,
    created,
    skipped,
    categoryCorrected,
    actions
  };
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
  const report = await syncShopCatalog({ apply: true });
  return {
    merchantProductsBefore: report.scanned,
    alreadyLinked: report.alreadyPublic,
    canonicalCreated: report.created,
    merchantOffersLinked: report.linked + report.created + report.published,
    uncertain: report.skipped,
    errors: report.failures
  };
}

async function loadShopCatalogOffers(): Promise<ShopCatalogOffer[]> {
  const products = await prisma.product.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      catalogProduct: {
        select: {
          id: true,
          status: true,
          category: true,
          normalizedName: true,
          unit: true,
          sizeLabel: true,
          primaryImageUrl: true
        }
      }
    }
  });
  return products.map((product) => ({
    productId: product.id,
    merchantId: product.merchantId,
    name: product.name,
    normalizedName: product.normalizedName,
    unit: product.unit,
    category: product.category,
    description: product.description,
    available: product.available,
    archived: product.archived,
    imageUrl: product.imageUrl,
    priceCents: product.priceCents,
    catalogProductId: product.catalogProductId,
    catalogStatus: product.catalogProduct?.status ?? null,
    catalogCategory: product.catalogProduct?.category ?? null,
    catalogNormalizedName: product.catalogProduct?.normalizedName ?? null,
    catalogUnit: product.catalogProduct?.unit ?? null,
    catalogSizeLabel: product.catalogProduct?.sizeLabel ?? null,
    catalogImageUrl: product.catalogProduct?.primaryImageUrl ?? null
  }));
}

/** Dry-run when apply is false. Writes only when apply is true. */
export async function syncShopCatalog(opts?: { apply?: boolean; productId?: string }) {
  const apply = opts?.apply === true;
  const rows = await loadShopCatalogOffers();
  const known = await prisma.catalogProduct.findMany({
    where: { status: { in: ["APPROVED", "PENDING"] } },
    select: {
      id: true,
      normalizedName: true,
      unit: true,
      sizeLabel: true,
      status: true,
      merchantOffers: { select: { merchantId: true } }
    }
  });
  const plan = planShopCatalogSync(
    rows,
    known.map((catalog) => ({
      id: catalog.id,
      normalizedName: catalog.normalizedName,
      unit: catalog.unit,
      sizeLabel: catalog.sizeLabel,
      status: catalog.status,
      merchantIds: catalog.merchantOffers.map((product) => product.merchantId)
    }))
  );
  const actions = opts?.productId ? plan.actions.filter((action) => action.productId === opts.productId) : plan.actions;
  const failures: Array<{ productId: string; message: string }> = [];
  if (!apply) return { ...plan, applied: false as const, failures };

  const byId = new Map(rows.map((row) => [row.productId, row]));
  for (const action of actions) {
    const row = byId.get(action.productId);
    if (!row) continue;
    try {
      if (action.action === "publish") {
        await prisma.catalogProduct.update({
          where: { id: action.catalogProductId },
          data: {
            status: "APPROVED",
            approvedAt: new Date(),
            ...(action.categoryChanged ? { category: action.category } : {}),
            ...(action.imageFilled ? { primaryImageUrl: row.imageUrl } : {})
          }
        });
      } else if (action.action === "link") {
        if (action.publish) {
          await prisma.catalogProduct.update({
            where: { id: action.catalogProductId },
            data: { status: "APPROVED", approvedAt: new Date(), ...(action.category ? { category: action.category } : {}) }
          });
        }
        await prisma.product.update({
          where: { id: row.productId },
          data: { catalogProductId: action.catalogProductId }
        });
      } else if (action.action === "create") {
        const product = row;
        const category = action.category || product.category?.trim() || "Uncategorized";
        const catalog = await prisma.catalogProduct.create({
          data: {
            name: row.name,
            normalizedName: row.normalizedName,
            description: row.description,
            category,
            sizeLabel: row.unit,
            unit: row.unit,
            primaryImageUrl: row.imageUrl,
            status: "APPROVED",
            source: "IMPORT",
            approvedAt: new Date(),
            ...(row.imageUrl
              ? { images: { create: { url: row.imageUrl, sortOrder: 0, isPrimary: true } } }
              : {})
          }
        });
        await prisma.product.update({
          where: { id: row.productId },
          data: { catalogProductId: catalog.id }
        });
      }
    } catch (err) {
      failures.push({
        productId: row.productId,
        message: err instanceof Error ? err.message : String(err)
      });
    }
  }
  return { ...plan, applied: true as const, failures };
}

/** Ensure upsert paths dual-write a catalog link when missing. */
export async function ensureCatalogLinkForProduct(productId: string) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product || product.archived || !product.available) return product?.catalogProductId ?? null;
  if (product.catalogProductId) {
    const catalog = await prisma.catalogProduct.findUnique({ where: { id: product.catalogProductId } });
    if (!catalog || catalog.status === "REJECTED" || catalog.status === "ARCHIVED") return product.catalogProductId;
    if (catalog.status === "APPROVED") return catalog.id;
  }
  try {
    await syncShopCatalog({ apply: true, productId });
  } catch (err) {
    console.error("[catalog] shop link failed", productId, err instanceof Error ? err.message : "unknown");
  }
  const after = await prisma.product.findUnique({ where: { id: productId } });
  return after?.catalogProductId ?? null;
}
