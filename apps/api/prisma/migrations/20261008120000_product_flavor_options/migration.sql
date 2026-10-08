-- Flavor options V1. Additive. Does not merge or rewrite existing CatalogProducts.

CREATE TABLE "CatalogProductFlavorOption" (
    "id" TEXT NOT NULL,
    "catalogProductId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogProductFlavorOption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CatalogProductFlavorOption_catalogProductId_normalizedName_key"
  ON "CatalogProductFlavorOption"("catalogProductId", "normalizedName");

CREATE INDEX "CatalogProductFlavorOption_catalogProductId_sortOrder_idx"
  ON "CatalogProductFlavorOption"("catalogProductId", "sortOrder");

ALTER TABLE "CatalogProductFlavorOption"
  ADD CONSTRAINT "CatalogProductFlavorOption_catalogProductId_fkey"
  FOREIGN KEY ("catalogProductId") REFERENCES "CatalogProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProductFlavorAvailability" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "flavorOptionId" TEXT NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductFlavorAvailability_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductFlavorAvailability_productId_flavorOptionId_key"
  ON "ProductFlavorAvailability"("productId", "flavorOptionId");

CREATE INDEX "ProductFlavorAvailability_flavorOptionId_idx"
  ON "ProductFlavorAvailability"("flavorOptionId");

ALTER TABLE "ProductFlavorAvailability"
  ADD CONSTRAINT "ProductFlavorAvailability_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductFlavorAvailability"
  ADD CONSTRAINT "ProductFlavorAvailability_flavorOptionId_fkey"
  FOREIGN KEY ("flavorOptionId") REFERENCES "CatalogProductFlavorOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommerceOrderItem"
  ADD COLUMN "flavorOptionId" TEXT,
  ADD COLUMN "flavorNameSnapshot" TEXT,
  ADD COLUMN "flavorPreference" TEXT;
