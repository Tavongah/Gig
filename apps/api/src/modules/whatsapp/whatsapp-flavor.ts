import {
  formatFlavorCustomerLine,
  isFlavorInquiry,
  matchFlavorFromText,
  parseProductFlavorOptionsEnabled,
  unmatchedFlavorMention,
  type FlavorOptionPublic
} from "@gigflow/shared";
import { prisma } from "../../config/prisma.js";
import { listFlavorOptions, presentFlavorOption } from "../commerce/flavor.service.js";
import { setExpected } from "./checkout-session.js";
import type { ConversationContext } from "./conversation.service.js";
import { sendCustomerChoices } from "./customer-interactive.js";
import { getWhatsAppProvider } from "./provider.js";

export function flavorUxEnabled(): boolean {
  return parseProductFlavorOptionsEnabled(process.env.PRODUCT_FLAVOR_OPTIONS_ENABLED);
}

export async function flavorsForProduct(productId: string): Promise<FlavorOptionPublic[]> {
  if (!flavorUxEnabled()) return [];
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { catalogProductId: true }
  });
  if (!product?.catalogProductId) return [];
  const rows = await listFlavorOptions(product.catalogProductId, true);
  return rows.map(presentFlavorOption);
}

export async function attachFlavorToLock(
  product: { id: string; name: string },
  query: string
): Promise<{
  flavorOptionId: string | null;
  flavorName: string | null;
  flavorPreference: "ANY" | "SPECIFIC" | null;
  unmatched?: string | null;
}> {
  const flavors = await flavorsForProduct(product.id);
  if (!flavors.length) {
    return { flavorOptionId: null, flavorName: null, flavorPreference: null };
  }
  const matched = matchFlavorFromText(query, flavors);
  if (matched) {
    return {
      flavorOptionId: matched.id,
      flavorName: matched.name,
      flavorPreference: "SPECIFIC"
    };
  }
  const unmatched = unmatchedFlavorMention(query, product.name, flavors);
  if (unmatched) {
    return {
      flavorOptionId: null,
      flavorName: null,
      flavorPreference: "ANY",
      unmatched
    };
  }
  return { flavorOptionId: null, flavorName: null, flavorPreference: "ANY" };
}

export async function sendFlavorChoicesForProduct(
  phone: string,
  ctx: ConversationContext,
  product: { id: string; name: string }
) {
  const flavors = await flavorsForProduct(product.id);
  if (!flavors.length) {
    await getWhatsAppProvider().sendText(phone, `${product.name} doesn't have flavor options.`);
    return { handled: true as const, asked: false };
  }
  const choiceId = crypto.randomUUID();
  ctx.pendingFlavorChoices = [
    {
      productId: product.id,
      productName: product.name,
      flavors: [{ id: null, name: "Any flavor" }, ...flavors.map((f) => ({ id: f.id, name: f.name }))],
      choiceId
    }
  ];
  ctx.choiceId = choiceId;
  setExpected(ctx, "PRODUCT_FLAVOR");
  const body = `What flavors are available for ${product.name}?\n\nFlavor is optional. Any flavor means no preference.`;
  await sendCustomerChoices(
    phone,
    ctx,
    body,
    ctx.pendingFlavorChoices[0]!.flavors.slice(0, 10).map((f, i) => ({
      title: f.name.slice(0, 20),
      action: {
        kind: "SELECT_FLAVOR",
        expectedInput: "PRODUCT_FLAVOR",
        checkoutSessionId: ctx.checkoutSessionId,
        productId: product.id,
        flavorOptionId: f.id ?? undefined,
        choiceIndex: i
      }
    }))
  );
  return { handled: true as const, asked: true };
}

export function applyPendingFlavorChoice(
  ctx: ConversationContext,
  pick: { id: string | null; name: string }
) {
  const pending = ctx.pendingFlavorChoices?.[0];
  if (!pending) return false;
  ctx.lockedProductLines = (ctx.lockedProductLines ?? []).map((line) =>
    line.productId === pending.productId
      ? {
          ...line,
          flavorOptionId: pick.id,
          flavorName: pick.id ? pick.name : null,
          flavorPreference: pick.id ? "SPECIFIC" : "ANY"
        }
      : line
  );
  ctx.pendingFlavorChoices = undefined;
  return true;
}

export function flavorInquiryFromText(text: string): boolean {
  return flavorUxEnabled() && isFlavorInquiry(text);
}

export function displayNameWithFlavor(line: {
  productName: string;
  flavorPreference?: string | null;
  flavorName?: string | null;
}): { productName: string; flavorLine?: string | null } {
  return {
    productName: line.productName,
    flavorLine: formatFlavorCustomerLine(line.flavorPreference, line.flavorName)
  };
}
