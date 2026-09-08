import { createHmac, timingSafeEqual } from "node:crypto";
import { validateTwilioRequest } from "./twilio-payload.js";

export type WhatsAppButton = { id: string; title: string };

export type OutboundWhatsAppMessage = {
  to: string;
  body: string;
  buttons?: WhatsAppButton[];
  at: string;
};

export interface WhatsAppProvider {
  readonly name: string;
  sendText(to: string, body: string): Promise<void>;
  sendButtons(to: string, body: string, buttons: WhatsAppButton[]): Promise<void>;
  verifyWebhookSignature?(rawBody: Buffer, signatureHeader: string | undefined): boolean;
  /** Twilio uses form params + full URL (not raw JSON HMAC). */
  verifyTwilioSignature?(input: {
    signatureHeader: string | undefined;
    url: string;
    params: Record<string, string>;
  }): boolean;
}

/** In-memory mock for tests and local Stage 4 development. */
export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly name = "mock";
  readonly sent: OutboundWhatsAppMessage[] = [];

  async sendText(to: string, body: string): Promise<void> {
    this.sent.push({ to, body, at: new Date().toISOString() });
  }

  async sendButtons(to: string, body: string, buttons: WhatsAppButton[]): Promise<void> {
    this.sent.push({ to, body, buttons, at: new Date().toISOString() });
  }

  clear(): void {
    this.sent.length = 0;
  }
}

/**
 * Meta Cloud API provider (official). Requires env:
 * WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET
 */
export class MetaWhatsAppProvider implements WhatsAppProvider {
  readonly name = "meta";

  constructor(
    private readonly token: string,
    private readonly phoneNumberId: string,
    private readonly appSecret?: string
  ) {}

  private async graph(path: string, body: unknown): Promise<void> {
    const res = await fetch(`https://graph.facebook.com/v21.0/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("[whatsapp:meta] send failed", res.status, text.slice(0, 300));
      throw new Error("WhatsApp send failed");
    }
  }

  async sendText(to: string, body: string): Promise<void> {
    const toDigits = to.replace(/\D/g, "");
    await this.graph(`${this.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      to: toDigits,
      type: "text",
      text: { body: body.slice(0, 4000) }
    });
  }

  async sendButtons(to: string, body: string, buttons: WhatsAppButton[]): Promise<void> {
    const toDigits = to.replace(/\D/g, "");
    const replyButtons = buttons.slice(0, 3).map((b) => ({
      type: "reply",
      reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) }
    }));
    await this.graph(`${this.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      to: toDigits,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: body.slice(0, 1024) },
        action: { buttons: replyButtons }
      }
    });
  }

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    if (!this.appSecret) return process.env.NODE_ENV !== "production";
    if (!signatureHeader?.startsWith("sha256=")) return false;
    const expected = createHmac("sha256", this.appSecret).update(rawBody).digest("hex");
    const provided = signatureHeader.slice("sha256=".length);
    try {
      return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
    } catch {
      return false;
    }
  }
}

export type TwilioWhatsAppProviderOptions = {
  accountSid: string;
  authToken: string;
  /** E.g. whatsapp:+14155238886 */
  fromWhatsApp: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
};

/**
 * Twilio WhatsApp Messaging API (testing transport).
 * Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM
 */
export class TwilioWhatsAppProvider implements WhatsAppProvider {
  readonly name = "twilio";
  readonly sent: OutboundWhatsAppMessage[] = [];

  constructor(private readonly opts: TwilioWhatsAppProviderOptions) {}

  private toWhatsAppAddress(to: string): string {
    const cleaned = to.replace(/^whatsapp:/i, "").trim();
    const e164 = cleaned.startsWith("+") ? cleaned : `+${cleaned.replace(/\D/g, "")}`;
    return `whatsapp:${e164}`;
  }

  private async createMessage(to: string, body: string): Promise<void> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.opts.accountSid}/Messages.json`;
    const auth = Buffer.from(`${this.opts.accountSid}:${this.opts.authToken}`).toString("base64");
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        From: this.opts.fromWhatsApp,
        To: this.toWhatsAppAddress(to),
        Body: body.slice(0, 1600)
      }).toString()
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("[whatsapp:twilio] send failed", res.status, text.slice(0, 300));
      throw new Error("WhatsApp send failed");
    }
  }

  async sendText(to: string, body: string): Promise<void> {
    this.sent.push({ to, body, at: new Date().toISOString() });
    await this.createMessage(to, body);
  }

  async sendButtons(to: string, body: string, buttons: WhatsAppButton[]): Promise<void> {
    const hints = buttons
      .slice(0, 3)
      .map((b) => b.title)
      .filter(Boolean);
    const combined =
      hints.length > 0 ? `${body.slice(0, 1400)}\n\nReply: ${hints.join(" · ")}` : body.slice(0, 1600);
    this.sent.push({ to, body: combined, buttons, at: new Date().toISOString() });
    await this.createMessage(to, combined);
  }

  verifyTwilioSignature(input: {
    signatureHeader: string | undefined;
    url: string;
    params: Record<string, string>;
  }): boolean {
    return validateTwilioRequest({
      authToken: this.opts.authToken,
      signatureHeader: input.signatureHeader,
      url: input.url,
      params: input.params
    });
  }
}

let sharedProvider: WhatsAppProvider | null = null;
let mockSingleton: MockWhatsAppProvider | null = null;

function resolveTwilioFromNumber(): string {
  const explicit = process.env.TWILIO_WHATSAPP_FROM?.trim();
  if (explicit) {
    return explicit.startsWith("whatsapp:") ? explicit : `whatsapp:${explicit}`;
  }
  const from = process.env.TWILIO_FROM_NUMBER?.trim();
  if (!from) {
    throw new Error(
      "WHATSAPP_PROVIDER=twilio requires TWILIO_WHATSAPP_FROM or TWILIO_FROM_NUMBER"
    );
  }
  return from.startsWith("whatsapp:") ? from : `whatsapp:${from}`;
}

export function getWhatsAppProvider(): WhatsAppProvider {
  if (sharedProvider) return sharedProvider;
  const mode = (process.env.WHATSAPP_PROVIDER || "mock").toLowerCase();
  if (mode === "meta") {
    const token = process.env.WHATSAPP_TOKEN?.trim();
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
    if (!token || !phoneNumberId) {
      throw new Error("WHATSAPP_PROVIDER=meta requires WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID");
    }
    sharedProvider = new MetaWhatsAppProvider(token, phoneNumberId, process.env.WHATSAPP_APP_SECRET);
    return sharedProvider;
  }
  if (mode === "twilio") {
    const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
    const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
    if (!accountSid || !authToken) {
      throw new Error("WHATSAPP_PROVIDER=twilio requires TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN");
    }
    sharedProvider = new TwilioWhatsAppProvider({
      accountSid,
      authToken,
      fromWhatsApp: resolveTwilioFromNumber()
    });
    return sharedProvider;
  }
  mockSingleton = mockSingleton ?? new MockWhatsAppProvider();
  sharedProvider = mockSingleton;
  return sharedProvider;
}

export function getMockWhatsAppProvider(): MockWhatsAppProvider {
  const p = getWhatsAppProvider();
  if (p instanceof MockWhatsAppProvider) return p;
  mockSingleton = mockSingleton ?? new MockWhatsAppProvider();
  return mockSingleton;
}

export function resetWhatsAppProviderForTests(): void {
  sharedProvider = null;
  mockSingleton = null;
}

/** Test helper: inject a provider (e.g. Twilio with mocked fetch). */
export function setWhatsAppProviderForTests(provider: WhatsAppProvider): void {
  sharedProvider = provider;
  if (provider instanceof MockWhatsAppProvider) {
    mockSingleton = provider;
  }
}
