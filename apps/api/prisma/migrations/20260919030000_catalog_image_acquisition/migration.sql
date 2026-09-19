-- H4 branded image acquisition workflow.
-- Additive only. Does not alter CatalogProduct IDs, Product rows, or orders.

CREATE TYPE "CatalogImageAcquisitionStatus" AS ENUM (
  'NEEDS_IMAGE_ACQUISITION',
  'PHOTO_RECEIVED',
  'VALIDATION_REQUIRED',
  'VALIDATED',
  'REJECTED',
  'UPLOADED'
);

CREATE TYPE "CatalogImageQueueKind" AS ENUM (
  'BRANDED',
  'GENERIC_EXCEPTION',
  'LEGACY_REVIEW'
);

CREATE TYPE "CatalogImageAssetRole" AS ENUM (
  'CANDIDATE',
  'REJECTED',
  'ASSIGNED'
);

CREATE TABLE "CatalogImageAcquisition" (
    "id" TEXT NOT NULL,
    "catalogProductId" TEXT NOT NULL,
    "queueKind" "CatalogImageQueueKind" NOT NULL,
    "exceptionQueue" TEXT,
    "status" "CatalogImageAcquisitionStatus" NOT NULL DEFAULT 'NEEDS_IMAGE_ACQUISITION',
    "sourceType" TEXT,
    "capturedByLabel" TEXT,
    "plannedName" TEXT NOT NULL,
    "plannedBrand" TEXT,
    "plannedSizeLabel" TEXT,
    "plannedCategory" TEXT NOT NULL,
    "brandFamily" TEXT,
    "acquisitionPack" TEXT,
    "acquisitionPriority" TEXT,
    "regionalPackageRisk" TEXT,
    "brandMetadataReview" BOOLEAN NOT NULL DEFAULT false,
    "likelyBrand" TEXT,
    "referenceImageUrl" TEXT,
    "candidateImageUrl" TEXT,
    "candidateObjectKey" TEXT,
    "assignedImageUrl" TEXT,
    "rejectionReason" TEXT,
    "rejectionNotes" TEXT,
    "regionalPackageConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "validationChecks" JSONB,
    "validatedAt" TIMESTAMP(3),
    "uploadedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogImageAcquisition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CatalogImageAcquisition_catalogProductId_key" ON "CatalogImageAcquisition"("catalogProductId");
CREATE INDEX "CatalogImageAcquisition_queueKind_status_idx" ON "CatalogImageAcquisition"("queueKind", "status");
CREATE INDEX "CatalogImageAcquisition_acquisitionPack_idx" ON "CatalogImageAcquisition"("acquisitionPack");
CREATE INDEX "CatalogImageAcquisition_acquisitionPriority_idx" ON "CatalogImageAcquisition"("acquisitionPriority");

ALTER TABLE "CatalogImageAcquisition" ADD CONSTRAINT "CatalogImageAcquisition_catalogProductId_fkey"
  FOREIGN KEY ("catalogProductId") REFERENCES "CatalogProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CatalogImageAcquisitionAsset" (
    "id" TEXT NOT NULL,
    "acquisitionId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "objectKey" TEXT,
    "role" "CatalogImageAssetRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogImageAcquisitionAsset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CatalogImageAcquisitionAsset_acquisitionId_role_idx"
  ON "CatalogImageAcquisitionAsset"("acquisitionId", "role");

ALTER TABLE "CatalogImageAcquisitionAsset" ADD CONSTRAINT "CatalogImageAcquisitionAsset_acquisitionId_fkey"
  FOREIGN KEY ("acquisitionId") REFERENCES "CatalogImageAcquisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
