/**
 * Seller Marketplace V1 — independent sellers with seller-owned inventory.
 * Customer fulfillment stays OFF unless SELLER_MARKETPLACE_ENABLED=true.
 * Does not alter Merchant / Product / Smart Basket semantics.
 */

import { z } from "zod";

/** Default OFF — foundation may deploy without customer exposure. */
export function parseSellerMarketplaceEnabled(value?: string | boolean | null): boolean {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  if (!v) return false;
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

export const sellerStatuses = ["PENDING", "ACTIVE", "SUSPENDED"] as const;
export type SellerStatus = (typeof sellerStatuses)[number];

export const sellerOfferStatuses = ["ACTIVE", "PAUSED", "SOLD_OUT"] as const;
export type SellerOfferStatus = (typeof sellerOfferStatuses)[number];

export const sellerSettlementStatuses = [
  "PENDING_PAYMENT",
  "READY_FOR_SETTLEMENT",
  "SETTLED",
  "VOIDED"
] as const;
export type SellerSettlementStatus = (typeof sellerSettlementStatuses)[number];

/** Default seller commission when PlatformSetting row is missing. */
export const DEFAULT_MARKETPLACE_SELLER_COMMISSION_RATE = 0.15;

/**
 * Integer-cent commission from merchandise subtotal.
 * Uses millirate (rate * 1000) to avoid float drift. Delivery fee excluded by caller.
 */
export function computeSellerCommissionCents(
  merchandiseCents: number,
  commissionRate: number
): { commissionCents: number; sellerProceedsCents: number } {
  if (!Number.isInteger(merchandiseCents) || merchandiseCents < 0) {
    throw new Error("merchandiseCents must be a non-negative integer");
  }
  if (!(commissionRate >= 0 && commissionRate <= 1)) {
    throw new Error("commissionRate must be between 0 and 1 inclusive");
  }
  const rateMillis = Math.round(commissionRate * 1000);
  const commissionCents = Math.floor((merchandiseCents * rateMillis) / 1000);
  return {
    commissionCents,
    sellerProceedsCents: merchandiseCents - commissionCents
  };
}

export const createSellerSchema = z.object({
  displayName: z.string().min(2).max(120),
  contactName: z.string().min(2).max(100).optional(),
  phone: z.string().min(7).max(24),
  whatsappPhone: z.string().min(7).max(24).optional(),
  pickupLocationLabel: z.string().min(2).max(160),
  pickupLatitude: z.number().min(-90).max(90),
  pickupLongitude: z.number().min(-180).max(180),
  ownerUserId: z.string().uuid().optional(),
  notes: z.string().max(2000).optional(),
  /** Admin may activate on create for controlled tests; default PENDING. */
  status: z.enum(sellerStatuses).optional()
});

export const updateSellerSchema = z.object({
  displayName: z.string().min(2).max(120).optional(),
  contactName: z.string().min(2).max(100).optional(),
  phone: z.string().min(7).max(24).optional(),
  whatsappPhone: z.string().min(7).max(24).nullable().optional(),
  pickupLocationLabel: z.string().min(2).max(160).optional(),
  pickupLatitude: z.number().min(-90).max(90).optional(),
  pickupLongitude: z.number().min(-180).max(180).optional(),
  notes: z.string().max(2000).nullable().optional(),
  status: z.enum(sellerStatuses).optional()
});

export const createSellerOfferSchema = z.object({
  catalogProductId: z.string().uuid(),
  priceCents: z.number().int().min(1).max(10_000_000),
  quantityAvailable: z.number().int().min(0).max(100_000),
  currency: z.string().length(3).default("usd"),
  conditionNote: z.string().max(200).optional(),
  status: z.enum(sellerOfferStatuses).optional()
});

export const updateSellerOfferSchema = z.object({
  priceCents: z.number().int().min(1).max(10_000_000).optional(),
  quantityAvailable: z.number().int().min(0).max(100_000).optional(),
  conditionNote: z.string().max(200).nullable().optional(),
  status: z.enum(["ACTIVE", "PAUSED"]).optional()
});

export const recordSellerFulfillmentSchema = z.object({
  sellerOfferId: z.string().uuid(),
  quantity: z.number().int().min(1).max(100_000),
  /** Customer payment state at fulfillment time — COD must not become READY_FOR_SETTLEMENT. */
  paymentStatusSnapshot: z.enum(["PAID", "DUE_ON_DELIVERY", "PENDING", "PAYMENT_PENDING"]),
  deliveryFeeCents: z.number().int().min(0).max(10_000_000).default(0),
  commerceOrderId: z.string().uuid().optional(),
  notes: z.string().max(2000).optional()
});
