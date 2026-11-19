export const REQUEST_PRODUCT_LIMIT = 10;

export type RequestProductDraft = {
  id: string;
  name: string;
  quantity: string;
  details: string;
};

export type RequestProductsDraft = {
  products: RequestProductDraft[];
  whatsappNumber: string;
  deliveryCity: string;
  notes: string;
};

export type RequestProductLine = {
  name: string;
  quantity: number;
  details: string;
};

export type ValidRequestProducts = {
  products: RequestProductLine[];
  whatsappNumber: string;
  deliveryCity: string;
  notes: string;
};

export type RequestProductsErrors = {
  form?: string;
  whatsappNumber?: string;
  deliveryCity?: string;
  products: Record<string, { name?: string; quantity?: string }>;
};

export function emptyRequestProduct(id: string, name = ""): RequestProductDraft {
  return { id, name, quantity: "1", details: "" };
}

export function parseCustomerWhatsApp(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^\+?[0-9][0-9\s().-]*$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  return `+${digits}`;
}

export function parseRequestQuantity(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^[1-9]\d{0,2}$/.test(trimmed)) return null;
  return Number(trimmed);
}

export function validateRequestProducts(draft: RequestProductsDraft):
  | { ok: true; value: ValidRequestProducts }
  | { ok: false; errors: RequestProductsErrors } {
  const errors: RequestProductsErrors = { products: {} };
  const products: RequestProductLine[] = [];

  if (draft.products.length < 1) {
    errors.form = "Add at least one product.";
  }
  if (draft.products.length > REQUEST_PRODUCT_LIMIT) {
    errors.form = `You can request up to ${REQUEST_PRODUCT_LIMIT} products.`;
  }

  for (const product of draft.products) {
    const name = product.name.trim();
    const quantity = parseRequestQuantity(product.quantity);
    const fieldErrors: { name?: string; quantity?: string } = {};
    if (!name) fieldErrors.name = "Enter a product name.";
    if (quantity == null) fieldErrors.quantity = "Enter a quantity of at least 1.";
    if (fieldErrors.name || fieldErrors.quantity) errors.products[product.id] = fieldErrors;
    if (name && quantity != null) {
      products.push({ name, quantity, details: product.details.trim() });
    }
  }

  const whatsappNumber = parseCustomerWhatsApp(draft.whatsappNumber);
  if (!whatsappNumber) errors.whatsappNumber = "Enter a WhatsApp number with the country code.";

  const deliveryCity = draft.deliveryCity.trim();
  if (!deliveryCity) errors.deliveryCity = "Enter a delivery city.";

  if (errors.form || errors.whatsappNumber || errors.deliveryCity || Object.keys(errors.products).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      products,
      whatsappNumber: whatsappNumber!,
      deliveryCity,
      notes: draft.notes.trim()
    }
  };
}

export function formatRequestProductsMessage(value: ValidRequestProducts): string {
  const products = value.products
    .map((product, index) => {
      const header = `${index + 1}. ${product.name} — Quantity: ${product.quantity}`;
      return product.details ? `${header}\n   Details: ${product.details}` : header;
    })
    .join("\n\n");
  const lines = [
    "Hello DUTS, I'd like to request the following products:",
    "",
    products,
    "",
    `Delivery city: ${value.deliveryCity}`,
    `My WhatsApp: ${value.whatsappNumber}`
  ];
  if (value.notes) lines.push("", `Additional notes: ${value.notes}`);
  lines.push("", "Please help me check availability and prices. Thank you!");
  return lines.join("\n");
}

/**
 * Staff inbox for catalog requests. This is not the Twilio shopping-bot number.
 * Expo inlines EXPO_PUBLIC_* only when the name is written out directly.
 */
export function requestProductsDestinationDigits(): string | null {
  const digits = (process.env.EXPO_PUBLIC_DUTS_REQUESTS_WHATSAPP ?? "").replace(/\D/g, "");
  if (!/^[0-9]{10,15}$/.test(digits)) return null;
  return digits;
}

/** Digits must come from the request-products configuration. This function has no fallback number. */
export function buildRequestProductsWhatsAppUrl(dutsDigits: string | null | undefined, message: string): string | null {
  const digits = (dutsDigits ?? "").replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
