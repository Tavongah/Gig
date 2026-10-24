/**
 * Seller Marketplace V1.
 * Customer fulfillment stays off unless SELLER_MARKETPLACE_ENABLED is explicitly true.
 * Commission rate is an input. This module does not choose 15% or any other rate.
 */

import { z } from "zod";

export const sellerStatuses = ["PENDING", "ACTIVE", "SUSPENDED"] as const;
export const sellerOfferStatuses = ["ACTIVE", "PAUSED", "SOLD_OUT"] as const;
export const sellerLedgerKinds = ["SALE", "ADJUSTMENT"] as const;
export const sellerSettlementStatuses = ["AWAITING_COLLECTION", "ACCRUED", "REVERSED"] as const;

export type SellerStatus = (typeof sellerStatuses)[number];
export type SellerOfferStatus = (typeof sellerOfferStatuses)[number];
export type SellerSettlementStatus = (typeof sellerSettlementStatuses)[number];

/** Default off. Missing, empty, and "false" all stay disabled. */
export function parseSellerMarketplaceEnabled(value?: string | boolean | null) {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  if (!v) return false;
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

export type SellerMerchandiseSplit = {
  merchandiseCents: number;
  commissionCents: number;
  sellerProceedsCents: number;
};

/**
 * Integer-cent split. Delivery is not an input and is not seller revenue.
 * commissionCents + sellerProceedsCents === merchandiseCents.
 */
export function splitSellerMerchandiseCents(
  merchandiseCents: number,
  commissionRate: number
): SellerMerchandiseSplit {
  if (!Number.isInteger(merchandiseCents) || merchandiseCents < 0) {
    throw new Error("INVALID_MERCHANDISE_CENTS");
  }
  if (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 1) {
    throw new Error("INVALID_COMMISSION_RATE");
  }
  const commissionCents = Math.round(merchandiseCents * commissionRate);
  const sellerProceedsCents = merchandiseCents - commissionCents;
  return { merchandiseCents, commissionCents, sellerProceedsCents };
}

const sellerStatusSchema = z.enum(sellerStatuses);
const activatableOfferStatus = z.enum(["ACTIVE", "PAUSED"]);

export const createSellerSchema = z.object({
  displayName: z.string().min(2).max(120),
  phone: z.string().min(7).max(24),
  whatsappPhone: z.string().min(7).max(24).optional(),
  pickupLocationLabel: z.string().min(2).max(160),
  pickupLatitude: z.number().min(-90).max(90),
  pickupLongitude: z.number().min(-180).max(180),
  pickupContactName: z.string().min(2).max(80),
  ownerUserId: z.string().uuid().optional(),
  notes: z.string().max(2000).optional(),
  status: sellerStatusSchema.optional()
});

export const updateSellerSchema = z
  .object({
    displayName: z.string().min(2).max(120).optional(),
    phone: z.string().min(7).max(24).optional(),
    whatsappPhone: z.string().min(7).max(24).nullable().optional(),
    pickupLocationLabel: z.string().min(2).max(160).optional(),
    pickupLatitude: z.number().min(-90).max(90).optional(),
    pickupLongitude: z.number().min(-180).max(180).optional(),
    pickupContactName: z.string().min(2).max(80).optional(),
    ownerUserId: z.string().uuid().nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    status: sellerStatusSchema.optional()
  })
  .refine((value) => Object.keys(value).length > 0, { message: "No seller changes." });

export const createSellerOfferSchema = z.object({
  catalogProductId: z.string().uuid(),
  priceCents: z.number().int().min(1).max(10_000_000),
  quantity: z.number().int().min(0).max(100_000),
  currency: z.string().length(3).default("usd"),
  status: activatableOfferStatus.optional()
});

export const updateSellerOfferSchema = z
  .object({
    priceCents: z.number().int().min(1).max(10_000_000).optional(),
    quantity: z.number().int().min(0).max(100_000).optional(),
    status: activatableOfferStatus.optional()
  })
  .refine((value) => Object.keys(value).length > 0, { message: "No offer changes." });

export const commitSellerFulfillmentSchema = z.object({
  quantity: z.number().int().min(1).max(100),
  paymentStatus: z.enum(["PAID", "DUE_ON_DELIVERY"]),
  deliveryFeeCents: z.number().int().min(0).max(10_000_000).default(0),
  reference: z.string().max(120).optional()
});

export const sellerCommissionRateSchema = z.object({
  rate: z.number().min(0).max(1)
});
