-- Guest browsing uses a coarse shopping area; exact delivery coords are collected later.

ALTER TABLE "GuestCommerceHandoff" ADD COLUMN IF NOT EXISTS "shoppingAreaId" TEXT;
ALTER TABLE "GuestCommerceHandoff" ADD COLUMN IF NOT EXISTS "locationIsApproximate" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "GuestCommerceHandoff" ALTER COLUMN "deliveryLabel" DROP NOT NULL;
ALTER TABLE "GuestCommerceHandoff" ALTER COLUMN "deliveryLat" DROP NOT NULL;
ALTER TABLE "GuestCommerceHandoff" ALTER COLUMN "deliveryLng" DROP NOT NULL;
