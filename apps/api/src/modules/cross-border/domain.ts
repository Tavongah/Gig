/**
 * Pure cross-border rules. No database, no provider calls, no local commerce.
 */

export const CROSS_BORDER_TERMS_VERSION = "cb-terms-2026-11-14";

export const CROSS_BORDER_TERMS = [
  "DUTS is an independent shopping and delivery service. DUTS is not SHEIN and is not a partner of the South African retailer.",
  "Product availability is confirmed by DUTS staff before a quotation is sent. A product link is not a price or a promise of stock.",
  "The quotation lists merchandise, South African shipping, cross-border freight, customs or taxes, the DUTS service fee and Zimbabwe delivery.",
  "Customs amounts marked as estimates are not a guaranteed all-inclusive price and may change or be payable separately.",
  "Sizes, colours and other options are purchased only as written on the accepted quotation. DUTS does not substitute them.",
  "DUTS purchases the goods only after the payment provider confirms the exact quoted amount.",
  "Cash on delivery is not available for South African shopping.",
  "Shipping time is given only when DUTS has a basis for it. There is no guaranteed delivery date unless the quotation says so.",
  "Cancellations before purchase follow the quotation. After purchase, refunds wait for the retailer and a verified refund path. DUTS does not refund automatically.",
  "Some goods cannot be imported. DUTS may decline a request.",
  "Lost or damaged shipments are reviewed against the carrier record. DUTS does not insure goods beyond what the quotation states."
].join(" ");

export const REQUEST_STATUSES = [
  "REQUESTED",
  "UNDER_REVIEW",
  "QUOTED",
  "AWAITING_PAYMENT",
  "PAYMENT_PENDING",
  "PAID",
  "READY_TO_PURCHASE",
  "PURCHASED",
  "RECEIVED_IN_SOUTH_AFRICA",
  "IN_TRANSIT_TO_ZIMBABWE",
  "CUSTOMS_CLEARANCE",
  "READY_FOR_LOCAL_DELIVERY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLED",
  "PRODUCT_UNAVAILABLE",
  "PAYMENT_FAILED",
  "REFUND_PENDING",
  "REFUNDED"
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

const TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  REQUESTED: ["UNDER_REVIEW", "CANCELLED", "PRODUCT_UNAVAILABLE"],
  UNDER_REVIEW: ["QUOTED", "PRODUCT_UNAVAILABLE", "CANCELLED"],
  QUOTED: ["AWAITING_PAYMENT", "UNDER_REVIEW", "CANCELLED", "PRODUCT_UNAVAILABLE"],
  AWAITING_PAYMENT: ["PAYMENT_PENDING", "QUOTED", "CANCELLED", "REFUND_PENDING"],
  PAYMENT_PENDING: ["PAID", "PAYMENT_FAILED", "AWAITING_PAYMENT", "CANCELLED", "REFUND_PENDING"],
  PAID: ["READY_TO_PURCHASE", "REFUND_PENDING"],
  READY_TO_PURCHASE: ["PURCHASED", "PRODUCT_UNAVAILABLE", "REFUND_PENDING"],
  PURCHASED: ["RECEIVED_IN_SOUTH_AFRICA", "REFUND_PENDING"],
  RECEIVED_IN_SOUTH_AFRICA: ["IN_TRANSIT_TO_ZIMBABWE", "REFUND_PENDING"],
  IN_TRANSIT_TO_ZIMBABWE: ["CUSTOMS_CLEARANCE", "READY_FOR_LOCAL_DELIVERY"],
  CUSTOMS_CLEARANCE: ["READY_FOR_LOCAL_DELIVERY", "REFUND_PENDING"],
  READY_FOR_LOCAL_DELIVERY: ["OUT_FOR_DELIVERY"],
  OUT_FOR_DELIVERY: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
  PRODUCT_UNAVAILABLE: ["REFUND_PENDING", "CANCELLED"],
  PAYMENT_FAILED: ["AWAITING_PAYMENT", "CANCELLED"],
  REFUND_PENDING: ["REFUNDED"],
  REFUNDED: []
};

export function assertTransition(from: RequestStatus, to: RequestStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new Error(`CROSS_BORDER_TRANSITION:${from}->${to}`);
  }
}

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

const SUPPORTED_LOCAL_CITIES = new Set(["harare", "gweru"]);

export function localDeliveryCoverage(city: string): "SUPPORTED" | "STAFF_CONFIRM" {
  return SUPPORTED_LOCAL_CITIES.has(city.trim().toLowerCase()) ? "SUPPORTED" : "STAFF_CONFIRM";
}

export function assertIntegerCents(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 100_000_000) {
    throw new Error(`INVALID_CENTS:${label}`);
  }
}

export function quoteTotalCents(parts: {
  merchandiseSubtotalCents: number;
  saShippingCents: number;
  crossBorderFreightCents: number;
  customsCents: number;
  serviceFeeCents: number;
  zimbabweDeliveryCents: number;
  additionalCents: number;
}): number {
  const values = [
    parts.merchandiseSubtotalCents,
    parts.saShippingCents,
    parts.crossBorderFreightCents,
    parts.customsCents,
    parts.serviceFeeCents,
    parts.zimbabweDeliveryCents,
    parts.additionalCents
  ];
  for (const value of values) assertIntegerCents(value, "component");
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isInteger(total) || total < 1) throw new Error("INVALID_CENTS:total");
  return total;
}

export function lineTotalCents(unitPriceCents: number, quantity: number): number {
  assertIntegerCents(unitPriceCents, "unit");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw new Error("INVALID_QUANTITY");
  return unitPriceCents * quantity;
}

const RATE_RE = /^\d+(\.\d{1,8})?$/;

export function assertExchangeSnapshot(input: {
  zarMerchandiseCents?: number | null;
  exchangeRate?: string | null;
  exchangeRateSource?: string | null;
  exchangeRateAt?: Date | null;
}): void {
  const hasAny = Boolean(input.zarMerchandiseCents || input.exchangeRate || input.exchangeRateSource || input.exchangeRateAt);
  if (!hasAny) return;
  if (!input.zarMerchandiseCents || !Number.isInteger(input.zarMerchandiseCents) || input.zarMerchandiseCents < 1) {
    throw new Error("EXCHANGE_SNAPSHOT_INCOMPLETE");
  }
  if (!input.exchangeRate || !RATE_RE.test(input.exchangeRate)) throw new Error("EXCHANGE_SNAPSHOT_INCOMPLETE");
  if (!input.exchangeRateSource?.trim()) throw new Error("EXCHANGE_SNAPSHOT_INCOMPLETE");
  if (!(input.exchangeRateAt instanceof Date) || Number.isNaN(input.exchangeRateAt.getTime())) {
    throw new Error("EXCHANGE_SNAPSHOT_INCOMPLETE");
  }
}

export function normalizeContactPhone(raw: string): string | null {
  const cleaned = raw.trim().replace(/[\s()-]/g, "");
  if (!cleaned || /pin|otp|password|cvv|card/i.test(cleaned)) return null;
  if (/^\+2637\d{8}$/.test(cleaned)) return cleaned;
  if (/^07\d{8}$/.test(cleaned)) return `+263${cleaned.slice(1)}`;
  if (/^7\d{8}$/.test(cleaned)) return `+263${cleaned}`;
  if (/^2637\d{8}$/.test(cleaned)) return `+${cleaned}`;
  if (/^\+[1-9]\d{7,14}$/.test(cleaned)) return cleaned;
  return null;
}

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 200) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host.includes(":") && (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd"))) {
    return true;
  }
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((n) => n > 255)) return true;
  const a = octets[0] ?? -1;
  const b = octets[1] ?? -1;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

export function assertPublicProductUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("UNSAFE_PRODUCT_URL");
  }
  if (url.protocol !== "https:") throw new Error("UNSAFE_PRODUCT_URL");
  if (url.username || url.password) throw new Error("UNSAFE_PRODUCT_URL");
  if (isPrivateHost(url.hostname)) throw new Error("UNSAFE_PRODUCT_URL");
  return url.toString();
}

export const RETAILERS = ["SHEIN", "TAKEALOT", "MR_PRICE", "ACKERMANS", "PEP", "OTHER"] as const;
export type Retailer = (typeof RETAILERS)[number];

export function retailerFromHost(hostname: string): Retailer | null {
  const host = hostname.toLowerCase();
  if (host === "shein.com" || host.endsWith(".shein.com")) return "SHEIN";
  if (host === "takealot.com" || host.endsWith(".takealot.com")) return "TAKEALOT";
  if (host === "mrp.com" || host.endsWith(".mrp.com") || host.endsWith("mrprice.co.za") || host.endsWith(".mrprice.co.za")) {
    return "MR_PRICE";
  }
  if (host.endsWith("ackermans.co.za")) return "ACKERMANS";
  if (host.endsWith("pepstores.com") || host.endsWith("pep.co.za")) return "PEP";
  return null;
}

export type RequestLineInput = {
  retailer: string;
  productUrl: string;
  productName: string;
  quantity: number;
  size?: string | null;
  color?: string | null;
  variantDetails?: string | null;
  notes?: string | null;
};

export type NormalizedLine = {
  retailer: string;
  productUrl: string;
  productName: string;
  quantity: number;
  size: string | null;
  color: string | null;
  variantDetails: string | null;
  notes: string | null;
};

function clip(value: string | null | undefined, max: number): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text.slice(0, max);
}

export function normalizeLines(lines: RequestLineInput[]): NormalizedLine[] {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 15) throw new Error("INVALID_LINES");
  return lines.map((line) => {
    const retailer = String(line.retailer ?? "").trim().toUpperCase().replace(/\s+/g, "_");
    if (!RETAILERS.includes(retailer as Retailer)) throw new Error("INVALID_RETAILER");
    const productUrl = assertPublicProductUrl(line.productUrl);
    const productName = clip(line.productName, 200);
    if (!productName) throw new Error("INVALID_PRODUCT_NAME");
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 20) throw new Error("INVALID_QUANTITY");
    return {
      retailer,
      productUrl,
      productName,
      quantity: line.quantity,
      size: clip(line.size, 80),
      color: clip(line.color, 80),
      variantDetails: clip(line.variantDetails, 200),
      notes: clip(line.notes, 500)
    };
  });
}

export type ContactChannel = "WHATSAPP" | "EMAIL";

export function normalizeCustomer(input: {
  customerName: string;
  phone?: string | null;
  email?: string | null;
  preferredContactChannel?: ContactChannel | null;
  destinationCity: string;
  deliveryAddress: string;
  deliveryInstructions?: string | null;
}): {
  customerName: string;
  phone: string | null;
  email: string | null;
  preferredContactChannel: ContactChannel;
  destinationCity: string;
  deliveryAddress: string;
  deliveryInstructions: string | null;
} {
  const customerName = String(input.customerName ?? "").trim().slice(0, 120);
  if (customerName.length < 2) throw new Error("INVALID_NAME");
  const phone = input.phone ? normalizeContactPhone(input.phone) : null;
  if (input.phone && !phone) throw new Error("INVALID_PHONE");
  const email = input.email ? normalizeEmail(input.email) : null;
  if (input.email && !email) throw new Error("INVALID_EMAIL");
  if (!phone && !email) throw new Error("CONTACT_REQUIRED");
  const destinationCity = String(input.destinationCity ?? "").trim().slice(0, 80);
  const deliveryAddress = String(input.deliveryAddress ?? "").trim().slice(0, 300);
  if (destinationCity.length < 2 || deliveryAddress.length < 3) throw new Error("INVALID_DESTINATION");
  let preferred = input.preferredContactChannel ?? null;
  if (preferred === "WHATSAPP" && !phone) throw new Error("CHANNEL_UNAVAILABLE");
  if (preferred === "EMAIL" && !email) throw new Error("CHANNEL_UNAVAILABLE");
  if (!preferred) preferred = phone ? "WHATSAPP" : "EMAIL";
  if (preferred === "WHATSAPP" && !phone) throw new Error("CHANNEL_UNAVAILABLE");
  return {
    customerName,
    phone,
    email,
    preferredContactChannel: preferred,
    destinationCity,
    deliveryAddress,
    deliveryInstructions: clip(input.deliveryInstructions, 500)
  };
}

export function crossBorderMerchantReference(reference: string, paymentId: string): string {
  const compact = paymentId.replace(/-/g, "").slice(0, 12).toUpperCase();
  const num = reference.replace(/[^0-9]/g, "").slice(0, 8) || "0";
  return `CBX-${num}-${compact}`;
}

export const CROSS_BORDER_CALLBACK_PATH = "/v1/cross-border/payments/zb/callback";

export type PaymentDecision =
  | { action: "PAID_READY" }
  | { action: "DUPLICATE" }
  | { action: "PENDING" }
  | { action: "FAILED"; requestStatus: "PAYMENT_FAILED" | "AWAITING_PAYMENT"; paymentStatus: "FAILED" | "CANCELLED" | "EXPIRED" }
  | { action: "EXCEPTION"; reason: string };

export function decidePaymentOutcome(input: {
  paymentStatus: "CREATED" | "PENDING" | "PAID" | "FAILED" | "CANCELLED" | "EXPIRED" | "EXCEPTION";
  paymentAmountCents: number;
  paymentCurrency: string;
  paymentQuoteVersion: number;
  paymentCreatedAt: Date;
  providerStatus: "PAID" | "PENDING" | "FAILED" | "CANCELLED" | "EXPIRED";
  providerAmountCents: number | null;
  providerCurrencyUsd: boolean;
  quoteStatus: "DRAFT" | "APPROVED" | "SENT" | "EXPIRED" | "SUPERSEDED" | "ACCEPTED";
  quoteVersion: number;
  quoteTotalCents: number;
  quoteCurrency: string;
  quoteExpiresAt: Date;
  now: Date;
}): PaymentDecision {
  if (input.paymentStatus === "PAID") return { action: "DUPLICATE" };
  if (input.paymentStatus === "EXCEPTION") return { action: "EXCEPTION", reason: "already_exception" };
  if (input.providerStatus === "PENDING") return { action: "PENDING" };
  if (input.quoteStatus === "SUPERSEDED" || input.quoteStatus === "DRAFT" || input.quoteStatus === "APPROVED") {
    return { action: "EXCEPTION", reason: "quote_not_payable" };
  }
  if (input.paymentQuoteVersion !== input.quoteVersion) return { action: "EXCEPTION", reason: "quote_version" };
  if (input.quoteCurrency.toUpperCase() !== "USD" || input.paymentCurrency.toUpperCase() !== "USD" || !input.providerCurrencyUsd) {
    return { action: "EXCEPTION", reason: "currency" };
  }
  if (input.providerAmountCents == null || input.providerAmountCents !== input.paymentAmountCents || input.paymentAmountCents !== input.quoteTotalCents) {
    return { action: "EXCEPTION", reason: "amount" };
  }
  if (input.providerStatus === "FAILED") return { action: "FAILED", requestStatus: "PAYMENT_FAILED", paymentStatus: "FAILED" };
  if (input.providerStatus === "CANCELLED") return { action: "FAILED", requestStatus: "AWAITING_PAYMENT", paymentStatus: "CANCELLED" };
  if (input.providerStatus === "EXPIRED") return { action: "FAILED", requestStatus: "AWAITING_PAYMENT", paymentStatus: "EXPIRED" };
  const initiatedInTime = input.paymentCreatedAt.getTime() <= input.quoteExpiresAt.getTime();
  const quoteOpen = input.quoteStatus === "ACCEPTED" || input.quoteStatus === "SENT";
  if (!quoteOpen || !initiatedInTime) return { action: "EXCEPTION", reason: "expired_or_not_accepted" };
  if (input.providerStatus === "PAID") return { action: "PAID_READY" };
  return { action: "PENDING" };
}

export type WaStep = "LINK" | "QTY" | "SIZE" | "COLOR" | "MORE" | "CITY" | "ADDRESS" | "CONTACT" | "NAME" | "CONFIRM";

export type WaItem = NormalizedLine;

export type WaDraft = {
  active: true;
  step: WaStep;
  draftId: string;
  items: WaItem[];
  pending: Partial<WaItem> | null;
};

export function isCrossBorderEntry(text: string): boolean {
  const value = text.trim().toLowerCase().replace(/\s+/g, " ");
  return value === "shop south africa" || value === "shop from south africa" || value === "shop shein" || value === "shop_south_africa";
}

export function shouldEnterCrossBorder(input: {
  enabled: boolean;
  text: string;
  draftActive: boolean;
  protectedTransaction: boolean;
  expectedInput?: string | null;
  hasBasket: boolean;
}): boolean {
  if (!input.enabled) return false;
  if (input.draftActive) return true;
  if (input.protectedTransaction || input.hasBasket) return false;
  const expected = input.expectedInput ?? "NONE";
  if (expected !== "NONE") return false;
  return isCrossBorderEntry(input.text);
}

function itemSummary(item: WaItem): string {
  const options = [item.size && `size ${item.size}`, item.color && `colour ${item.color}`, item.variantDetails]
    .filter(Boolean)
    .join(", ");
  return `${item.quantity} x ${item.productName}${options ? ` (${options})` : ""}`;
}

export function reduceCrossBorderDraft(draft: WaDraft | null, text: string, phone: string, draftId: string): {
  draft: WaDraft | null;
  reply: string;
  exitToMenu?: boolean;
  submit?: {
    draftId: string;
    customerName: string;
    phone: string | null;
    email: string | null;
    preferredContactChannel: ContactChannel;
    destinationCity: string;
    deliveryAddress: string;
    lines: NormalizedLine[];
  };
} {
  const value = text.trim();
  const lower = value.toLowerCase();
  if (/^(cancel|stop|menu)$/i.test(value) && (draft || isCrossBorderEntry(value) === false)) {
    if (draft || /^(cancel|stop|menu)$/i.test(value)) {
      if (draft) {
        return { draft: null, exitToMenu: true, reply: "South African shopping cancelled.\n\n" };
      }
    }
  }
  if (!draft) {
    return {
      draft: { active: true, step: "LINK", draftId, items: [], pending: null },
      reply: "Shop from SHEIN and South African stores. Send a product link. DUTS will quote it. No payment is taken now."
    };
  }
  if (/^(cancel|stop|menu)$/i.test(value)) {
    return { draft: null, exitToMenu: true, reply: "South African shopping cancelled.\n\n" };
  }

  if (draft.step === "LINK") {
    try {
      const productUrl = assertPublicProductUrl(value);
      const host = new URL(productUrl).hostname;
      const retailer = retailerFromHost(host) ?? "OTHER";
      draft.pending = { productUrl, retailer, productName: `${retailer === "OTHER" ? "Product" : retailer} from ${host}` };
      draft.step = "QTY";
      return { draft, reply: "How many do you want? Reply with a number from 1 to 20." };
    } catch {
      return { draft, reply: "Send a public https product link. DUTS does not open private or local addresses." };
    }
  }

  if (draft.step === "QTY") {
    const quantity = Number(value);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      return { draft, reply: "Reply with a quantity from 1 to 20." };
    }
    draft.pending = { ...draft.pending, quantity };
    draft.step = "SIZE";
    return { draft, reply: "What size should DUTS buy? Reply with the size, or skip." };
  }

  if (draft.step === "SIZE") {
    draft.pending = { ...draft.pending, size: /^(skip|none|n\/a)$/i.test(value) ? null : value.slice(0, 80) };
    draft.step = "COLOR";
    return { draft, reply: "What colour should DUTS buy? Reply with the colour, or skip." };
  }

  if (draft.step === "COLOR") {
    const color = /^(skip|none|n\/a)$/i.test(value) ? null : value.slice(0, 80);
    const pending = draft.pending ?? {};
    const item: WaItem = {
      retailer: pending.retailer || "OTHER",
      productUrl: pending.productUrl || "",
      productName: pending.productName || "Product",
      quantity: pending.quantity || 1,
      size: pending.size ?? null,
      color,
      variantDetails: null,
      notes: null
    };
    draft.items = [...draft.items, item];
    draft.pending = null;
    draft.step = "MORE";
    return { draft, reply: `Added: ${itemSummary(item)}\n\nReply 1 to add another product, or 2 to continue.` };
  }

  if (draft.step === "MORE") {
    if (value === "1" || /^add/i.test(value)) {
      draft.step = "LINK";
      return { draft, reply: "Send the next product link." };
    }
    if (value === "2" || /^continue|done/i.test(value)) {
      draft.step = "CITY";
      return { draft, reply: "Which Zimbabwe city should DUTS deliver to?" };
    }
    return { draft, reply: "Reply 1 to add another product, or 2 to continue." };
  }

  if (draft.step === "CITY") {
    if (value.length < 2) return { draft, reply: "Send the delivery city." };
    draft.pending = { productName: value.slice(0, 80) };
    draft.step = "ADDRESS";
    return { draft, reply: "Send the delivery address or location in that city." };
  }

  if (draft.step === "ADDRESS") {
    if (value.length < 3) return { draft, reply: "Send a delivery address or location." };
    const city = draft.pending?.productName || "";
    draft.pending = { productName: city, notes: value.slice(0, 300) };
    draft.step = "CONTACT";
    return {
      draft,
      reply: `Reply 1 to receive the quotation on this WhatsApp number (${phone}). Or send an email address. DUTS does not assume every phone has WhatsApp unless you choose 1.`
    };
  }

  if (draft.step === "CONTACT") {
    const city = draft.pending?.productName || "";
    const address = draft.pending?.notes || "";
    if (value === "1") {
      draft.pending = { productName: city, notes: address, retailer: "WHATSAPP" };
      draft.step = "NAME";
    } else {
      const email = normalizeEmail(value);
      if (!email) return { draft, reply: "Reply 1 to use this WhatsApp number, or send a valid email address." };
      draft.pending = { productName: city, notes: address, retailer: "EMAIL", productUrl: email };
      draft.step = "NAME";
    }
    return { draft, reply: "What name should DUTS put on the request?" };
  }

  if (draft.step === "NAME") {
    if (value.trim().length < 2) return { draft, reply: "Send the name for this request." };
    draft.pending = { ...draft.pending, variantDetails: value.trim().slice(0, 120) };
    draft.step = "CONFIRM";
    const lines = draft.items.map((item, index) => `${index + 1}. ${itemSummary(item)}`).join("\n");
    const channel = draft.pending?.retailer === "EMAIL" ? draft.pending.productUrl : phone;
    return {
      draft,
      reply: `Please confirm this South African shopping request.\n\n${lines}\n\nDeliver to ${draft.pending?.productName}.\nQuotation to ${channel}.\n\nReply YES to submit. No payment is taken now.`
    };
  }

  if (draft.step === "CONFIRM") {
    if (!/^yes$/i.test(lower)) {
      return { draft, reply: "Reply YES to submit, or menu to cancel. No payment is taken now." };
    }
    const city = draft.pending?.productName || "";
    const address = draft.pending?.notes || "";
    const email = draft.pending?.retailer === "EMAIL" ? draft.pending.productUrl || null : null;
    const channel: ContactChannel = draft.pending?.retailer === "EMAIL" ? "EMAIL" : "WHATSAPP";
    return {
      draft: null,
      reply: "",
      submit: {
        draftId: draft.draftId,
        customerName: draft.pending?.variantDetails || "WhatsApp customer",
        phone: channel === "WHATSAPP" ? phone : null,
        email,
        preferredContactChannel: channel,
        destinationCity: city,
        deliveryAddress: address,
        lines: draft.items
      }
    };
  }

  return { draft, reply: "Send a product link to continue, or menu to cancel." };
}

export function customerStatusMessage(status: RequestStatus): string {
  switch (status) {
    case "REQUESTED":
    case "UNDER_REVIEW":
      return "We've received your shopping request. Our team is checking the products and will send your quotation shortly.";
    case "QUOTED":
    case "AWAITING_PAYMENT":
    case "PAYMENT_PENDING":
      return "Your DUTS shopping quotation is ready. Review your products, total price and payment options using the secure link.";
    case "PAID":
    case "READY_TO_PURCHASE":
      return "Payment received! DUTS will now arrange the purchase of your items.";
    case "PURCHASED":
      return "Your items have been ordered from the South African retailer.";
    case "RECEIVED_IN_SOUTH_AFRICA":
      return "Your package has arrived at our South African receiving location.";
    case "IN_TRANSIT_TO_ZIMBABWE":
    case "CUSTOMS_CLEARANCE":
      return "Your package is on its way to Zimbabwe.";
    case "READY_FOR_LOCAL_DELIVERY":
    case "OUT_FOR_DELIVERY":
      return "Your package is being arranged for delivery in Zimbabwe.";
    case "DELIVERED":
      return "Your DUTS order has been delivered. Thank you for shopping with us!";
    case "CANCELLED":
      return "This shopping request was cancelled.";
    case "PRODUCT_UNAVAILABLE":
      return "A product on this request is unavailable. DUTS will not purchase it unless you accept a new quotation.";
    case "PAYMENT_FAILED":
      return "The payment was not completed. No purchase has been made.";
    case "REFUND_PENDING":
      return "This payment needs a manual review before any purchase or refund.";
    case "REFUNDED":
      return "This request was refunded.";
    default:
      return "DUTS is reviewing this shopping request.";
  }
}
