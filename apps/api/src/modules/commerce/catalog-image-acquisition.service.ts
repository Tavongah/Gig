import { readFile } from "node:fs/promises";
import type {
  CatalogImageAcquisitionPack,
  CatalogImageAcquisitionPriority,
  CatalogImageQueueTab,
  CatalogImageRejectionReason,
  CatalogImageSourceType
} from "@gigflow/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import { persistNormalizedCatalogPhoto } from "../../lib/catalog-photo-upload.js";
import { localMediaAbsolutePath } from "../../lib/spaces.js";
import { browserAccessibleMediaUrl } from "../../lib/catalog-media.js";
import { updateCatalogProduct } from "./catalog.service.js";
import {
  ALL_ACQUISITION_PLAN,
  BRANDED_ACQUISITION_PLAN,
  GENERIC_EXCEPTION_PLAN,
  LEGACY_REVIEW_PLAN,
  MOBILE_CAPTURE_INSTRUCTIONS,
  PACK_LABELS,
  filterAcquisitionQueue,
  identityMatchesPlan,
  packProgressFromRows,
  sortAcquisitionQueue,
  type FilterableAcquisition
} from "./catalog-image-acquisition.plan.js";

const HIGH_RISK = "HIGH";

export type ValidationChecks = {
  brandMatches: true;
  productMatches: true;
  sizeMatches: true;
  flavorMatches: true;
  packageTypeMatches: true;
  imageClear: true;
  noWatermark: true;
  noPriceOverlay: true;
  regionalPackageConfirmed?: boolean;
};

function hasImage(url: string | null | undefined): boolean {
  return Boolean(url && url.trim());
}

export async function ensureAcquisitionRows(): Promise<void> {
  const existing = await prisma.catalogImageAcquisition.findMany({
    select: { catalogProductId: true }
  });
  const have = new Set(existing.map((r) => r.catalogProductId));
  const products = await prisma.catalogProduct.findMany({
    where: { id: { in: ALL_ACQUISITION_PLAN.map((p) => p.catalogProductId) } },
    select: { id: true }
  });
  const live = new Set(products.map((p) => p.id));
  const missing = ALL_ACQUISITION_PLAN.filter((p) => !have.has(p.catalogProductId) && live.has(p.catalogProductId));
  if (missing.length === 0) return;
  await prisma.catalogImageAcquisition.createMany({
    data: missing.map((p) => ({
      catalogProductId: p.catalogProductId,
      queueKind: p.queueKind,
      exceptionQueue: p.exceptionQueue,
      plannedName: p.plannedName,
      plannedBrand: p.plannedBrand,
      plannedSizeLabel: p.plannedSizeLabel,
      plannedCategory: p.plannedCategory,
      brandFamily: p.brandFamily,
      acquisitionPack: p.acquisitionPack,
      acquisitionPriority: p.acquisitionPriority,
      regionalPackageRisk: p.regionalPackageRisk,
      brandMetadataReview: p.brandMetadataReview,
      likelyBrand: p.likelyBrand,
      referenceImageUrl: p.referenceImageUrl,
      notes: p.notes,
      status: "NEEDS_IMAGE_ACQUISITION"
    }))
  });
}

function presentation(row: {
  id: string;
  catalogProductId: string;
  queueKind: FilterableAcquisition["queueKind"];
  exceptionQueue: string | null;
  status: string;
  sourceType: string | null;
  capturedByLabel: string | null;
  plannedName: string;
  plannedBrand: string | null;
  plannedSizeLabel: string | null;
  plannedCategory: string;
  brandFamily: string | null;
  acquisitionPack: string | null;
  acquisitionPriority: string | null;
  regionalPackageRisk: string | null;
  brandMetadataReview: boolean;
  likelyBrand: string | null;
  referenceImageUrl: string | null;
  candidateImageUrl: string | null;
  assignedImageUrl: string | null;
  rejectionReason: string | null;
  rejectionNotes: string | null;
  regionalPackageConfirmed: boolean;
  validatedAt: Date | null;
  uploadedAt: Date | null;
  notes: string | null;
  catalogProduct: {
    name: string;
    brand: string | null;
    sizeLabel: string | null;
    category: string;
    status: string;
    primaryImageUrl: string | null;
  };
}) {
  const liveUrl = browserAccessibleMediaUrl(row.catalogProduct.primaryImageUrl);
  const alreadyExists = hasImage(liveUrl) && row.status !== "UPLOADED";
  return {
    id: row.id,
    catalogProductId: row.catalogProductId,
    queueKind: row.queueKind,
    exceptionQueue: row.exceptionQueue,
    status: alreadyExists ? "IMAGE_ALREADY_EXISTS" : row.status,
    acquisitionStatus: row.status,
    sourceType: row.sourceType,
    capturedByLabel: row.capturedByLabel,
    name: row.catalogProduct.name,
    brand: row.catalogProduct.brand,
    sizeLabel: row.catalogProduct.sizeLabel,
    category: row.catalogProduct.category,
    catalogStatus: row.catalogProduct.status,
    brandFamily: row.brandFamily,
    acquisitionPack: row.acquisitionPack,
    packLabel: row.acquisitionPack
      ? PACK_LABELS[row.acquisitionPack as CatalogImageAcquisitionPack] ?? row.acquisitionPack
      : null,
    priority: row.acquisitionPriority,
    regionalPackageRisk: row.regionalPackageRisk,
    zimbabwePackagePreferred: row.regionalPackageRisk ? true : false,
    brandMetadataReview: row.brandMetadataReview,
    likelyBrand: row.likelyBrand,
    referenceImageUrl: browserAccessibleMediaUrl(row.referenceImageUrl),
    candidateImageUrl: browserAccessibleMediaUrl(row.candidateImageUrl),
    assignedImageUrl: browserAccessibleMediaUrl(row.assignedImageUrl),
    livePrimaryImageUrl: liveUrl,
    imageState: hasImage(liveUrl) ? "HAS_IMAGE" : "MISSING",
    alreadyExists,
    rejectionReason: row.rejectionReason,
    rejectionNotes: row.rejectionNotes,
    regionalPackageConfirmed: row.regionalPackageConfirmed,
    validatedAt: row.validatedAt,
    uploadedAt: row.uploadedAt,
    notes: row.notes,
    readOnly: row.queueKind === "LEGACY_REVIEW"
  };
}

export async function listImageQueue(input: {
  tab?: CatalogImageQueueTab;
  pack?: CatalogImageAcquisitionPack;
  priority?: CatalogImageAcquisitionPriority;
  q?: string;
}) {
  await ensureAcquisitionRows();
  const rows = await prisma.catalogImageAcquisition.findMany({
    include: {
      catalogProduct: {
        select: {
          name: true,
          brand: true,
          sizeLabel: true,
          category: true,
          status: true,
          primaryImageUrl: true
        }
      }
    }
  });

  const filterable: Array<FilterableAcquisition & { raw: (typeof rows)[number] }> = rows.map((row) => ({
    catalogProductId: row.catalogProductId,
    queueKind: row.queueKind,
    exceptionQueue: row.exceptionQueue,
    plannedName: row.plannedName,
    plannedBrand: row.plannedBrand,
    plannedSizeLabel: row.plannedSizeLabel,
    plannedCategory: row.plannedCategory,
    brandFamily: row.brandFamily,
    likelyBrand: row.likelyBrand,
    acquisitionPack: row.acquisitionPack,
    acquisitionPriority: row.acquisitionPriority,
    status: row.status,
    hasLiveImage: hasImage(row.catalogProduct.primaryImageUrl),
    raw: row
  }));

  const tab = input.tab ?? "branded";
  const filtered = sortAcquisitionQueue(
    filterAcquisitionQueue(filterable, {
      tab,
      pack: input.pack,
      priority: input.priority,
      q: input.q
    })
  );

  const branded = filterable.filter((r) => r.queueKind === "BRANDED");
  const exceptions = filterable.filter((r) => r.queueKind === "GENERIC_EXCEPTION");
  const packs = packProgressFromRows(filterable);
  const brandedMissing = branded.filter((r) => !r.hasLiveImage && r.status !== "UPLOADED").length;

  return {
    items: filtered.map((r) => presentation(r.raw)),
    instructions: MOBILE_CAPTURE_INSTRUCTIONS,
    summary: {
      branded: branded.length,
      brandedMissing,
      brandedComplete: branded.length - brandedMissing,
      priorityA: branded.filter((r) => r.acquisitionPriority === "BRANDED_PRIORITY_A").length,
      priorityB: branded.filter((r) => r.acquisitionPriority === "BRANDED_PRIORITY_B").length,
      priorityC: branded.filter((r) => r.acquisitionPriority === "BRANDED_PRIORITY_C").length,
      exceptions: exceptions.length,
      humanReview: exceptions.filter((r) => r.exceptionQueue === "HUMAN_REVIEW").length,
      legacyReview: filterable.filter((r) => r.queueKind === "LEGACY_REVIEW").length,
      packs
    },
    planCounts: {
      brandedPlan: BRANDED_ACQUISITION_PLAN.length,
      exceptionPlan: GENERIC_EXCEPTION_PLAN.length,
      legacyPlan: LEGACY_REVIEW_PLAN.length
    }
  };
}

async function loadAcquisition(id: string) {
  const row = await prisma.catalogImageAcquisition.findUnique({
    where: { id },
    include: {
      catalogProduct: {
        select: {
          id: true,
          name: true,
          brand: true,
          sizeLabel: true,
          category: true,
          status: true,
          primaryImageUrl: true
        }
      }
    }
  });
  if (!row) throw new AppError("Acquisition record not found.", 404, "NOT_FOUND");
  return row;
}

export async function uploadAcquisitionCandidate(
  acquisitionId: string,
  input: { userId: string; fileName?: string; dataBase64: string }
) {
  const row = await loadAcquisition(acquisitionId);
  if (row.queueKind === "LEGACY_REVIEW") {
    throw new AppError("Legacy images are read-only in this phase.", 409, "LEGACY_REVIEW_READONLY");
  }
  const uploaded = await persistNormalizedCatalogPhoto({
    userId: input.userId,
    fileName: input.fileName,
    dataBase64: input.dataBase64
  });

  if (row.candidateImageUrl) {
    await prisma.catalogImageAcquisitionAsset.create({
      data: {
        acquisitionId: row.id,
        url: row.candidateImageUrl,
        objectKey: row.candidateObjectKey,
        role: "REJECTED"
      }
    });
  }

  await prisma.catalogImageAcquisitionAsset.create({
    data: {
      acquisitionId: row.id,
      url: uploaded.url,
      objectKey: uploaded.objectKey,
      role: "CANDIDATE"
    }
  });

  const updated = await prisma.catalogImageAcquisition.update({
    where: { id: row.id },
    data: {
      candidateImageUrl: uploaded.url,
      candidateObjectKey: uploaded.objectKey,
      status: "VALIDATION_REQUIRED",
      rejectionReason: null,
      rejectionNotes: null,
      regionalPackageConfirmed: false,
      validationChecks: Prisma.JsonNull,
      validatedAt: null
    },
    include: {
      catalogProduct: {
        select: {
          name: true,
          brand: true,
          sizeLabel: true,
          category: true,
          status: true,
          primaryImageUrl: true
        }
      }
    }
  });

  return presentation(updated);
}

export async function rejectAcquisitionPhoto(
  acquisitionId: string,
  input: { reason: CatalogImageRejectionReason; notes?: string | null }
) {
  const row = await loadAcquisition(acquisitionId);
  if (row.queueKind === "LEGACY_REVIEW") {
    throw new AppError("Legacy images are read-only in this phase.", 409, "LEGACY_REVIEW_READONLY");
  }
  if (row.candidateImageUrl) {
    await prisma.catalogImageAcquisitionAsset.create({
      data: {
        acquisitionId: row.id,
        url: row.candidateImageUrl,
        objectKey: row.candidateObjectKey,
        role: "REJECTED"
      }
    });
  }
  const updated = await prisma.catalogImageAcquisition.update({
    where: { id: row.id },
    data: {
      status: "REJECTED",
      rejectionReason: input.reason,
      rejectionNotes: input.notes?.trim() || null,
      validationChecks: Prisma.JsonNull,
      validatedAt: null
    },
    include: {
      catalogProduct: {
        select: {
          name: true,
          brand: true,
          sizeLabel: true,
          category: true,
          status: true,
          primaryImageUrl: true
        }
      }
    }
  });
  return presentation(updated);
}

async function assertCandidateJpeg(url: string, objectKey: string | null) {
  if (objectKey) {
    try {
      const buf = await readFile(localMediaAbsolutePath(objectKey));
      if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) return;
    } catch {
      /* not a local file */
    }
  }
  const res = await fetch(url);
  if (res.status !== 200) {
    throw new AppError("Could not verify the photo URL.", 502, "IMAGE_VERIFY_FAILED");
  }
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (!ct.includes("jpeg") && !ct.includes("jpg")) {
    throw new AppError("Processed photo must be a JPEG.", 400, "IMAGE_VERIFY_FAILED");
  }
}

export async function assignValidatedAcquisition(
  acquisitionId: string,
  input: {
    catalogProductId: string;
    sourceType: CatalogImageSourceType;
    capturedByLabel?: string | null;
    checks: ValidationChecks;
  }
) {
  const row = await loadAcquisition(acquisitionId);
  if (row.queueKind === "LEGACY_REVIEW") {
    throw new AppError("Legacy images are read-only in this phase.", 409, "LEGACY_REVIEW_READONLY");
  }
  if (row.catalogProductId !== input.catalogProductId) {
    throw new AppError("Catalog product does not match this acquisition record.", 409, "IDENTITY_MISMATCH");
  }
  if (row.catalogProduct.id !== row.catalogProductId) {
    throw new AppError("Catalog product does not match this acquisition record.", 409, "IDENTITY_MISMATCH");
  }
  if (!identityMatchesPlan(row.catalogProduct, row)) {
    throw new AppError("Live product identity no longer matches the acquisition plan.", 409, "IDENTITY_MISMATCH");
  }
  if (row.status !== "VALIDATION_REQUIRED" && row.status !== "PHOTO_RECEIVED" && row.status !== "VALIDATED") {
    throw new AppError("This photo still needs to be uploaded and previewed before assignment.", 409, "VALIDATION_REQUIRED");
  }
  if (!row.candidateImageUrl) {
    throw new AppError("Upload and preview a photo before assigning it.", 409, "VALIDATION_REQUIRED");
  }
  if (hasImage(row.catalogProduct.primaryImageUrl)) {
    throw new AppError("This product already has an image. It was not overwritten.", 409, "IMAGE_ALREADY_EXISTS");
  }
  if (row.regionalPackageRisk === HIGH_RISK && input.checks.regionalPackageConfirmed !== true) {
    throw new AppError("Confirm this packaging is appropriate for the Zimbabwe market.", 400, "REGIONAL_PACKAGE_REQUIRED");
  }

  const candidateUrl = browserAccessibleMediaUrl(row.candidateImageUrl) || row.candidateImageUrl;
  await assertCandidateJpeg(candidateUrl, row.candidateObjectKey);

  await prisma.catalogImageAcquisition.update({
    where: { id: row.id },
    data: {
      status: "VALIDATED",
      sourceType: input.sourceType,
      capturedByLabel: input.capturedByLabel?.trim() || null,
      regionalPackageConfirmed: input.checks.regionalPackageConfirmed === true,
      validationChecks: input.checks,
      validatedAt: new Date()
    }
  });

  const assigned = await updateCatalogProduct(row.catalogProductId, {
    primaryImageUrl: candidateUrl
  });

  await prisma.catalogImageAcquisitionAsset.create({
    data: {
      acquisitionId: row.id,
      url: candidateUrl,
      objectKey: row.candidateObjectKey,
      role: "ASSIGNED"
    }
  });

  const updated = await prisma.catalogImageAcquisition.update({
    where: { id: row.id },
    data: {
      status: "UPLOADED",
      assignedImageUrl: assigned.primaryImageUrl,
      uploadedAt: new Date()
    },
    include: {
      catalogProduct: {
        select: {
          name: true,
          brand: true,
          sizeLabel: true,
          category: true,
          status: true,
          primaryImageUrl: true
        }
      }
    }
  });

  return presentation(updated);
}
