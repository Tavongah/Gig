-- Source merchandise proposals and one fulfillment owner per checkout.
-- Local/test only until a reviewed production deploy.

CREATE TYPE "CheckoutFulfillmentOwner" AS ENUM ('SHOP', 'COURIER_SOURCE');
CREATE TYPE "SourcePriceProposalStatus" AS ENUM ('PROPOSED', 'REJECTED', 'CONFIRMED', 'SUPERSEDED', 'INVALIDATED');

ALTER TABLE "CommerceCheckout" ADD COLUMN "fulfillmentOwner" "CheckoutFulfillmentOwner";

CREATE TABLE "SourcePriceProposal" (
    "id" TEXT NOT NULL,
    "checkoutId" TEXT NOT NULL,
    "gigId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "merchandiseCents" INTEGER NOT NULL,
    "status" "SourcePriceProposalStatus" NOT NULL DEFAULT 'PROPOSED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "SourcePriceProposal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SourcePriceProposal_checkoutId_status_idx" ON "SourcePriceProposal"("checkoutId", "status");
CREATE INDEX "SourcePriceProposal_gigId_idx" ON "SourcePriceProposal"("gigId");

ALTER TABLE "SourcePriceProposal"
  ADD CONSTRAINT "SourcePriceProposal_checkoutId_fkey"
  FOREIGN KEY ("checkoutId") REFERENCES "CommerceCheckout"("id") ON DELETE CASCADE ON UPDATE CASCADE;
