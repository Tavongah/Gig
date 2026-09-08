import { getWhatsAppProvider } from "./provider.js";

/**
 * Session vs template messaging (Meta Cloud API).
 * Within the 24h customer-care window: free-form text/buttons OK.
 * Outside that window: approved templates required.
 *
 * Template names are env-configurable; sends fall back to session text in mock/dev.
 */
export type CommerceNotifyKind =
  | "merchant_new_order"
  | "customer_order_accepted"
  | "customer_courier_assigned"
  | "customer_on_the_way"
  | "customer_delivered"
  | "customer_cancelled";

const TEMPLATE_ENV: Record<CommerceNotifyKind, string> = {
  merchant_new_order: "WHATSAPP_TEMPLATE_MERCHANT_NEW_ORDER",
  customer_order_accepted: "WHATSAPP_TEMPLATE_ORDER_ACCEPTED",
  customer_courier_assigned: "WHATSAPP_TEMPLATE_COURIER_ASSIGNED",
  customer_on_the_way: "WHATSAPP_TEMPLATE_ON_THE_WAY",
  customer_delivered: "WHATSAPP_TEMPLATE_DELIVERED",
  customer_cancelled: "WHATSAPP_TEMPLATE_CANCELLED"
};

export function templateNameFor(kind: CommerceNotifyKind): string | null {
  const envKey = TEMPLATE_ENV[kind];
  const name = process.env[envKey]?.trim();
  return name || null;
}

/**
 * Prefer session text. If WHATSAPP_FORCE_TEMPLATES=true and a template is configured,
 * Meta provider should send template (future Graph call). For Stage 4.5, text is used
 * and template names are documented for Meta Business Manager approval.
 */
export async function sendCommerceNotification(
  to: string,
  kind: CommerceNotifyKind,
  body: string,
  buttons?: Array<{ id: string; title: string }>
): Promise<{ mode: "session" | "template"; template?: string }> {
  const wa = getWhatsAppProvider();
  const template = templateNameFor(kind);
  const forceTemplates = process.env.WHATSAPP_FORCE_TEMPLATES === "true";

  if (forceTemplates && template && wa.name === "meta") {
    // Template Graph payload is account-specific; until templates are approved, fall back to text.
    // Never log tokens. Log only template name.
    console.info(JSON.stringify({ event: "WHATSAPP_TEMPLATE_FALLBACK_SESSION", template, kind }));
  }

  if (buttons?.length) {
    try {
      await wa.sendButtons(to, body, buttons);
    } catch {
      await wa.sendText(to, `${body}\n\n(Reply with the option text if buttons do not appear.)`);
    }
  } else {
    await wa.sendText(to, body);
  }

  return { mode: "session", template: template ?? undefined };
}
