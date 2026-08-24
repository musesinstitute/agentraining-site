// Minimal Resend client used only for Invite Learner email delivery.
//
// Plain fetch() to Resend's HTTP API - no SDK dependency, matching the
// existing house pattern for every other outbound integration in this repo
// (openai-transcribe.mjs's OpenAI call, pilot-data.mjs's Claude call): a
// bare API key from process.env, a single fetch(), no added package.
//
// Server-side only. Never imported by any browser-facing file.

const RESEND_API_URL = 'https://api.resend.com/emails';

// Thrown when INVITE_EMAIL_API_KEY / INVITE_EMAIL_FROM aren't configured
// yet. Kept distinct from a real delivery failure so callers can record
// "skipped_not_configured" separately from "failed" in their own audit
// trail, and so a fresh environment with no email setup at all behaves
// identically to a real provider outage from the invitation's point of
// view - either way, invitation creation itself must never be affected.
export class EmailNotConfiguredError extends Error {}

export async function sendEmail({ to, subject, html, text, replyTo }) {
  const apiKey = process.env.INVITE_EMAIL_API_KEY;
  const from = process.env.INVITE_EMAIL_FROM;
  if (!apiKey || !from) {
    throw new EmailNotConfiguredError('Email delivery is not configured (missing INVITE_EMAIL_API_KEY / INVITE_EMAIL_FROM).');
  }

  const body = { from, to, subject, html, text };
  if (replyTo) body.reply_to = replyTo;

  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Surface Resend's own message where available; never include the
    // request body (which carries the email content) in what gets thrown -
    // callers log only this message, never the body.
    throw new Error(data?.message || `Email provider request failed (${response.status}).`);
  }
  return { id: data?.id || '' };
}
