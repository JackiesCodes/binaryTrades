import "server-only";

/**
 * Transactional email (verification and password-reset links) through Resend.
 * Set RESEND_API_KEY and EMAIL_FROM (an address on a domain verified in Resend,
 * e.g. "binaryTrades <no-reply@yourdomain.com>"). Without them, emails are not
 * sent: new accounts are treated as verified and password reset by email is off.
 */
export function emailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export function appUrl(request?: Request): string {
  const configured = process.env.APP_URL?.replace(/\/$/, "");
  if (configured) return configured;
  if (request) return new URL(request.url).origin;
  return "https://binarytrades.trading";
}

function layout(title: string, body: string, cta: { label: string; url: string }): string {
  return `<!doctype html><html><body style="margin:0;background:#0b120e;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#ede8d8">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="100%" style="max-width:480px;background:#111a14;border:1px solid #1f2b23;border-radius:16px" cellpadding="0" cellspacing="0"><tr><td style="padding:28px">
<div style="font-size:20px;font-weight:700;margin-bottom:16px">binary<span style="color:#85bb65">Trades</span></div>
<h1 style="font-size:18px;margin:0 0 12px">${title}</h1>
<p style="font-size:14px;line-height:1.6;color:#b9b4a6;margin:0 0 20px">${body}</p>
<a href="${cta.url}" style="display:inline-block;background:#85bb65;color:#0b120e;font-weight:600;text-decoration:none;padding:12px 18px;border-radius:10px">${cta.label}</a>
<p style="font-size:12px;line-height:1.6;color:#7d796e;margin:20px 0 0">If the button doesn't work, paste this link into your browser:<br><span style="color:#b9b4a6;word-break:break-all">${cta.url}</span></p>
<p style="font-size:12px;color:#7d796e;margin:16px 0 0">Didn't ask for this? You can ignore this email.</p>
</td></tr></table></td></tr></table></body></html>`;
}

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!emailEnabled()) throw new Error("Email is not configured");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, html }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Email provider returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export function verificationEmail(url: string) {
  return {
    subject: "Confirm your binaryTrades email",
    html: layout("Confirm your email", "Confirm this address to finish setting up your account. The link works for 48 hours.", {
      label: "Confirm email",
      url,
    }),
  };
}

export function resetEmail(url: string) {
  return {
    subject: "Reset your binaryTrades password",
    html: layout("Reset your password", "Someone (hopefully you) asked to reset your password. The link works for 1 hour and only once.", {
      label: "Choose a new password",
      url,
    }),
  };
}
