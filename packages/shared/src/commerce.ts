import { z } from "zod";

export const merchantCategories = [
  "TUCK_SHOP",
  "GROCERY",
  "BAKERY",
  "FOOD",
  "HOUSEHOLD",
  "OTHER"
] as const;
export type MerchantCategory = (typeof merchantCategories)[number];

export const merchantCategoryLabels: Record<MerchantCategory, string> = {
  TUCK_SHOP: "Tuck Shop",
  GROCERY: "Grocery",
  BAKERY: "Bakery",
  FOOD: "Food",
  HOUSEHOLD: "Household",
  OTHER: "Other"
};

export const commerceOrderStatuses = [
  "DRAFT",
  "CUSTOMER_CONFIRMED",
  "MERCHANT_PENDING",
  "MERCHANT_ACCEPTED",
  "READY_FOR_PICKUP",
  "COURIER_ASSIGNED",
  "PICKED_UP",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "MERCHANT_REJECTED",
  "CANCELLED",
  "PAYMENT_FAILED"
] as const;
export type CommerceOrderStatus = (typeof commerceOrderStatuses)[number];

export const commercePaymentStatuses = [
  "PENDING",
  "PAYMENT_PENDING",
  "PAID",
  "PAYMENT_FAILED",
  "AUTHORIZED",
  "CAPTURED",
  "FAILED",
  "REFUNDED",
  "NOT_REQUIRED",
  "DUE_ON_DELIVERY"
] as const;
export type CommercePaymentStatus = (typeof commercePaymentStatuses)[number];

export const commercePaymentAttemptStatuses = [
  "CREATED",
  "PENDING",
  "PAID",
  "FAILED",
  "EXPIRED",
  "CANCELLED"
] as const;
export type CommercePaymentAttemptStatus = (typeof commercePaymentAttemptStatuses)[number];

export const commercePaymentMethods = [
  "TEST_BYPASS",
  "CASH",
  "STRIPE",
  "ECOCASH",
  "ONEMONEY"
] as const;
export type CommercePaymentMethod = (typeof commercePaymentMethods)[number];

export const whatsappParties = ["CUSTOMER", "MERCHANT"] as const;
export type WhatsAppParty = (typeof whatsappParties)[number];

export const whatsappConversationStates = [
  "IDLE",
  "AWAITING_LOCATION",
  "BUILDING_CART",
  "AWAITING_PRODUCT_CHOICE",
  "AWAITING_ORDER_CONFIRMATION",
  "AWAITING_PAYMENT",
  "ORDER_ACTIVE",
  "MERCHANT_ONBOARDING",
  "MERCHANT_MENU"
] as const;
export type WhatsAppConversationState = (typeof whatsappConversationStates)[number];

/** Human-readable commerce + delivery status for WhatsApp customers. */
export function commerceCustomerStatusCopy(status: CommerceOrderStatus): string {
  switch (status) {
    case "DRAFT":
      return "We're preparing your order summary.";
    case "CUSTOMER_CONFIRMED":
    case "MERCHANT_PENDING":
      return "Your order is with the shop for confirmation.";
    case "MERCHANT_ACCEPTED":
      return "Your order is being prepared.";
    case "READY_FOR_PICKUP":
      return "Your order is ready. We are finding a courier.";
    case "COURIER_ASSIGNED":
      return "A courier is on the way.";
    case "PICKED_UP":
      return "The courier is collecting your order.";
    case "OUT_FOR_DELIVERY":
      return "Your order is on the way.";
    case "DELIVERED":
      return "Your order has been delivered.";
    case "MERCHANT_REJECTED":
      return "The shop couldn't take this order.";
    case "CANCELLED":
      return "Your order was cancelled.";
    case "PAYMENT_FAILED":
      return "Payment failed.";
    default:
      return "Order update.";
  }
}

/** Short shop-UI status labels (web/PWA). Does not change WhatsApp copy. */
export function commerceShopUiStatusLabel(
  status: CommerceOrderStatus,
  deliveryGigStatus?: string | null
): string {
  if (deliveryGigStatus) {
    const d = deliveryGigStatus.toUpperCase();
    if (d.includes("ARRIVED") || d === "WORKER_ARRIVED") return "Courier arrived";
    if (d === "IN_TRANSIT" || d === "OUT_FOR_DELIVERY" || d.includes("EN_ROUTE_DROP")) return "On the way";
    if (d.includes("PICKED") || d === "PACKAGE_PICKED_UP") return "Order picked up";
    if (d.includes("EN_ROUTE_PICKUP") || d.includes("GOING_TO_SHOP")) return "Courier going to shop";
    if (d === "ASSIGNED" || d === "WORKER_ASSIGNED" || d === "ACCEPTED") return "Courier assigned";
    if (d === "COMPLETED" || d === "DELIVERED") return "Delivered";
  }

  switch (status) {
    case "DRAFT":
      return "Waiting for shop";
    case "CUSTOMER_CONFIRMED":
    case "MERCHANT_PENDING":
      return "Waiting for shop";
    case "MERCHANT_ACCEPTED":
      return "Shop preparing order";
    case "READY_FOR_PICKUP":
      return "Ready for pickup";
    case "COURIER_ASSIGNED":
      return "Courier assigned";
    case "PICKED_UP":
      return "Order picked up";
    case "OUT_FOR_DELIVERY":
      return "On the way";
    case "DELIVERED":
      return "Delivered";
    case "MERCHANT_REJECTED":
      return "Shop couldn't take order";
    case "CANCELLED":
      return "Cancelled";
    case "PAYMENT_FAILED":
      return "Payment failed";
    default:
      return "Order update";
  }
}

export function normalizeProductSearchName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Alias map for common Zimbabwe / brand shorthand (deterministic, not invented products). */
export const PRODUCT_ALIAS_MAP: Record<string, string[]> = {
  coke: ["coca-cola", "coca cola", "coke", "coka", "coka cola"],
  "coca cola": ["coca-cola", "coke"],
  mazoe: ["mazoe", "mazoe orange", "mazoe orange crush", "mazo"],
  bread: ["bread", "loaf", "loaves", "lobels", "bred"],
  eggs: ["egg", "eggs"],
  milk: ["milk", "mlk"],
  sugar: ["sugar", "suger", "sugr"],
  oil: ["cooking oil", "oil", "cookin oil"],
  rice: ["rice"],
  kapenta: ["kapenta", "matemba"],
  matemba: ["matemba", "kapenta"],
  pepsi: ["pepsi"],
  soap: ["soap", "barra"],
  water: ["water", "bottled water"],
  flour: ["flour", "mealie meal", "mealie"]
};

export function expandSearchTerms(query: string): string[] {
  const n = normalizeProductSearchName(query);
  const terms = new Set<string>([n]);
  for (const [key, aliases] of Object.entries(PRODUCT_ALIAS_MAP)) {
    if (n.includes(key) || aliases.some((a) => n.includes(a))) {
      terms.add(key);
      for (const a of aliases) terms.add(a);
    }
  }
  return [...terms];
}

export type RequestedShoppingItem = {
  query: string;
  quantity: number;
};

export const createMerchantSchema = z.object({
  name: z.string().min(2).max(120),
  contactName: z.string().min(2).max(100).optional(),
  phone: z.string().min(7).max(24).optional(),
  whatsappPhone: z.string().min(7).max(24),
  locationLabel: z.string().min(2).max(160),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  category: z.enum(merchantCategories).default("TUCK_SHOP"),
  logoUrl: z.string().url().max(2048).optional(),
  openingHours: z.string().max(200).optional(),
  ownerUserId: z.string().uuid().optional(),
  pilotArea: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
  isActive: z.boolean().optional(),
  acceptsOrders: z.boolean().optional()
});

export const updateMerchantSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  contactName: z.string().min(2).max(100).optional(),
  phone: z.string().min(7).max(24).optional(),
  whatsappPhone: z.string().min(7).max(24).optional(),
  locationLabel: z.string().min(2).max(160).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  category: z.enum(merchantCategories).optional(),
  logoUrl: z.string().url().max(2048).nullable().optional(),
  openingHours: z.string().max(200).nullable().optional(),
  pilotArea: z.string().max(120).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
  acceptsOrders: z.boolean().optional()
});

export const upsertProductSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(500).optional(),
  category: z.string().max(80).optional(),
  priceCents: z.number().int().min(1).max(10_000_000),
  currency: z.string().length(3).default("usd"),
  available: z.boolean().default(true),
  quantityApprox: z.number().int().min(0).max(100_000).optional(),
  unit: z.string().max(40).optional(),
  imageUrl: z.string().url().max(2048).optional(),
  searchAliases: z.array(z.string().max(80)).max(20).default([])
});

export const DEFAULT_MARKETPLACE_MERCHANT_RADIUS_KM = 5;
export const PILOT_READY_MIN_PRODUCTS = 10;
