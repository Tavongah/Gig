import { createHmac, timingSafeEqual } from "node:crypto";
import { validateTwilioRequest } from "./twilio-payload.js";

export type WhatsAppButton = { id: string; title: string; description?: string };

export type OutboundWhatsAppMessage = {
  to: string;
  body: string;
  buttons?: WhatsAppButton[];
  at: string;
  providerMessageSid?: string;
};

export type WhatsAppSendResult = {
  ok: boolean;
  providerMessageSid?: string;
  errorCode?: string;
  errorCategory?: "TRANSIENT" | "SESSION_WINDOW" | "INVALID_NUMBER" | "TEMPLATE_REQUIRED" | "PROVIDER" | "UNKNOWN";
  errorMessage?: string;
};

export type WhatsAppOutboundOptions = {
  body?: string;
  buttons?: WhatsAppButton[];
  contentSid?: string;
  contentVariables?: Record<string, string>;
  statusCallbackUrl?: string;
};

export interface WhatsAppProvider {
  readonly name: string;
  sendText(to: string, body: string): Promise<void>;
  sendButtons(to: string, body: string, buttons: WhatsAppButton[]): Promise<void>;
  sendList?(to: string, body: string, buttonText: string, items: WhatsAppButton[]): Promise<void>;
  sendOutbound?(to: string, opts: WhatsAppOutboundOptions): Promise<WhatsAppSendResult>;
  verifyWebhookSignature?(rawBody: Buffer, signatureHeader: string | undefined): boolean;
  /** Twilio uses form params + full URL (not raw JSON HMAC). */
  verifyTwilioSignature?(input: {
    signatureHeader: string | undefined;
    url: string;
    params: Record<string, string>;
  }): boolean;
}

function mockSid(): string {
  return `SM${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
}

/** In-memory mock for tests and local Stage 4 development. */
export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly name = "mock";
  readonly sent: OutboundWhatsAppMessage[] = [];
  /** Test hook: next sendOutbound fails with this result then clears. */
  nextFailure: WhatsAppSendResult | null = null;
  failUntilCleared: WhatsAppSendResult | null = null;

  async sendText(to: string, body: string): Promise<void> {
    const result = await this.sendOutbound(to, { body });
    if (!result.ok) throw new Error("WhatsApp send failed");
  }

  async sendButtons(to: string, body: string, buttons: WhatsAppButton[]): Promise<void> {
    const result = await this.sendOutbound(to, { body, buttons });
    if (!result.ok) throw new Error("WhatsApp send failed");
  }

  async sendList(to: string, body: string, _buttonText: string, items: WhatsAppButton[]): Promise<void> {
    const result = await this.sendOutbound(to, { body, buttons: items });
    if (!result.ok) throw new Error("WhatsApp send failed");
  }

  async sendOutbound(to: string, opts: WhatsAppOutboundOptions): Promise<WhatsAppSendResult> {
    const fail = this.nextFailure ?? this.failUntilCleared;
    if (this.nextFailure) this.nextFailure = null;
    if (fail) return fail;
    const sid = mockSid();
    const body = opts.body ?? "";
    this.sent.push({ to, body, buttons: opts.buttons, at: new Date().toISOString(), providerMessageSid: sid });
    return { ok: true, providerMessageSid: sid };
  }

  clear(): void {
    this.sent.length = 0;
    this.nextFailure = null;
    this.failUntilCleared = null;
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

  async sendList(to: string, body: string, buttonText: string, items: WhatsAppButton[]): Promise<void> {
    const toDigits = to.replace(/\D/g, "");
    const rows = items.slice(0, 10).map((b) => ({
      id: b.id.slice(0, 200),
      title: b.title.slice(0, 24),
      description: (b.description ?? "").slice(0, 72)
    }));
    await this.graph(`${this.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      to: toDigits,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: body.slice(0, 1024) },
        action: {
          button: buttonText.slice(0, 20) || "View options",
          sections: [{ title: "Options", rows }]
        }
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
  private contentApiDisabledUntil = 0;

  constructor(private readonly opts: TwilioWhatsAppProviderOptions) {}

  private toWhatsAppAddress(to: string): string {
    const cleaned = to.replace(/^whatsapp:/i, "").trim();
    const e164 = cleaned.startsWith("+") ? cleaned : `+${cleaned.replace(/\D/g, "")}`;
    return `whatsapp:${e164}`;
  }

  private classifyTwilioError(code: string | undefined, httpStatus: number): WhatsAppSendResult["errorCategory"] {
    if (code === "63016" || code === "63024") return "SESSION_WINDOW";
    if (code === "21211" || code === "21614" || code === "21612") return "INVALID_NUMBER";
    if (httpStatus === 429 || httpStatus >= 500 || code === "20429") return "TRANSIENT";
    if (httpStatus >= 400 && httpStatus < 500) return "PROVIDER";
    return "UNKNOWN";
  }

  async sendOutbound(to: string, opts: WhatsAppOutboundOptions): Promise<WhatsAppSendResult> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.opts.accountSid}/Messages.json`;
    const auth = Buffer.from(`${this.opts.accountSid}:${this.opts.authToken}`).toString("base64");
    const params = new URLSearchParams({
      From: this.opts.fromWhatsApp,
      To: this.toWhatsAppAddress(to)
    });
    if (opts.contentSid) {
      params.set("ContentSid", opts.contentSid);
      if (opts.contentVariables && Object.keys(opts.contentVariables).length > 0) {
        params.set("ContentVariables", JSON.stringify(opts.contentVariables));
      }
    } else {
      const hints = (opts.buttons ?? []).slice(0, 3).map((b) => b.title).filter(Boolean);
      const body = opts.body ?? "";
      const combined =
        hints.length > 0 ? `${body.slice(0, 1400)}\n\nReply: ${hints.join(" · ")}` : body.slice(0, 1600);
      params.set("Body", combined);
    }
    if (opts.statusCallbackUrl) {
      params.set("StatusCallback", opts.statusCallbackUrl);
    }
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: params.toString()
      });
      const text = await res.text();
      let parsed: { sid?: string; error_code?: number; code?: number; message?: string; status?: string } = {};
      try {
        parsed = JSON.parse(text) as typeof parsed;
      } catch {
        parsed = {};
      }
      if (!res.ok) {
        const code = String(parsed.code ?? parsed.error_code ?? res.status);
        const category = this.classifyTwilioError(code, res.status);
        console.error("[whatsapp:twilio] send failed", res.status, code, (parsed.message ?? text).slice(0, 180));
        return {
          ok: false,
          errorCode: code,
          errorCategory: category === "SESSION_WINDOW" ? "TEMPLATE_REQUIRED" : category,
          errorMessage: (parsed.message ?? "WhatsApp send failed").slice(0, 180)
        };
      }
      const sid = parsed.sid;
      this.sent.push({
        to,
        body: opts.body ?? "",
        buttons: opts.buttons,
        at: new Date().toISOString(),
        providerMessageSid: sid
      });
      return { ok: true, providerMessageSid: sid };
    } catch {
      return { ok: false, errorCategory: "TRANSIENT", errorMessage: "WhatsApp send failed" };
    }
  }

  async sendText(to: string, body: string): Promise<void> {
    const result = await this.sendOutbound(to, { body });
    if (!result.ok) throw new Error("WhatsApp send failed");
  }

  private async createTwilioContent(
    kind: "quick-reply" | "list-picker",
    body: string,
    buttons: WhatsAppButton[],
    listButton?: string
  ): Promise<string | null> {
    if (!buttons.length) return null;
    if (Date.now() < this.contentApiDisabledUntil) return null;
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const auth = Buffer.from(`${this.opts.accountSid}:${this.opts.authToken}`).toString("base64");
    const types =
      kind === "list-picker"
        ? {
            "twilio/list-picker": {
              body: body.slice(0, 1024),
              button: (listButton || "View options").slice(0, 20),
              items: buttons.slice(0, 10).map((b) => ({
                id: b.id.slice(0, 200),
                item: b.title.slice(0, 24),
                description: (b.description ?? "").slice(0, 72)
              }))
            }
          }
        : {
            "twilio/quick-reply": {
              body: body.slice(0, 1024),
              actions: buttons.slice(0, 3).map((b) => ({
                type: "QUICK_REPLY",
                title: b.title.slice(0, 20),
                id: b.id.slice(0, 200)
              }))
            }
          };
    try {
      const res = await fetchImpl("https://content.twilio.com/v1/Content", {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          friendly_name: `duts_${kind.replace("-", "")}_${Date.now().toString(36)}_${Math.random()
            .toString(36)
            .slice(2, 8)}`,
          language: "en",
          types
        })
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          this.contentApiDisabledUntil = Date.now() + 60_000;
        }
        console.error("[whatsapp:twilio] content create failed", res.status);
        return null;
      }
      const json = (await res.json()) as { sid?: string };
      return json.sid ?? null;
    } catch {
      return null;
    }
  }

  async sendButtons(to: string, body: string, buttons: WhatsAppButton[]): Promise<void> {
    const contentSid = await this.createTwilioContent("quick-reply", body, buttons);
    if (contentSid) {
      const interactive = await this.sendOutbound(to, { contentSid, buttons, body });
      if (interactive.ok) return;
    }
    const result = await this.sendOutbound(to, { body, buttons });
    if (!result.ok) throw new Error("WhatsApp send failed");
  }

  async sendList(to: string, body: string, buttonText: string, items: WhatsAppButton[]): Promise<void> {
    const contentSid = await this.createTwilioContent("list-picker", body, items, buttonText);
    if (contentSid) {
      const interactive = await this.sendOutbound(to, { contentSid, buttons: items, body });
      if (interactive.ok) return;
    }
    const result = await this.sendOutbound(to, { body, buttons: items });
    if (!result.ok) throw new Error("WhatsApp send failed");
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
