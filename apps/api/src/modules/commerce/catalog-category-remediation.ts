import {
  CANONICAL_CATALOG_CATEGORIES,
  classifyCatalogCategory,
  summarizeCategoryClassifications,
  type CatalogCategoryClassification
} from "@gigflow/shared";
import type { PrismaClient } from "@prisma/client";

export type RemediationAction = "CORRECT" | "SKIP";

export type CatalogRemediationCandidate = {
  id: string;
  name: string;
  brand: string | null;
  description: string | null;
  category: string;
  subcategory: string | null;
  sizeLabel: string | null;
  status: string;
  source: string;
  barcode: string | null;
  unit: string | null;
  primaryImageUrl: string | null;
  normalizedName: string;
  submittedByMerchantId: string | null;
  approvedAt: Date | null;
  approvedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type RemediationDecision = {
  id: string;
  name: string;
  status: string;
  currentCategory: string;
  suggestedCategory: string | null;
  confidence: CatalogCategoryClassification["confidence"];
  evidence: string[];
  action: RemediationAction;
  reason: string;
};

export type CatalogFingerprint = {
  id: string;
  name: string;
  brand: string | null;
  description: string | null;
  subcategory: string | null;
  sizeLabel: string | null;
  status: string;
  source: string;
  barcode: string | null;
  unit: string | null;
  primaryImageUrl: string | null;
  normalizedName: string;
  submittedByMerchantId: string | null;
  approvedAt: string | null;
  approvedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

const CANONICAL = new Set<string>(CANONICAL_CATALOG_CATEGORIES as unknown as string[]);

const CATALOG_SELECT = {
  id: true,
  name: true,
  brand: true,
  description: true,
  category: true,
  subcategory: true,
  sizeLabel: true,
  status: true,
  source: true,
  barcode: true,
  unit: true,
  primaryImageUrl: true,
  normalizedName: true,
  submittedByMerchantId: true,
  approvedAt: true,
  approvedByUserId: true,
  createdAt: true,
  updatedAt: true
} as const;

function iso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function produceIdentityConflict(
  name: string,
  brand: string | null | undefined,
  description: string | null | undefined,
  suggested: string
) {
  if (suggested !== "Vegetables") return false;
  const hay = `${name} ${brand ?? ""} ${description ?? ""}`.toLowerCase();
  return /\bsoup\b|\bbroth\b|\bstock\b/.test(hay);
}

export function evaluateCatalogCategoryRemediation(input: {
  id: string;
  name: string;
  brand?: string | null;
  description?: string | null;
  status: string;
  classification: CatalogCategoryClassification;
}): RemediationDecision {
  const classification = input.classification;
  const base = {
    id: input.id,
    name: input.name,
    status: input.status,
    currentCategory: classification.currentCategory,
    suggestedCategory: classification.suggestedCategory,
    confidence: classification.confidence,
    evidence: classification.evidence
  };

  if (input.status === "ARCHIVED") {
    return { ...base, action: "SKIP", reason: "ARCHIVED" };
  }
  if (classification.confidence !== "HIGH") {
    return { ...base, action: "SKIP", reason: `confidence ${classification.confidence}` };
  }
  if (classification.agrees || !classification.appliedWouldChange || !classification.suggestedCategory) {
    return { ...base, action: "SKIP", reason: "no HIGH-confidence family mismatch" };
  }
  if (!CANONICAL.has(classification.suggestedCategory)) {
    return { ...base, action: "SKIP", reason: "suggested category is not canonical" };
  }
  if (produceIdentityConflict(input.name, input.brand, input.description, classification.suggestedCategory)) {
    return { ...base, action: "SKIP", reason: "conflicting product identity" };
  }
  return {
    ...base,
    action: "CORRECT",
    reason: "HIGH-confidence canonical mismatch"
  };
}

export function fingerprintCatalogProduct(row: CatalogRemediationCandidate): CatalogFingerprint {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    description: row.description,
    subcategory: row.subcategory,
    sizeLabel: row.sizeLabel,
    status: row.status,
    source: row.source,
    barcode: row.barcode,
    unit: row.unit,
    primaryImageUrl: row.primaryImageUrl,
    normalizedName: row.normalizedName,
    submittedByMerchantId: row.submittedByMerchantId,
    approvedAt: iso(row.approvedAt),
    approvedByUserId: row.approvedByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function stable(value: unknown) {
  return JSON.stringify(value);
}

async function safetySnapshot(prisma: PrismaClient) {
  const [
    catalogProducts,
    images,
    flavors,
    merchantProducts,
    catalogCount,
    imageCount,
    flavorCount,
    productCount,
    merchantCount,
    orderAgg,
    paymentCount,
    commercePaymentCount,
    checkoutCount,
    deliveryCount
  ] = await Promise.all([
    prisma.catalogProduct.findMany({
      select: CATALOG_SELECT,
      orderBy: { id: "asc" }
    }),
    prisma.catalogProductImage.findMany({
      select: {
        id: true,
        catalogProductId: true,
        url: true,
        sortOrder: true,
        isPrimary: true
      },
      orderBy: { id: "asc" }
    }),
    prisma.catalogProductFlavorOption.findMany({
      select: {
        id: true,
        catalogProductId: true,
        name: true,
        normalizedName: true
      },
      orderBy: { id: "asc" }
    }),
    prisma.product.findMany({
      select: {
        id: true,
        catalogProductId: true,
        merchantId: true,
        name: true,
        category: true,
        priceCents: true,
        available: true,
        quantityApprox: true,
        archived: true,
        imageUrl: true
      },
      orderBy: { id: "asc" }
    }),
    prisma.catalogProduct.count(),
    prisma.catalogProductImage.count(),
    prisma.catalogProductFlavorOption.count(),
    prisma.product.count(),
    prisma.merchant.count(),
    prisma.commerceOrder.aggregate({ _count: true, _max: { updatedAt: true } }),
    prisma.payment.count(),
    prisma.commercePaymentAttempt.count(),
    prisma.commerceCheckout.count(),
    prisma.courierDeliveryRelease.count()
  ]);

  return {
    catalogProducts,
    fingerprints: Object.fromEntries(
      catalogProducts.map((row) => [row.id, fingerprintCatalogProduct(row)])
    ) as Record<string, CatalogFingerprint>,
    categories: Object.fromEntries(catalogProducts.map((row) => [row.id, row.category])) as Record<
      string,
      string
    >,
    images,
    flavors,
    merchantProducts,
    counts: {
      catalogProducts: catalogCount,
      catalogImages: imageCount,
      catalogFlavors: flavorCount,
      merchantProducts: productCount,
      merchants: merchantCount,
      orders: orderAgg._count,
      orderMaxUpdatedAt: orderAgg._max.updatedAt?.toISOString() ?? null,
      payments: paymentCount,
      commercePayments: commercePaymentCount,
      checkouts: checkoutCount,
      deliveries: deliveryCount
    }
  };
}

export async function planCatalogCategoryRemediation(prisma: PrismaClient) {
  const products = await prisma.catalogProduct.findMany({
    select: CATALOG_SELECT,
    orderBy: { id: "asc" }
  });

  const rows = products.map((product) => {
    const classification = classifyCatalogCategory({
      name: product.name,
      brand: product.brand,
      description: product.description,
      category: product.category,
      subcategory: product.subcategory,
      sizeLabel: product.sizeLabel
    });
    const decision = evaluateCatalogCategoryRemediation({
      id: product.id,
      name: product.name,
      brand: product.brand,
      description: product.description,
      status: product.status,
      classification
    });
    return { product, classification, decision };
  });

  const classifications = rows.map((row) => row.classification);
  const decisions = rows.map((row) => row.decision);
  const highMismatches = rows.filter(
    (row) => row.classification.confidence === "HIGH" && !row.classification.agrees
  );
  const mediumMismatches = rows.filter(
    (row) => row.classification.confidence === "MEDIUM" && !row.classification.agrees
  );

  return {
    products,
    decisions,
    summary: summarizeCategoryClassifications(classifications),
    archived: products.filter((p) => p.status === "ARCHIVED").length,
    highMismatches: highMismatches.map((row) => row.decision),
    mediumMismatches: mediumMismatches.map((row) => ({
      id: row.product.id,
      name: row.product.name,
      status: row.product.status,
      currentCategory: row.classification.currentCategory,
      suggestedCategory: row.classification.suggestedCategory,
      confidence: row.classification.confidence,
      evidence: row.classification.evidence,
      action: "SKIP" as const,
      reason: "MEDIUM confidence"
    })),
    correct: decisions.filter((d) => d.action === "CORRECT"),
    skippedHigh: highMismatches
      .map((row) => row.decision)
      .filter((d) => d.action === "SKIP")
  };
}

function assertSnapshotsSafe(
  before: Awaited<ReturnType<typeof safetySnapshot>>,
  after: Awaited<ReturnType<typeof safetySnapshot>>,
  intended: RemediationDecision[]
) {
  if (stable(before.counts) !== stable(after.counts)) {
    throw new Error(`Unexpected count change: ${stable(before.counts)} -> ${stable(after.counts)}`);
  }
  if (stable(before.images) !== stable(after.images)) {
    throw new Error("Unexpected CatalogProductImage change");
  }
  if (stable(before.flavors) !== stable(after.flavors)) {
    throw new Error("Unexpected CatalogProductFlavorOption change");
  }
  if (stable(before.merchantProducts) !== stable(after.merchantProducts)) {
    throw new Error("Unexpected merchant Product change");
  }

  const beforeIds = Object.keys(before.fingerprints).sort();
  const afterIds = Object.keys(after.fingerprints).sort();
  if (stable(beforeIds) !== stable(afterIds)) {
    throw new Error("CatalogProduct IDs changed");
  }

  const intendedById = new Map(intended.map((row) => [row.id, row]));
  for (const id of beforeIds) {
    if (stable(before.fingerprints[id]) !== stable(after.fingerprints[id])) {
      throw new Error(`Unexpected non-category CatalogProduct field change for ${id}`);
    }
    const decision = intendedById.get(id);
    if (decision) {
      if (after.categories[id] !== decision.suggestedCategory) {
        throw new Error(`Category not applied for ${id}`);
      }
      if (before.categories[id] !== decision.currentCategory) {
        throw new Error(`Pre-apply category mismatch for ${id}`);
      }
    } else if (before.categories[id] !== after.categories[id]) {
      throw new Error(`Unauthorized category change for ${id}`);
    }
  }
}

export async function applyCatalogCategoryRemediation(
  prisma: PrismaClient,
  opts: { apply: boolean }
) {
  const plan = await planCatalogCategoryRemediation(prisma);
  const intended = plan.correct;

  const dryRunResult = {
    apply: false as const,
    writes: 0,
    summary: plan.summary,
    archived: plan.archived,
    proposed: intended,
    applied: [] as Array<{
      id: string;
      name: string;
      oldCategory: string;
      newCategory: string;
      confidence: string;
      evidence: string[];
    }>,
    skippedHigh: plan.skippedHigh,
    highMismatches: plan.highMismatches,
    mediumMismatches: plan.mediumMismatches
  };

  if (!opts.apply) {
    return dryRunResult;
  }

  const before = await safetySnapshot(prisma);
  const applied: Array<{
    id: string;
    name: string;
    oldCategory: string;
    newCategory: string;
    confidence: string;
    evidence: string[];
  }> = [];

  await prisma.$transaction(async (tx) => {
    for (const row of intended) {
      if (!row.suggestedCategory) {
        throw new Error(`Refusing apply without suggested category for ${row.id}`);
      }
      const result = await tx.$executeRaw`
        UPDATE "CatalogProduct"
        SET category = ${row.suggestedCategory}
        WHERE id = ${row.id}
          AND CAST(status AS TEXT) <> 'ARCHIVED'
          AND category = ${row.currentCategory}
      `;
      if (Number(result) !== 1) {
        throw new Error(`Expected 1 category update for ${row.id}, got ${String(result)}`);
      }
      applied.push({
        id: row.id,
        name: row.name,
        oldCategory: row.currentCategory,
        newCategory: row.suggestedCategory,
        confidence: row.confidence,
        evidence: row.evidence
      });
    }
  });

  const after = await safetySnapshot(prisma);
  assertSnapshotsSafe(before, after, intended);

  return {
    apply: true as const,
    writes: applied.length,
    summary: plan.summary,
    archived: plan.archived,
    proposed: intended,
    applied,
    skippedHigh: plan.skippedHigh,
    highMismatches: plan.highMismatches,
    mediumMismatches: plan.mediumMismatches,
    safety: {
      catalogProducts: after.counts.catalogProducts,
      merchantProducts: after.counts.merchantProducts,
      orders: after.counts.orders,
      payments: after.counts.payments,
      deliveries: after.counts.deliveries
    }
  };
}
