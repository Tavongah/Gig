import type { InboundWhatsAppMessage } from "./customer-handler.js";

/** Meta Cloud API webhook payload (subset). */
export type MetaWebhookPayload = {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          id: string;
          from: string;
          type?: string;
          text?: { body?: string };
          button?: { payload?: string; text?: string };
          interactive?: {
            type?: string;
            button_reply?: { id?: string; title?: string };
            list_reply?: { id?: string; title?: string };
          };
          location?: { latitude?: number; longitude?: number; name?: string; address?: string };
        }>;
        contacts?: Array<{ profile?: { name?: string } }>;
      };
    }>;
  }>;
};

/** Parse inbound customer/merchant messages from a Meta webhook body. */
export function extractMetaMessages(payload: MetaWebhookPayload): InboundWhatsAppMessage[] {
  const out: InboundWhatsAppMessage[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const name = value?.contacts?.[0]?.profile?.name;
      for (const m of value?.messages ?? []) {
        out.push({
          providerMessageId: m.id,
          from: m.from,
          text:
            m.text?.body ||
            m.button?.text ||
            m.interactive?.button_reply?.title ||
            m.interactive?.list_reply?.title,
          buttonId:
            m.button?.payload ||
            m.interactive?.button_reply?.id ||
            m.interactive?.list_reply?.id,
          location:
            m.location?.latitude != null && m.location?.longitude != null
              ? {
                  latitude: m.location.latitude,
                  longitude: m.location.longitude,
                  name: m.location.name,
                  address: m.location.address
                }
              : undefined,
          profileName: name
        });
      }
    }
  }
  return out;
}
