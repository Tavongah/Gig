import { createHmac, timingSafeEqual } from "node:crypto";
import type { InboundWhatsAppMessage } from "./customer-handler.js";

/** Twilio WhatsApp inbound webhook fields (application/x-www-form-urlencoded). */
export type TwilioWhatsAppForm = Record<string, string | undefined>;

export type InboundWhatsAppMedia = {
  url?: string;
  contentType?: string;
};

export type InboundWhatsAppMessageWithMedia = InboundWhatsAppMessage & {
  /** Transport-only metadata; conversation engine ignores this. */
  media?: InboundWhatsAppMedia[];
};

/** Strip Twilio's `whatsapp:` channel prefix; leave E.164 digits for normalizePhoneNumber. */
export function stripTwilioWhatsAppAddress(raw: string): string {
  return raw.replace(/^whatsapp:/i, "").trim();
}

/**
 * Official Twilio request signature algorithm
 * (same as twilio.validateRequest / getExpectedTwilioSignature).
 * https://www.twilio.com/docs/usage/security#validating-requests
 */
export function getExpectedTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>
): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

export function validateTwilioRequest(input: {
  authToken: string;
  signatureHeader: string | undefined;
  url: string;
  params: Record<string, string>;
}): boolean {
  if (!input.signatureHeader) return false;
  const expected = getExpectedTwilioSignature(input.authToken, input.url, input.params);
  const provided = input.signatureHeader.trim();
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function asStringMap(body: TwilioWhatsAppForm | Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) {
    if (v == null) continue;
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = String(v);
  }
  return out;
}

function extractMedia(params: Record<string, string>): InboundWhatsAppMedia[] | undefined {
  const n = Number(params.NumMedia ?? "0");
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const media: InboundWhatsAppMedia[] = [];
  for (let i = 0; i < Math.min(n, 10); i += 1) {
    const url = params[`MediaUrl${i}`];
    const contentType = params[`MediaContentType${i}`];
    if (url || contentType) media.push({ url, contentType });
  }
  return media.length ? media : undefined;
}

/**
 * Normalize one Twilio WhatsApp inbound POST into the shared inbound structure.
 * Returns null when MessageSid / From are missing (not a usable WhatsApp message).
 */
export function extractTwilioMessage(
  body: TwilioWhatsAppForm | Record<string, unknown>
): InboundWhatsAppMessageWithMedia | null {
  const params = asStringMap(body);
  const sid = params.MessageSid?.trim() || params.SmsMessageSid?.trim();
  const fromRaw = params.From?.trim();
  if (!sid || !fromRaw) return null;

  const lat = params.Latitude != null && params.Latitude !== "" ? Number(params.Latitude) : NaN;
  const lng = params.Longitude != null && params.Longitude !== "" ? Number(params.Longitude) : NaN;
  const hasLocation = Number.isFinite(lat) && Number.isFinite(lng);

  const text = params.Body?.trim() || undefined;
  // Twilio Content / interactive reply payloads (optional; Body usually carries the label)
  const buttonId =
    params.ButtonPayload?.trim() ||
    params.ListId?.trim() ||
    undefined;

  return {
    providerMessageId: sid,
    from: stripTwilioWhatsAppAddress(fromRaw),
    text,
    buttonId,
    location: hasLocation
      ? {
          latitude: lat,
          longitude: lng,
          name: params.Label?.trim() || undefined,
          address: params.Address?.trim() || undefined
        }
      : undefined,
    profileName: params.ProfileName?.trim() || undefined,
    media: extractMedia(params)
  };
}

export function twilioFormParamsForSignature(
  body: TwilioWhatsAppForm | Record<string, unknown>
): Record<string, string> {
  return asStringMap(body);
}

/** Public webhook URL Twilio signed (override with TWILIO_WHATSAPP_WEBHOOK_URL). */
export function resolveTwilioWebhookUrl(reqProtocol?: string, reqHost?: string): string {
  const explicit = process.env.TWILIO_WHATSAPP_WEBHOOK_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const base = (process.env.API_PUBLIC_URL || "").replace(/\/$/, "");
  if (base) return `${base}/v1/whatsapp/twilio`;
  if (reqProtocol && reqHost) return `${reqProtocol}://${reqHost}/v1/whatsapp/twilio`;
  return "http://localhost:4000/v1/whatsapp/twilio";
}
