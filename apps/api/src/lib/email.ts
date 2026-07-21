import { env } from "../config/env.js";
import { AppError } from "./errors.js";

export function isEmailConfigured(): boolean {
  const from = Boolean(env.EMAIL_FROM?.trim());
  const hasProvider = Boolean(env.RESEND_API_KEY?.trim() || env.SENDGRID_API_KEY?.trim());
  return from && hasProvider;
}

export interface TransactionalEmailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Send transactional email.
 * Provider order: Resend (recommended free tier) → SendGrid → console stub when allowed.
 */
export async function sendTransactionalEmail(input: TransactionalEmailInput): Promise<{ ok: true }> {
  const to = input.to.trim().toLowerCase();
  const from = env.EMAIL_FROM?.trim();
  const resendKey = env.RESEND_API_KEY?.trim();
  const sendgridKey = env.SENDGRID_API_KEY?.trim();
  const allowConsoleStub = env.NODE_ENV === "development" || env.LOG_VERIFICATION_TO_CONSOLE;

  if (allowConsoleStub) {
    console.info(`[email] to=${to} subject=${input.subject}`);
    console.info(`[email] text=\n${input.text}`);
  }

  if (!from || (!resendKey && !sendgridKey)) {
    if (allowConsoleStub) {
      console.warn(
        "[email] No email provider configured — stubbed to console. Set RESEND_API_KEY (recommended) or SENDGRID_API_KEY + EMAIL_FROM."
      );
      return { ok: true };
    }

    throw new AppError(
      "Email delivery is not configured. Please contact Duts Support.",
      503,
      "EMAIL_NOT_CONFIGURED",
      { email: "Email delivery is not configured." }
    );
  }

  if (resendKey) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: `Duts <${from}>`,
        to: [to],
        subject: input.subject,
        text: input.text,
        html: input.html
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error("[email] resend_failed", { status: response.status, body: body.slice(0, 300) });
      throw new AppError(
        "We couldn’t send that email right now. Please try again in a few minutes.",
        502,
        "EMAIL_SEND_FAILED",
        { email: "Email provider rejected the message." }
      );
    }

    return { ok: true };
  }

  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sendgridKey}`,
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
    console.error("[email] sendgrid_failed", { status: response.status, body: body.slice(0, 300) });
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
