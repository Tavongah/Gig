-- Pilot merchant onboarding: optional pilotArea + notes.

ALTER TABLE "Merchant" ADD COLUMN IF NOT EXISTS "pilotArea" TEXT;
ALTER TABLE "Merchant" ADD COLUMN IF NOT EXISTS "notes" TEXT;

CREATE INDEX IF NOT EXISTS "Merchant_pilotArea_idx" ON "Merchant"("pilotArea");
