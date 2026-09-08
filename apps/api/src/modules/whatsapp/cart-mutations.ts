import type { RequestedShoppingItem } from "@gigflow/shared";
import { normalizeProductSearchName } from "@gigflow/shared";
import type { ShoppingIntent } from "./shopping-intent.js";
import { resolveCartReference } from "./shopping-intent.js";

export type CartMutationResult =
  | { ok: true; items: RequestedShoppingItem[]; note?: string }
  | { ok: false; reason: string; ask?: string };

/** Merge / mutate requestedItems. Never touches Product prices or Product IDs. */
export function applyCartIntent(
  current: RequestedShoppingItem[],
  intent: ShoppingIntent,
  draftNames?: string[]
): CartMutationResult {
  const cart = [...current];

  switch (intent.kind) {
    case "NEW_LIST": {
      if (!intent.items?.length) return { ok: false, reason: "empty_list", ask: "Tell me which items you want." };
      return { ok: true, items: mergeItems([], intent.items), note: "replaced" };
    }
    case "ADD_ITEM": {
      if (!intent.items?.length) return { ok: false, reason: "empty_add", ask: "What should I add?" };
      return { ok: true, items: mergeItems(cart, intent.items), note: "added" };
    }
    case "CLEAR_CART":
      return { ok: true, items: [], note: "cleared" };
    case "REMOVE_ITEM": {
      const resolved = resolveCartReference(intent.reference, intent.targetQuery, cart, draftNames);
      if (!resolved) {
        return { ok: false, reason: "ambiguous", ask: "Which item should I remove?" };
      }
      if ("ambiguous" in resolved) {
        return {
          ok: false,
          reason: "ambiguous",
          ask: `Which one should I remove?\n${resolved.ambiguous.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
        };
      }
      const next = cart.filter((c) => !queriesMatch(c.query, resolved.query));
      if (next.length === cart.length) {
        return { ok: false, reason: "not_found", ask: `I don't see "${resolved.query}" in your basket.` };
      }
      return { ok: true, items: next, note: "removed" };
    }
    case "CHANGE_QUANTITY": {
      const qty = intent.quantity;
      if (qty == null || qty < 1) {
        // "add another" without qty → bump that by 1
        const resolved = resolveCartReference(intent.reference ?? "that", intent.targetQuery, cart, draftNames);
        if (!resolved || "ambiguous" in resolved) {
          return {
            ok: false,
            reason: "ambiguous",
            ask: "Which item should I change the quantity for?"
          };
        }
        const next = cart.map((c) =>
          queriesMatch(c.query, resolved.query) ? { ...c, quantity: c.quantity + 1 } : c
        );
        return { ok: true, items: next, note: "qty" };
      }
      const resolved = resolveCartReference(intent.reference, intent.targetQuery, cart, draftNames);
      if (!resolved) {
        return { ok: false, reason: "ambiguous", ask: "Which item should I change?" };
      }
      if ("ambiguous" in resolved) {
        return {
          ok: false,
          reason: "ambiguous",
          ask: `Which one?\n${resolved.ambiguous.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
        };
      }
      let found = false;
      const next = cart.map((c) => {
        if (queriesMatch(c.query, resolved.query)) {
          found = true;
          return { ...c, quantity: qty };
        }
        return c;
      });
      if (!found) {
        return { ok: true, items: mergeItems(cart, [{ query: resolved.query, quantity: qty }]), note: "qty_add" };
      }
      return { ok: true, items: next, note: "qty" };
    }
    case "REPLACE_ITEM": {
      if (!intent.replaceWith) {
        return { ok: false, reason: "missing_replace", ask: "What should I change it to?" };
      }
      const resolved = resolveCartReference(intent.reference, intent.targetQuery, cart, draftNames);
      if (!resolved) {
        return { ok: false, reason: "ambiguous", ask: "Which item should I replace?" };
      }
      if ("ambiguous" in resolved) {
        return {
          ok: false,
          reason: "ambiguous",
          ask: `Which one should I replace?\n${resolved.ambiguous.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
        };
      }
      const next = cart.map((c) =>
        queriesMatch(c.query, resolved.query)
          ? { query: normalizeProductSearchName(intent.replaceWith!) || intent.replaceWith!, quantity: c.quantity }
          : c
      );
      if (!next.some((c) => queriesMatch(c.query, intent.replaceWith!))) {
        // target wasn't in cart — add replacement
        return {
          ok: true,
          items: mergeItems(
            cart.filter((c) => !queriesMatch(c.query, resolved.query)),
            [{ query: intent.replaceWith, quantity: 1 }]
          ),
          note: "replaced"
        };
      }
      return { ok: true, items: next, note: "replaced" };
    }
    default:
      return { ok: false, reason: "not_a_mutation" };
  }
}

function mergeItems(base: RequestedShoppingItem[], add: RequestedShoppingItem[]): RequestedShoppingItem[] {
  const out = base.map((b) => ({ ...b }));
  for (const item of add) {
    const idx = out.findIndex((o) => queriesMatch(o.query, item.query));
    if (idx >= 0 && out[idx]) {
      out[idx] = { ...out[idx], quantity: out[idx].quantity + item.quantity };
    } else {
      out.push({ query: normalizeProductSearchName(item.query) || item.query, quantity: item.quantity });
    }
  }
  return out;
}

function queriesMatch(a: string, b: string): boolean {
  const na = normalizeProductSearchName(a);
  const nb = normalizeProductSearchName(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

export function getCartTtlMs(): number {
  const raw = process.env.COMMERCE_CART_TTL_SECONDS;
  if (raw && /^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n >= 60 && n <= 86_400) return n * 1000;
  }
  return 45 * 60 * 1000; // 45 minutes
}

export function isCartExpired(draftQuotedAt: string | undefined, now = Date.now()): boolean {
  if (!draftQuotedAt) return false;
  const t = Date.parse(draftQuotedAt);
  if (!Number.isFinite(t)) return false;
  return now - t > getCartTtlMs();
}

export function formatRequestedCart(items: RequestedShoppingItem[]): string {
  if (!items.length) return "Your cart is empty. Tell me what you'd like to buy.";
  return ["Your order:", ...items.map((i) => `• ${i.quantity} × ${i.query}`)].join("\n");
}
