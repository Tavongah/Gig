import { env } from "../config/env.js";
import { AppError } from "./errors.js";

export function isEmailConfigured(): boolean {
  return Boolean(env.SENDGRID_API_KEY?.trim() && env.EMAIL_FROM?.trim());
}

export interface TransactionalEmailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Send a transactional email via SendGrid.
 * In development (or when LOG_VERIFICATION_TO_CONSOLE is set) without SendGrid,
 * logs the message and succeeds so local flows still work.
 */
export async function sendTransactionalEmail(input: TransactionalEmailInput): Promise<{ ok: true }> {
  const to = input.to.trim().toLowerCase();
  const from = env.EMAIL_FROM?.trim();
  const apiKey = env.SENDGRID_API_KEY?.trim();

  if (env.NODE_ENV === "development" || env.LOG_VERIFICATION_TO_CONSOLE) {
    console.info(`[email] to=${to} subject=${input.subject}`);
    console.info(`[email] text=\n${input.text}`);
  }

  if (!apiKey || !from) {
    if (env.NODE_ENV === "development" || env.LOG_VERIFICATION_TO_CONSOLE) {
      console.warn("[email] SENDGRID_API_KEY / EMAIL_FROM not set — email stubbed (console only).");
      return { ok: true };
    }

    throw new AppError(
      "Email delivery is not configured. Please contact Duts Support.",
      503,
      "EMAIL_NOT_CONFIGURED",
      { email: "Email delivery is not configured." }
    );
  }

  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from, name: "Duts" },
      subject: input.subject,
      content: [
        { type: "text/plain", value: input.text },
        { type: "text/html", value: input.html }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error("[email] sendgrid_failed", {
      status: response.status,
      body: body.slice(0, 300)
    });
    throw new AppError(
      "We couldn’t send that email right now. Please try again in a few minutes.",
      502,
      "EMAIL_SEND_FAILED",
      { email: "Email provider rejected the message." }
    );
  }

  return { ok: true };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildSimpleEmail(params: {
  title: string;
  intro: string;
  actionLabel: string;
  actionUrl: string;
  footer?: string;
}): { text: string; html: string } {
  const footer =
    params.footer ??
    "If you didn’t request this, you can ignore this email. The link will expire automatically.";
  const text = `${params.title}\n\n${params.intro}\n\n${params.actionLabel}: ${params.actionUrl}\n\n${footer}`;
  const html = `<!DOCTYPE html>
<html>
  <body style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a;background:#f8fafc;padding:24px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:28px;border:1px solid #e2e8f0;">
      <tr><td>
        <h1 style="margin:0 0 12px;font-size:22px;">${escapeHtml(params.title)}</h1>
        <p style="margin:0 0 20px;color:#475569;">${escapeHtml(params.intro)}</p>
        <p style="margin:0 0 24px;">
          <a href="${escapeHtml(params.actionUrl)}" style="display:inline-block;background:#7B3FE4;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:700;">
            ${escapeHtml(params.actionLabel)}
          </a>
        </p>
        <p style="margin:0;font-size:12px;color:#94a3b8;">${escapeHtml(footer)}</p>
      </td></tr>
    </table>
  </body>
</html>`;
  return { text, html };
}
