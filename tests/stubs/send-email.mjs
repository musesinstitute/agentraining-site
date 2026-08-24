// Test double for netlify/functions/lib/send-email.mjs, used only by tests
// via tests/loader.mjs. Never makes a real network call to Resend.

export class EmailNotConfiguredError extends Error {}

let __sentEmails = [];
let __mode = 'success'; // 'success' | 'fail' | 'not_configured'

export function __resetEmailStub() {
  __sentEmails = [];
  __mode = 'success';
}
export function __setEmailMode(mode) { __mode = mode; }
export function __getSentEmails() { return __sentEmails; }

export async function sendEmail({ to, subject, html, text, replyTo }) {
  if (__mode === 'not_configured') {
    throw new EmailNotConfiguredError('Email delivery is not configured (missing INVITE_EMAIL_API_KEY / INVITE_EMAIL_FROM).');
  }
  if (__mode === 'fail') {
    throw new Error('Simulated email provider failure');
  }
  __sentEmails.push({ to, subject, html, text, replyTo });
  return { id: 'stub-email-' + Math.random().toString(36).slice(2) };
}
