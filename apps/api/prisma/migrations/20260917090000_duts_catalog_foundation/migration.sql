-- Additive DUTS canonical catalog foundation.
-- Product rows remain the merchant-offer façade (stable IDs for WhatsApp/orders).

CREATE TYPE "CatalogProductStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED');
CREATE TYPE "CatalogProductSource" AS ENUM ('DUTS_ADMIN', 'MERCHANT_SUBMISSION', 'IMPORT');

CREATE TABLE "CatalogProduct" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "brand" TEXT,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "sizeLabel" TEXT,
    "unit" TEXT,
    "barcode" TEXT,
    "primaryImageUrl" TEXT,
    "status" "CatalogProductStatus" NOT NULL DEFAULT 'APPROVED',
    "source" "CatalogProductSource" NOT NULL DEFAULT 'DUTS_ADMIN',
    "submittedByMerchantId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CatalogProductImage" (
    "id" TEXT NOT NULL,
    "catalogProductId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogProductImage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CatalogProduct_normalizedName_idx" ON "CatalogProduct"("normalizedName");
CREATE INDEX "CatalogProduct_status_idx" ON "CatalogProduct"("status");
CREATE INDEX "CatalogProduct_category_idx" ON "CatalogProduct"("category");
CREATE UNIQUE INDEX "CatalogProduct_barcode_key" ON "CatalogProduct"("barcode");
CREATE INDEX "CatalogProductImage_catalogProductId_sortOrder_idx" ON "CatalogProductImage"("catalogProductId", "sortOrder");

ALTER TABLE "CatalogProduct" ADD CONSTRAINT "CatalogProduct_submittedByMerchantId_fkey"
  FOREIGN KEY ("submittedByMerchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CatalogProductImage" ADD CONSTRAINT "CatalogProductImage_catalogProductId_fkey"
  FOREIGN KEY ("catalogProductId") REFERENCES "CatalogProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Product" ADD COLUMN "catalogProductId" TEXT;

CREATE INDEX "Product_catalogProductId_idx" ON "Product"("catalogProductId");

CREATE UNIQUE INDEX "Product_merchantId_catalogProductId_key"
  ON "Product"("merchantId", "catalogProductId");

ALTER TABLE "Product" ADD CONSTRAINT "Product_catalogProductId_fkey"
  FOREIGN KEY ("catalogProductId") REFERENCES "CatalogProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
