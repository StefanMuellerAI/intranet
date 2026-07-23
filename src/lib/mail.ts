import "server-only";

/**
 * Transaktionale E-Mails über die Brevo-API.
 * Absender: intranet@stefanai.de — Templates in deutscher Sprache,
 * Link zum jeweiligen Vorgang in jeder Mail.
 *
 * Ohne BREVO_API_KEY (lokale Entwicklung) werden Mails nur geloggt.
 */

const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

export interface MailRecipient {
  email: string;
  name?: string;
}

export async function sendMail(opts: {
  to: MailRecipient[];
  subject: string;
  heading: string;
  paragraphs: string[];
  /** Pfad innerhalb der App, z. B. /freigaben/urlaub/<id> */
  linkPath?: string;
  /** Alternativ: absolute URL (z. B. Clerk-Einladungslink) */
  linkUrl?: string;
  linkLabel?: string;
}): Promise<void> {
  const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
  const link =
    opts.linkUrl ?? (opts.linkPath ? `${baseUrl}${opts.linkPath}` : undefined);

  const htmlContent = `
<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a;">
  <div style="padding: 24px 0 12px; border-bottom: 2px solid #111;">
    <strong style="font-size: 16px;">StefanAI Intranet</strong>
  </div>
  <h2 style="font-size: 18px; margin: 24px 0 12px;">${escapeHtml(opts.heading)}</h2>
  ${opts.paragraphs
    .map(
      (p) =>
        `<p style="font-size: 14px; line-height: 1.6; margin: 0 0 12px;">${escapeHtml(p)}</p>`
    )
    .join("")}
  ${
    link
      ? `<p style="margin: 24px 0;"><a href="${link}" style="background: #111; color: #fff; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-size: 14px;">${escapeHtml(
          opts.linkLabel ?? "Vorgang öffnen"
        )}</a></p>`
      : ""
  }
  <p style="font-size: 12px; color: #777; margin-top: 32px; border-top: 1px solid #ddd; padding-top: 12px;">
    Diese Nachricht wurde automatisch vom StefanAI Mitarbeiter-Intranet versendet.<br/>
    StefanAI Solutions GmbH · Graeffstr. 5 · 50823 Köln
  </p>
</div>`;

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.log(
      `[Mail-Stub] An: ${opts.to.map((t) => t.email).join(", ")} — Betreff: ${opts.subject}${link ? ` — Link: ${link}` : ""}`
    );
    return;
  }

  const res = await fetch(BREVO_URL, {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: {
        name: process.env.MAIL_SENDER_NAME ?? "StefanAI Intranet",
        email: process.env.MAIL_SENDER_EMAIL ?? "intranet@stefanai.de",
      },
      to: opts.to,
      subject: opts.subject,
      htmlContent,
    }),
  });
  if (!res.ok) {
    console.error(
      `Brevo-Versand fehlgeschlagen (${res.status}): ${await res.text()}`
    );
  }
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
