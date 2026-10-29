/**
 * Persist a supported-city catalog request when no merchant can supply it.
 * Does not price merchandise, create a CommerceOrder, take payment, or call a courier.
 */
import { createHash } from "node:crypto";
import { CommerceCheckoutStatus, type OrderSource, Prisma } from "@prisma/client";
import {
  calculatePilotDeliveryPrice,
  classifyPackage,
  normalizeProductSearchName,
  resolveSupportedPackagePricingCity,
  type PilotPackageClass
} from "@gigflow/shared";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import { ensureAppCommerceCustomer, ensureWhatsAppCommerceCustomer } from "./commerce-customer.service.js";
import { formatUnresolvedRequestAccepted } from "../whatsapp/copy.js";

export const UNRESOLVED_CHECKOUT_NOTE =
  "Merchandise price is not set. totalCents is not a payable total.";

export type AcceptedUnresolvedRequest = {
  acceptedRequest: true;
  payable: false;
  merchandisePriced: false;
  checkoutId: string;
  checkoutNumber: number;
  status: "AWAITING_FULFILLMENT";
  packageClass: PilotPackageClass;
  deliveryFeeCents: number;
  lines: Array<{ catalogProductId: string; productName: string; quantity: number }>;
  message: string;
};

export function isAcceptedUnresolvedRequest(value: unknown): value is AcceptedUnresolvedRequest {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { acceptedRequest?: boolean }).acceptedRequest === true &&
      (value as { payable?: boolean }).payable === false
  );
}

type ResolvedLine = {
  catalogProductId: string;
  productName: string;
  quantity: number;
  category?: string | null;
  subcategory?: string | null;
  sizeLabel?: string | null;
  unit?: string | null;
};

function idempotencyKey(customerKey: string, lines: ResolvedLine[], lat: number, lng: number) {
  const body = [
    "unresolved-v1",
    customerKey,
    ...lines
      .map((line) => `${line.catalogProductId}:${line.quantity}`)
      .sort(),
    lat.toFixed(3),
    lng.toFixed(3)
  ].join("|");
  return createHash("sha256").update(body).digest("hex");
}

function present(row: {
  id: string;
  checkoutNumber: number;
  packageClass: string | null;
  deliveryFeeCents: number;
  lines: Array<{ catalogProductId: string; productNameSnapshot: string; quantity: number }>;
}): AcceptedUnresolvedRequest {
  const packageClass: PilotPackageClass =
    row.packageClass === "SMALL" || row.packageClass === "LARGE" ? row.packageClass : "MEDIUM";
  return {
    acceptedRequest: true,
    payable: false,
    merchandisePriced: false,
    checkoutId: row.id,
    checkoutNumber: row.checkoutNumber,
    status: "AWAITING_FULFILLMENT",
    packageClass,
    deliveryFeeCents: row.deliveryFeeCents,
    lines: row.lines.map((line) => ({
      catalogProductId: line.catalogProductId,
      productName: line.productNameSnapshot,
      quantity: line.quantity
    })),
    message: formatUnresolvedRequestAccepted()
  };
}

async function persist(input: {
  customerKey: string;
  commerceCustomerId: string;
  userId?: string | null;
  phone?: string | null;
  orderSource: OrderSource;
  lat: number;
  lng: number;
  deliveryLabel: string;
  lines: ResolvedLine[];
}): Promise<AcceptedUnresolvedRequest | null> {
  const city = resolveSupportedPackagePricingCity({
    typedAddress: input.deliveryLabel,
    deliveryLabel: input.deliveryLabel,
    customerLatitude: input.lat,
    customerLongitude: input.lng
  });
  if (!city) return null;
  if (!input.lines.length) return null;

  const packageClass = classifyPackage(
    input.lines.map((line) => ({
      quantity: line.quantity,
      category: line.category,
      subcategory: line.subcategory,
      sizeLabel: line.sizeLabel,
      unit: line.unit
    }))
  );
  const priced = calculatePilotDeliveryPrice({
    routeDistanceKm: 0,
    packageClass,
    deliveryLabel: input.deliveryLabel,
    typedAddress: input.deliveryLabel,
    customerLatitude: input.lat,
    customerLongitude: input.lng
  });
  if (!priced.eligible) return null;

  const key = idempotencyKey(input.customerKey, input.lines, input.lat, input.lng);
  const existing = await prisma.commerceCheckout.findUnique({
    where: { idempotencyKey: key },
    include: { lines: true }
  });
  if (existing?.status === CommerceCheckoutStatus.AWAITING_FULFILLMENT) return present(existing);

  try {
    const created = await prisma.commerceCheckout.create({
      data: {
        customerId: input.userId ?? null,
        commerceCustomerId: input.commerceCustomerId,
        status: CommerceCheckoutStatus.AWAITING_FULFILLMENT,
        paymentStatus: "PENDING",
        paymentMethod: "CASH",
        orderSource: input.orderSource,
        itemsSubtotalCents: 0,
        deliveryFeeCents: priced.deliveryFeeCents,
        serviceFeeCents: 0,
        totalCents: 0,
        deliveryLabel: input.deliveryLabel,
        deliveryLatitude: input.lat,
        deliveryLongitude: input.lng,
        packageClass,
        customerWhatsAppPhone: input.phone ?? null,
        pickupSequence: [],
        allocations: { merchants: [], awaitingFulfillment: true },
        notes: UNRESOLVED_CHECKOUT_NOTE,
        idempotencyKey: key,
        lines: {
          create: input.lines.map((line) => ({
            catalogProductId: line.catalogProductId,
            quantity: line.quantity,
            productNameSnapshot: line.productName,
            fulfillmentStatus: "AWAITING_SOURCE"
          }))
        }
      },
      include: { lines: true }
    });
    return present(created);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const replay = await prisma.commerceCheckout.findUnique({
        where: { idempotencyKey: key },
        include: { lines: true }
      });
      if (replay?.status === CommerceCheckoutStatus.AWAITING_FULFILLMENT) return present(replay);
    }
    throw error;
  }
}

async function uniqueCatalogByQuery(query: string, quantity: number): Promise<ResolvedLine | null> {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) return null;
  const normalized = normalizeProductSearchName(query);
  if (!normalized || normalized.length < 2) return null;
  const rows = await prisma.catalogProduct.findMany({
    where: {
      status: "APPROVED",
      OR: [{ normalizedName: normalized }, { normalizedName: { contains: normalized } }]
    },
    take: 8,
    orderBy: { name: "asc" }
  });
  const exact = rows.filter((row) => row.normalizedName === normalized);
  const chosen = exact.length === 1 ? exact[0] : exact.length === 0 && rows.length === 1 ? rows[0] : null;
  if (!chosen) return null;
  return {
    catalogProductId: chosen.id,
    productName: chosen.name,
    quantity,
    category: chosen.category,
    subcategory: chosen.subcategory,
    sizeLabel: chosen.sizeLabel,
    unit: chosen.unit
  };
}

/** WhatsApp free-text basket. Returns null unless every item is one approved catalog product in Gweru or Harare. */
export async function acceptUnresolvedTextRequest(input: {
  phone: string;
  lat: number;
  lng: number;
  deliveryLabel: string;
  items: Array<{ query: string; quantity: number }>;
}): Promise<AcceptedUnresolvedRequest | null> {
  if (!input.items.length) return null;
  const lines: ResolvedLine[] = [];
  for (const item of input.items) {
    const line = await uniqueCatalogByQuery(item.query, item.quantity);
    if (!line) return null;
    lines.push(line);
  }
  const customer = await ensureWhatsAppCommerceCustomer(input.phone);
  return persist({
    customerKey: customer.id,
    commerceCustomerId: customer.id,
    phone: customer.whatsappPhone,
    orderSource: "WHATSAPP",
    lat: input.lat,
    lng: input.lng,
    deliveryLabel: input.deliveryLabel.trim() || "Delivery location",
    lines
  });
}

/**
 * App/web product lines after merchant availability already failed.
 * Returns null for unsupported cities, missing catalog links, or mixed merchants.
 */
export async function acceptUnresolvedProductRequest(input: {
  userId?: string | null;
  phone?: string | null;
  lat: number;
  lng: number;
  deliveryLabel: string;
  lines: Array<{ productId: string; quantity: number }>;
}): Promise<AcceptedUnresolvedRequest | null> {
  if (!input.lines.length) return null;
  const ids = [...new Set(input.lines.map((line) => line.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    include: { catalogProduct: true }
  });
  if (products.length !== ids.length) return null;
  const merchants = new Set(products.map((product) => product.merchantId));
  if (merchants.size !== 1) return null;

  const lines: ResolvedLine[] = [];
  for (const line of input.lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99) return null;
    const product = products.find((row) => row.id === line.productId);
    const catalog = product?.catalogProduct;
    if (!product || !catalog || catalog.status !== "APPROVED") return null;
    lines.push({
      catalogProductId: catalog.id,
      productName: catalog.name,
      quantity: line.quantity,
      category: catalog.category,
      subcategory: catalog.subcategory,
      sizeLabel: catalog.sizeLabel,
      unit: catalog.unit
    });
  }

  if (input.userId) {
    const customer = await ensureAppCommerceCustomer(input.userId);
    return persist({
      customerKey: customer.id,
      commerceCustomerId: customer.id,
      userId: input.userId,
      phone: input.phone ?? customer.whatsappPhone,
      orderSource: "APP",
      lat: input.lat,
      lng: input.lng,
      deliveryLabel: input.deliveryLabel.trim() || "Delivery location",
      lines
    });
  }
  if (input.phone) {
    const customer = await ensureWhatsAppCommerceCustomer(input.phone);
    return persist({
      customerKey: customer.id,
      commerceCustomerId: customer.id,
      phone: customer.whatsappPhone,
      orderSource: "WHATSAPP",
      lat: input.lat,
      lng: input.lng,
      deliveryLabel: input.deliveryLabel.trim() || "Delivery location",
      lines
    });
  }
  return null;
}

export function assertCheckoutPayable(status: CommerceCheckoutStatus | string | null | undefined) {
  if (status === CommerceCheckoutStatus.AWAITING_FULFILLMENT) {
    throw new AppError(
      "This request isn't ready for payment. We'll confirm the total first.",
      409,
      "REQUEST_NOT_PAYABLE"
    );
  }
}
